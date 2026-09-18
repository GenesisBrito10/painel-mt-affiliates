import {
  BadRequestException,
  Injectable,
  Inject,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { UserRole } from '@prisma/client';
import type Redis from 'ioredis';
import {
  AUTH_REPOSITORY,
  type IAuthRepository,
} from '../domain/repositories/auth.repository.js';
import {
  InvalidCredentialsException,
  AccountInactiveException,
  AccountPendingException,
  AccountBlockedException,
  EmailAlreadyRegisteredException,
  AccountLockedException,
  InvalidRefreshTokenException,
} from '../domain/exceptions/auth.exceptions.js';
import { ReferralCode } from '../../user/domain/value-objects/referral-code.vo.js';
import { NotificationService } from '../../notification/application/notification.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../../shared/shared.module.js';
import { MailService } from '../../mail/index.js';
import {
  LoginDto,
  RegisterDto,
  AuthResponseDto,
  ForgotPasswordDto,
  ResetPasswordDto,
} from './dto/auth.dto.js';
import type { JwtPayload, AuthTokens } from '../domain/auth.types.js';
import { REFRESH_TOKEN_EXPIRY_DAYS } from '../domain/auth.types.js';

const LOCKOUT_PREFIX = 'auth:lockout:';
const LOCKOUT_MAX_ATTEMPTS = 5;
const LOCKOUT_TTL_SECONDS = 900; // 15 minutes
const REFRESH_REUSE_GRACE_MS = 15_000;
const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(AUTH_REPOSITORY)
    private readonly repo: IAuthRepository,
    private readonly jwt: JwtService,
    private readonly notificationService: NotificationService,
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT)
    private readonly redis: Redis,
    private readonly mailService: MailService,
  ) {}

  async login(dto: LoginDto): Promise<AuthTokens & AuthResponseDto> {
    // ── Account lockout check ──────────────────────────────────────────────
    await this.checkLockout(dto.email);

    const user = await this.repo.findByEmail(dto.email);

    // Constant-time comparison prevents user enumeration
    if (!user || !(await bcrypt.compare(dto.password, user.password))) {
      await this.recordFailedLogin(dto.email);
      throw new InvalidCredentialsException();
    }

    // External (third-party panel) users are API-only shadow accounts and can
    // never log in. Treat like invalid credentials to avoid enumeration.
    if (user.isExternal) {
      throw new InvalidCredentialsException();
    }

    // PENDING: account exists but has not been approved yet
    if (user.status === 'PENDING') {
      throw new AccountPendingException();
    }

    // BLOCKED: banned by admin or referrer due to fraud
    if (user.status === 'BLOCKED') {
      throw new AccountBlockedException();
    }

    // REJECTED or deactivated by admin
    if (!user.active || user.status === 'REJECTED') {
      throw new AccountInactiveException();
    }

    // Login success — reset lockout counter
    await this.resetLockout(dto.email);

    return this.buildTokens(user.id, user.email, user.role);
  }

  async isEmailAvailable(email: string): Promise<boolean> {
    const existing = await this.repo.findByEmail(email.toLowerCase().trim());
    return !existing;
  }

  async register(dto: RegisterDto): Promise<AuthTokens & AuthResponseDto> {
    const existing = await this.repo.findByEmail(dto.email);
    if (existing) throw new EmailAlreadyRegisteredException(dto.email);

    const hash = await bcrypt.hash(dto.password, 12);

    // H02 fix — use domain Value Object instead of raw randomBytes
    const referralCode = ReferralCode.generate();

    let referredById: string | undefined;
    if (dto.referralCode) {
      const referrer = await this.repo.findByReferralCode(dto.referralCode);
      referredById = referrer?.id;
    }

    const user = await this.repo.createUser({
      name: dto.name,
      email: dto.email,
      password: hash,
      referralCode: referralCode.value,
      referredById,
    });

    // Fire-and-forget: notify admins + referrer about the new pending registration
    this.dispatchRegistrationNotifications(
      user.id,
      dto.name,
      user.email,
      referredById,
    ).catch((err) =>
      this.logger.warn(`Registration notification failed: ${err?.message}`),
    );

    return this.buildTokens(user.id, user.email, user.role);
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<void> {
    const user = await this.repo.findByEmail(dto.email);

    if (
      !user ||
      user.isExternal ||
      user.role !== UserRole.AFFILIATE ||
      !user.active ||
      user.status === 'BLOCKED' ||
      user.status === 'REJECTED'
    ) {
      return;
    }

    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);

    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    const resetUrl = this.buildAffiliateResetUrl(rawToken);
    const template = this.buildPasswordResetEmail(user.email, resetUrl);

    await this.mailService
      .send({
        to: user.email,
        subject: template.subject,
        text: template.text,
        html: template.html,
      })
      .catch((error: Error) => {
        this.logger.error(
          `Password reset email failed for ${user.email}: ${error.message}`,
        );
      });
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const tokenHash = this.hashToken(dto.token);

    const row = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            active: true,
            status: true,
            isExternal: true,
          },
        },
      },
    });

    if (
      !row ||
      row.usedAt ||
      row.expiresAt < new Date() ||
      row.user.isExternal ||
      row.user.role !== UserRole.AFFILIATE ||
      !row.user.active ||
      row.user.status === 'BLOCKED' ||
      row.user.status === 'REJECTED'
    ) {
      throw new BadRequestException('Token inválido ou expirado.');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const now = new Date();

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: row.userId },
        data: { password: passwordHash },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: row.id },
        data: { usedAt: now },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: row.userId, revoked: false },
        data: { revoked: true },
      }),
    ]);

    await this.resetLockout(row.user.email);
  }

  // ─── Refresh Token ──────────────────────────────────────────────────────────

  async refresh(rawToken: string): Promise<AuthTokens & AuthResponseDto> {
    const tokenHash = this.hashToken(rawToken);

    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        userId: true,
        familyId: true,
        revoked: true,
        expiresAt: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            status: true,
            active: true,
          },
        },
      },
    });

    // Token not found
    if (!stored) {
      throw new InvalidRefreshTokenException();
    }

    // Browser reloads, HMR, retries, or two tabs can briefly present the token
    // that was just rotated. Recover that benign duplicate instead of revoking
    // the whole family and logging the user out.
    if (stored.revoked) {
      const duplicateRefresh = await this.recoverRecentDuplicateRefresh(stored);
      if (duplicateRefresh) return duplicateRefresh;

      this.logger.warn(
        `Refresh token reuse detected! Revoking family ${stored.familyId} for user ${stored.userId}`,
      );
      await this.prisma.refreshToken.updateMany({
        where: { familyId: stored.familyId },
        data: { revoked: true },
      });
      throw new InvalidRefreshTokenException();
    }

    // Token expired
    if (stored.expiresAt < new Date()) {
      await this.prisma.refreshToken.update({
        where: { id: stored.id },
        data: { revoked: true },
      });
      throw new InvalidRefreshTokenException();
    }

    // Account status re-validation (defense in depth)
    const user = stored.user;
    if (
      !user.active ||
      user.status === 'BLOCKED' ||
      user.status === 'REJECTED'
    ) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: user.id },
        data: { revoked: true },
      });
      throw new InvalidRefreshTokenException();
    }

    // Rotate: revoke current, issue new with same familyId
    const newRawToken = randomUUID();
    const newHash = this.hashToken(newRawToken);
    const expiresAt = new Date(
      Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    );

    await this.prisma.$transaction([
      this.prisma.refreshToken.update({
        where: { id: stored.id },
        data: { revoked: true },
      }),
      this.prisma.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: newHash,
          familyId: stored.familyId,
          expiresAt,
        },
      }),
    ]);

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    return {
      accessToken: this.jwt.sign(payload),
      refreshToken: newRawToken,
      userId: user.id,
      email: user.email,
      role: user.role,
    };
  }

  private async recoverRecentDuplicateRefresh(stored: {
    id: string;
    userId: string;
    familyId: string;
    createdAt: Date;
    user: {
      id: string;
      email: string;
      role: string;
      status: string;
      active: boolean;
    };
  }): Promise<(AuthTokens & AuthResponseDto) | null> {
    const recentCutoff = new Date(Date.now() - REFRESH_REUSE_GRACE_MS);

    const activeSuccessor = await this.prisma.refreshToken.findFirst({
      where: {
        familyId: stored.familyId,
        revoked: false,
        expiresAt: { gt: new Date() },
        createdAt: { gt: stored.createdAt, gte: recentCutoff },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    if (!activeSuccessor) return null;

    const user = stored.user;
    if (
      !user.active ||
      user.status === 'BLOCKED' ||
      user.status === 'REJECTED'
    ) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: user.id },
        data: { revoked: true },
      });
      throw new InvalidRefreshTokenException();
    }

    this.logger.debug(`Recovered duplicate refresh for user ${stored.userId}`);

    const newRawToken = randomUUID();
    const newHash = this.hashToken(newRawToken);
    const expiresAt = new Date(
      Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    );

    await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({
        where: { familyId: stored.familyId, revoked: false },
        data: { revoked: true },
      }),
      this.prisma.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: newHash,
          familyId: stored.familyId,
          expiresAt,
        },
      }),
    ]);

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role as JwtPayload['role'],
    };
    return {
      accessToken: this.jwt.sign(payload),
      refreshToken: newRawToken,
      userId: user.id,
      email: user.email,
      role: user.role,
    };
  }

  // ─── Logout ─────────────────────────────────────────────────────────────────

  async logout(rawToken: string): Promise<void> {
    const tokenHash = this.hashToken(rawToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: { familyId: true },
    });

    if (stored) {
      // Revoke entire family to invalidate any leaked tokens from same session
      await this.prisma.refreshToken.updateMany({
        where: { familyId: stored.familyId },
        data: { revoked: true },
      });
    }
  }

  /**
   * Revoke all refresh tokens for a user — called when user is blocked.
   */
  async revokeAllUserTokens(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revoked: false },
      data: { revoked: true },
    });
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private async dispatchRegistrationNotifications(
    newUserId: string,
    newUserName: string,
    newUserEmail: string,
    referredById?: string,
  ): Promise<void> {
    const adminIds = await this.repo.findAdminIds();
    const targetIds = [...adminIds];

    // Also notify the referrer if they're not already an admin
    if (referredById && !adminIds.includes(referredById)) {
      targetIds.push(referredById);
    }

    if (targetIds.length === 0) return;

    const notifications = targetIds.map((userId) => ({
      userId,
      type: 'REGISTRATION' as const,
      title: '👤 Novo afiliado pendente',
      message: `Um novo afiliado se registrou e aguarda aprovação.`,
      metadata: { newUserId, newUserName, newUserEmail },
    }));

    await this.notificationService.createMany(notifications);
  }

  private async buildTokens(
    id: string,
    email: string,
    role: string,
  ): Promise<AuthTokens & AuthResponseDto> {
    const payload: JwtPayload = {
      sub: id,
      email,
      role: role as JwtPayload['role'],
    };
    const accessToken = this.jwt.sign(payload);

    // Create refresh token: random UUID, SHA-256 stored in DB
    const rawRefreshToken = randomUUID();
    const tokenHash = this.hashToken(rawRefreshToken);
    const familyId = randomUUID();
    const expiresAt = new Date(
      Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    );

    await this.prisma.refreshToken.create({
      data: { userId: id, tokenHash, familyId, expiresAt },
    });

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      userId: id,
      email,
      role,
    };
  }

  private hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  private buildAffiliateResetUrl(rawToken: string): string {
    const baseUrl = (
      process.env['AFFILIATE_PANEL_URL'] ||
      'https://affiliates.mtafiliates.com.br'
    ).replace(/\/+$/, '');
    return `${baseUrl}/auth/reset-password?token=${encodeURIComponent(rawToken)}`;
  }

  private buildPasswordResetEmail(
    email: string,
    resetUrl: string,
  ): {
    subject: string;
    text: string;
    html: string;
  } {
    const safeEmail = this.escapeHtml(email);
    const safeResetUrl = this.escapeHtml(resetUrl);
    const panelUrl = (
      process.env['AFFILIATE_PANEL_URL'] ||
      'https://affiliates.mtafiliates.com.br'
    ).replace(/\/+$/, '');
    const logoUrl = this.escapeHtml(`${panelUrl}/mt-affiliates-logo.png`);

    return {
      subject: 'Redefinição de senha - MT Affiliates',
      text: [
        'Olá,',
        '',
        `Recebemos uma solicitação para redefinir a senha da conta ${email}.`,
        'Este link expira em 30 minutos e só pode ser usado uma vez.',
        '',
        `Redefinir senha: ${resetUrl}`,
        '',
        'Se você não solicitou essa alteração, ignore este e-mail.',
        '',
        'Equipe MT Affiliates',
      ].join('\n'),
      html: `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#172033;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f6f8;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="background:#111827;padding:24px 28px;">
                <p style="margin:0;color:#f5b301;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;">MT Affiliates</p>
                <h1 style="margin:8px 0 0;color:#ffffff;font-size:24px;line-height:1.25;">Redefinição de senha</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <p style="margin:0 0 14px;font-size:15px;line-height:1.6;">Olá,</p>
                <p style="margin:0 0 14px;font-size:15px;line-height:1.6;">Recebemos uma solicitação para redefinir a senha da conta <strong>${safeEmail}</strong>.</p>
                <p style="margin:0 0 22px;font-size:15px;line-height:1.6;">Este link expira em <strong>30 minutos</strong> e só pode ser usado uma vez.</p>
                <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 22px;">
                  <tr>
                    <td style="border-radius:8px;background:#f5b301;">
                      <a href="${safeResetUrl}" style="display:inline-block;padding:13px 18px;color:#111827;text-decoration:none;font-size:14px;font-weight:700;">Redefinir senha</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 18px;font-size:13px;line-height:1.6;color:#5f6b7a;">Se o botão não funcionar, copie e cole este link no navegador:<br><a href="${safeResetUrl}" style="color:#7c3aed;word-break:break-all;">${safeResetUrl}</a></p>
                <p style="margin:0;font-size:13px;line-height:1.6;color:#5f6b7a;">Se você não solicitou essa alteração, ignore este e-mail.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px;border-top:1px solid #e5e7eb;">
                <img src="${logoUrl}" width="118" alt="MT Affiliates" style="display:block;width:118px;max-width:118px;height:auto;border:0;outline:none;text-decoration:none;">
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
    };
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ─── Account lockout (anti-brute-force) ─────────────────────────────────

  private async checkLockout(email: string): Promise<void> {
    const key = `${LOCKOUT_PREFIX}${email.toLowerCase()}`;
    const attempts = await this.redis.get(key);
    if (attempts && parseInt(attempts, 10) >= LOCKOUT_MAX_ATTEMPTS) {
      const ttl = await this.redis.ttl(key);
      throw new AccountLockedException(ttl > 0 ? ttl : LOCKOUT_TTL_SECONDS);
    }
  }

  private async recordFailedLogin(email: string): Promise<void> {
    const key = `${LOCKOUT_PREFIX}${email.toLowerCase()}`;
    const current = await this.redis.incr(key);
    if (current === 1) {
      // First failure — set expiry
      await this.redis.expire(key, LOCKOUT_TTL_SECONDS);
    }
  }

  private async resetLockout(email: string): Promise<void> {
    const key = `${LOCKOUT_PREFIX}${email.toLowerCase()}`;
    await this.redis.del(key);
  }
}
