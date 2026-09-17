import { describe, it, expect, vi } from 'vitest';
import { UserRole } from '@prisma/client';
import { LinkRequestService } from './link-request.service.js';
import type { JwtPayload } from '../../auth/domain/auth.types.js';

/**
 * Focused unit test for the referral enrichment of the link-requests listing.
 * `list()` for an ADMIN with an empty query touches only
 * `prisma.linkRequest.{findMany,count}`, so we can drive it through a bare
 * instance (Object.create) without wiring the service's ~15 constructor deps.
 */
function makeService(rows: unknown[]) {
  const findMany = vi.fn().mockResolvedValue(rows);
  const count = vi.fn().mockResolvedValue(rows.length);
  const prisma = { linkRequest: { findMany, count } };

  const service = Object.create(
    LinkRequestService.prototype,
  ) as LinkRequestService;
  (service as unknown as { prisma: unknown }).prisma = prisma;
  return { service, findMany };
}

const admin: JwtPayload = {
  sub: 'admin-1',
  role: UserRole.ADMIN,
} as JwtPayload;

const affiliate: JwtPayload = {
  sub: 'affiliate-1',
  role: UserRole.AFFILIATE,
} as JwtPayload;

const baseRow = {
  id: 'lr-1',
  userId: 'u-1',
  dealId: null,
  bettingHouseSlug: 'betano',
  message: '',
  status: 'PENDING',
  links: [],
  adminNote: '',
  fulfilledAt: null,
  fulfilledByName: '',
  createdAt: new Date('2026-01-10T00:00:00Z'),
  resolvedCpa: null,
  resolvedRevshare: null,
  resolvedRuleApplied: null,
  inviterCpa: null,
  requiredHouseSlugs: [],
  missingHouseSlugs: [],
  blockedReason: null,
  deal: null,
};

describe('LinkRequestService.list — referral enrichment', () => {
  it('selects the referrer (referredBy) on the user relation', async () => {
    const { service, findMany } = makeService([]);

    await service.list(admin, {} as never);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
    const select = findMany.mock.calls[0][0].select;
    expect(select.user.select.referredBy).toEqual({
      select: { id: true, name: true, email: true },
    });
  });

  it('hides inactive deal requests from the affiliate Meus Links listing', async () => {
    const { service, findMany } = makeService([]);

    await service.list(affiliate, { mine: true });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'affiliate-1',
          OR: [{ dealId: null }, { deal: { is: { active: true } } }],
        },
      }),
    );
  });

  it('maps referredBy when the request owner has an inviter', async () => {
    const { service } = makeService([
      {
        ...baseRow,
        user: {
          name: 'Bob',
          email: 'bob@example.com',
          referredBy: {
            id: 'inv-1',
            name: 'Alice',
            email: 'alice@example.com',
          },
        },
      },
    ]);

    const { data } = await service.list(admin, {} as never);

    expect(data[0].referredBy).toEqual({
      id: 'inv-1',
      name: 'Alice',
      email: 'alice@example.com',
    });
  });

  it('maps referredBy to null when the request owner was not referred', async () => {
    const { service } = makeService([
      {
        ...baseRow,
        user: { name: 'Carol', email: 'carol@example.com', referredBy: null },
      },
    ]);

    const { data } = await service.list(admin, {} as never);

    expect(data[0].referredBy).toBeNull();
  });
});
