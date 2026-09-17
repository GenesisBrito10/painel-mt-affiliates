import { describe, expect, it, vi } from 'vitest';
import { LinkRequestStatus } from '@prisma/client';
import { LinkRequestService } from './link-request.service.js';

function makeService() {
  const create = vi.fn().mockImplementation(({ data }: any) => ({
    id: 'lr-1',
    userId: data.userId,
    dealId: data.dealId,
    bettingHouseSlug: data.bettingHouseSlug,
    message: data.message,
    status: data.status ?? LinkRequestStatus.PENDING,
    createdAt: new Date('2026-07-17T00:00:00Z'),
  }));

  const service = Object.create(
    LinkRequestService.prototype,
  ) as LinkRequestService;
  const resolveCpa = vi.fn().mockResolvedValue({
    cpa: 45,
    revshare: 0,
    ruleApplied: 'INVITER_MINUS_DISCOUNT',
    inviterId: 'inv-1',
    inviterCpa: 50,
    rangeReferenceHouse: null,
    rangeReferenceCpa: null,
    togglesApplied: ['useInviterCpa', 'inviterDiscount'],
  });

  Object.assign(service as any, {
    prisma: {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          referredById: 'inv-1',
          name: 'Afiliado',
        }),
      },
      linkRequest: { create },
    },
    houseLinkRule: {
      getRule: vi.fn().mockResolvedValue({
        id: 'rule-diario',
        requestEnabled: true,
        autoAssignEnabled: true,
        updatedAt: new Date('2026-07-17T00:00:00Z'),
      }),
    },
    linkDependency: {
      checkRequiredLinks: vi.fn().mockResolvedValue({
        ok: true,
        requiredHouses: [],
        missingHouses: [],
      }),
    },
    cpaResolution: {
      resolveCpa,
    },
    assignmentLog: { record: vi.fn().mockResolvedValue(undefined) },
    linkWebhook: { notifyCreated: vi.fn().mockResolvedValue(undefined) },
  });

  return { service, create, resolveCpa };
}

describe('LinkRequestService.create — Esportiva Diário rule snapshot', () => {
  it('persists the resolved CPA for esportiva-diario even when the user has an inviter', async () => {
    const { service, create, resolveCpa } = makeService();

    await (service as any).resolveAndAssign(
      'user-1',
      'deal-1',
      'esportiva-diario',
      '',
    );

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data).toMatchObject({
      bettingHouseSlug: 'esportiva-diario',
      resolvedCpa: 45,
      resolvedRevshare: 0,
      resolvedRuleApplied: 'INVITER_MINUS_DISCOUNT',
      inviterId: 'inv-1',
      inviterCpa: 50,
    });
    expect(resolveCpa).toHaveBeenCalledWith(
      expect.objectContaining({ dealId: 'deal-1' }),
    );
  });
});
