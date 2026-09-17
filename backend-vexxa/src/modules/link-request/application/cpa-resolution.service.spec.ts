import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma, LinkRuleType, type HouseLinkRule } from '@prisma/client';
import { CpaResolutionService } from './cpa-resolution.service.js';

const D = (n: number) => new Prisma.Decimal(n);

function makeRule(over: Partial<HouseLinkRule> = {}): HouseLinkRule {
  const base: HouseLinkRule = {
    id: 'rule-1',
    houseSlug: 'superbet',
    requestEnabled: true,
    autoAssignEnabled: true,
    ruleType: LinkRuleType.INVITER_DISCOUNT,
    defaultCpa: D(105),
    fallbackCpa: D(105),
    inviterCpaThreshold: D(105),
    inviterCpaDiscount: D(10),
    defaultRevshare: D(0),
    rangeReferenceHouse: null,
    rangeTiers: [],
    checkExistingLink: true,
    checkPendingRequest: true,
    useInviterCpa: true,
    applyFallbackNoInviterCpa: true,
    applyDefaultNoInviter: true,
    blockOnRequiredFail: true,
    processOldRequests: false,
    requireActiveLinkInHouses: false,
    requiredHouseSlugs: [],
    blockMessage: '',
    updatedByName: '',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  return { ...base, ...over };
}

/** Prisma mock whose affiliateLink.findFirst returns a fixed CPA for any read. */
function makePrisma(cpa: number | null) {
  return {
    affiliateLink: {
      findFirst: vi
        .fn()
        .mockResolvedValue(cpa === null ? null : { cpa: D(cpa) }),
    },
  } as never;
}

function makePrismaByDeal(dealCpa: number | null, houseWideCpa: number | null) {
  const linkRequestFindFirst = vi
    .fn()
    .mockResolvedValue(dealCpa === null ? null : { resolvedCpa: D(dealCpa) });
  const prisma = {
    linkRequest: {
      findFirst: linkRequestFindFirst,
    },
    affiliateLink: {
      findFirst: vi
        .fn()
        .mockResolvedValue(
          houseWideCpa === null ? null : { cpa: D(houseWideCpa) },
        ),
    },
  } as never;
  return { prisma, linkRequestFindFirst };
}

/**
 * Prisma mock que resolve CPA por chave `${userId}:${bettingHouse}`.
 * Necessário para RANGE, que lê o superbet do PRÓPRIO usuário e a esportiva
 * do convidante em duas chamadas distintas.
 */
function makePrismaByHouse(map: Record<string, number | null>) {
  return {
    affiliateLink: {
      findFirst: vi.fn().mockImplementation((args: unknown) => {
        const where = (
          args as { where: { userId: string; bettingHouse: string } }
        ).where;
        const v = map[`${where.userId}:${where.bettingHouse}`];
        return Promise.resolve(v == null ? null : { cpa: D(v) });
      }),
    },
  } as never;
}

describe('CpaResolutionService — INVITER_DISCOUNT (Superbet 105/105/10)', () => {
  const cases: Array<[number, number, string]> = [
    [120, 105, 'DEFAULT'],
    [110, 105, 'DEFAULT'],
    [105, 95, 'INVITER_MINUS_DISCOUNT'],
    [100, 90, 'INVITER_MINUS_DISCOUNT'],
    [95, 85, 'INVITER_MINUS_DISCOUNT'],
  ];
  it.each(cases)('inviter %d → %d (%s)', async (inv, expected, rule) => {
    const svc = new CpaResolutionService(makePrisma(inv));
    const r = await svc.resolveCpa({
      houseSlug: 'superbet',
      userId: 'u-1',
      inviterId: 'inv-1',
      rule: makeRule(),
    });
    expect(r.cpa).toBe(expected);
    expect(r.ruleApplied).toBe(rule);
  });

  it('aguarda quando o convidante só tem CPA de outra deal da Superbet', async () => {
    const { prisma, linkRequestFindFirst } = makePrismaByDeal(null, 130);
    const svc = new CpaResolutionService(prisma);

    const result = await svc.resolveCpa({
      houseSlug: 'superbet',
      dealId: 'deal-nova',
      userId: 'user-1',
      inviterId: 'inv-1',
      rule: makeRule(),
    });

    expect(result.hold).toBe(true);
    expect(result.inviterCpa).toBeNull();
    const lookupArg: unknown = linkRequestFindFirst.mock.calls[0]?.[0];
    expect(lookupArg).toMatchObject({
      where: {
        userId: 'inv-1',
        dealId: 'deal-nova',
        bettingHouseSlug: 'superbet',
        status: 'FULFILLED',
      },
    });
  });

  it('calcula pelo CPA FULFILLED do convidante na mesma deal da Superbet', async () => {
    const { prisma } = makePrismaByDeal(105, 130);
    const svc = new CpaResolutionService(prisma);

    const result = await svc.resolveCpa({
      houseSlug: 'superbet',
      dealId: 'deal-nova',
      userId: 'user-1',
      inviterId: 'inv-1',
      rule: makeRule(),
    });

    expect(result).toMatchObject({
      cpa: 95,
      inviterCpa: 105,
      ruleApplied: 'INVITER_MINUS_DISCOUNT',
    });
  });
});

describe('CpaResolutionService — Betnacional (75/80/5)', () => {
  const rule = makeRule({
    houseSlug: 'betnacional',
    defaultCpa: D(75),
    fallbackCpa: D(75),
    inviterCpaThreshold: D(80),
    inviterCpaDiscount: D(5),
  });
  const cases: Array<[number, number]> = [
    [90, 75],
    [85, 75],
    [80, 75],
    [75, 70],
    [70, 65],
  ];
  it.each(cases)('inviter %d → %d', async (inv, expected) => {
    const svc = new CpaResolutionService(makePrisma(inv));
    const r = await svc.resolveCpa({
      houseSlug: 'betnacional',
      userId: 'u',
      inviterId: 'i',
      rule,
    });
    expect(r.cpa).toBe(expected);
  });
});

describe('CpaResolutionService — Hiperbet (40/45/5)', () => {
  const rule = makeRule({
    houseSlug: 'hiperbet',
    defaultCpa: D(40),
    fallbackCpa: D(40),
    inviterCpaThreshold: D(45),
    inviterCpaDiscount: D(5),
  });
  const cases: Array<[number, number]> = [
    [55, 40],
    [50, 40],
    [45, 40],
    [40, 35],
    [35, 30],
  ];
  it.each(cases)('inviter %d → %d', async (inv, expected) => {
    const svc = new CpaResolutionService(makePrisma(inv));
    const r = await svc.resolveCpa({
      houseSlug: 'hiperbet',
      userId: 'u',
      inviterId: 'i',
      rule,
    });
    expect(r.cpa).toBe(expected);
  });
});

describe('CpaResolutionService — Betano Diario (60/inviter−5)', () => {
  const rule = makeRule({
    houseSlug: 'betano-diario',
    defaultCpa: D(60),
    fallbackCpa: D(60),
    inviterCpaThreshold: null,
    inviterCpaDiscount: D(5),
  });

  it('uses CPA 60 for a user without an inviter', async () => {
    const service = new CpaResolutionService(makePrisma(null));
    const result = await service.resolveCpa({
      houseSlug: 'betano-diario',
      userId: 'user-1',
      inviterId: null,
      rule,
    });
    expect(result).toMatchObject({ cpa: 60, ruleApplied: 'DEFAULT' });
  });

  it('uses the inviter CPA minus 5', async () => {
    const service = new CpaResolutionService(makePrisma(60));
    const result = await service.resolveCpa({
      houseSlug: 'betano-diario',
      userId: 'user-1',
      inviterId: 'inviter-1',
      rule,
    });
    expect(result).toMatchObject({
      cpa: 55,
      inviterCpa: 60,
      ruleApplied: 'INVITER_MINUS_DISCOUNT',
    });
  });

  it('keeps the request pending when the inviter has no Betano Diario CPA', async () => {
    const service = new CpaResolutionService(makePrisma(null));
    const result = await service.resolveCpa({
      houseSlug: 'betano-diario',
      userId: 'user-1',
      inviterId: 'inviter-1',
      rule,
    });
    expect(result).toMatchObject({ hold: true, cpa: 0, inviterCpa: null });
  });
});

describe('CpaResolutionService — Esportiva RANGE (ref = superbet DO PRÓPRIO usuário)', () => {
  const rule = makeRule({
    houseSlug: 'esportivabet',
    ruleType: LinkRuleType.RANGE,
    defaultCpa: D(55),
    fallbackCpa: D(55),
    inviterCpaThreshold: null,
    inviterCpaDiscount: D(5),
    rangeReferenceHouse: 'superbet',
    rangeTiers: [
      { min: 116, max: 120, cpa: 65 },
      { min: 115, max: 115, cpa: 60 },
      { min: 100, max: 114, cpa: 55 },
      { min: null, max: 99, cpa: 50 },
    ] as unknown as Prisma.JsonValue,
  });

  // Faixa pelo CPA superbet do próprio usuário, SEM convidante.
  const tierCases: Array<[number, number]> = [
    [120, 65],
    [117, 65],
    [116, 65],
    [115, 60],
    [114, 55],
    [100, 55],
    [99, 50],
    [50, 50],
  ];
  it.each(tierCases)(
    'superbet próprio %d → esportiva %d (RANGE_RULE, sem convidante)',
    async (ownSb, expected) => {
      const svc = new CpaResolutionService(
        makePrismaByHouse({ 'u:superbet': ownSb }),
      );
      const r = await svc.resolveCpa({
        houseSlug: 'esportivabet',
        userId: 'u',
        inviterId: null,
        rule,
      });
      expect(r.cpa).toBe(expected);
      expect(r.ruleApplied).toBe('RANGE_RULE');
      expect(r.rangeReferenceHouse).toBe('superbet');
      expect(r.rangeReferenceCpa).toBe(ownSb);
    },
  );

  it('convidante com esportiva IGUAL ao calculado → calculado − 5 (INVITER_MINUS_DISCOUNT)', async () => {
    // own superbet 116 → faixa 65; convidante esportiva 65 → 60.
    const svc = new CpaResolutionService(
      makePrismaByHouse({ 'u:superbet': 116, 'inv:esportivabet': 65 }),
    );
    const r = await svc.resolveCpa({
      houseSlug: 'esportivabet',
      userId: 'u',
      inviterId: 'inv',
      rule,
    });
    expect(r.cpa).toBe(60);
    expect(r.ruleApplied).toBe('INVITER_MINUS_DISCOUNT');
  });

  it('convidante com esportiva DIFERENTE → mantém valor da faixa', async () => {
    // own superbet 116 → 65; convidante esportiva 60 → 65.
    const svc = new CpaResolutionService(
      makePrismaByHouse({ 'u:superbet': 116, 'inv:esportivabet': 60 }),
    );
    const r = await svc.resolveCpa({
      houseSlug: 'esportivabet',
      userId: 'u',
      inviterId: 'inv',
      rule,
    });
    expect(r.cpa).toBe(65);
    expect(r.ruleApplied).toBe('RANGE_RULE');
  });

  it('convidante SEM esportiva configurada → fica em espera', async () => {
    const svc = new CpaResolutionService(
      makePrismaByHouse({ 'u:superbet': 116, 'inv:esportivabet': null }),
    );
    const r = await svc.resolveCpa({
      houseSlug: 'esportivabet',
      userId: 'u',
      inviterId: 'inv',
      rule,
    });
    expect(r.hold).toBe(true);
    expect(r.fallbackUsed).toBe(false);
    expect(r.togglesApplied).toContain('holdInviterNoCpa');
  });

  it('superbet ativo mas SEM CPA configurado → fallback 55 (FALLBACK)', async () => {
    const svc = new CpaResolutionService(
      makePrismaByHouse({
        'u:superbet': null,
        'inv:esportivabet': 60,
      }),
    );
    const r = await svc.resolveCpa({
      houseSlug: 'esportivabet',
      userId: 'u',
      inviterId: 'inv',
      rule,
    });
    expect(r.cpa).toBe(55);
    expect(r.ruleApplied).toBe('FALLBACK');
    expect(r.fallbackUsed).toBe(true);
  });
});

describe('CpaResolutionService — fallbacks e toggles', () => {
  let prismaNoLink: ReturnType<typeof makePrisma>;
  beforeEach(() => {
    prismaNoLink = makePrisma(null);
  });

  it('sem convidante → CPA padrão (DEFAULT)', async () => {
    const svc = new CpaResolutionService(prismaNoLink);
    const r = await svc.resolveCpa({
      houseSlug: 'superbet',
      userId: 'u',
      inviterId: null,
      rule: makeRule(),
    });
    expect(r.cpa).toBe(105);
    expect(r.ruleApplied).toBe('DEFAULT');
  });

  it('convidante sem link/CPA → fica em espera sem fallback', async () => {
    const svc = new CpaResolutionService(prismaNoLink);
    const r = await svc.resolveCpa({
      houseSlug: 'superbet',
      userId: 'u',
      inviterId: 'i',
      rule: makeRule(),
    });
    expect(r.hold).toBe(true);
    expect(r.fallbackUsed).toBe(false);
    expect(r.togglesApplied).toContain('holdInviterNoCpa');
  });

  it('useInviterCpa=false → ignora convidante e usa default (INVITER_DISCOUNT)', async () => {
    const svc = new CpaResolutionService(makePrisma(95));
    const r = await svc.resolveCpa({
      houseSlug: 'superbet',
      userId: 'u',
      inviterId: 'i',
      rule: makeRule({ useInviterCpa: false }),
    });
    expect(r.cpa).toBe(105);
    expect(r.ruleApplied).toBe('DEFAULT');
  });

  it('precisão Decimal: 100.0000 − 10 = 90.0000', async () => {
    const svc = new CpaResolutionService(makePrisma(100));
    const r = await svc.resolveCpa({
      houseSlug: 'superbet',
      userId: 'u',
      inviterId: 'i',
      rule: makeRule(),
    });
    expect(r.cpa).toBe(90);
  });
});

describe('CpaResolutionService — bloqueio global sem link do convidante', () => {
  it.each([
    ['sportingbet', LinkRuleType.INVITER_DISCOUNT],
    ['casa-range', LinkRuleType.RANGE],
    ['casa-mirror', LinkRuleType.MIRROR],
  ])(
    '%s com regra %s fica em espera antes do fallback',
    async (houseSlug, ruleType) => {
      const svc = new CpaResolutionService(makePrisma(null));
      const result = await svc.resolveCpa({
        houseSlug,
        userId: 'user-1',
        inviterId: 'inviter-1',
        rule: makeRule({ houseSlug, ruleType }),
      });

      expect(result.hold).toBe(true);
      expect(result.fallbackUsed).toBe(false);
      expect(result.togglesApplied).toContain('holdInviterNoCpa');
      expect(result.togglesApplied).not.toContain('applyFallbackNoInviterCpa');
    },
  );
});
