import { describe, it, expect, vi } from 'vitest';
import { DashboardBalanceService } from './dashboard-balance.service.js';
import { UserRole } from '@prisma/client';

const decimal = (n: number) => ({ toNumber: () => n });

function makeRepo(aggOverride?: unknown) {
  return {
    aggregatePerCampaignHouse: vi.fn().mockResolvedValue(aggOverride ?? []),
    aggregateSummary: vi.fn(),
    aggregateDaily: vi.fn(),
    aggregateByCampaign: vi.fn(),
    getDistinctAffiliates: vi.fn(),
    getDistinctCampaigns: vi.fn(),
    getDistinctPanels: vi.fn(),
    getSyncedDays: vi.fn(),
    aggregateRanking: vi.fn(),
  };
}

function makeSettings(overrides: Record<string, string> = {}) {
  const map = new Map(
    Object.entries({
      withdrawal_block_active: 'false',
      withdrawal_block_start_date: '2026-04-01',
      withdrawal_block_end_date: '2026-05-01',
      min_avg_deposit_per_cpa: '70',
      min_avg_deposit_warning: 'Aviso mínimo',
      min_withdrawal_amount: '100',
      ...overrides,
    }),
  );
  return { getMany: vi.fn().mockResolvedValue(map) };
}

function makeAccess() {
  return {
    resolveAccessContext: vi.fn(),
    resolveCampaignIdsForScope: vi.fn().mockReturnValue(['camp-001']),
    collectNetworkCampaignIds: vi.fn().mockResolvedValue([]),
  };
}

type LinkFixture = {
  campaignId: string;
  bettingHouse: string;
  linkType?: string | null;
  cpa: ReturnType<typeof decimal>;
  revshare: ReturnType<typeof decimal>;
};

const BASE_USER: {
  id: string;
  bonusBalance: ReturnType<typeof decimal>;
  affiliateLinks: LinkFixture[];
  fraudCounts: { bettingHouse: string; count: number }[];
  balanceAdjustments: {
    bettingHouse: string;
    amount: ReturnType<typeof decimal>;
    pinbetDimension?: 'AFP1' | 'AFP2' | 'COMBINED' | null;
  }[];
} = {
  id: 'user-001',
  bonusBalance: decimal(0),
  affiliateLinks: [
    {
      campaignId: 'camp-001',
      bettingHouse: 'esportivabet',
      cpa: decimal(200),
      revshare: decimal(25),
    },
  ],
  fraudCounts: [],
  balanceAdjustments: [],
};

function makePrisma(userOverride?: Partial<typeof BASE_USER>) {
  return {
    user: {
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValue({ ...BASE_USER, ...userOverride }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    withdrawalRequest: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    setting: { findMany: vi.fn().mockResolvedValue([]) },
  };
}

const JWT_USER = {
  sub: 'user-001',
  email: 'u@vexxa.com',
  role: UserRole.AFFILIATE,
};

describe('DashboardBalanceService', () => {
  describe('getBalance()', () => {
    it('calculates own CPA and Rev commission correctly', async () => {
      const repo = makeRepo([
        {
          campaignId: 'camp-001',
          bettingHouse: 'esportivabet',
          cpaQualified: 5,
          revShare: 1000,
          deposit: 5000,
        },
      ]);
      const svc = new DashboardBalanceService(
        repo as any,
        makeAccess() as any,
        makeSettings() as any,
        makePrisma() as any,
      );

      const result = await svc.getBalance(JWT_USER, {});

      expect(result.cpa).toBe(1000); // 200 × 5
      expect(result.rev).toBe(250); // (25/100) × 1000
      expect(result.networkCpa).toBe(0);
    });

    it('deducts direct fraud counts', async () => {
      const repo = makeRepo([
        {
          campaignId: 'camp-001',
          bettingHouse: 'esportivabet',
          cpaQualified: 5,
          revShare: 0,
          deposit: 0,
        },
      ]);
      const prisma = makePrisma({
        fraudCounts: [{ bettingHouse: 'esportivabet', count: 2 }],
      });
      const svc = new DashboardBalanceService(
        repo as any,
        makeAccess() as any,
        makeSettings() as any,
        prisma as any,
      );

      const result = await svc.getBalance(JWT_USER, {});

      expect(result.cpa).toBe(1000); // 200 × 5
      expect(result.fraudDeduction).toBe(400); // 200 × 2
      expect(result.grossBalance).toBe(600); // 1000 − 400
    });

    it('deducts approved and pending withdrawals from balance', async () => {
      const repo = makeRepo([
        {
          campaignId: 'camp-001',
          bettingHouse: 'esportivabet',
          cpaQualified: 3,
          revShare: 0,
          deposit: 0,
        },
      ]);
      const prisma = {
        user: {
          findUniqueOrThrow: vi.fn().mockResolvedValue({
            ...BASE_USER,
            affiliateLinks: [
              {
                campaignId: 'camp-001',
                bettingHouse: 'esportivabet',
                cpa: decimal(100),
                revshare: decimal(0),
              },
            ],
          }),
          findMany: vi.fn().mockResolvedValue([]),
        },
        withdrawalRequest: {
          findMany: vi.fn().mockResolvedValue([
            {
              originalAmount: decimal(150),
              bettingHouse: 'esportivabet',
              status: 'APPROVED',
            },
            {
              originalAmount: decimal(50),
              bettingHouse: 'esportivabet',
              status: 'PENDING',
            },
          ]),
        },
        setting: { findMany: vi.fn().mockResolvedValue([]) },
      };
      const svc = new DashboardBalanceService(
        repo as any,
        makeAccess() as any,
        makeSettings() as any,
        prisma as any,
      );

      const result = await svc.getBalance(JWT_USER, {});

      expect(result.grossBalance).toBe(300); // 100 × 3
      expect(result.approvedWithdrawals).toBe(200);
      expect(result.balance).toBe(100);
    });

    it('keeps Pinbet financial balance while limiting withdrawable to 80% of Net P&L', async () => {
      const repo = makeRepo([
        {
          campaignId: 'pin-camp',
          bettingHouse: 'pinbet-diario',
          cpaQualified: 10,
          revShare: 0,
          deposit: 500,
          netPl: 100,
          withdrawalTotal: 0,
          volume: 1500,
          pinbetMetricsComplete: true,
        },
      ]);
      const prisma = makePrisma({
        affiliateLinks: [
          {
            campaignId: 'pin-camp',
            bettingHouse: 'pinbet-diario',
            cpa: decimal(100),
            revshare: decimal(0),
          },
        ],
      });
      const svc = new DashboardBalanceService(
        repo as any,
        makeAccess() as any,
        makeSettings() as any,
        prisma as any,
      );

      const result = await svc.getBalance(JWT_USER, {});
      const house = result.perHouse.find((h) => h.house === 'pinbet-diario');

      expect(house).toMatchObject({
        total: 1000,
        netPl: 100,
        netPlWithdrawalLimit: 80,
        withdrawable: 80,
        withdrawalRestriction: 'NET_PL_CAP',
      });
      expect(result.balance).toBe(1000);
      expect(result.withdrawableTotal).toBe(80);
    });

    it('limits afp1 and afp2 independently after both links become monthly', async () => {
      const repo = makeRepo([
        {
          campaignId: 'VALLEX-AFP1',
          bettingHouse: 'pinbet-mensal',
          cpaQualified: 10,
          revShare: 0,
          deposit: 500,
          netPl: 100,
          pinbetMetricsComplete: true,
        },
        {
          campaignId: 'MJM-AFP2',
          bettingHouse: 'pinbet-mensal',
          cpaQualified: 0,
          revShare: 0,
          deposit: 0,
          netPl: 1000,
          pinbetMetricsComplete: true,
        },
      ]);
      const prisma = makePrisma({
        affiliateLinks: [
          {
            campaignId: 'VALLEX-AFP1',
            bettingHouse: 'pinbet-mensal',
            linkType: 'afp1',
            cpa: decimal(100),
            revshare: decimal(0),
          },
          {
            campaignId: 'MJM-AFP2',
            bettingHouse: 'pinbet-mensal',
            linkType: 'afp2',
            cpa: decimal(100),
            revshare: decimal(0),
          },
        ],
      });
      const svc = new DashboardBalanceService(
        repo as any,
        makeAccess() as any,
        makeSettings() as any,
        prisma as any,
      );

      const result = await svc.getBalance(JWT_USER, {});
      const house = result.perHouse.find((h) => h.house === 'pinbet-mensal');

      expect(house).toMatchObject({
        total: 1000,
        withdrawable: 80,
        withdrawalRestriction: 'NET_PL_CAP',
        pinbetDimensions: [
          { dimension: 'AFP1', balance: 1000, withdrawable: 80 },
          { dimension: 'AFP2', balance: 0, withdrawable: 0 },
        ],
      });
    });

    it('uses the matching monthly dimension for network spread rates', async () => {
      const ownLinks = [
        {
          campaignId: 'HEAD-AFP1',
          bettingHouse: 'pinbet-mensal',
          linkType: 'afp1',
          cpa: decimal(100),
          revshare: decimal(0),
        },
        {
          campaignId: 'HEAD-AFP2',
          bettingHouse: 'pinbet-mensal',
          linkType: 'afp2',
          cpa: decimal(200),
          revshare: decimal(0),
        },
      ];
      const networkLinks = [
        {
          campaignId: 'DOWN-AFP1',
          bettingHouse: 'pinbet-mensal',
          linkType: 'afp1',
          cpa: decimal(10),
          revshare: decimal(0),
        },
        {
          campaignId: 'DOWN-AFP2',
          bettingHouse: 'pinbet-mensal',
          linkType: 'afp2',
          cpa: decimal(150),
          revshare: decimal(0),
        },
      ];
      const repo = makeRepo([
        ...ownLinks.map((link) => ({
          campaignId: link.campaignId,
          bettingHouse: 'pinbet-mensal',
          cpaQualified: 0,
          revShare: 0,
          deposit: 0,
          netPl: 0,
          pinbetMetricsComplete: true,
        })),
        ...networkLinks.map((link) => ({
          campaignId: link.campaignId,
          bettingHouse: 'pinbet-mensal',
          cpaQualified: 1,
          revShare: 0,
          deposit: 100,
          netPl: 1000,
          pinbetMetricsComplete: true,
        })),
      ]);
      const networkUser = {
        id: 'network-user',
        referredById: 'user-001',
        isExternal: false,
        affiliateLinks: networkLinks,
        fraudCounts: [],
      };
      const prisma = {
        ...makePrisma({ affiliateLinks: ownLinks }),
        user: {
          findUniqueOrThrow: vi.fn().mockResolvedValue({
            ...BASE_USER,
            affiliateLinks: ownLinks,
          }),
          findMany: vi
            .fn()
            .mockResolvedValueOnce([networkUser])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([networkUser]),
        },
      };
      const svc = new DashboardBalanceService(
        repo as any,
        makeAccess() as any,
        makeSettings() as any,
        prisma as any,
      );

      const result = await svc.getBalance(JWT_USER, {});

      expect(result.networkCpa).toBe(140); // (100-10) + (200-150)
    });

    it('treats a network Pinbet link with no provider row as zero movement instead of syncing', async () => {
      const repo = makeRepo([
        {
          campaignId: 'own-pin-camp',
          bettingHouse: 'pinbet-diario',
          cpaQualified: 10,
          revShare: 0,
          deposit: 500,
          netPl: 100,
          withdrawalTotal: 0,
          volume: 1500,
          pinbetMetricsComplete: true,
        },
      ]);
      const ownLink = {
        campaignId: 'own-pin-camp',
        bettingHouse: 'pinbet-diario',
        cpa: decimal(100),
        revshare: decimal(0),
      };
      const networkLink = {
        campaignId: 'network-pin-without-movement',
        bettingHouse: 'pinbet-diario',
        cpa: decimal(50),
        revshare: decimal(0),
      };
      const prisma = {
        user: {
          findUniqueOrThrow: vi.fn().mockResolvedValue({
            ...BASE_USER,
            affiliateLinks: [ownLink],
          }),
          findMany: vi
            .fn()
            .mockResolvedValueOnce([
              {
                id: 'network-user',
                affiliateLinks: [networkLink],
                fraudCounts: [],
              },
            ])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([
              {
                id: 'network-user',
                isExternal: false,
                affiliateLinks: [networkLink],
                fraudCounts: [],
              },
            ]),
        },
        withdrawalRequest: { findMany: vi.fn().mockResolvedValue([]) },
        setting: { findMany: vi.fn().mockResolvedValue([]) },
      };
      const svc = new DashboardBalanceService(
        repo as any,
        makeAccess() as any,
        makeSettings() as any,
        prisma as any,
      );

      const result = await svc.getBalance(JWT_USER, {});
      const house = result.perHouse.find((h) => h.house === 'pinbet-diario');

      expect(house).toMatchObject({
        netPl: 100,
        pinbetMetricsComplete: true,
        netPlWithdrawalLimit: 80,
        withdrawable: 80,
        withdrawalRestriction: 'NET_PL_CAP',
      });
    });

    it('keeps Pinbet syncing when an existing provider row has null metrics', async () => {
      const repo = makeRepo([
        {
          campaignId: 'pin-camp',
          bettingHouse: 'pinbet-diario',
          cpaQualified: 10,
          revShare: 0,
          deposit: 500,
          netPl: null,
          withdrawalTotal: 0,
          volume: 1500,
          pinbetMetricsComplete: false,
        },
      ]);
      const prisma = makePrisma({
        affiliateLinks: [
          {
            campaignId: 'pin-camp',
            bettingHouse: 'pinbet-diario',
            cpa: decimal(100),
            revshare: decimal(0),
          },
        ],
      });
      const svc = new DashboardBalanceService(
        repo as any,
        makeAccess() as any,
        makeSettings() as any,
        prisma as any,
      );

      const result = await svc.getBalance(JWT_USER, {});
      const house = result.perHouse.find((h) => h.house === 'pinbet-diario');

      expect(house).toMatchObject({
        netPl: null,
        pinbetMetricsComplete: false,
        withdrawable: 0,
        withdrawalRestriction: 'METRICS_SYNCING',
      });
    });

    it('returns zero balance when user has no affiliate links', async () => {
      const prisma = makePrisma({ affiliateLinks: [] });
      const svc = new DashboardBalanceService(
        makeRepo() as any,
        makeAccess() as any,
        makeSettings() as any,
        prisma as any,
      );

      const result = await svc.getBalance(JWT_USER, {});

      expect(result.balance).toBe(0);
      expect(result.cpa).toBe(0);
    });

    it('passes auditExclusion to repository when block is active', async () => {
      const repo = makeRepo();
      const svc = new DashboardBalanceService(
        repo as any,
        makeAccess() as any,
        makeSettings({ withdrawal_block_active: 'true' }) as any,
        makePrisma() as any,
      );

      await svc.getBalance(JWT_USER, {});

      expect(repo.aggregatePerCampaignHouse).toHaveBeenCalledWith(
        expect.any(Array),
        undefined,
        expect.any(Date),
        expect.any(Date),
        expect.objectContaining({
          startDate: expect.any(Date),
          endDate: expect.any(Date),
        }),
        undefined,
      );
    });

    it('reads deposit average from the source house for a shared-account alias (esportiva-diario → esportivabet)', async () => {
      // esportiva-diario usa a mesma conta do provedor que esportivabet, então o
      // affiliate_data das campanhas dele fica tagueado 'esportivabet'. A média de
      // depósito por CPA deve ler da casa-FONTE — senão dá 0 e bloqueia o saque.
      const repo = makeRepo([
        {
          campaignId: 'diario-camp',
          bettingHouse: 'esportivabet',
          cpaQualified: 2,
          revShare: 0,
          deposit: 83,
        },
      ]);
      const prisma = {
        user: {
          findUniqueOrThrow: vi.fn().mockResolvedValue({
            ...BASE_USER,
            affiliateLinks: [
              {
                campaignId: 'diario-camp',
                bettingHouse: 'esportiva-diario',
                cpa: decimal(60),
                revshare: decimal(0),
              },
            ],
          }),
          findMany: vi.fn().mockResolvedValue([]),
        },
        withdrawalRequest: { findMany: vi.fn().mockResolvedValue([]) },
        setting: { findMany: vi.fn().mockResolvedValue([]) },
        bettingHouse: {
          findUnique: vi
            .fn()
            .mockResolvedValue({ minAvgDepositPerCpa: decimal(40) }),
        },
      };
      const svc = new DashboardBalanceService(
        repo as any,
        makeAccess() as any,
        makeSettings() as any,
        prisma as any,
      );

      const result = await svc.getBalance(JWT_USER, {
        bettingHouse: 'esportiva-diario',
      });

      // agregação (own + depósito) usa a casa-FONTE (esportivabet), não a do link
      expect(repo.aggregatePerCampaignHouse).toHaveBeenCalledWith(
        ['diario-camp'],
        'esportivabet',
        expect.any(Date),
        expect.any(Date),
        undefined,
        undefined,
      );
      // ganho próprio aparece mesmo filtrando pela casa aliased (bug do -120):
      // 60 × 2 CPA = 120 — antes dava 0 (lia bucket vazio) e o saldo ficava negativo
      expect(result.cpa).toBe(120);
      expect(result.balance).toBe(120);
      // 83 / 2 = 41.5 ≥ 40 → não bloqueia
      expect(result.depositInfo.avgDepositPerCpa).toBe(41.5);
      expect(result.depositInfo.belowMinimum).toBe(false);
    });

    it('exempts network head from deposit warning', async () => {
      // loadNetworkMembers: L1 query → L2 query → full members query
      // If L1 has members → isNetworkHead = true → exempt from deposit warning
      const prisma = {
        user: {
          findUniqueOrThrow: vi.fn().mockResolvedValue(BASE_USER),
          findMany: vi
            .fn()
            // L1 referrals: 1 member exists → isNetworkHead
            .mockResolvedValueOnce([
              {
                id: 'l1',
                affiliateLinks: [
                  {
                    campaignId: 'l1-camp',
                    bettingHouse: 'esportivabet',
                    cpa: decimal(100),
                    revshare: decimal(0),
                  },
                ],
                fraudCounts: [],
              },
            ])
            // L2 referrals: none
            .mockResolvedValueOnce([])
            // Full members query (those with links)
            .mockResolvedValueOnce([
              {
                id: 'l1',
                affiliateLinks: [
                  { campaignId: 'l1-camp', bettingHouse: 'esportivabet' },
                ],
                fraudCounts: [],
              },
            ]),
        },
        withdrawalRequest: { findMany: vi.fn().mockResolvedValue([]) },
        setting: { findMany: vi.fn().mockResolvedValue([]) },
      };
      const svc = new DashboardBalanceService(
        makeRepo() as any,
        makeAccess() as any,
        makeSettings() as any,
        prisma as any,
      );

      const result = await svc.getBalance(JWT_USER, {});

      expect(result.depositInfo.exemptByNetworkHead).toBe(true);
      expect(result.depositInfo.belowMinimum).toBe(false);
    });

    // Network earnings: EXTERNAL downline pays the head his FULL deal rate;
    // REAL downline pays only the spread margin (head rate − member rate).
    function makeNetworkPrisma(isExternal: boolean) {
      return {
        user: {
          findUniqueOrThrow: vi.fn().mockResolvedValue(BASE_USER), // head cpa 200
          findMany: vi
            .fn()
            // L1 referrals: member anchor rate 100 on esportivabet
            .mockResolvedValueOnce([
              {
                id: 'l1',
                affiliateLinks: [
                  {
                    campaignId: 'l1-camp',
                    bettingHouse: 'esportivabet',
                    cpa: decimal(100),
                    revshare: decimal(0),
                  },
                ],
                fraudCounts: [],
              },
            ])
            // L2 referrals: none
            .mockResolvedValueOnce([])
            // Full members query (with isExternal flag)
            .mockResolvedValueOnce([
              {
                id: 'l1',
                isExternal,
                affiliateLinks: [
                  { campaignId: 'l1-camp', bettingHouse: 'esportivabet' },
                ],
                fraudCounts: [],
              },
            ]),
        },
        withdrawalRequest: { findMany: vi.fn().mockResolvedValue([]) },
        setting: { findMany: vi.fn().mockResolvedValue([]) },
      };
    }

    it('pays the head the FULL deal rate for EXTERNAL downline', async () => {
      const repo = makeRepo([
        {
          campaignId: 'l1-camp',
          bettingHouse: 'esportivabet',
          cpaQualified: 10,
          revShare: 0,
          deposit: 0,
        },
      ]);
      const svc = new DashboardBalanceService(
        repo as any,
        makeAccess() as any,
        makeSettings() as any,
        makeNetworkPrisma(true) as any,
      );

      const result = await svc.getBalance(JWT_USER, {});

      expect(result.networkCpa).toBe(2000); // 200 (full head rate) × 10
    });

    it('pays the head only the spread margin for REAL downline', async () => {
      const repo = makeRepo([
        {
          campaignId: 'l1-camp',
          bettingHouse: 'esportivabet',
          cpaQualified: 10,
          revShare: 0,
          deposit: 0,
        },
      ]);
      const svc = new DashboardBalanceService(
        repo as any,
        makeAccess() as any,
        makeSettings() as any,
        makeNetworkPrisma(false) as any,
      );

      const result = await svc.getBalance(JWT_USER, {});

      expect(result.networkCpa).toBe(1000); // (200 − 100) margin × 10
    });
  });
});
