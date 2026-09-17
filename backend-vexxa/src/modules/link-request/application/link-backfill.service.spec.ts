import { describe, expect, it, vi } from 'vitest';
import { LinkRequestStatus } from '@prisma/client';
import { LinkBackfillService } from './link-backfill.service.js';

const decimal = (n: number) => ({ toNumber: () => n });

/**
 * Cobre o reprocessRequest do admin: antes era no-op silencioso em REJECTED
 * (tryAssign exige PENDING). Agora reavalia dependência e reabre p/ PENDING.
 */
function setup(opts: { status: LinkRequestStatus; depOk: boolean }) {
  const linkRequest = {
    findUnique: vi.fn().mockResolvedValue({
      id: 'req-1',
      userId: 'user-1',
      status: opts.status,
      bettingHouseSlug: 'esportivabet',
      resolvedCpa: decimal(65),
      resolvedRevshare: decimal(0),
      resolvedRuleApplied: 'RANGE_RULE',
      inviterId: null,
      user: { name: 'Michael', referredById: null },
    }),
    update: vi.fn().mockResolvedValue(undefined),
  };
  const prisma = { linkRequest } as never;

  const houseLinkRule = {
    getRule: vi.fn().mockResolvedValue({
      id: 'rule-esp',
      houseSlug: 'esportivabet',
      blockOnRequiredFail: true,
      blockMessage: 'Precisa de superbet.',
      requireActiveLinkInHouses: true,
      requiredHouseSlugs: ['superbet'],
      updatedAt: new Date(),
    }),
  } as never;

  const cpaResolution = { resolveCpa: vi.fn() } as never;

  const linkDependency = {
    checkRequiredLinks: vi.fn().mockResolvedValue(
      opts.depOk
        ? { ok: true, requiredHouses: ['superbet'], missingHouses: [] }
        : {
            ok: false,
            requiredHouses: ['superbet'],
            missingHouses: ['superbet'],
          },
    ),
  } as never;

  const assignmentLog = { record: vi.fn().mockResolvedValue(undefined) };
  const esportivaAssignment = {
    tryAssign: vi
      .fn()
      .mockResolvedValue({ assigned: true, campaignId: 'VALLEXGROUP - 9' }),
  };

  const service = new LinkBackfillService(
    prisma,
    houseLinkRule,
    cpaResolution,
    linkDependency,
    assignmentLog as never,
    {} as never, // superbet
    {} as never, // betnacional
    {} as never, // hiperbet
    {} as never, // betano
    esportivaAssignment as never,
  );

  return {
    service,
    linkRequest,
    linkDependency,
    assignmentLog,
    esportivaAssignment,
  };
}

describe('LinkBackfillService.reprocessRequest', () => {
  const opts = {
    reason: 'liberação manual',
    recalculateSnapshot: false,
    adminName: 'Admin',
  };

  it('REJECTED + dependência OK → reabre p/ PENDING e atribui o link', async () => {
    const ctx = setup({ status: LinkRequestStatus.REJECTED, depOk: true });
    const res = await ctx.service.reprocessRequest('req-1', opts);

    // Reabre a solicitação antes do tryAssign (senão tryAssign no-op).
    const reopenArg: unknown = ctx.linkRequest.update.mock.calls[0]?.[0];
    expect(reopenArg).toMatchObject({
      where: { id: 'req-1' },
      data: { status: LinkRequestStatus.PENDING },
    });
    expect(ctx.esportivaAssignment.tryAssign).toHaveBeenCalled();
    expect(res.outcome).toBe('LINK_ASSIGNED');
    expect(res.status).toBe(LinkRequestStatus.FULFILLED);
  });

  it('REJECTED + dependência falha → BLOCKED com motivo, não atribui', async () => {
    const ctx = setup({ status: LinkRequestStatus.REJECTED, depOk: false });
    const res = await ctx.service.reprocessRequest('req-1', opts);

    expect(ctx.esportivaAssignment.tryAssign).not.toHaveBeenCalled();
    expect(ctx.assignmentLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'BLOCKED' }),
    );
    expect(res.outcome).toBe('BLOCKED');
  });

  it('FULFILLED → rejeita reprocesso', async () => {
    const ctx = setup({ status: LinkRequestStatus.FULFILLED, depOk: true });
    await expect(ctx.service.reprocessRequest('req-1', opts)).rejects.toThrow();
  });
});

describe('LinkBackfillService — Superbet deal-scoped snapshot', () => {
  it('ignora CPA antigo da casa e re-resolve usando a deal do pedido', async () => {
    const resolveCpa = vi.fn().mockResolvedValue({
      cpa: 100,
      revshare: 0,
      ruleApplied: 'INVITER_MINUS_DISCOUNT',
      inviterId: 'inviter-1',
      inviterCpa: 105,
      rangeReferenceHouse: null,
      rangeReferenceCpa: null,
      togglesApplied: ['useInviterCpa', 'inviterDiscount'],
    });
    const linkRequest = { update: vi.fn().mockResolvedValue(undefined) };
    const service = new LinkBackfillService(
      {
        linkRequest,
        affiliateLink: {
          findFirst: vi.fn().mockResolvedValue({
            cpa: decimal(130),
            revshare: decimal(0),
          }),
        },
      } as never,
      {} as never,
      { resolveCpa } as never,
      {
        checkRequiredLinks: vi.fn().mockResolvedValue({
          ok: true,
          requiredHouses: [],
          missingHouses: [],
        }),
      } as never,
      { record: vi.fn().mockResolvedValue(undefined) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const rule = {
      id: 'rule-superbet',
      houseSlug: 'superbet',
      blockOnRequiredFail: true,
      blockMessage: '',
      updatedAt: new Date('2026-08-24T00:00:00Z'),
    } as never;

    const snapshotOne = (
      service as unknown as {
        snapshotOne(
          req: {
            id: string;
            userId: string;
            dealId: string | null;
            inviterId: string | null;
            user: { name: string; referredById: string | null };
          },
          rule: unknown,
        ): Promise<void>;
      }
    ).snapshotOne.bind(service);
    await snapshotOne(
      {
        id: 'request-1',
        userId: 'user-1',
        dealId: 'deal-new',
        inviterId: 'inviter-1',
        user: { name: 'Afiliado', referredById: 'inviter-1' },
      },
      rule,
    );

    expect(resolveCpa).toHaveBeenCalledWith(
      expect.objectContaining({
        houseSlug: 'superbet',
        dealId: 'deal-new',
        inviterId: 'inviter-1',
      }),
    );
    const updateArg: unknown = linkRequest.update.mock.calls.at(-1)?.[0];
    expect(updateArg).toMatchObject({
      data: { resolvedCpa: 100, inviterCpa: 105 },
    });
  });

  it('mantém PENDING no reprocesso enquanto o convidante não entrou na deal', async () => {
    const linkRequest = {
      findUnique: vi.fn().mockResolvedValue({
        id: 'request-2',
        userId: 'user-2',
        dealId: 'deal-new',
        status: LinkRequestStatus.PENDING,
        bettingHouseSlug: 'superbet',
        resolvedCpa: null,
        resolvedRevshare: null,
        resolvedRuleApplied: null,
        inviterId: 'inviter-2',
        user: { name: 'Afiliado', referredById: 'inviter-2' },
      }),
      update: vi.fn().mockResolvedValue(undefined),
    };
    const superbetAssignment = {
      tryAssign: vi.fn().mockResolvedValue({ assigned: true }),
    };
    const assignmentLog = { record: vi.fn().mockResolvedValue(undefined) };
    const service = new LinkBackfillService(
      { linkRequest } as never,
      {
        getRule: vi.fn().mockResolvedValue({
          id: 'rule-superbet',
          houseSlug: 'superbet',
          blockOnRequiredFail: true,
          blockMessage: '',
          updatedAt: new Date('2026-08-24T00:00:00Z'),
        }),
      } as never,
      {
        resolveCpa: vi.fn().mockResolvedValue({
          cpa: 0,
          revshare: 0,
          ruleApplied: 'DEFAULT',
          inviterId: 'inviter-2',
          inviterCpa: null,
          rangeReferenceHouse: null,
          rangeReferenceCpa: null,
          togglesApplied: ['holdInviterNoCpa'],
          hold: true,
        }),
      } as never,
      {
        checkRequiredLinks: vi.fn().mockResolvedValue({
          ok: true,
          requiredHouses: [],
          missingHouses: [],
        }),
      } as never,
      assignmentLog as never,
      superbetAssignment as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await service.reprocessRequest('request-2', {
      reason: 'reprocessar após entrada do convidante',
      recalculateSnapshot: true,
      adminName: 'Admin',
    });

    expect(result).toEqual({
      status: LinkRequestStatus.PENDING,
      outcome: 'WAITING_SNAPSHOT',
    });
    expect(superbetAssignment.tryAssign).not.toHaveBeenCalled();
    const updateArg: unknown = linkRequest.update.mock.calls[0]?.[0];
    expect(updateArg).toMatchObject({
      data: { resolvedCpa: null, resolvedRevshare: null, resolvedAt: null },
    });
    expect(assignmentLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'WAITING_SNAPSHOT' }),
    );
  });
});
