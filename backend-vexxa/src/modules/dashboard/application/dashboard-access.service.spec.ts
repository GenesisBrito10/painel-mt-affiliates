import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { DashboardAccessService } from './dashboard-access.service.js';
import { UserRole } from '@prisma/client';

const makePrisma = () => ({
  affiliateLink: {
    findMany: vi.fn().mockResolvedValue([]),
  },
  $queryRaw: vi.fn().mockResolvedValue([]),
});

describe('DashboardAccessService', () => {
  let service: DashboardAccessService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    prisma = makePrisma();
    // Direct instantiation — no NestJS container needed
    service = new DashboardAccessService(prisma as any);
  });

  afterEach(() => vi.clearAllMocks());

  // ─── resolveAccessContext ──────────────────────────────────────────────────

  describe('resolveAccessContext()', () => {
    it('returns isAdmin=true and empty arrays for ADMIN role', async () => {
      const ctx = await service.resolveAccessContext('admin-id', UserRole.ADMIN);

      expect(ctx.isAdmin).toBe(true);
      expect(ctx.ownCampaignIds).toEqual([]);
      expect(ctx.networkCampaignIds).toEqual([]);
      expect(ctx.allCampaignIds).toEqual([]);
      // Admin should NOT query the DB
      expect(prisma.affiliateLink.findMany).not.toHaveBeenCalled();
    });

    it('returns own campaignIds from affiliateLinks for AFFILIATE role', async () => {
      prisma.affiliateLink.findMany.mockResolvedValue([
        { campaignId: 'camp-001' },
        { campaignId: 'camp-002' },
      ]);
      prisma.$queryRaw.mockResolvedValue([]);

      const ctx = await service.resolveAccessContext('user-001', UserRole.AFFILIATE);

      expect(ctx.isAdmin).toBe(false);
      expect(ctx.ownCampaignIds).toEqual(['camp-001', 'camp-002']);
      expect(ctx.networkCampaignIds).toEqual([]);
      expect(ctx.allCampaignIds).toEqual(['camp-001', 'camp-002']);
    });

    it('collects network campaignIds via BFS 3-level', async () => {
      prisma.affiliateLink.findMany.mockResolvedValue([{ campaignId: 'own-001' }]);
      prisma.$queryRaw.mockResolvedValue([
        { campaignId: 'l1-camp' },
        { campaignId: 'l2-camp' },
        { campaignId: 'l3-camp' },
      ]);

      const ctx = await service.resolveAccessContext('user-001', UserRole.AFFILIATE);

      expect(ctx.ownCampaignIds).toEqual(['own-001']);
      expect(ctx.networkCampaignIds).toContain('l1-camp');
      expect(ctx.networkCampaignIds).toContain('l2-camp');
      expect(ctx.networkCampaignIds).toContain('l3-camp');
      expect(ctx.allCampaignIds).toContain('own-001');
      expect(ctx.allCampaignIds).toContain('l3-camp');
    });

    it('deduplicates campaignIds across own and network', async () => {
      const SHARED = 'shared-camp';
      prisma.affiliateLink.findMany.mockResolvedValue([{ campaignId: SHARED }]);
      prisma.$queryRaw.mockResolvedValue([{ campaignId: SHARED }]);

      const ctx = await service.resolveAccessContext('user-001', UserRole.AFFILIATE);

      // allCampaignIds must not have duplicates
      const unique = new Set(ctx.allCampaignIds);
      expect(unique.size).toBe(ctx.allCampaignIds.length);
      expect(ctx.allCampaignIds).toContain(SHARED);
    });

    it('stops BFS early when level returns empty results', async () => {
      prisma.affiliateLink.findMany.mockResolvedValue([{ campaignId: 'own-001' }]);
      prisma.$queryRaw.mockResolvedValue([]);

      await service.resolveAccessContext('user-001', UserRole.AFFILIATE);

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });
  });

  // ─── resolveCampaignIdsForScope ────────────────────────────────────────────

  describe('resolveCampaignIdsForScope()', () => {
    const access = {
      ownCampaignIds: ['own-001', 'own-002'],
      networkCampaignIds: ['net-001'],
      allCampaignIds: ['own-001', 'own-002', 'net-001'],
      isAdmin: false,
    };

    it('returns null for admin', () => {
      expect(service.resolveCampaignIdsForScope({ ...access, isAdmin: true }, 'all')).toBeNull();
    });

    it('returns ownCampaignIds for scope=mine', () => {
      expect(service.resolveCampaignIdsForScope(access, 'mine')).toEqual(['own-001', 'own-002']);
    });

    it('returns networkCampaignIds for scope=network', () => {
      expect(service.resolveCampaignIdsForScope(access, 'network')).toEqual(['net-001']);
    });

    it('returns allCampaignIds for scope=all', () => {
      expect(service.resolveCampaignIdsForScope(access, 'all')).toEqual(['own-001', 'own-002', 'net-001']);
    });

    it('defaults to all when scope is undefined', () => {
      expect(service.resolveCampaignIdsForScope(access, undefined)).toEqual(['own-001', 'own-002', 'net-001']);
    });
  });
});
