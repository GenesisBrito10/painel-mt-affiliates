import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { CpaPrizeEngineService } from './cpa-prize-engine.service.js';

const decimal = (n: number) => new Prisma.Decimal(n);

interface TxMock {
  cpaPrizeAward: { createMany: ReturnType<typeof vi.fn> };
  cpaPrizeProgress: { upsert: ReturnType<typeof vi.fn> };
  cpaPrizeLog: { create: ReturnType<typeof vi.fn> };
}

function makeVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ver-1',
    ruleId: 'rule-1',
    bettingHouse: 'superbet',
    cpaPerPrize: 10,
    countMode: 'INDIVIDUAL',
    prizeType: 'BALANCE',
    prizeValue: decimal(100),
    prizeLabel: 'R$100',
    startDate: new Date('2026-05-01T00:00:00.000Z'),
    endDate: null,
    effectiveFromDate: new Date('2026-05-01T00:00:00.000Z'),
    supersededAt: null,
    ...overrides,
  };
}

function makePrisma(opts: {
  version?: Record<string, unknown>;
  links?: { userId: string; campaignId: string }[];
  groupRows?: { campaignId: string; _sum: { cpaQualified: number } }[];
  progress?: { awardsGenerated: number } | null;
  users?: { id: string; referredById: string | null }[];
  locked?: boolean;
  createManyImpl?: () => Promise<unknown>;
}) {
  const tx: TxMock = {
    cpaPrizeAward: {
      createMany: vi.fn(
        opts.createManyImpl ?? (() => Promise.resolve({ count: 0 })),
      ),
    },
    cpaPrizeProgress: { upsert: vi.fn().mockResolvedValue(undefined) },
    cpaPrizeLog: { create: vi.fn().mockResolvedValue(undefined) },
  };

  const prisma = {
    cpaPrizeRuleVersion: {
      findUnique: vi.fn().mockResolvedValue(opts.version ?? makeVersion()),
    },
    affiliateLink: {
      findMany: vi.fn().mockResolvedValue(opts.links ?? []),
    },
    affiliateData: {
      groupBy: vi.fn().mockResolvedValue(opts.groupRows ?? []),
    },
    user: {
      findMany: vi.fn().mockResolvedValue(opts.users ?? []),
      findUnique: vi.fn().mockResolvedValue({ name: 'Afiliado' }),
    },
    cpaPrizeProgress: {
      findUnique: vi.fn().mockResolvedValue(opts.progress ?? null),
      upsert: vi.fn().mockResolvedValue(undefined),
    },
    $transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)),
    $queryRaw: vi.fn().mockResolvedValue([{ locked: opts.locked ?? true }]),
  };

  return { prisma, tx };
}

const notification = {
  create: vi.fn().mockResolvedValue(undefined),
  createMany: vi.fn(),
};

function svc(prisma: unknown) {
  return new CpaPrizeEngineService(prisma as never, notification as never);
}

describe('CpaPrizeEngineService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('individual: 23 CPAs, meta 10 → gera 2 prêmios (cycleIndex 1,2)', async () => {
    const { prisma, tx } = makePrisma({
      links: [{ userId: 'u1', campaignId: 'c1' }],
      groupRows: [{ campaignId: 'c1', _sum: { cpaQualified: 23 } }],
      progress: null,
    });
    const res = await svc(prisma).evaluateRuleVersion('ver-1');

    expect(res.awardsGenerated).toBe(2);
    expect(tx.cpaPrizeAward.createMany).toHaveBeenCalledTimes(1);
    const arg = tx.cpaPrizeAward.createMany.mock.calls[0][0] as {
      data: { cycleIndex: number; status: string }[];
    };
    expect(arg.data.map((d) => d.cycleIndex)).toEqual([1, 2]);
    expect(arg.data.every((d) => d.status === 'AVAILABLE')).toBe(true);
  });

  it('idempotente: já gerou 2, total 23 → delta 0, nenhum award novo', async () => {
    const { prisma, tx } = makePrisma({
      links: [{ userId: 'u1', campaignId: 'c1' }],
      groupRows: [{ campaignId: 'c1', _sum: { cpaQualified: 23 } }],
      progress: { awardsGenerated: 2 },
    });
    const res = await svc(prisma).evaluateRuleVersion('ver-1');

    expect(res.awardsGenerated).toBe(0);
    expect(tx.cpaPrizeAward.createMany).not.toHaveBeenCalled();
    expect(prisma.cpaPrizeProgress.upsert).toHaveBeenCalled(); // totals refreshed
  });

  it('re-sync derruba total abaixo do premiado → não gera nem apaga award (delta<=0)', async () => {
    const { prisma, tx } = makePrisma({
      links: [{ userId: 'u1', campaignId: 'c1' }],
      groupRows: [{ campaignId: 'c1', _sum: { cpaQualified: 15 } }],
      progress: { awardsGenerated: 2 },
    });
    const res = await svc(prisma).evaluateRuleVersion('ver-1');

    expect(res.awardsGenerated).toBe(0);
    expect(tx.cpaPrizeAward.createMany).not.toHaveBeenCalled();
  });

  it('rede: soma só a downline, exclui CPA próprio do cabeça', async () => {
    // H (head) → child C. Both have campaigns; only C counts for H.
    const { prisma, tx } = makePrisma({
      version: makeVersion({ countMode: 'NETWORK' }),
      links: [
        { userId: 'H', campaignId: 'cH' },
        { userId: 'C', campaignId: 'cC' },
      ],
      groupRows: [
        { campaignId: 'cH', _sum: { cpaQualified: 100 } },
        { campaignId: 'cC', _sum: { cpaQualified: 20 } },
      ],
      users: [
        { id: 'H', referredById: null },
        { id: 'C', referredById: 'H' },
      ],
      progress: null,
    });
    const res = await svc(prisma).evaluateRuleVersion('ver-1');

    // H total = 20 (only downline) → floor(20/10)=2 prêmios. C is not a head.
    expect(res.usersEvaluated).toBe(1);
    expect(res.awardsGenerated).toBe(2);
    const arg = tx.cpaPrizeAward.createMany.mock.calls[0][0] as {
      data: { userId: string }[];
    };
    expect(arg.data.every((d) => d.userId === 'H')).toBe(true);
  });

  it('janela usa effectiveFromDate (corte diário) no filtro de data', async () => {
    const eff = new Date('2026-05-11T00:00:00.000Z');
    const { prisma } = makePrisma({
      version: makeVersion({
        startDate: new Date('2026-05-01T00:00:00.000Z'),
        effectiveFromDate: eff,
      }),
      links: [{ userId: 'u1', campaignId: 'c1' }],
      groupRows: [{ campaignId: 'c1', _sum: { cpaQualified: 5 } }],
    });
    await svc(prisma).evaluateRuleVersion('ver-1');

    const where = (
      prisma.affiliateData.groupBy.mock.calls[0][0] as {
        where: { date: { gte: Date } };
      }
    ).where;
    expect(where.date.gte.getTime()).toBe(eff.getTime());
  });

  it('lock ocupado → skippedLocked, nenhum trabalho', async () => {
    const { prisma, tx } = makePrisma({ locked: false });
    const res = await svc(prisma).evaluateRuleVersion('ver-1');

    expect(res.skippedLocked).toBe(true);
    expect(prisma.affiliateLink.findMany).not.toHaveBeenCalled();
    expect(tx.cpaPrizeAward.createMany).not.toHaveBeenCalled();
  });

  it('unique-violation (P2002) ao gerar award é tratada como idempotência, não lança', async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'test',
    });
    const { prisma } = makePrisma({
      links: [{ userId: 'u1', campaignId: 'c1' }],
      groupRows: [{ campaignId: 'c1', _sum: { cpaQualified: 23 } }],
      progress: null,
      createManyImpl: () => Promise.reject(p2002),
    });
    const res = await svc(prisma).evaluateRuleVersion('ver-1');

    expect(res.errors).toBe(0);
    expect(res.awardsGenerated).toBe(0);
  });
});
