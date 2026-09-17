import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AffiliateApiSandboxService } from './affiliate-api-sandbox.service.js';

type Rec = Record<string, any>;

const matches = (rec: Rec, where: Rec) =>
  Object.entries(where).every(([k, v]) => rec[k] === v);

function makePrisma() {
  const store: Rec[] = [];
  let seq = 0;
  const api = {
    affiliateApiSandboxRecord: {
      create: vi.fn(async ({ data }: { data: Rec }) => {
        const rec = {
          id: `rec-${++seq}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        store.push(rec);
        return rec;
      }),
      findFirst: vi.fn(
        async ({ where }: { where: Rec }) =>
          store.find((r) => matches(r, where)) ?? null,
      ),
      findMany: vi.fn(async ({ where }: { where: Rec }) =>
        store.filter((r) => matches(r, where)),
      ),
      update: vi.fn(async ({ where, data }: { where: Rec; data: Rec }) => {
        const r = store.find((x) => x.id === where.id)!;
        Object.assign(r, data);
        return r;
      }),
      deleteMany: vi.fn(async ({ where }: { where: Rec }) => {
        const before = store.length;
        for (let i = store.length - 1; i >= 0; i--) {
          if (matches(store[i]!, where)) store.splice(i, 1);
        }
        return { count: before - store.length };
      }),
    },
    // Production tables — must NEVER be called by the sandbox.
    user: { create: vi.fn() },
    withdrawalRequest: { create: vi.fn() },
  };
  return { api, store };
}

const OWNER = 'owner-1';

describe('AffiliateApiSandboxService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: AffiliateApiSandboxService;

  beforeEach(() => {
    prisma = makePrisma();
    svc = new AffiliateApiSandboxService(prisma.api as any);
  });

  it('link-request creates a sandbox user (not a real User)', async () => {
    const res: any = await svc.createLinkRequestFromApi(OWNER, {
      externalUserId: 'panel-1',
    } as any);
    expect(res.sandbox).toBe(true);
    expect(res.requester.externalId).toBe('panel-1');
    expect(prisma.api.user.create).not.toHaveBeenCalled();
  });

  it('getExternalUser returns the seeded balance (R$1000/house)', async () => {
    await svc.createLinkRequestFromApi(OWNER, {
      externalUserId: 'panel-1',
    } as any);
    const res: any = await svc.getExternalUser(OWNER, 'panel-1', {} as any);
    expect(res.balance.perHouse[0].total).toBe(1000);
    expect(res.balance.balance).toBe(1000);
  });

  it('withdrawal takes the FULL house balance, fee 0, and is 1-per-day (429)', async () => {
    const created: any = await svc.createWithdrawalFromApi(OWNER, {
      externalUserId: 'panel-1',
      bettingHouse: 'superbet',
    } as any);
    expect(created.withdrawal.originalAmount).toBe(1000);
    expect(created.withdrawal.withdrawalFee).toBe(0);
    expect(created.withdrawal.status).toBe('PENDING');
    // balance reserved → 0
    expect(created.balance.perHouse[0].total).toBe(0);
    // second withdrawal same house SAME DAY → 429 (1 por dia)
    await expect(
      svc.createWithdrawalFromApi(OWNER, {
        externalUserId: 'panel-1',
        bettingHouse: 'superbet',
      } as any),
    ).rejects.toMatchObject({ status: 429 });
    // NEVER wrote a real withdrawal row
    expect(prisma.api.withdrawalRequest.create).not.toHaveBeenCalled();
  });

  it('rejects bonus house', async () => {
    await expect(
      svc.createWithdrawalFromApi(OWNER, {
        externalUserId: 'panel-1',
        bettingHouse: 'bonus',
      } as any),
    ).rejects.toThrow('bônus');
  });

  it('status matrix: completed allowed from PENDING, invalid transition 400', async () => {
    const created: any = await svc.createWithdrawalFromApi(OWNER, {
      externalUserId: 'panel-1',
      bettingHouse: 'superbet',
    } as any);
    const id = created.withdrawal.id;

    const done: any = await svc.setWithdrawalStatusFromApi(OWNER, id, {
      status: 'completed',
    } as any);
    expect(done.status).toBe('COMPLETED');

    // COMPLETED is terminal → processing must fail
    await expect(
      svc.setWithdrawalStatusFromApi(OWNER, id, {
        status: 'processing',
      } as any),
    ).rejects.toThrow('Transição inválida');
  });

  it('rejected releases the balance back; list + get work; reset wipes', async () => {
    const created: any = await svc.createWithdrawalFromApi(OWNER, {
      externalUserId: 'panel-1',
      bettingHouse: 'superbet',
    } as any);
    const id = created.withdrawal.id;

    await svc.setWithdrawalStatusFromApi(OWNER, id, {
      status: 'rejected',
    } as any);
    const user: any = await svc.getExternalUser(OWNER, 'panel-1', {} as any);
    expect(user.balance.perHouse[0].total).toBe(1000); // released

    const list: any = await svc.listWithdrawalsFromApi(OWNER, {} as any);
    expect(list.total).toBe(1);
    const one: any = await svc.getWithdrawalFromApi(OWNER, id);
    expect(one.id).toBe(id);

    const reset = await svc.reset(OWNER);
    expect(reset.deleted).toBeGreaterThan(0);
    const after: any = await svc.listWithdrawalsFromApi(OWNER, {} as any);
    expect(after.total).toBe(0);
  });

  it('cross-owner isolation: another owner cannot see/touch the withdrawal', async () => {
    const created: any = await svc.createWithdrawalFromApi(OWNER, {
      externalUserId: 'panel-1',
      bettingHouse: 'superbet',
    } as any);
    await expect(
      svc.getWithdrawalFromApi('other-owner', created.withdrawal.id),
    ).rejects.toThrow('não encontrada');
  });
});
