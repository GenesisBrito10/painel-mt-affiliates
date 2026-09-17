import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { UserStatus, UserRole } from '@prisma/client';
import { UserService } from './application/user.service.js';
import { USER_REPOSITORY } from './domain/repositories/user.repository.js';
import { NotificationService } from '../notification/application/notification.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../shared/shared.module.js';
import {
  UserNotFoundException,
  EmailAlreadyInUseException,
  AffiliateLinkNotFoundException,
  DuplicateCampaignException,
  BettingHouseNotFoundException,
} from './domain/exceptions/user.exceptions.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const mockUser = {
  id: 'user-uuid-1',
  name: 'Test User',
  email: 'test@vexxa.com',
  password: '$2b$12$hash',
  role: UserRole.AFFILIATE,
  status: UserStatus.APPROVED,
  active: true,
  ageVerified: false,
  withdrawalBlocked: false,
  bonusBalance: { toString: () => '0.00' },
  referralCode: null,
  referredById: null,
  pixKeyType: '',
  pixKey: '',
  bankName: '',
  bankAgency: '',
  bankAccount: '',
  accountHolder: '',
  cpf: null,
  birthDate: null,
  whatsapp: null,
  profileCompleted: false,
  depositComplianceAlertCount: 0,
  depositCompliancePenalizedAt: null,
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockPendingUser = {
  ...mockUser,
  id: 'pending-uuid-1',
  status: UserStatus.PENDING,
  referredById: 'referrer-uuid-1',
};

const mockReferrer = {
  ...mockUser,
  id: 'referrer-uuid-1',
  name: 'Referrer User',
  email: 'referrer@vexxa.com',
};

// ─── Mock factories ───────────────────────────────────────────────────────────

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

/** PrismaService mock — only surfaces the methods touched by UserService */
const makePrismaMock = () => {
  const prisma: Record<string, any> = {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
    setting: { findMany: vi.fn().mockResolvedValue([]) },
    affiliateLink: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    linkRequest: { findMany: vi.fn().mockResolvedValue([]) },
    bettingHouse: { findMany: vi.fn() },
    auditLog: { create: vi.fn() },
    // isInReferrerNetwork / downline CTEs — default: target NÃO está na rede.
    $queryRaw: vi.fn().mockResolvedValue([{ ok: false }]),
  };
  // Simulate Prisma interactive transactions: run callback with same stub
  prisma['$transaction'] = vi.fn((fn: (tx: typeof prisma) => unknown) =>
    fn(prisma),
  );
  return prisma;
};

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('UserService', () => {
  let service: UserService;
  let repo: ReturnType<typeof makeRepo>;
  let prisma: ReturnType<typeof makePrismaMock>;
  let notificationMock: ReturnType<typeof makeNotificationMock>;
  let redisMock: { del: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    repo = makeRepo();
    prisma = makePrismaMock();
    notificationMock = makeNotificationMock();
    redisMock = { del: vi.fn().mockResolvedValue(1) };

    // Pattern: list ALL providers as useValue — no overrideProvider needed
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

  // ─── findById ─────────────────────────────────────────────────────────────

  it('findById should return user without password', async () => {
    repo.findById.mockResolvedValue(mockUser);
    const result = await service.findById('user-uuid-1');
    expect(result).not.toHaveProperty('password');
    expect(result.email).toBe('test@vexxa.com');
  });

  it('findById throws UserNotFoundException when user missing', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.findById('bad-id')).rejects.toThrow(
      UserNotFoundException,
    );
  });

  // ─── updateProfile ────────────────────────────────────────────────────────

  it('updateProfile should only update profile fields', async () => {
    repo.findById.mockResolvedValue(mockUser);
    repo.update.mockResolvedValue({ ...mockUser, name: 'New Name' });
    const result = await service.updateProfile('user-uuid-1', {
      name: 'New Name',
    });
    expect(result.name).toBe('New Name');
    expect(repo.update).toHaveBeenCalledWith(
      'user-uuid-1',
      expect.objectContaining({ name: 'New Name' }),
    );
  });

  it('getAdminAffiliateProfile returns full CPF and audits sensitive access', async () => {
    const admin = { ...mockUser, id: 'admin-uuid', role: UserRole.ADMIN };
    const target = {
      ...mockUser,
      id: 'target-uuid',
      cpf: '12345678909',
      whatsapp: '+5511999999999',
      affiliateLinks: [],
      referredBy: null,
    };
    repo.findById.mockResolvedValue(admin);
    prisma.user.findUnique.mockResolvedValue(target);

    const result = await service.getAdminAffiliateProfile(
      'target-uuid',
      'admin-uuid',
    );

    expect(result.cpf).toBe('12345678909');
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'VIEW_AFFILIATE_SENSITIVE_PROFILE',
        }),
      }),
    );
  });

  it('getAdminAffiliateProfile hides links backed only by inactive deals', async () => {
    const admin = { ...mockUser, id: 'admin-uuid', role: UserRole.ADMIN };
    const target = {
      ...mockUser,
      id: 'target-uuid',
      affiliateLinks: [
        {
          id: 'link-superbet',
          bettingHouse: 'superbet',
          affiliateId: '5565',
          campaignId: '5565-MJM01',
          cpa: { toString: () => '105.0000' },
          revshare: { toString: () => '0.0000' },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      referredBy: null,
    };
    repo.findById.mockResolvedValue(admin);
    // Prisma mock is intentionally loose across this legacy suite.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    prisma.user.findUnique.mockResolvedValue(target);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    prisma.linkRequest.findMany.mockResolvedValue([
      {
        bettingHouseSlug: 'superbet',
        dealId: 'inactive-deal',
        status: 'FULFILLED',
        deal: { active: false },
      },
    ]);

    const result = await service.getAdminAffiliateProfile(
      'target-uuid',
      'admin-uuid',
    );

    expect(result.affiliateLinks).toEqual([]);
  });

  it('updateBalanceBlock toggles withdrawalBlocked, audits and notifies', async () => {
    const admin = { ...mockUser, id: 'admin-uuid', role: UserRole.ADMIN };
    const target = { ...mockUser, id: 'target-uuid', withdrawalBlocked: false };
    const updated = { ...target, withdrawalBlocked: true };
    repo.findById.mockResolvedValueOnce(target).mockResolvedValueOnce(admin);
    prisma.user.update.mockResolvedValue(updated);

    const result = await service.updateBalanceBlock(
      'target-uuid',
      'admin-uuid',
      {
        blocked: true,
        reason: 'Risco financeiro',
      },
    );

    expect(result.withdrawalBlocked).toBe(true);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'target-uuid' },
      data: { withdrawalBlocked: true },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'BLOCK_AFFILIATE_BALANCE',
        }),
      }),
    );
    expect(notificationMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'target-uuid',
      }),
    );
  });

  it('updateExclusiveDealsAccess toggles flag and audits (no notification)', async () => {
    const admin = { ...mockUser, id: 'admin-uuid', role: UserRole.ADMIN };
    const target = {
      ...mockUser,
      id: 'target-uuid',
      exclusiveDealsAccess: false,
    };
    const updated = { ...target, exclusiveDealsAccess: true };
    repo.findById.mockResolvedValueOnce(target).mockResolvedValueOnce(admin);
    prisma.user.update.mockResolvedValue(updated);

    const result = await service.updateExclusiveDealsAccess(
      'target-uuid',
      'admin-uuid',
      { exclusive: true },
    );

    expect(result).toBeDefined();
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'target-uuid' },
      data: { exclusiveDealsAccess: true },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'GRANT_EXCLUSIVE_DEALS_ACCESS',
        }),
      }),
    );
    expect(notificationMock.create).not.toHaveBeenCalled();
  });

  // ─── update ───────────────────────────────────────────────────────────────

  it('update throws EmailAlreadyInUseException when email already taken', async () => {
    repo.findById.mockResolvedValue(mockUser);
    repo.findByEmail.mockResolvedValue({ ...mockUser, id: 'other-user' });
    await expect(
      service.update('user-uuid-1', { email: 'taken@vexxa.com' }),
    ).rejects.toThrow(EmailAlreadyInUseException);
  });

  // ─── createAffiliateLink ──────────────────────────────────────────────────

  it('createAffiliateLink throws DuplicateCampaignException for duplicate campaignId+house', async () => {
    repo.findById.mockResolvedValue(mockUser);
    repo.bettingHouseExists.mockResolvedValue(true);
    repo.findAffiliateLinkByUniqueKey.mockResolvedValue({
      id: 'existing-link',
    });
    await expect(
      service.createAffiliateLink('user-uuid-1', {
        bettingHouse: 'esportivabet',
        campaignId: 'camp_123',
      }),
    ).rejects.toThrow(DuplicateCampaignException);
  });

  it('createAffiliateLink throws BettingHouseNotFoundException for invalid slug', async () => {
    repo.findById.mockResolvedValue(mockUser);
    repo.bettingHouseExists.mockResolvedValue(false);
    await expect(
      service.createAffiliateLink('user-uuid-1', {
        bettingHouse: 'invalid-house',
        campaignId: 'camp_abc',
      }),
    ).rejects.toThrow(BettingHouseNotFoundException);
  });

  // ─── updateAffiliateLink ──────────────────────────────────────────────────

  it('updateAffiliateLink throws AffiliateLinkNotFoundException when link belongs to different user', async () => {
    repo.findAffiliateLinkById.mockResolvedValue({
      id: 'link-1',
      userId: 'other-user',
    });
    await expect(
      service.updateAffiliateLink('user-uuid-1', 'link-1', { cpa: '200.0000' }),
    ).rejects.toThrow(AffiliateLinkNotFoundException);
  });

  // ─── approveByReferrer ────────────────────────────────────────────────────

  it('approveByReferrer throws ForbiddenException when caller is not the direct referrer', async () => {
    const target = { ...mockPendingUser, referredById: 'someone-else' };
    repo.findById
      .mockResolvedValueOnce(target)
      .mockResolvedValueOnce(mockReferrer);
    await expect(
      service.approveByReferrer('pending-uuid-1', 'referrer-uuid-1', {
        status: UserStatus.APPROVED,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('approveByReferrer throws BadRequestException when user is already approved', async () => {
    const alreadyApproved = {
      ...mockPendingUser,
      status: UserStatus.APPROVED,
      referredById: 'referrer-uuid-1',
    };
    repo.findById
      .mockResolvedValueOnce(alreadyApproved)
      .mockResolvedValueOnce(mockReferrer);
    await expect(
      service.approveByReferrer('pending-uuid-1', 'referrer-uuid-1', {
        status: UserStatus.APPROVED,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('approveByReferrer succeeds with status-only approval (no CPA/Rev)', async () => {
    repo.findById
      .mockResolvedValueOnce(mockPendingUser)
      .mockResolvedValueOnce(mockReferrer);

    prisma.user.update.mockResolvedValue({
      ...mockPendingUser,
      status: UserStatus.APPROVED,
    });
    prisma.auditLog.create.mockResolvedValue(undefined);

    const result = await service.approveByReferrer(
      'pending-uuid-1',
      'referrer-uuid-1',
      {
        status: UserStatus.APPROVED,
      },
    );

    expect(result).toBeDefined();
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: UserStatus.APPROVED },
      }),
    );
    // No affiliateLink should be created during status approval
    expect(prisma.affiliateLink.create).not.toHaveBeenCalled();
  });
});
