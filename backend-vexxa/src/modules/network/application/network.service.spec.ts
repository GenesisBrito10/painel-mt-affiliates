import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { NetworkService } from './network.service.js';

// ─── Shared helpers ──────────────────────────────────────────────────────────

const decimal = (n: number) => ({ toNumber: () => n });

const BASE_ROOT = {
  referralCode: 'ROOT-CODE',
  affiliateLinks: [
    {
      campaignId: 'root-camp',
      bettingHouse: 'esportivabet',
      cpa: decimal(200),
      revshare: decimal(20),
    },
  ],
};

const makeSettings = (blockActive = false) => ({
  getMany: vi
    .fn()
    .mockResolvedValue(
      new Map([['withdrawal_block_active', blockActive ? 'true' : 'false']]),
    ),
});

const makeRepo = () => ({
  aggregateStatsByCampaignId: vi.fn().mockResolvedValue(new Map()),
  countSubReferrals: vi.fn().mockResolvedValue(new Map()),
  findFraudLogs: vi.fn().mockResolvedValue([]),
  findReferrals: vi.fn().mockResolvedValue([]),
});

const makePrisma = (
  overrides: Partial<{
    root: object;
    bfsRounds: object[][];
    fraudUsers: object[];
    rootName: string;
  }> = {},
) => {
  const root = overrides.root ?? BASE_ROOT;
  const bfsRounds = overrides.bfsRounds ?? [[]]; // default: empty L1
  const fraudUsers = overrides.fraudUsers ?? [];
  const rootName = overrides.rootName ?? 'Root User';

  const findManyMock = vi.fn();
  bfsRounds.forEach((round) => findManyMock.mockResolvedValueOnce(round));
  // After all BFS rounds, any extra call returns empty
  findManyMock.mockResolvedValue([]);

  return {
    user: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(root),
      findUnique: vi.fn().mockResolvedValue({ name: rootName }),
      findMany: findManyMock,
    },
  };
};

const makeService = (
  overrides: Parameters<typeof makePrisma>[0] = {},
  repoOverrides = {},
) => {
  const prisma = makePrisma(overrides);
  const settings = makeSettings();
  const repo = { ...makeRepo(), ...repoOverrides };
  return {
    service: new NetworkService(prisma as any, settings as any, repo as any),
    prisma,
    repo,
    settings,
  };
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('NetworkService', () => {
  afterEach(() => vi.clearAllMocks());

  // ─── getTree() ─────────────────────────────────────────────────────────────

  describe('getTree()', () => {
    it('returns empty tree when user has no network', async () => {
      const { service } = makeService({ bfsRounds: [[]] });

      const result = await service.getTree('root-id', {});

      expect(result.totalReferrals).toBe(0);
      expect(result.network).toEqual([]);
      expect(result.networkEarnings).toBe(0);
      expect(result.referralCode).toBe('ROOT-CODE');
    });

    it('assigns correct level (1, 2, 3) to BFS members', async () => {
      const l1 = {
        id: 'l1',
        name: 'L1',
        email: 'l1@x.com',
        status: 'APPROVED',
        referralCode: null,
        referredById: 'root-id',
        createdAt: new Date(),
        affiliateLinks: [],
        fraudCounts: [],
      };
      const l2 = {
        id: 'l2',
        name: 'L2',
        email: 'l2@x.com',
        status: 'APPROVED',
        referralCode: null,
        referredById: 'l1',
        createdAt: new Date(),
        affiliateLinks: [],
        fraudCounts: [],
      };
      const l3 = {
        id: 'l3',
        name: 'L3',
        email: 'l3@x.com',
        status: 'APPROVED',
        referralCode: null,
        referredById: 'l2',
        createdAt: new Date(),
        affiliateLinks: [],
        fraudCounts: [],
      };

      const { service } = makeService({ bfsRounds: [[l1], [l2], [l3]] });

      const result = await service.getTree('root-id', { limit: 50 });

      const levels = result.network.map((m) => ({
        name: m.name,
        level: m.level,
      }));
      expect(levels).toContainEqual({ name: 'L1', level: 1 });
      expect(levels).toContainEqual({ name: 'L2', level: 2 });
      expect(levels).toContainEqual({ name: 'L3', level: 3 });
    });

    it('maxLevel=1 retorna só nível 1 (Árvore da rede aprova só diretos)', async () => {
      const l1 = {
        id: 'l1',
        name: 'L1',
        email: 'l1@x.com',
        status: 'PENDING',
        referralCode: null,
        referredById: 'root-id',
        createdAt: new Date(),
        affiliateLinks: [],
        fraudCounts: [],
      };
      const l2 = {
        id: 'l2',
        name: 'L2',
        email: 'l2@x.com',
        status: 'APPROVED',
        referralCode: null,
        referredById: 'l1',
        createdAt: new Date(),
        affiliateLinks: [],
        fraudCounts: [],
      };
      const l3 = {
        id: 'l3',
        name: 'L3',
        email: 'l3@x.com',
        status: 'APPROVED',
        referralCode: null,
        referredById: 'l2',
        createdAt: new Date(),
        affiliateLinks: [],
        fraudCounts: [],
      };

      const { service } = makeService({ bfsRounds: [[l1], [l2], [l3]] });

      const result = await service.getTree('root-id', {
        limit: 50,
        maxLevel: 1,
      });

      expect(result.network.map((m) => m.name)).toEqual(['L1']);
      expect(result.total).toBe(1);
      expect(result.statusSummary?.total).toBe(1);
      expect(result.statusSummary?.pending).toBe(1);
    });

    it('resolves parentName correctly for each level', async () => {
      const l1 = {
        id: 'l1',
        name: 'Alice',
        email: 'a@x.com',
        status: 'APPROVED',
        referralCode: null,
        referredById: 'root-id',
        createdAt: new Date(),
        affiliateLinks: [],
        fraudCounts: [],
      };
      const l2 = {
        id: 'l2',
        name: 'Bob',
        email: 'b@x.com',
        status: 'APPROVED',
        referralCode: null,
        referredById: 'l1',
        createdAt: new Date(),
        affiliateLinks: [],
        fraudCounts: [],
      };

      const { service } = makeService({
        bfsRounds: [[l1], [l2]],
        rootName: 'Root User',
      });

      const result = await service.getTree('root-id', {});

      const alice = result.network.find((m) => m.name === 'Alice')!;
      const bob = result.network.find((m) => m.name === 'Bob')!;

      expect(alice.parentName).toBe('Root User');
      expect(bob.parentName).toBe('Alice');
    });

    it('calculates spread model earnings: (myCpa - l1Cpa) × cpaQualified', async () => {
      // Root myCpa=200 on esportivabet.
      // L1 member also has link on esportivabet with cpa=100.
      // L1 is own level=1, so l1AncestorId = l1 itself → l1Links = l1's own links → l1Cpa=100.
      // margin = max(0, 200 - 100) = 100; cpaQualified=5 → earnings = 500.
      const l1 = {
        id: 'l1',
        name: 'L1',
        email: 'l1@x.com',
        status: 'APPROVED',
        referralCode: null,
        referredById: 'root-id',
        createdAt: new Date(),
        affiliateLinks: [
          {
            campaignId: 'l1-camp',
            bettingHouse: 'esportivabet',
            cpa: decimal(100),
            revshare: decimal(5),
          },
        ],
        fraudCounts: [],
      };

      const statsMap = new Map([
        [
          'l1-camp',
          {
            registrations: 10,
            ftds: 5,
            deposit: 1000,
            totalCommission: 500,
            revShare: 200,
            cpaQualified: 5,
          },
        ],
      ]);

      const { service } = makeService(
        { bfsRounds: [[l1]] },
        { aggregateStatsByCampaignId: vi.fn().mockResolvedValue(statsMap) },
      );

      const result = await service.getTree('root-id', {});

      // root link: cpa=200 revshare=20, l1 link: cpa=100 revshare=5
      // CPA margin=100 × 5 qftd = 500; revShare margin=15% × 200 revShare = 30 → total=530
      const member = result.network[0]!;
      expect(member.myEarnings).toBe(530); // 500 CPA + 30 revShare
      expect(result.networkEarnings).toBe(530);
    });

    it('calculates fraud deduction from spread margin × fraud count', async () => {
      // Root: myCpa=200, L1 has fraudCount=2 on esportivabet, l1Cpa=100 → margin=100, deduction=200
      const l1 = {
        id: 'l1',
        name: 'L1',
        email: 'l1@x.com',
        status: 'APPROVED',
        referralCode: null,
        referredById: 'root-id',
        createdAt: new Date(),
        affiliateLinks: [
          {
            campaignId: 'l1-camp',
            bettingHouse: 'esportivabet',
            cpa: decimal(100),
            revshare: decimal(5),
          },
        ],
        fraudCounts: [{ bettingHouse: 'esportivabet', count: 2 }],
      };

      const { service } = makeService({ bfsRounds: [[l1]] });

      const result = await service.getTree('root-id', {});

      const member = result.network[0]!;
      expect(member.fraudCount).toBe(2);
      expect(member.fraudDeduction).toBe(200); // 100 (margin) × 2 (count)
      expect(result.networkFraudLoss).toBe(200);
      expect(result.netNetworkEarnings).toBe(result.networkEarnings - 200);
    });

    it('filters members by house when house query param is provided', async () => {
      const l1WithHouse = {
        id: 'l1',
        name: 'With House',
        email: 'a@x.com',
        status: 'APPROVED',
        referralCode: null,
        referredById: 'root-id',
        createdAt: new Date(),
        affiliateLinks: [
          {
            campaignId: 'c1',
            bettingHouse: 'esportivabet',
            cpa: decimal(100),
            revshare: decimal(5),
          },
        ],
        fraudCounts: [],
      };
      const l2WithoutHouse = {
        id: 'l2',
        name: 'No House',
        email: 'b@x.com',
        status: 'APPROVED',
        referralCode: null,
        referredById: 'root-id',
        createdAt: new Date(),
        affiliateLinks: [
          {
            campaignId: 'c2',
            bettingHouse: 'betano',
            cpa: decimal(150),
            revshare: decimal(10),
          },
        ],
        fraudCounts: [],
      };

      const { service } = makeService({
        bfsRounds: [[l1WithHouse, l2WithoutHouse]],
      });

      const result = await service.getTree('root-id', {
        house: 'esportivabet',
      });

      expect(result.network).toHaveLength(1);
      expect(result.network[0]!.name).toBe('With House');
    });

    it('applies server-side pagination correctly', async () => {
      // Pagination slices after full BFS load — test with a single call, check total vs network length
      const members = Array.from({ length: 25 }, (_, i) => ({
        id: `m-${i}`,
        name: `M${i}`,
        email: `m${i}@x.com`,
        status: 'APPROVED',
        referralCode: null,
        referredById: 'root-id',
        createdAt: new Date(),
        affiliateLinks: [],
        fraudCounts: [],
      }));

      // Create a stable prisma mock that always returns the same 25 members for L1
      const prisma = {
        user: {
          findUniqueOrThrow: vi.fn().mockResolvedValue(BASE_ROOT),
          findUnique: vi.fn().mockResolvedValue({ name: 'Root User' }),
          findMany: vi
            .fn()
            // Each call returns 25 members for L1, then empty for L2/L3
            .mockImplementation(
              ({ where }: { where: { referredById?: { in: string[] } } }) => {
                if (where.referredById?.in?.includes('root-id'))
                  return Promise.resolve(members);
                return Promise.resolve([]);
              },
            ),
        },
      };
      const repo = makeRepo();
      const svc = new NetworkService(
        prisma as any,
        makeSettings() as any,
        repo as any,
      );

      const page1 = await svc.getTree('root-id', { page: 1, limit: 10 });
      const page2 = await svc.getTree('root-id', { page: 2, limit: 10 });
      const page3 = await svc.getTree('root-id', { page: 3, limit: 10 });

      expect(page1.network).toHaveLength(10);
      expect(page2.network).toHaveLength(10);
      expect(page3.network).toHaveLength(5);
      expect(page1.total).toBe(25);
      expect(page1.totalReferrals).toBe(25);
    });

    it('accumulates totals correctly across all members', async () => {
      const makeL1 = (id: string, cId: string) => ({
        id,
        name: id,
        email: `${id}@x.com`,
        status: 'APPROVED',
        referralCode: null,
        referredById: 'root-id',
        createdAt: new Date(),
        affiliateLinks: [
          {
            campaignId: cId,
            bettingHouse: 'esportivabet',
            cpa: decimal(100),
            revshare: decimal(5),
          },
        ],
        fraudCounts: [],
      });

      const statsMap = new Map([
        [
          'c1',
          {
            registrations: 3,
            ftds: 1,
            deposit: 100,
            totalCommission: 50,
            revShare: 20,
            cpaQualified: 1,
          },
        ],
        [
          'c2',
          {
            registrations: 5,
            ftds: 2,
            deposit: 200,
            totalCommission: 100,
            revShare: 40,
            cpaQualified: 2,
          },
        ],
      ]);

      const { service } = makeService(
        { bfsRounds: [[makeL1('a', 'c1'), makeL1('b', 'c2')]] },
        { aggregateStatsByCampaignId: vi.fn().mockResolvedValue(statsMap) },
      );

      const result = await service.getTree('root-id', {});

      expect(result.totals.registrations).toBe(8); // 3 + 5
      expect(result.totals.cpaQualified).toBe(3); // 1 + 2
    });

    it('subReferrals is populated from countSubReferrals map', async () => {
      const l1 = {
        id: 'l1',
        name: 'L1',
        email: 'l1@x.com',
        status: 'APPROVED',
        referralCode: null,
        referredById: 'root-id',
        createdAt: new Date(),
        affiliateLinks: [],
        fraudCounts: [],
      };

      const subMap = new Map([['l1', 7]]);

      const { service } = makeService(
        { bfsRounds: [[l1]] },
        { countSubReferrals: vi.fn().mockResolvedValue(subMap) },
      );

      const result = await service.getTree('root-id', {});

      expect(result.network[0]!.subReferrals).toBe(7);
    });
  });

  // ─── getFraudReport() ──────────────────────────────────────────────────────

  describe('getFraudReport()', () => {
    it('returns empty report when user has no network', async () => {
      const { service } = makeService({ bfsRounds: [[]] });

      const result = await service.getFraudReport('root-id');

      expect(result.total).toBe(0);
      expect(result.totalFraudCpa).toBe(0);
      expect(result.members).toEqual([]);
    });

    it('groups fraud logs by userId and sums totalFraudCpa', async () => {
      const l1 = {
        id: 'l1',
        name: 'L1',
        email: 'l1@x.com',
        status: 'APPROVED',
        referralCode: null,
        referredById: 'root-id',
        createdAt: new Date(),
        affiliateLinks: [],
        fraudCounts: [],
      };

      const fraudLogs = [
        {
          userId: 'l1',
          id: 'log-1',
          bettingHouse: 'esportivabet',
          oldCount: 0,
          newCount: 2,
          reason: 'suspicious',
          changedByName: 'Admin',
          changedByEmail: 'admin@v.com',
          createdAt: new Date(),
        },
        {
          userId: 'l1',
          id: 'log-2',
          bettingHouse: 'betano',
          oldCount: 0,
          newCount: 1,
          reason: 'fraud',
          changedByName: null,
          changedByEmail: null,
          createdAt: new Date(),
        },
      ];

      const prisma = {
        user: {
          findUniqueOrThrow: vi.fn().mockResolvedValue(BASE_ROOT),
          findUnique: vi.fn().mockResolvedValue({ name: 'Root User' }),
          findMany: vi
            .fn()
            .mockResolvedValueOnce([l1]) // L1 BFS
            .mockResolvedValueOnce([]) // L2
            .mockResolvedValueOnce([]) // L3 (not called if L2 empty)
            .mockResolvedValue([{ id: 'l1', name: 'L1', email: 'l1@x.com' }]), // user lookup
        },
      };
      const repo = {
        ...makeRepo(),
        findFraudLogs: vi.fn().mockResolvedValue(fraudLogs),
      };
      const service = new NetworkService(
        prisma as any,
        makeSettings() as any,
        repo as any,
      );

      const result = await service.getFraudReport('root-id');

      expect(result.total).toBe(1); // 1 unique member with fraud
      expect(result.members[0]!.userId).toBe('l1');
      expect(result.members[0]!.totalFraudCpa).toBe(3); // 2 + 1
      expect(result.members[0]!.logs).toHaveLength(2);
      expect(result.members[0]!.logs[0]!.registeredBy).toEqual({
        name: 'Admin',
        email: 'admin@v.com',
      });
    });
  });

  // ─── getReferrals() ────────────────────────────────────────────────────────

  describe('getReferrals()', () => {
    it('delegates to repository and returns referral entries', async () => {
      const referrals = [
        {
          id: 'u1',
          userId: 'u1',
          bettingHouseSlug: 'esportivabet',
          status: 'approved',
          referralCode: 'CODE1',
          commissionCpa: 150,
          commissionRevshare: 15,
          createdAt: new Date(),
          userName: 'User 1',
          userEmail: 'u1@x.com',
        },
      ];

      const { service, repo } = makeService(
        {},
        { findReferrals: vi.fn().mockResolvedValue(referrals) },
      );

      const result = await service.getReferrals('root-id', {});

      expect(result).toEqual(referrals);
      expect(repo.findReferrals).toHaveBeenCalledWith(
        'root-id',
        undefined,
        undefined,
      );
    });

    it('passes house filter to repository', async () => {
      const { service, repo } = makeService();

      await service.getReferrals('root-id', { house: 'betano' });

      expect(repo.findReferrals).toHaveBeenCalledWith(
        'root-id',
        'betano',
        undefined,
      );
    });
  });
});
