import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { UserStatus, UserRole } from '@prisma/client';
import { UserService } from './application/user.service.js';
import { USER_REPOSITORY } from './domain/repositories/user.repository.js';
import { NotificationService } from '../notification/application/notification.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../shared/shared.module.js';
import {
  UserNotFoundException,
  InvalidCpfException,
  UnderageException,
  ImmutableFieldException,
  OnboardingAlreadyCompleteException,
} from './domain/exceptions/user.exceptions.js';

// ─── Valid CPF for tests (passes Módulo 11) ──────────────────────────────────
// 529.982.247-25 → digits: 52998224725
const VALID_CPF = '52998224725';
const VALID_CPF_FORMATTED = '529.982.247-25';

// Invalid by algorithm
const INVALID_CPF = '11111111111';

// Another valid CPF for "taken" scenarios: 024.002.611-05
const TAKEN_CPF = '02400261105';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const makeBaseUser = (overrides = {}) => ({
  id: 'user-uuid-onboarding',
  name: 'KYC Test User',
  email: 'kyc@vexxa.com',
  password: '$2b$12$hash',
  role: UserRole.AFFILIATE,
  status: UserStatus.APPROVED,
  active: true,
  ageVerified: false,
  profileCompleted: false,
  withdrawalBlocked: false,
  bonusBalance: { toString: () => '0.00' },
  referralCode: null,
  referredById: null,
  cpf: null,
  birthDate: null,
  whatsapp: null,
  pixKeyType: '',
  pixKey: '',
  bankName: '',
  bankAgency: '',
  bankAccount: '',
  accountHolder: '',
  depositComplianceAlertCount: 0,
  depositCompliancePenalizedAt: null,
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeValidOnboardingDto = (overrides = {}) => ({
  cpf: VALID_CPF_FORMATTED,
  birthDate: '1996-05-15',
  whatsapp: '(11) 99999-9999',
  pixKeyType: 'cpf',
  pixKey: '52998224725',
  accountHolder: 'KYC Test User',
  ...overrides,
});

// ─── Mock factories ──────────────────────────────────────────────────────────

const makeRepo = () => ({
  findById: vi.fn(),
  findByEmail: vi.fn(),
  findAll: vi.fn(),
  update: vi.fn(),
  findAffiliateLinksByUser: vi.fn(),
  findAffiliateLinkById: vi.fn(),
  findAffiliateLinkByUniqueKey: vi.fn(),
  createAffiliateLink: vi.fn(),
  updateAffiliateLink: vi.fn(),
  deleteAffiliateLink: vi.fn(),
  findFraudCount: vi.fn(),
  createAuditLog: vi.fn(),
  bettingHouseExists: vi.fn(),
  updateStatusWithAudit: vi.fn(),
});

const makeNotificationMock = () => ({
  create: vi.fn().mockResolvedValue(undefined),
});

const makeRedisMock = () => ({
  del: vi.fn().mockResolvedValue(1),
});

const makePrismaMock = () => {
  const prisma: Record<string, any> = {
    user: { findUnique: vi.fn(), update: vi.fn() },
    affiliateLink: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    bettingHouse: { findMany: vi.fn() },
    auditLog: { create: vi.fn() },
    $queryRaw: vi.fn(),
  };
  prisma['$transaction'] = vi.fn((fn: (tx: typeof prisma) => unknown) => fn(prisma));
  return prisma;
};

// ─── Test suite ──────────────────────────────────────────────────────────────

describe('UserService — KYC Onboarding', () => {
  let service: UserService;
  let repo: ReturnType<typeof makeRepo>;
  let prisma: ReturnType<typeof makePrismaMock>;
  let notificationMock: ReturnType<typeof makeNotificationMock>;
  let redisMock: ReturnType<typeof makeRedisMock>;

  beforeEach(async () => {
    repo = makeRepo();
    prisma = makePrismaMock();
    notificationMock = makeNotificationMock();
    redisMock = makeRedisMock();

    const module = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: USER_REPOSITORY, useValue: repo },
        { provide: NotificationService, useValue: notificationMock },
        { provide: PrismaService, useValue: prisma },
        { provide: REDIS_CLIENT, useValue: redisMock },
      ],
    }).compile();

    service = module.get(UserService);
  });

  afterEach(() => vi.clearAllMocks());

  // ═══════════════════════════════════════════════════════════════════════════
  //  checkCpfAvailability
  // ═══════════════════════════════════════════════════════════════════════════

  describe('checkCpfAvailability', () => {
    it('returns { available: false, reason: "invalid" } for invalid CPF (all same digits)', async () => {
      const result = await service.checkCpfAvailability(INVALID_CPF);
      expect(result).toEqual({ available: false, reason: 'invalid' });
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('returns { available: false, reason: "invalid" } for empty string', async () => {
      const result = await service.checkCpfAvailability('');
      expect(result).toEqual({ available: false, reason: 'invalid' });
    });

    it('returns { available: false, reason: "invalid" } for CPF with wrong length', async () => {
      const result = await service.checkCpfAvailability('1234567');
      expect(result).toEqual({ available: false, reason: 'invalid' });
    });

    it('returns { available: false, reason: "taken" } when CPF already exists in DB', async () => {
      prisma.$queryRaw.mockResolvedValue([{ id: 'existing-user-id' }]);
      const result = await service.checkCpfAvailability(VALID_CPF);
      expect(result).toEqual({ available: false, reason: 'taken' });
      expect(prisma.$queryRaw).toHaveBeenCalled();
    });

    it('returns { available: true } when CPF is valid and not in DB', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      const result = await service.checkCpfAvailability(VALID_CPF);
      expect(result).toEqual({ available: true });
    });

    it('accepts formatted CPF input (strips dots/dashes before validation)', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      const result = await service.checkCpfAvailability(VALID_CPF_FORMATTED);
      expect(result).toEqual({ available: true });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  completeOnboarding
  // ═══════════════════════════════════════════════════════════════════════════

  describe('completeOnboarding', () => {
    it('throws UserNotFoundException when user does not exist', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(
        service.completeOnboarding('nonexistent', makeValidOnboardingDto()),
      ).rejects.toThrow(UserNotFoundException);
    });

    it('returns user response immediately for ADMIN users (exempt)', async () => {
      const admin = makeBaseUser({ role: UserRole.ADMIN, profileCompleted: false });
      repo.findById.mockResolvedValue(admin);
      const result = await service.completeOnboarding('user-uuid-onboarding', makeValidOnboardingDto());
      expect(result).toBeDefined();
      expect(result.email).toBe('kyc@vexxa.com');
      // Should NOT write to DB
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws OnboardingAlreadyCompleteException when profile is already completed', async () => {
      const completed = makeBaseUser({ profileCompleted: true });
      repo.findById.mockResolvedValue(completed);
      await expect(
        service.completeOnboarding('user-uuid-onboarding', makeValidOnboardingDto()),
      ).rejects.toThrow(OnboardingAlreadyCompleteException);
    });

    it('throws InvalidCpfException for invalid CPF in DTO', async () => {
      repo.findById.mockResolvedValue(makeBaseUser());
      await expect(
        service.completeOnboarding('user-uuid-onboarding', makeValidOnboardingDto({ cpf: INVALID_CPF })),
      ).rejects.toThrow(InvalidCpfException);
    });

    it('throws BadRequestException for invalid birth date format', async () => {
      repo.findById.mockResolvedValue(makeBaseUser());
      await expect(
        service.completeOnboarding('user-uuid-onboarding', makeValidOnboardingDto({ birthDate: 'not-a-date' })),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws UnderageException and auto-blocks user when age < 18', async () => {
      const user = makeBaseUser();
      repo.findById.mockResolvedValue(user);

      const now = new Date();
      const underageBirthDate = `${now.getFullYear() - 16}-01-15`; // 16 years old

      prisma.user.update.mockResolvedValue({ ...user, status: 'BLOCKED', active: false });
      prisma.auditLog.create.mockResolvedValue(undefined);

      await expect(
        service.completeOnboarding('user-uuid-onboarding', makeValidOnboardingDto({ birthDate: underageBirthDate })),
      ).rejects.toThrow(UnderageException);

      // Verify user was blocked in transaction
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-uuid-onboarding' },
          data: expect.objectContaining({ status: 'BLOCKED', active: false }),
        }),
      );

      // Verify audit log was created
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'BLOCK_UNDERAGE',
            userId: 'user-uuid-onboarding',
          }),
        }),
      );
    });

    it('successfully completes onboarding for valid 18+ user', async () => {
      const user = makeBaseUser();
      repo.findById.mockResolvedValue(user);

      const updatedUser = {
        ...user,
        cpf: VALID_CPF,
        birthDate: new Date('1996-05-15'),
        whatsapp: '(11) 99999-9999',
        pixKeyType: 'cpf',
        pixKey: '52998224725',
        accountHolder: 'KYC Test User',
        profileCompleted: true,
      };
      prisma.user.update.mockResolvedValue(updatedUser);
      prisma.auditLog.create.mockResolvedValue(undefined);

      const result = await service.completeOnboarding('user-uuid-onboarding', makeValidOnboardingDto());

      expect(result).toBeDefined();
      expect(result.email).toBe('kyc@vexxa.com');

      // Verify profileCompleted was set to true
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            profileCompleted: true,
            cpf: VALID_CPF,
            whatsapp: '(11) 99999-9999',
            pixKeyType: 'cpf',
          }),
        }),
      );

      // Verify COMPLETE_ONBOARDING audit log
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'COMPLETE_ONBOARDING',
          }),
        }),
      );
    });

    it('throws ImmutableFieldException when CPF is duplicate (P2002)', async () => {
      const user = makeBaseUser();
      repo.findById.mockResolvedValue(user);

      // Simulate Prisma P2002 unique constraint violation
      const p2002Error = Object.assign(new Error('Unique constraint'), {
        code: 'P2002',
        meta: { target: ['cpf'] },
      });
      prisma.$transaction.mockRejectedValue(p2002Error);

      await expect(
        service.completeOnboarding('user-uuid-onboarding', makeValidOnboardingDto()),
      ).rejects.toThrow(ImmutableFieldException);
    });

    it('re-throws non-P2002 errors without swallowing them', async () => {
      const user = makeBaseUser();
      repo.findById.mockResolvedValue(user);

      const dbError = new Error('Connection lost');
      prisma.$transaction.mockRejectedValue(dbError);

      await expect(
        service.completeOnboarding('user-uuid-onboarding', makeValidOnboardingDto()),
      ).rejects.toThrow('Connection lost');
    });

    it('stores CPF as raw 11 digits (no formatting)', async () => {
      const user = makeBaseUser();
      repo.findById.mockResolvedValue(user);

      prisma.user.update.mockResolvedValue({ ...user, cpf: VALID_CPF, profileCompleted: true });
      prisma.auditLog.create.mockResolvedValue(undefined);

      await service.completeOnboarding('user-uuid-onboarding', makeValidOnboardingDto());

      const updateCall = prisma.user.update.mock.calls[0][0];
      expect(updateCall.data.cpf).toBe(VALID_CPF);
      expect(updateCall.data.cpf).not.toContain('.');
      expect(updateCall.data.cpf).not.toContain('-');
    });

    it('user exactly 18 today is allowed (boundary test)', async () => {
      const user = makeBaseUser();
      repo.findById.mockResolvedValue(user);

      const now = new Date();
      const exactly18 = `${now.getFullYear() - 18}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

      prisma.user.update.mockResolvedValue({ ...user, profileCompleted: true, cpf: VALID_CPF });
      prisma.auditLog.create.mockResolvedValue(undefined);

      // Should NOT throw UnderageException
      await expect(
        service.completeOnboarding('user-uuid-onboarding', makeValidOnboardingDto({ birthDate: exactly18 })),
      ).resolves.toBeDefined();
    });

    it('user under 18 is rejected (17 years old)', async () => {
      const user = makeBaseUser();
      repo.findById.mockResolvedValue(user);

      // A person born on 2009-06-15 is clearly 16-17 in 2026 — under 18
      const underageBirth = '2009-06-15';

      prisma.user.update.mockResolvedValue({ ...user, status: 'BLOCKED', active: false });
      prisma.auditLog.create.mockResolvedValue(undefined);

      await expect(
        service.completeOnboarding('user-uuid-onboarding', makeValidOnboardingDto({ birthDate: underageBirth })),
      ).rejects.toThrow(UnderageException);
    });
  });
});
