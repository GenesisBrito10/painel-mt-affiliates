import {
  Injectable,
  Logger,
  Inject,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import * as bcrypt from 'bcrypt';
import type { AffiliateLink, Prisma, User } from '@prisma/client';
import {
  LinkRequestStatus,
  NotificationType,
  UserRole,
  UserStatus,
} from '@prisma/client';
import type Redis from 'ioredis';
import {
  USER_REPOSITORY,
  type IUserRepository,
} from '../domain/repositories/user.repository.js';
import {
  CpfAlreadyInUseException,
  UserNotFoundException,
  EmailAlreadyInUseException,
  AffiliateLinkNotFoundException,
  DuplicateCampaignException,
  BettingHouseNotFoundException,
  AdminNotFoundException,
  UserBlockedException,
  BlockNotAllowedException,
  UserNotBlockedException,
  InvalidCpfException,
  UnderageException,
  ImmutableFieldException,
  OnboardingAlreadyCompleteException,
} from '../domain/exceptions/user.exceptions.js';
import { Cpf } from '../domain/value-objects/cpf.vo.js';
import { CompleteOnboardingDto } from './dto/complete-onboarding.dto.js';
import { NotificationService } from '../../notification/application/notification.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../../shared/shared.module.js';
import {
  UpdateBalanceBlockDto,
  GrantWithdrawalReleaseDto,
  UpdateExclusiveDealsDto,
  UpdateApiAccessDto,
  UpdateUserAdminDto,
  UpdateStatusDto,
  UpdateUserPasswordDto,
  UpsertBalanceAdjustmentDto,
  BalanceAdjustmentResponseDto,
} from './dto/update-user.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { ListUsersDto } from './dto/list-users.dto.js';
import { UserResponseDto, PaginatedResponse } from './dto/user-response.dto.js';
import {
  AffiliateLinkResponseDto,
  CreateAffiliateLinkDto,
  UpdateAffiliateLinkDto,
} from './dto/affiliate-link.dto.js';
import { filterLinksForActiveAgreements } from './membership-visibility.js';

/** Safety cap of rows returned by the affiliates export (mirrors ledger). */
export const AFFILIATE_EXPORT_MAX_ROWS = 10000;

/** Filter inputs shared by the affiliates listing and the export. */
export interface AffiliatesFilter {
  search?: string;
  role?: string;
  status?: string;
  bettingHouseId?: string;
  noLink?: string;
  referralDepth?: string;
}

/** One mapped affiliate row ready for CSV/PDF rendering. */
export interface AffiliateExportRow {
  name: string;
  email: string;
  status: string;
  referralOriginLabel: string;
  referredBy: { name: string; email: string } | null;
  memberships: Array<{
    houseName: string;
    commissionCpa: number;
    commissionRevshare: number;
  }>;
  createdAt: Date;
}

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);
  private readonly blockedEmailDomains = new Set([
    'mtafiliates.com.br',
  ]);

  constructor(
    @Inject(USER_REPOSITORY)
    private readonly repo: IUserRepository,
    private readonly notificationService: NotificationService,
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT)
    private readonly redis: Redis,
  ) {}

  // ─── User CRUD ─────────────────────────────────────────────────────────────

  async findById(id: string): Promise<UserResponseDto> {
    const user = await this.repo.findById(id);
    if (!user) throw new UserNotFoundException(id);
    const [requiresSuperbetAgreementRequest, hasReferrals] = await Promise.all([
      this.requiresSuperbetAgreementRequest(user),
      this.hasReferrals(user.id),
    ]);
    return this.toUserResponse(user, {
      requiresSuperbetAgreementRequest,
      hasReferrals,
    });
  }

  async findAll(
    dto: ListUsersDto,
  ): Promise<PaginatedResponse<UserResponseDto>> {
    const limit = dto.limit ?? 20;
    const { data, total, nextCursor } = await this.repo.findAll({
      role: dto.role,
      status: dto.status,
      search: dto.search,
      cursor: dto.cursor,
      limit,
    });

    return {
      data: data.map((u) => this.toUserResponse(u)),
      meta: { total, nextCursor, limit },
    };
  }

  async update(id: string, dto: UpdateUserAdminDto): Promise<UserResponseDto> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new UserNotFoundException(id);

    if (dto.email && dto.email !== existing.email) {
      const dup = await this.repo.findByEmail(dto.email);
      if (dup) throw new EmailAlreadyInUseException(dto.email);
    }

    let cpf: string | null | undefined;
    if (dto.cpf !== undefined) {
      if (!dto.cpf) {
        cpf = null;
      } else {
        const parsedCpf = Cpf.parse(dto.cpf);
        if (!parsedCpf) throw new InvalidCpfException();
        cpf = parsedCpf.value;

        if (cpf !== existing.cpf) {
          const duplicateCpf = await this.prisma.user.findFirst({
            where: {
              cpf,
              id: { not: id },
              deletedAt: null,
            },
            select: { id: true },
          });
          if (duplicateCpf) throw new CpfAlreadyInUseException();
        }
      }
    }

    const updated = await this.repo.update(id, {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.email !== undefined && { email: dto.email }),
      ...(dto.role !== undefined && { role: dto.role }),
      ...(dto.status !== undefined && { status: dto.status }),
      ...(dto.active !== undefined && { active: dto.active }),
      ...(dto.withdrawalBlocked !== undefined && {
        withdrawalBlocked: dto.withdrawalBlocked,
      }),
      ...(dto.ageVerified !== undefined && { ageVerified: dto.ageVerified }),
      // Personal profile fields (admin override)
      ...(dto.cpf !== undefined && { cpf }),
      ...(dto.whatsapp !== undefined && { whatsapp: dto.whatsapp || null }),
      ...(dto.pixKeyType !== undefined && { pixKeyType: dto.pixKeyType }),
      ...(dto.pixKey !== undefined && { pixKey: dto.pixKey }),
      ...(dto.bankName !== undefined && { bankName: dto.bankName }),
      ...(dto.bankAgency !== undefined && { bankAgency: dto.bankAgency }),
      ...(dto.bankAccount !== undefined && { bankAccount: dto.bankAccount }),
      ...(dto.accountHolder !== undefined && {
        accountHolder: dto.accountHolder,
      }),
    });

    return this.toUserResponse(updated);
  }

  async updatePassword(
    targetUserId: string,
    adminId: string,
    dto: UpdateUserPasswordDto,
  ): Promise<void> {
    if (targetUserId === adminId) {
      throw new ForbiddenException(
        'Use the account settings flow to change your own password.',
      );
    }

    const [target, admin] = await Promise.all([
      this.repo.findById(targetUserId),
      this.repo.findById(adminId),
    ]);

    if (!target) throw new UserNotFoundException(targetUserId);
    if (!admin) throw new AdminNotFoundException();

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const auditDetails: Prisma.InputJsonObject = {
      targetUserId,
      targetUserEmail: target.email,
      revokedRefreshTokens: true,
    };

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: targetUserId },
        data: { password: passwordHash },
      });

      await tx.refreshToken.updateMany({
        where: { userId: targetUserId, revoked: false },
        data: { revoked: true },
      });

      await tx.auditLog.create({
        data: {
          userId: adminId,
          userName: admin.name,
          userEmail: admin.email,
          action: 'ADMIN_UPDATE_USER_PASSWORD',
          resource: 'users',
          method: 'PATCH',
          path: `/admin/users/${targetUserId}/password`,
          details: auditDetails,
        },
      });
    });

    await this.redis.del(`auth:lockout:${target.email}`).catch(() => {
      /* non-critical */
    });

    this.logger.warn(
      `Admin ${adminId} changed password for user ${targetUserId}`,
    );
  }

  async getAdminAffiliateProfile(targetUserId: string, adminId: string) {
    const [target, admin, fulfilledRequests] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: targetUserId, deletedAt: null },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          status: true,
          active: true,
          withdrawalBlocked: true,
          exclusiveDealsAccess: true,
          apiAccessEnabled: true,
          bonusBalance: true,
          referralCode: true,
          cpf: true,
          birthDate: true,
          whatsapp: true,
          profileCompleted: true,
          pixKeyType: true,
          pixKey: true,
          bankName: true,
          bankAgency: true,
          bankAccount: true,
          accountHolder: true,
          createdAt: true,
          updatedAt: true,
          referredBy: { select: { id: true, name: true, email: true } },
          affiliateLinks: {
            where: { deletedAt: null },
            select: {
              id: true,
              bettingHouse: true,
              affiliateId: true,
              campaignId: true,
              cpa: true,
              revshare: true,
              createdAt: true,
              updatedAt: true,
            },
            orderBy: { bettingHouse: 'asc' },
          },
        },
      }),
      this.repo.findById(adminId),
      this.prisma.linkRequest.findMany({
        where: {
          userId: targetUserId,
          status: LinkRequestStatus.FULFILLED,
        },
        select: {
          bettingHouseSlug: true,
          dealId: true,
          status: true,
          links: true,
          deal: { select: { active: true } },
        },
      }),
    ]);

    if (!target) throw new UserNotFoundException(targetUserId);
    if (!admin) throw new AdminNotFoundException();

    const settings = await this.prisma.setting.findMany({
      where: {
        key: {
          in: [
            'min_withdrawal_amount',
            'withdrawal_fee_rate',
            'min_avg_deposit_per_cpa',
          ],
        },
      },
      select: { key: true, value: true },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: adminId,
        userName: admin.name,
        userEmail: admin.email,
        action: 'VIEW_AFFILIATE_SENSITIVE_PROFILE',
        resource: 'users',
        method: 'GET',
        path: `/admin/affiliates/${targetUserId}/profile`,
        details: {
          targetUserId,
          fields: ['email', 'name', 'cpf', 'whatsapp', 'pix'],
        } as any,
      },
    });

    const visibleLinks = filterLinksForActiveAgreements(
      target.affiliateLinks,
      fulfilledRequests,
    );

    return {
      ...target,
      bonusBalance: target.bonusBalance.toString(),
      affiliateLinks: visibleLinks.map((link) => ({
        ...link,
        cpa: link.cpa?.toString() ?? null,
        revshare: link.revshare?.toString() ?? null,
      })),
      settings: Object.fromEntries(settings.map((s) => [s.key, s.value])),
    };
  }

  async updateBalanceBlock(
    targetUserId: string,
    adminId: string,
    dto: UpdateBalanceBlockDto,
  ): Promise<UserResponseDto> {
    const [target, admin] = await Promise.all([
      this.repo.findById(targetUserId),
      this.repo.findById(adminId),
    ]);

    if (!target) throw new UserNotFoundException(targetUserId);
    if (!admin) throw new AdminNotFoundException();

    const updated = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: targetUserId },
        data: { withdrawalBlocked: dto.blocked },
      });
      await tx.auditLog.create({
        data: {
          userId: adminId,
          userName: admin.name,
          userEmail: admin.email,
          action: dto.blocked
            ? 'BLOCK_AFFILIATE_BALANCE'
            : 'UNBLOCK_AFFILIATE_BALANCE',
          resource: 'users',
          method: 'PATCH',
          path: `/admin/affiliates/${targetUserId}/balance-block`,
          details: {
            targetUserId,
            previousWithdrawalBlocked: target.withdrawalBlocked,
            withdrawalBlocked: dto.blocked,
            reason: dto.reason ?? '',
          } as any,
        },
      });
      return user;
    });

    this.notificationService
      .create({
        userId: targetUserId,
        type: NotificationType.GENERAL,
        title: dto.blocked
          ? 'Saldo bloqueado para saque'
          : 'Saldo liberado para saque',
        message: dto.blocked
          ? `Seu saldo foi bloqueado para novas solicitações de saque.${dto.reason ? ` Motivo: ${dto.reason}` : ''}`
          : 'Seu saldo foi liberado para novas solicitações de saque.',
        metadata: { withdrawalBlocked: dto.blocked, reason: dto.reason ?? '' },
      })
      .catch((err) =>
        this.logger.warn(`Balance block notification failed: ${err?.message}`),
      );

    this.redis.del(`user:status:${targetUserId}`).catch(() => {
      /* non-critical */
    });
    return this.toUserResponse(updated);
  }

  /**
   * Libera 1 saque EXTRA por casa no dia atual (bypass do rate-limit 1/dia/casa).
   * Idempotente: se já houver liberação não consumida hoje para a casa, retorna-a.
   * O consumo acontece no withdrawal.service quando o saque extra é criado.
   */
  async grantWithdrawalRelease(
    targetUserId: string,
    adminId: string,
    dto: GrantWithdrawalReleaseDto,
  ): Promise<{
    released: boolean;
    alreadyExisted: boolean;
    releaseId: string;
  }> {
    const bettingHouse = dto.bettingHouse.trim().toLowerCase();
    if (bettingHouse === 'bonus') {
      throw new BadRequestException(
        'Bônus não tem limite diário — liberação não se aplica.',
      );
    }

    const [target, admin] = await Promise.all([
      this.repo.findById(targetUserId),
      this.repo.findById(adminId),
    ]);
    if (!target) throw new UserNotFoundException(targetUserId);
    if (!admin) throw new AdminNotFoundException();

    // startOfDay LOCAL — casa com a janela do rate-limit em withdrawal.service.
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const existing = await this.prisma.withdrawalDayRelease.findFirst({
      where: {
        userId: targetUserId,
        bettingHouse,
        releaseDate: { gte: startOfDay },
        consumedAt: null,
      },
      select: { id: true },
    });
    if (existing) {
      return { released: true, alreadyExisted: true, releaseId: existing.id };
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const rel = await tx.withdrawalDayRelease.create({
        data: {
          userId: targetUserId,
          bettingHouse,
          releaseDate: startOfDay,
          reason: dto.reason ?? null,
          createdById: adminId,
          createdByName: admin.name,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: adminId,
          userName: admin.name,
          userEmail: admin.email,
          action: 'GRANT_WITHDRAWAL_RELEASE',
          resource: 'users',
          method: 'POST',
          path: `/admin/affiliates/${targetUserId}/withdrawal-release`,
          details: {
            targetUserId,
            bettingHouse,
            releaseId: rel.id,
            reason: dto.reason ?? '',
          } as any,
        },
      });
      return rel;
    });

    this.notificationService
      .create({
        userId: targetUserId,
        type: NotificationType.GENERAL,
        title: 'Saque extra liberado',
        message: `Foi liberado um saque adicional para ${bettingHouse} hoje.`,
        metadata: { bettingHouse, releaseId: created.id },
      })
      .catch((err) =>
        this.logger.warn(
          `Withdrawal release notification failed: ${err?.message}`,
        ),
      );

    return { released: true, alreadyExisted: false, releaseId: created.id };
  }

  /**
   * Marca/desmarca o usuário como "exclusivo": habilita ver deals exclusive=true
   * em /v1/link-requests/deals. Admin/superadmin enxerga tudo independentemente.
   */
  async updateExclusiveDealsAccess(
    targetUserId: string,
    adminId: string,
    dto: UpdateExclusiveDealsDto,
  ): Promise<UserResponseDto> {
    const [target, admin] = await Promise.all([
      this.repo.findById(targetUserId),
      this.repo.findById(adminId),
    ]);
    if (!target) throw new UserNotFoundException(targetUserId);
    if (!admin) throw new AdminNotFoundException();

    const updated = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: targetUserId },
        data: { exclusiveDealsAccess: dto.exclusive },
      });
      await tx.auditLog.create({
        data: {
          userId: adminId,
          userName: admin.name,
          userEmail: admin.email,
          action: dto.exclusive
            ? 'GRANT_EXCLUSIVE_DEALS_ACCESS'
            : 'REVOKE_EXCLUSIVE_DEALS_ACCESS',
          resource: 'users',
          method: 'PATCH',
          path: `/admin/affiliates/${targetUserId}/exclusive-deals`,
          details: {
            targetUserId,
            exclusiveDealsAccess: dto.exclusive,
            reason: dto.reason ?? '',
          } as any,
        },
      });
      return user;
    });

    // Sem notificação ao afiliado por decisão de produto (toggle silencioso).
    this.redis.del(`user:status:${targetUserId}`).catch(() => {
      /* non-critical */
    });
    return this.toUserResponse(updated);
  }

  /** Admin grants/revokes access to the API + Webhook features for a user. */
  async updateApiAccess(
    targetUserId: string,
    adminId: string,
    dto: UpdateApiAccessDto,
  ): Promise<UserResponseDto> {
    const [target, admin] = await Promise.all([
      this.repo.findById(targetUserId),
      this.repo.findById(adminId),
    ]);
    if (!target) throw new UserNotFoundException(targetUserId);
    if (!admin) throw new AdminNotFoundException();

    const updated = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: targetUserId },
        data: { apiAccessEnabled: dto.enabled },
      });
      await tx.auditLog.create({
        data: {
          userId: adminId,
          userName: admin.name,
          userEmail: admin.email,
          action: dto.enabled ? 'GRANT_API_ACCESS' : 'REVOKE_API_ACCESS',
          resource: 'users',
          method: 'PATCH',
          path: `/admin/affiliates/${targetUserId}/api-access`,
          details: {
            targetUserId,
            apiAccessEnabled: dto.enabled,
            reason: dto.reason ?? '',
          } as any,
        },
      });
      return user;
    });

    return this.toUserResponse(updated);
  }

  /**
   * Admin: define o ajuste manual de saldo POR CASA de um afiliado. É um valor
   * ABSOLUTO (SET, não incremental) — positivo credita, negativo abate. Entra
   * direto no saldo por casa em DashboardBalanceService (campo `adjustment`).
   * Upsert na unique (userId, bettingHouse).
   */
  async upsertBalanceAdjustment(
    targetUserId: string,
    adminId: string,
    dto: UpsertBalanceAdjustmentDto,
  ): Promise<BalanceAdjustmentResponseDto> {
    const [target, admin] = await Promise.all([
      this.repo.findById(targetUserId),
      this.repo.findById(adminId),
    ]);
    if (!target) throw new UserNotFoundException(targetUserId);
    if (!admin) throw new AdminNotFoundException();

    const bettingHouse = dto.bettingHouse.trim().toLowerCase();
    if (!bettingHouse) {
      throw new BadRequestException('Informe a casa do ajuste.');
    }
    // Só permite ajuste em casa realmente cadastrada (evita slug digitado errado
    // criando um bucket fantasma que nunca some no saldo).
    const house = await this.prisma.bettingHouse.findUnique({
      where: { slug: bettingHouse },
      select: { slug: true },
    });
    if (!house) {
      throw new BettingHouseNotFoundException(bettingHouse);
    }

    const reason = dto.reason?.trim() || null;

    const saved = await this.prisma.$transaction(async (tx) => {
      const row = await tx.balanceAdjustment.upsert({
        where: {
          userId_bettingHouse: { userId: targetUserId, bettingHouse },
        },
        create: {
          userId: targetUserId,
          bettingHouse,
          amount: dto.amount,
          reason,
          updatedById: adminId,
        },
        update: {
          amount: dto.amount,
          reason,
          updatedById: adminId,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: adminId,
          userName: admin.name,
          userEmail: admin.email,
          action: 'UPSERT_BALANCE_ADJUSTMENT',
          resource: 'users',
          method: 'PUT',
          path: `/admin/affiliates/${targetUserId}/balance-adjustments`,
          details: {
            targetUserId,
            bettingHouse,
            amount: dto.amount,
            reason: reason ?? '',
          } as any,
        },
      });
      return row;
    });

    return {
      bettingHouse: saved.bettingHouse,
      amount: saved.amount.toNumber(),
      reason: saved.reason,
      updatedAt: saved.updatedAt.toISOString(),
    };
  }

  /** Admin: lista os ajustes de saldo (por casa) de um afiliado. */
  async listBalanceAdjustments(
    targetUserId: string,
  ): Promise<BalanceAdjustmentResponseDto[]> {
    const target = await this.repo.findById(targetUserId);
    if (!target) throw new UserNotFoundException(targetUserId);

    const rows = await this.prisma.balanceAdjustment.findMany({
      where: { userId: targetUserId },
      orderBy: { bettingHouse: 'asc' },
    });
    return rows.map((r) => ({
      bettingHouse: r.bettingHouse,
      amount: r.amount.toNumber(),
      reason: r.reason,
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<UserResponseDto> {
    const user = await this.repo.findById(userId);
    if (!user) throw new UserNotFoundException(userId);

    if (dto.email !== undefined) {
      if (this.hasBlockedEmailDomain(dto.email)) {
        throw new BadRequestException('Informe um e-mail válido.');
      }

      if (dto.email !== user.email) {
        const existing = await this.repo.findByEmail(dto.email);
        if (existing && existing.id !== userId) {
          throw new EmailAlreadyInUseException(dto.email);
        }
      }
    }

    const updated = await this.repo.update(userId, {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.email !== undefined && { email: dto.email }),
      ...(dto.avatarUrl !== undefined && { avatarUrl: dto.avatarUrl }),
      ...(dto.pixKeyType !== undefined && { pixKeyType: dto.pixKeyType }),
      ...(dto.pixKey !== undefined && { pixKey: dto.pixKey }),
      ...(dto.bankName !== undefined && { bankName: dto.bankName }),
      ...(dto.bankAgency !== undefined && { bankAgency: dto.bankAgency }),
      ...(dto.bankAccount !== undefined && { bankAccount: dto.bankAccount }),
      ...(dto.accountHolder !== undefined && {
        accountHolder: dto.accountHolder,
      }),
    });

    return this.toUserResponse(updated);
  }

  private hasBlockedEmailDomain(email: string): boolean {
    const domain = email.split('@')[1]?.toLowerCase().trim();
    return !!domain && this.blockedEmailDomains.has(domain);
  }

  async updateStatus(
    id: string,
    dto: UpdateStatusDto,
    adminId: string,
  ): Promise<UserResponseDto> {
    const [user, admin] = await Promise.all([
      this.repo.findById(id),
      this.repo.findById(adminId),
    ]);

    if (!user) throw new UserNotFoundException(id);
    if (!admin) throw new AdminNotFoundException();

    // Guard: BLOCKED must go through the dedicated blockUser() flow
    if (dto.status === ('BLOCKED' as UserStatus)) {
      throw new BadRequestException(
        'Use a rota dedicada /users/:id/block para bloquear usuários.',
      );
    }

    // Atomic: status update + audit log + affiliate link in a single transaction
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id },
        data: { status: dto.status },
      });
      await tx.auditLog.create({
        data: {
          userId: adminId,
          userName: admin.name,
          userEmail: admin.email,
          action: 'UPDATE_STATUS',
          resource: 'users',
          method: 'PATCH',
          path: `/admin/users/${id}/status`,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          details: {
            oldStatus: user.status,
            newStatus: dto.status,
            targetUserId: id,
            ...(dto.bettingHouse
              ? {
                  bettingHouse: dto.bettingHouse,
                  cpa: dto.cpa,
                  revshare: dto.revshare,
                }
              : {}),
          } as any,
        },
      });

      // Create or update affiliate link when approving with commission info
      if (dto.status === UserStatus.APPROVED && dto.bettingHouse) {
        await this.upsertAffiliateLinkOnApproval(tx, id, dto);

        // Also create a PENDING LinkRequest so the admin can assign promotion links
        const existingRequest = await tx.linkRequest.findFirst({
          where: {
            userId: id,
            bettingHouseSlug: dto.bettingHouse,
            status: 'PENDING',
          },
        });
        if (!existingRequest) {
          const deal = await tx.deal.findFirst({
            where: { bettingHouseSlug: dto.bettingHouse, active: true },
            select: { id: true },
            orderBy: { createdAt: 'desc' },
          });
          await tx.linkRequest.create({
            data: {
              userId: id,
              bettingHouseSlug: dto.bettingHouse,
              dealId: deal?.id ?? null,
              message: `Aprovado por ${admin.name} com CPA R$${dto.cpa ?? 0} / Rev ${dto.revshare ?? 0}%`,
              status: 'PENDING',
            },
          });
        }
      }

      return u;
    });

    // Fire-and-forget: notify user about status change
    this.notificationService
      .create({
        userId: id,
        type: 'STATUS_CHANGE',
        title:
          dto.status === UserStatus.APPROVED
            ? '✅ Conta aprovada'
            : '🔄 Status atualizado',
        message:
          dto.status === UserStatus.APPROVED
            ? 'Sua conta foi aprovada! Solicite seu acordo no Marketplace para ter acesso ao painel.'
            : `Seu status foi alterado para ${dto.status}.`,
        metadata: { newStatus: dto.status },
      })
      .catch((err) =>
        this.logger.warn(`Status notification failed: ${err?.message}`),
      );

    // Invalidate JwtStrategy status cache so next request re-validates
    this.redis.del(`user:status:${id}`).catch(() => {
      /* non-critical */
    });

    this.logger.log(
      `User ${id} status changed to ${dto.status} by admin ${adminId}`,
    );
    return this.toUserResponse(updated);
  }

  // ─── Referrer approval by affiliate (non-admin) ────────────────────────────

  async approveByReferrer(
    targetUserId: string,
    referrerId: string,
    dto: UpdateStatusDto,
  ): Promise<UserResponseDto> {
    const [target, referrer] = await Promise.all([
      this.repo.findById(targetUserId),
      this.repo.findById(referrerId),
    ]);

    if (!target) throw new UserNotFoundException(targetUserId);
    if (!referrer) throw new UserNotFoundException(referrerId);

    // Só o convidante DIRETO pode aprovar — quem veio do convite dele. Aprovar
    // afiliado que ele não convidou é bloqueado (segurança).
    if (target.referredById !== referrerId) {
      throw new ForbiddenException('Você só pode aprovar quem você convidou.');
    }

    // Only PENDING users can be approved/rejected via this route
    if (target.status !== UserStatus.PENDING) {
      throw new BadRequestException(
        `Usuário já está com status ${target.status}.`,
      );
    }

    // Validate referrer ceiling when approving with commission info
    if (dto.status === UserStatus.APPROVED && dto.bettingHouse) {
      const referrerLink = await this.prisma.affiliateLink.findFirst({
        where: { userId: referrerId, bettingHouse: dto.bettingHouse },
        select: { cpa: true, revshare: true },
      });
      // Ter acordo na casa NÃO é mais obrigatório para aprovar um convidado. Se o
      // convidante tiver acordo, mantemos o teto de comissão; se não tiver, aprova
      // mesmo assim (sem checar teto).
      if (referrerLink) {
        if (
          dto.cpa !== undefined &&
          dto.cpa !== null &&
          referrerLink.cpa &&
          dto.cpa > referrerLink.cpa.toNumber()
        ) {
          throw new BadRequestException(
            `CPA não pode exceder seu teto de R$${referrerLink.cpa.toNumber()}.`,
          );
        }
        if (
          dto.revshare !== undefined &&
          dto.revshare !== null &&
          referrerLink.revshare &&
          dto.revshare > referrerLink.revshare.toNumber()
        ) {
          throw new BadRequestException(
            `RevShare não pode exceder seu teto de ${referrerLink.revshare.toNumber()}%.`,
          );
        }
      }
    }

    // Atomic: status update + audit log + affiliate link in a single transaction
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id: targetUserId },
        data: { status: dto.status },
      });
      await tx.auditLog.create({
        data: {
          userId: referrerId,
          userName: referrer.name,
          userEmail: referrer.email,
          action: 'UPDATE_STATUS',
          resource: 'users',
          method: 'PATCH',
          path: `/users/${targetUserId}/approve`,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          details: {
            oldStatus: target.status,
            newStatus: dto.status,
            targetUserId,
            approvedByReferrer: true,
            ...(dto.bettingHouse
              ? {
                  bettingHouse: dto.bettingHouse,
                  cpa: dto.cpa,
                  revshare: dto.revshare,
                }
              : {}),
          } as any,
        },
      });

      // Create or update affiliate link when approving with commission info
      if (dto.status === UserStatus.APPROVED && dto.bettingHouse) {
        await this.upsertAffiliateLinkOnApproval(tx, targetUserId, dto);

        // Also create a PENDING LinkRequest so the admin can assign promotion links
        const existingRequest = await tx.linkRequest.findFirst({
          where: {
            userId: targetUserId,
            bettingHouseSlug: dto.bettingHouse,
            status: 'PENDING',
          },
        });
        if (!existingRequest) {
          // Find the active deal for this house (if any)
          const deal = await tx.deal.findFirst({
            where: { bettingHouseSlug: dto.bettingHouse, active: true },
            select: { id: true },
            orderBy: { createdAt: 'desc' },
          });
          await tx.linkRequest.create({
            data: {
              userId: targetUserId,
              bettingHouseSlug: dto.bettingHouse,
              dealId: deal?.id ?? null,
              message: `Aprovado por ${referrer.name} com CPA R$${dto.cpa ?? 0} / Rev ${dto.revshare ?? 0}%`,
              status: 'PENDING',
            },
          });
        }
      }

      return u;
    });

    // Fire-and-forget: notify user about status change
    this.notificationService
      .create({
        userId: targetUserId,
        type: 'STATUS_CHANGE',
        title:
          dto.status === UserStatus.APPROVED
            ? '✅ Conta aprovada'
            : '❌ Conta recusada',
        message:
          dto.status === UserStatus.APPROVED
            ? `Sua conta foi aprovada por ${referrer.name}! Solicite seu acordo no Marketplace para ter acesso ao painel.`
            : `Sua solicitação foi recusada por ${referrer.name}.`,
        metadata: { newStatus: dto.status },
      })
      .catch((err) =>
        this.logger.warn(`Status notification failed: ${err?.message}`),
      );

    this.logger.log(
      `User ${targetUserId} status changed to ${dto.status} by referrer ${referrerId}`,
    );
    return this.toUserResponse(updated);
  }

  // ─── Referrer links for approval modal ────────────────────────────────────

  async getReferrerLinks(targetUserId: string): Promise<{
    data: Array<{
      bettingHouse: string;
      houseName: string;
      cpa: number;
      revshare: number;
    }>;
  }> {
    // Single raw SQL: get referrer's affiliate links with house names in one query
    const rows = await this.prisma.$queryRaw<
      Array<{
        bettingHouse: string;
        houseName: string;
        cpa: number | null;
        revshare: number | null;
      }>
    >`
      SELECT
        al."bettingHouse",
        COALESCE(bh.name, al."bettingHouse") AS "houseName",
        al.cpa,
        al.revshare
      FROM users u
      INNER JOIN affiliate_links al ON al."userId" = u."referredById"
      LEFT  JOIN betting_houses  bh ON bh.slug     = al."bettingHouse"
      WHERE u.id = ${targetUserId}
        AND u."referredById" IS NOT NULL
        AND al."deletedAt" IS NULL
        AND al."bettingHouse" = 'superbet'
    `;

    return {
      data: rows.map((r) => ({
        bettingHouse: r.bettingHouse,
        houseName: r.houseName,
        cpa: Number(r.cpa ?? 0),
        revshare: Number(r.revshare ?? 0),
      })),
    };
  }

  /**
   * F3 — Asserts that `callerId` is the direct referrer of `targetUserId`.
   * Self-approval is intentionally blocked: a user cannot act as their own approver.
   */
  async assertReferrerLinksAccess(
    targetUserId: string,
    callerId: string,
  ): Promise<void> {
    // Explicit self-approval block
    if (callerId === targetUserId) {
      throw new ForbiddenException('Um usuário não pode aprovar a si mesmo.');
    }
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { referredById: true },
    });
    if (target?.referredById !== callerId) {
      throw new ForbiddenException(
        'Acesso negado: você não é o convidante deste usuário.',
      );
    }
  }

  // ─── Affiliate link upsert on approval ──────────────────────────────────

  /**
   * Creates or updates an AffiliateLink when a user is approved with commission info.
   * Called inside the approval transaction to be atomic with the status change.
   * The campaignId is a placeholder — it gets replaced when a link request is fulfilled
   * (via admin, pool assignment, or syncAffiliateLink in link-request.service).
   */
  private async upsertAffiliateLinkOnApproval(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    targetUserId: string,
    dto: UpdateStatusDto,
  ): Promise<void> {
    if (!dto.bettingHouse) return;

    const existing = await (tx as any).affiliateLink.findFirst({
      where: { userId: targetUserId, bettingHouse: dto.bettingHouse },
      select: { id: true },
    });

    if (existing) {
      await (tx as any).affiliateLink.update({
        where: { id: existing.id },
        data: {
          ...(dto.cpa !== undefined && dto.cpa !== null
            ? { cpa: dto.cpa }
            : {}),
          ...(dto.revshare !== undefined && dto.revshare !== null
            ? { revshare: dto.revshare }
            : {}),
        },
      });
      this.logger.log(
        `Updated affiliate link for user ${targetUserId} in ${dto.bettingHouse}: CPA=${dto.cpa}, Rev=${dto.revshare}`,
      );
    } else {
      await (tx as any).affiliateLink.create({
        data: {
          userId: targetUserId,
          bettingHouse: dto.bettingHouse,
          campaignId: `pending_${dto.bettingHouse}_${targetUserId.slice(0, 8)}`,
          affiliateId: '',
          cpa: dto.cpa ?? null,
          revshare: dto.revshare ?? null,
        },
      });
      this.logger.log(
        `Created affiliate link for user ${targetUserId} in ${dto.bettingHouse}: CPA=${dto.cpa}, Rev=${dto.revshare}`,
      );
    }
  }

  // ─── AffiliateLink CRUD (UserModule owns this aggregate) ──────────────────

  async getAffiliateLinks(userId: string): Promise<AffiliateLinkResponseDto[]> {
    const user = await this.repo.findById(userId);
    if (!user) throw new UserNotFoundException(userId);
    const links = await this.repo.findAffiliateLinksByUser(userId);
    return links.map((l) => this.toLinkResponse(l));
  }

  async createAffiliateLink(
    userId: string,
    dto: CreateAffiliateLinkDto,
  ): Promise<AffiliateLinkResponseDto> {
    const user = await this.repo.findById(userId);
    if (!user) throw new UserNotFoundException(userId);

    const houseExists = await this.repo.bettingHouseExists(dto.bettingHouse);
    if (!houseExists) throw new BettingHouseNotFoundException(dto.bettingHouse);

    const duplicate = await this.repo.findAffiliateLinkByUniqueKey(
      dto.campaignId,
      dto.bettingHouse,
    );
    if (duplicate)
      throw new DuplicateCampaignException(dto.campaignId, dto.bettingHouse);

    const link = await this.repo.createAffiliateLink({
      userId,
      bettingHouse: dto.bettingHouse,
      campaignId: dto.campaignId,
      affiliateId: dto.affiliateId ?? '',
      cpa: dto.cpa ?? null,
      revshare: dto.revshare ?? null,
      userLink: dto.userLink ?? null,
    });

    return this.toLinkResponse(link);
  }

  async updateAffiliateLink(
    userId: string,
    linkId: string,
    dto: UpdateAffiliateLinkDto,
  ): Promise<AffiliateLinkResponseDto> {
    const link = await this.repo.findAffiliateLinkById(linkId);
    if (!link || link.userId !== userId)
      throw new AffiliateLinkNotFoundException();

    const updated = await this.repo.updateAffiliateLink(linkId, {
      ...(dto.affiliateId !== undefined && { affiliateId: dto.affiliateId }),
      ...(dto.cpa !== undefined && { cpa: dto.cpa }),
      ...(dto.revshare !== undefined && { revshare: dto.revshare }),
      ...(dto.userLink !== undefined && { userLink: dto.userLink }),
    });

    return this.toLinkResponse(updated);
  }

  async deleteAffiliateLink(userId: string, linkId: string): Promise<void> {
    const link = await this.repo.findAffiliateLinkById(linkId);
    if (!link || link.userId !== userId)
      throw new AffiliateLinkNotFoundException();
    await this.repo.deleteAffiliateLink(linkId);
  }

  // ─── Read methods exported for CommissionModule (Phase 2) ─────────────────

  async getFraudCount(userId: string, bettingHouse: string): Promise<number> {
    return this.repo.findFraudCount(userId, bettingHouse);
  }

  // ─── Block user (admin or direct referrer) ────────────────────────────────

  /**
   * Blocks a user, preventing login and removing them from the affiliate network.
   * Only the admin or the user's direct referrer can perform this action.
   * Action is audited and a notification is sent to the blocked user.
   */
  async blockUser(
    targetUserId: string,
    blockerId: string,
    isAdmin: boolean,
  ): Promise<UserResponseDto> {
    const [target, blocker] = await Promise.all([
      this.repo.findById(targetUserId),
      this.repo.findById(blockerId),
    ]);

    if (!target) throw new UserNotFoundException(targetUserId);
    if (!blocker) throw new UserNotFoundException(blockerId);

    // Self-block prevention — admin cannot lock themselves out
    if (targetUserId === blockerId) {
      throw new BlockNotAllowedException();
    }

    if (target.status === 'BLOCKED') {
      throw new UserBlockedException(targetUserId);
    }

    // Non-admin: must be the direct referrer
    if (!isAdmin) {
      if (target.referredById !== blockerId) {
        throw new BlockNotAllowedException();
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id: targetUserId },
        data: { status: 'BLOCKED', active: false },
      });
      await tx.auditLog.create({
        data: {
          userId: blockerId,
          userName: blocker.name,
          userEmail: blocker.email,
          action: 'BLOCK_USER',
          resource: 'users',
          method: 'POST',
          path: `/users/${targetUserId}/block`,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          details: {
            targetUserId,
            blockedByAdmin: isAdmin,
            previousStatus: target.status,
          } as any,
        },
      });
      return u;
    });

    // Fire-and-forget: notify the blocked user
    this.notificationService
      .create({
        userId: targetUserId,
        type: 'STATUS_CHANGE',
        title: '🚫 Conta bloqueada',
        message:
          'Sua conta foi bloqueada por atividade suspeita. Entre em contato com o suporte para mais informações.',
        metadata: { newStatus: 'BLOCKED', blockedBy: blockerId },
      })
      .catch((err) =>
        this.logger.warn(`Block notification failed: ${err?.message}`),
      );

    this.logger.log(
      `User ${targetUserId} BLOCKED by ${isAdmin ? 'admin' : 'referrer'} ${blockerId}`,
    );

    // Invalidate JwtStrategy status cache — ensures next request is rejected immediately
    this.redis.del(`user:status:${targetUserId}`).catch(() => {
      /* non-critical */
    });

    return this.toUserResponse(updated);
  }

  // ─── Unblock user (admin only) ───────────────────────────────────────

  /**
   * Unblocks a previously blocked user, restoring login access.
   * Admin-only action. Restores status to APPROVED and re-activates the account.
   */
  async unblockUser(
    targetUserId: string,
    adminId: string,
  ): Promise<UserResponseDto> {
    const [target, admin] = await Promise.all([
      this.repo.findById(targetUserId),
      this.repo.findById(adminId),
    ]);

    if (!target) throw new UserNotFoundException(targetUserId);
    if (!admin) throw new AdminNotFoundException();

    if (target.status !== 'BLOCKED') {
      throw new UserNotBlockedException(targetUserId);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id: targetUserId },
        data: { status: 'APPROVED', active: true },
      });
      await tx.auditLog.create({
        data: {
          userId: adminId,
          userName: admin.name,
          userEmail: admin.email,
          action: 'UNBLOCK_USER',
          resource: 'users',
          method: 'POST',
          path: `/admin/users/${targetUserId}/unblock`,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          details: { targetUserId, previousStatus: target.status } as any,
        },
      });
      return u;
    });

    // Fire-and-forget: notify the unblocked user
    this.notificationService
      .create({
        userId: targetUserId,
        type: 'STATUS_CHANGE',
        title: '✅ Conta desbloqueada',
        message:
          'Sua conta foi desbloqueada. Você já pode acessar a plataforma normalmente.',
        metadata: { newStatus: 'APPROVED', unblockedBy: adminId },
      })
      .catch((err) =>
        this.logger.warn(`Unblock notification failed: ${err?.message}`),
      );

    this.logger.log(`User ${targetUserId} UNBLOCKED by admin ${adminId}`);

    // Invalidate JwtStrategy status cache so user can authenticate again immediately
    this.redis.del(`user:status:${targetUserId}`).catch(() => {
      /* non-critical */
    });

    return this.toUserResponse(updated);
  }

  // ─── KYC Onboarding ─────────────────────────────────────────────────────

  /**
   * Completes the mandatory identity onboarding for an affiliate.
   *
   * Edge cases handled:
   * - CPF already registered to another account → 409 (unique constraint)
   * - Invalid CPF (algorithm) → 400
   * - User under 18 → 403 + auto-block
   * - Idempotent: if profileCompleted is already true → 409
   * - cpf/birthDate immutability is enforced here (first-set-only)
  /**
   * GET /users/me/onboarding/check-cpf
   * Lightweight check: validates CPF algorithm + uniqueness in DB.
   * Returns { available: true } if CPF is valid and not yet registered.
   */
  async checkCpfAvailability(
    rawCpf: string,
  ): Promise<{ available: boolean; reason?: string }> {
    const cpf = Cpf.parse(rawCpf);
    if (!cpf) return { available: false, reason: 'invalid' };

    // Use raw query to sidestep stale Prisma client cache on the cpf unique field
    // Table is mapped to "users" via @@map("users") in schema.prisma
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM users WHERE cpf = ${cpf.value} LIMIT 1
    `;
    if (rows.length > 0) return { available: false, reason: 'taken' };

    return { available: true };
  }

  /**
   * Complete mandatory KYC onboarding for an affiliate.
   * - CPF and birthDate are immutable after first submission
   * - Auto-blocks underage (< 18) accounts
   * - Admin users are never required to complete onboarding
   */
  async completeOnboarding(
    userId: string,
    dto: CompleteOnboardingDto,
  ): Promise<UserResponseDto> {
    const user = await this.repo.findById(userId);
    if (!user) throw new UserNotFoundException(userId);

    // Admins are exempt from onboarding
    if (user.role === 'ADMIN') {
      return this.toUserResponse(user);
    }

    // Idempotency guard — prevent re-submission
    if (user.profileCompleted) {
      throw new OnboardingAlreadyCompleteException();
    }

    // Validate CPF with Receita Federal algorithm
    const cpf = Cpf.parse(dto.cpf);
    if (!cpf) throw new InvalidCpfException();

    // 18+ validation — fail fast before any DB write
    const birth = new Date(dto.birthDate);
    if (isNaN(birth.getTime())) {
      throw new BadRequestException('Data de nascimento inválida.');
    }

    // Use UTC to avoid timezone edge cases on exact birthday
    const now = new Date();
    const todayUTC = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const birthUTC = new Date(
      Date.UTC(birth.getFullYear(), birth.getMonth(), birth.getDate()),
    );
    const age =
      todayUTC.getUTCFullYear() -
      birthUTC.getUTCFullYear() -
      (todayUTC <
      new Date(
        Date.UTC(
          todayUTC.getUTCFullYear(),
          birthUTC.getUTCMonth(),
          birthUTC.getUTCDate(),
        ),
      )
        ? 1
        : 0);

    if (age < 18) {
      // Auto-block the underage user and record audit
      await this.prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: userId },
          data: { status: 'BLOCKED', active: false },
        });
        await tx.auditLog.create({
          data: {
            userId,
            userName: user.name,
            userEmail: user.email,
            action: 'BLOCK_UNDERAGE',
            resource: 'users',
            method: 'POST',
            path: `/users/${userId}/onboarding`,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            details: {
              reason: 'User is under 18',
              birthDate: dto.birthDate,
              age,
            } as any,
          },
        });
      });
      this.logger.warn(
        `Underage user ${userId} blocked during onboarding (age=${age})`,
      );
      throw new UnderageException();
    }

    // Save all KYC data atomically
    // cpf and birthDate are stored as-is — Cpf VO raw digits
    let updated: User;
    try {
      updated = await this.prisma.$transaction(async (tx) => {
        const u = await tx.user.update({
          where: { id: userId },
          data: {
            cpf: cpf.value, // raw 11 digits (never formatted)
            birthDate: birth,
            whatsapp: dto.whatsapp,
            pixKeyType: dto.pixKeyType,
            pixKey: dto.pixKey,
            accountHolder: dto.accountHolder,
            profileCompleted: true,
          },
        });
        await tx.auditLog.create({
          data: {
            userId,
            userName: user.name,
            userEmail: user.email,
            action: 'COMPLETE_ONBOARDING',
            resource: 'users',
            method: 'POST',
            path: `/users/${userId}/onboarding`,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            details: { cpfMasked: cpf.masked } as any,
          },
        });
        return u;
      });
    } catch (err: unknown) {
      // P2002 = Prisma unique constraint violation (CPF already used)
      const prismaErr = err as { code?: string; meta?: { target?: string[] } };
      if (
        prismaErr?.code === 'P2002' &&
        prismaErr?.meta?.target?.includes('cpf')
      ) {
        throw new ImmutableFieldException('cpf (já cadastrado em outra conta)');
      }
      throw err;
    }

    this.logger.log(`User ${userId} completed onboarding (age=${age})`);
    return this.toUserResponse(updated);
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  // validateSuperbetApprovalAgreement and upsertApprovalLink removed:
  // Deal commission (CPA/RevShare) is now handled exclusively in
  // LinkRequestModule when a deal request is approved, not during
  // user status approval.

  // ─── Private mappers ──────────────────────────────────────────────────────

  // Regra removida: afiliado aprovado NÃO é mais obrigado a ter um acordo Superbet.
  // Antes, sem link/pedido Superbet este flag ficava true e o middleware do front
  // travava o usuário em /deals?required=superbet. Agora sempre false — ter acordo
  // (Superbet ou qualquer casa) é opcional; o usuário entra no painel normalmente.
  private async requiresSuperbetAgreementRequest(
    _user: User,
  ): Promise<boolean> {
    return false;
  }

  private toUserResponse(
    user: User,
    extra: {
      requiresSuperbetAgreementRequest?: boolean;
      hasReferrals?: boolean;
    } = {},
  ): UserResponseDto {
    // Mask CPF — full value is never exposed via API (security)
    const cpfMasked = user.cpf ? (Cpf.parse(user.cpf)?.masked ?? null) : null;
    return plainToInstance(
      UserResponseDto,
      {
        ...user,
        cpf: cpfMasked,
        bonusBalance: user.bonusBalance.toString(),
        requiresSuperbetAgreementRequest:
          extra.requiresSuperbetAgreementRequest ?? false,
        hasReferrals: extra.hasReferrals ?? false,
      },
      { excludeExtraneousValues: true },
    );
  }

  async getAdminAffiliateReferralOrigin(targetUserId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId, deletedAt: null },
      select: {
        id: true,
        name: true,
        email: true,
        referredById: true,
        createdAt: true,
      },
    });
    if (!user) throw new UserNotFoundException(targetUserId);

    const upline = await this.prisma.$queryRaw<
      Array<{ id: string; name: string; email: string; hop: number }>
    >`
      WITH RECURSIVE upline AS (
        SELECT id, name, email, "referredById", 0 AS hop
        FROM users
        WHERE id = ${targetUserId}::uuid AND "deletedAt" IS NULL
        UNION ALL
        SELECT p.id, p.name, p.email, p."referredById", u.hop + 1
        FROM users p
        INNER JOIN upline u ON p.id = u."referredById"
        WHERE p."deletedAt" IS NULL
      )
      SELECT id, name, email, hop
      FROM upline
      WHERE hop > 0
      ORDER BY hop DESC
    `;

    const referralDepth = upline.length;
    const [directReferrals, totalDownline] = await Promise.all([
      this.prisma.user.count({
        where: { referredById: targetUserId, deletedAt: null },
      }),
      this.networkDownlineCount(targetUserId),
    ]);

    return {
      userId: user.id,
      name: user.name,
      email: user.email,
      joinedAt: user.createdAt,
      referralDepth,
      isDirect: referralDepth === 0,
      originLabel:
        referralDepth === 0 ? 'Direto ao painel' : `Nível ${referralDepth}`,
      upline: upline.map((member, index) => ({
        id: member.id,
        name: member.name,
        email: member.email,
        depthFromRoot: index,
        depthToTarget: member.hop,
      })),
      directReferrer: upline.length
        ? {
            id: upline[upline.length - 1]!.id,
            name: upline[upline.length - 1]!.name,
            email: upline[upline.length - 1]!.email,
          }
        : null,
      directReferrals,
      totalDownline,
    };
  }

  // ─── Affiliates listing / export (shared WHERE + CTE) ──────────────────────

  /**
   * Builds the dynamic WHERE clause + recursive `referral_depths` CTE shared by
   * the paginated admin listing and the export. Returns the SQL fragments plus
   * the positional params already collected, and the next free param index so
   * callers can append LIMIT/OFFSET.
   */
  buildAffiliatesQueryBase(filters: AffiliatesFilter): {
    depthsCte: string;
    whereClause: string;
    params: unknown[];
    nextParamIdx: number;
  } {
    const conditions: string[] = ['u."deletedAt" IS NULL'];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (filters.search) {
      conditions.push(
        `(u.name ILIKE $${paramIdx} OR u.email ILIKE $${paramIdx})`,
      );
      params.push(`%${filters.search}%`);
      paramIdx++;
    }
    if (filters.role && filters.role !== 'all') {
      conditions.push(`u.role = $${paramIdx}`);
      params.push(filters.role.toUpperCase());
      paramIdx++;
    }
    if (filters.status && filters.status !== 'all') {
      conditions.push(`u.status = $${paramIdx}`);
      params.push(filters.status.toUpperCase());
      paramIdx++;
    }
    if (filters.noLink === 'true') {
      conditions.push(
        `NOT EXISTS (SELECT 1 FROM affiliate_links al2 WHERE al2."userId" = u.id)`,
      );
    }
    if (filters.bettingHouseId && filters.bettingHouseId !== 'all') {
      conditions.push(
        `EXISTS (SELECT 1 FROM affiliate_links al3 WHERE al3."userId" = u.id AND al3."bettingHouse" = $${paramIdx})`,
      );
      params.push(filters.bettingHouseId);
      paramIdx++;
    }
    if (filters.referralDepth && filters.referralDepth !== 'all') {
      switch (filters.referralDepth) {
        case 'direct':
        case '0':
          conditions.push(`u."referredById" IS NULL`);
          break;
        case '1':
          conditions.push(`rd.depth = 1`);
          break;
        case '2':
          conditions.push(`rd.depth = 2`);
          break;
        case '3':
          conditions.push(`rd.depth = 3`);
          break;
        case '4plus':
          conditions.push(`rd.depth >= 4`);
          break;
      }
    }

    const whereClause = conditions.join(' AND ');
    const depthsCte = `
      WITH RECURSIVE referral_depths AS (
        SELECT id, 0 AS depth
        FROM users
        WHERE "referredById" IS NULL AND "deletedAt" IS NULL
        UNION ALL
        SELECT u.id, rd.depth + 1
        FROM users u
        INNER JOIN referral_depths rd ON u."referredById" = rd.id
        WHERE u."deletedAt" IS NULL
      )`;

    return { depthsCte, whereClause, params, nextParamIdx: paramIdx };
  }

  /** Maps a referral depth to its human-readable origin label. */
  referralOriginLabel(depth: number | null): string {
    if (depth === null) return 'Indefinido';
    if (depth === 0) return 'Direto ao painel';
    return `Nível ${depth}`;
  }

  /**
   * Fetches every affiliate matching the given filters (no pagination) for
   * CSV/PDF export. Reuses the exact WHERE/CTE of the paginated listing.
   * A hard safety cap of 10.000 rows guards against abusive payloads.
   */
  async findAffiliatesForExport(
    filters: AffiliatesFilter,
  ): Promise<AffiliateExportRow[]> {
    // Scope the export to affiliates by default: without an explicit role the
    // base query would return every user (including ADMINs). Don't rely on the
    // frontend always sending `role=AFFILIATE` — enforce it server-side.
    const scoped: AffiliatesFilter = {
      ...filters,
      role: filters.role ?? 'AFFILIATE',
    };
    const { depthsCte, whereClause, params, nextParamIdx } =
      this.buildAffiliatesQueryBase(scoped);

    const dataSql = `${depthsCte}
      SELECT
        u.id,
        u.name,
        u.email,
        u.status,
        u."createdAt"      AS "createdAt",
        COALESCE(rd.depth, CASE WHEN u."referredById" IS NULL THEN 0 ELSE NULL END) AS "referralDepth",
        CASE WHEN r.id IS NOT NULL
             THEN jsonb_build_object('id', r.id, 'name', r.name, 'email', r.email)
             ELSE NULL
        END AS "referredBy",
        COALESCE(
          (SELECT jsonb_agg(jsonb_build_object(
            'bettingHouse',  al."bettingHouse",
            'houseName',     COALESCE(bh.name, al."bettingHouse"),
            'cpa',           al.cpa,
            'revshare',      al.revshare
          ))
          FROM affiliate_links al
          LEFT JOIN betting_houses bh ON bh.slug = al."bettingHouse"
          WHERE al."userId" = u.id),
          '[]'::jsonb
        ) AS "links"
      FROM users u
      LEFT JOIN referral_depths rd ON rd.id = u.id
      LEFT JOIN users r ON r.id = u."referredById"
      WHERE ${whereClause}
      ORDER BY u."createdAt" DESC
      LIMIT $${nextParamIdx}
    `;

    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        id: string;
        name: string;
        email: string;
        status: string;
        createdAt: Date;
        referralDepth: number | null;
        referredBy: { id: string; name: string; email: string } | null;
        links: Array<{
          bettingHouse: string;
          houseName: string;
          cpa: number | null;
          revshare: number | null;
        }>;
      }>
    >(dataSql, ...params, AFFILIATE_EXPORT_MAX_ROWS);

    return rows.map((u) => ({
      name: u.name,
      email: u.email,
      status: u.status,
      referralOriginLabel: this.referralOriginLabel(u.referralDepth),
      referredBy: u.referredBy
        ? { name: u.referredBy.name, email: u.referredBy.email }
        : null,
      memberships: (u.links ?? []).map((l) => ({
        houseName: l.houseName,
        commissionCpa: Number(l.cpa ?? 0),
        commissionRevshare: Number(l.revshare ?? 0),
      })),
      createdAt: u.createdAt,
    }));
  }

  /** Count all affiliates below userId (any depth). */
  private async networkDownlineCount(userId: string): Promise<number> {
    const rows = await this.prisma.$queryRaw<[{ count: bigint }]>`
      WITH RECURSIVE downline AS (
        SELECT id FROM users
        WHERE "referredById" = ${userId}::uuid AND "deletedAt" IS NULL
        UNION ALL
        SELECT u.id FROM users u
        INNER JOIN downline d ON u."referredById" = d.id
        WHERE u."deletedAt" IS NULL
      )
      SELECT COUNT(*)::bigint AS count FROM downline
    `;
    return Number(rows[0]?.count ?? 0);
  }

  private async hasReferrals(userId: string): Promise<boolean> {
    const count = await this.prisma.user.count({
      where: { referredById: userId, deletedAt: null },
    });
    return count > 0;
  }

  private toLinkResponse(link: AffiliateLink): AffiliateLinkResponseDto {
    return plainToInstance(
      AffiliateLinkResponseDto,
      {
        ...link,
        cpa: link.cpa?.toString() ?? null,
        revshare: link.revshare?.toString() ?? null,
      },
      { excludeExtraneousValues: true },
    );
  }
}
