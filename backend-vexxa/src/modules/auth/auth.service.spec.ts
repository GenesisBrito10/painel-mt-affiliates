import { describe, it, expect, beforeEach, beforeAll, vi, afterEach } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './application/auth.service.js';
import {
  InvalidCredentialsException,
  AccountInactiveException,
  AccountPendingException,
  AccountLockedException,
  EmailAlreadyRegisteredException,
} from './domain/exceptions/auth.exceptions.js';
import { UserRole, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

// Set in beforeAll — bcrypt cost=4 keeps tests fast
let HASHED_PASSWORD: string;

beforeAll(async () => {
  HASHED_PASSWORD = await bcrypt.hash('StrongPass@123', 4);
});

const makeActiveUser = () => ({
  id: 'user-uuid-1',
  email: 'user@vexxa.com',
  get password() { return HASHED_PASSWORD; },
  role: UserRole.AFFILIATE,
  status: UserStatus.APPROVED,
  active: true,
});

const makeRepo = () => ({
  findByEmail: vi.fn(),
  findByReferralCode: vi.fn(),
  findAdminIds: vi.fn().mockResolvedValue([]),
  createUser: vi.fn(),
});

const makeJwt = () => ({
  sign: vi.fn().mockReturnValue('mock-jwt-token'),
});

const makeNotification = () => ({
  create: vi.fn().mockResolvedValue({}),
  createMany: vi.fn().mockResolvedValue(0),
});

const makePrisma = () => ({
  user: {
    update: vi.fn().mockResolvedValue({}),
  },
  refreshToken: {
    create: vi.fn().mockResolvedValue({ id: 'rt-1' }),
    findUnique: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
  passwordResetToken: {
    create: vi.fn().mockResolvedValue({ id: 'prt-1' }),
    findUnique: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue({ id: 'prt-1' }),
  },
  $transaction: vi.fn((args: unknown[]) => Promise.all(args)),
});

const makeRedis = () => ({
  get: vi.fn().mockResolvedValue(null),
  incr: vi.fn().mockResolvedValue(1),
  expire: vi.fn().mockResolvedValue(1),
  del: vi.fn().mockResolvedValue(1),
  ttl: vi.fn().mockResolvedValue(900),
});

const makeMail = () => ({
  send: vi.fn().mockResolvedValue(undefined),
});

describe('AuthService', () => {
  let service: AuthService;
  let repo: ReturnType<typeof makeRepo>;
  let jwt: ReturnType<typeof makeJwt>;
  let notifications: ReturnType<typeof makeNotification>;
  let prisma: ReturnType<typeof makePrisma>;
  let redis: ReturnType<typeof makeRedis>;
  let mail: ReturnType<typeof makeMail>;

  beforeEach(() => {
    repo = makeRepo();
    jwt = makeJwt();
    notifications = makeNotification();
    prisma = makePrisma();
    redis = makeRedis();
    mail = makeMail();
    service = new AuthService(
      repo as never,
      jwt as unknown as JwtService,
      notifications as never,
      prisma as never,
      redis as never,
      mail as never,
    );
  });

  afterEach(() => vi.clearAllMocks());

  // ─── login ───────────────────────────────────────────────────────────────

  it('login returns AuthResponseDto with accessToken on valid credentials', async () => {
    repo.findByEmail.mockResolvedValue(makeActiveUser());
    const result = await service.login({ email: 'user@vexxa.com', password: 'StrongPass@123' });
    expect(result.accessToken).toBe('mock-jwt-token');
    expect(result.userId).toBe('user-uuid-1');
    expect(result.email).toBe('user@vexxa.com');
    expect(result.refreshToken).toBeDefined();
    expect(jwt.sign).toHaveBeenCalledOnce();
  });

  it('login throws InvalidCredentialsException when user not found', async () => {
    repo.findByEmail.mockResolvedValue(null);
    await expect(service.login({ email: 'ghost@vexxa.com', password: 'any' }))
      .rejects.toThrow(InvalidCredentialsException);
  });

  it('login throws InvalidCredentialsException when password wrong', async () => {
    repo.findByEmail.mockResolvedValue(makeActiveUser());
    await expect(service.login({ email: 'user@vexxa.com', password: 'WrongPassword!' }))
      .rejects.toThrow(InvalidCredentialsException);
  });

  it('login throws AccountInactiveException when user is inactive', async () => {
    repo.findByEmail.mockResolvedValue({ ...makeActiveUser(), active: false });
    await expect(service.login({ email: 'user@vexxa.com', password: 'StrongPass@123' }))
      .rejects.toThrow(AccountInactiveException);
  });

  it('login throws AccountInactiveException when status is REJECTED', async () => {
    repo.findByEmail.mockResolvedValue({ ...makeActiveUser(), status: UserStatus.REJECTED });
    await expect(service.login({ email: 'user@vexxa.com', password: 'StrongPass@123' }))
      .rejects.toThrow(AccountInactiveException);
  });

  it('login throws AccountPendingException when status is PENDING (awaiting approval)', async () => {
    repo.findByEmail.mockResolvedValue({ ...makeActiveUser(), status: UserStatus.PENDING });
    await expect(service.login({ email: 'user@vexxa.com', password: 'StrongPass@123' }))
      .rejects.toThrow(AccountPendingException);
  });

  // ─── register ────────────────────────────────────────────────────────────

  it('register creates user and returns AuthResponseDto', async () => {
    repo.findByEmail.mockResolvedValue(null);
    repo.findByReferralCode.mockResolvedValue(null);
    repo.createUser.mockResolvedValue({ id: 'new-uuid', email: 'new@vexxa.com', role: UserRole.AFFILIATE });

    const result = await service.register({ name: 'New User', email: 'new@vexxa.com', password: 'StrongPass@123' });

    expect(result.accessToken).toBe('mock-jwt-token');
    expect(result.refreshToken).toBeDefined();
    expect(repo.createUser).toHaveBeenCalledOnce();
    const call = repo.createUser.mock.calls[0]![0] as { password: string; referralCode: string };
    // Password must be hashed — never stored as plaintext
    expect(call.password).not.toBe('StrongPass@123');
    // ReferralCode VO: randomBytes(4).hex.toUpperCase() = 8 chars
    expect(call.referralCode).toHaveLength(8);
  });

  it('register throws EmailAlreadyRegisteredException when email taken', async () => {
    repo.findByEmail.mockResolvedValue(makeActiveUser());
    await expect(
      service.register({ name: 'Dup', email: 'user@vexxa.com', password: 'StrongPass@123' }),
    ).rejects.toThrow(EmailAlreadyRegisteredException);
    expect(repo.createUser).not.toHaveBeenCalled();
  });

  it('register resolves referredById from referral code', async () => {
    repo.findByEmail.mockResolvedValue(null);
    repo.findByReferralCode.mockResolvedValue({ id: 'referrer-uuid' });
    repo.createUser.mockResolvedValue({ id: 'new-uuid', email: 'ref@vexxa.com', role: UserRole.AFFILIATE });

    await service.register({ name: 'Referred', email: 'ref@vexxa.com', password: 'StrongPass@123', referralCode: 'ABCD1234' });

    const call = repo.createUser.mock.calls[0]![0] as { referredById: string };
    expect(call.referredById).toBe('referrer-uuid');
  });

  // ─── Password reset ─────────────────────────────────────────────────────

  describe('password reset', () => {
    it('forgotPassword creates a reset token and sends email for affiliate users', async () => {
      repo.findByEmail.mockResolvedValue(makeActiveUser());

      await service.forgotPassword({ email: 'user@vexxa.com' });

      expect(prisma.passwordResetToken.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-uuid-1',
          tokenHash: expect.any(String),
          expiresAt: expect.any(Date),
        },
      });
      expect(mail.send).toHaveBeenCalledWith(expect.objectContaining({
        to: 'user@vexxa.com',
        subject: 'Redefinição de senha - MT Affiliates',
        text: expect.stringContaining('Redefinir senha:'),
        html: expect.stringContaining('Redefinir senha'),
      }));
    });

    it('forgotPassword returns silently for unknown emails', async () => {
      repo.findByEmail.mockResolvedValue(null);

      await service.forgotPassword({ email: 'ghost@vexxa.com' });

      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
      expect(mail.send).not.toHaveBeenCalled();
    });

    it('forgotPassword returns silently for non-affiliate users', async () => {
      repo.findByEmail.mockResolvedValue({ ...makeActiveUser(), role: UserRole.ADMIN });

      await service.forgotPassword({ email: 'admin@vexxa.com' });

      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
      expect(mail.send).not.toHaveBeenCalled();
    });

    it('resetPassword updates password, marks token as used, revokes refresh tokens, and clears lockout', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'reset-token-id',
        userId: 'user-uuid-1',
        usedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        user: {
          id: 'user-uuid-1',
          email: 'user@vexxa.com',
          role: UserRole.AFFILIATE,
          active: true,
          status: UserStatus.APPROVED,
        },
      });

      await service.resetPassword({ token: 'raw-token', password: 'NewStrong@123' });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-uuid-1' },
        data: { password: expect.any(String) },
      });
      expect(prisma.passwordResetToken.update).toHaveBeenCalledWith({
        where: { id: 'reset-token-id' },
        data: { usedAt: expect.any(Date) },
      });
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-uuid-1', revoked: false },
        data: { revoked: true },
      });
      expect(redis.del).toHaveBeenCalledWith('auth:lockout:user@vexxa.com');
    });

    it('resetPassword rejects invalid tokens', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(null);

      await expect(
        service.resetPassword({ token: 'missing-token', password: 'NewStrong@123' }),
      ).rejects.toThrow('Token inválido ou expirado.');
    });

    it('resetPassword rejects expired or used tokens', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'reset-token-id',
        userId: 'user-uuid-1',
        usedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        user: {
          id: 'user-uuid-1',
          email: 'user@vexxa.com',
          role: UserRole.AFFILIATE,
          active: true,
          status: UserStatus.APPROVED,
        },
      });

      await expect(
        service.resetPassword({ token: 'used-token', password: 'NewStrong@123' }),
      ).rejects.toThrow('Token inválido ou expirado.');
    });
  });

  // ─── Lockout ──────────────────────────────────────────────────────────────

  describe('lockout', () => {
    it('throws AccountLockedException when account is locked (>= 5 failures)', async () => {
      // Arrange: Redis reports 5 failed attempts already stored
      redis.get.mockResolvedValue('5');
      redis.ttl.mockResolvedValue(720); // 12 min remaining

      // Act & Assert
      await expect(
        service.login({ email: 'locked@vexxa.com', password: 'any' }),
      ).rejects.toThrow(AccountLockedException);

      // No DB query should happen — lockout short-circuits before bcrypt
      expect(repo.findByEmail).not.toHaveBeenCalled();
    });

    it('does not lock when failure count is below threshold (< 5)', async () => {
      // Arrange: 4 failures registered — should not lock yet
      redis.get.mockResolvedValue('4');
      repo.findByEmail.mockResolvedValue(null);

      // Act & Assert: proceeds to credential check, fails with InvalidCredentials
      await expect(
        service.login({ email: 'user@vexxa.com', password: 'any' }),
      ).rejects.toThrow(InvalidCredentialsException);
    });

    it('records a failed login by incrementing Redis counter', async () => {
      // Arrange: no lock, no user found
      redis.get.mockResolvedValue(null);
      redis.incr.mockResolvedValue(1); // first failure
      repo.findByEmail.mockResolvedValue(null);

      // Act
      await expect(
        service.login({ email: 'target@vexxa.com', password: 'wrong' }),
      ).rejects.toThrow(InvalidCredentialsException);

      // Assert: INCR called with correct key prefix
      expect(redis.incr).toHaveBeenCalledWith(expect.stringContaining('auth:lockout:target@vexxa.com'));
      // On first failure, EXPIRE must be set
      expect(redis.expire).toHaveBeenCalledWith(
        expect.stringContaining('auth:lockout:target@vexxa.com'),
        900,
      );
    });

    it('does NOT set EXPIRE when counter is already > 1 (subsequent failures)', async () => {
      // Arrange: already has 2 failures
      redis.get.mockResolvedValue(null); // not locked yet
      redis.incr.mockResolvedValue(3);   // third failure — expire should NOT be reset
      repo.findByEmail.mockResolvedValue(null);

      await expect(
        service.login({ email: 'target@vexxa.com', password: 'wrong' }),
      ).rejects.toThrow(InvalidCredentialsException);

      expect(redis.expire).not.toHaveBeenCalled();
    });

    it('resets lockout counter after a successful login', async () => {
      // Arrange: no lock, valid user
      redis.get.mockResolvedValue(null);
      repo.findByEmail.mockResolvedValue(makeActiveUser());

      // Act
      await service.login({ email: 'user@vexxa.com', password: 'StrongPass@123' });

      // Assert: DEL called to clear the counter
      expect(redis.del).toHaveBeenCalledWith(
        expect.stringContaining('auth:lockout:user@vexxa.com'),
      );
    });
  });
});
