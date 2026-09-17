import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { LinkWebhookService } from './link-webhook.service.js';

const makePrisma = () => ({
  linkWebhookDelivery: {
    findUnique: vi.fn(),
    create: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
  },
  user: { findUnique: vi.fn() },
});

describe('LinkWebhookService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let settings: {
    ownerIdForActor: ReturnType<typeof vi.fn>;
    listTargetsForEvent: ReturnType<typeof vi.fn>;
    getSettingsRow: ReturnType<typeof vi.fn>;
  };
  let http: { post: ReturnType<typeof vi.fn> };
  let producer: { enqueueDelivery: ReturnType<typeof vi.fn> };
  let service: LinkWebhookService;

  beforeEach(() => {
    prisma = makePrisma();
    settings = {
      ownerIdForActor: vi.fn(),
      listTargetsForEvent: vi.fn().mockResolvedValue([]),
      getSettingsRow: vi.fn(),
    };
    http = { post: vi.fn() };
    producer = { enqueueDelivery: vi.fn().mockResolvedValue(undefined) };
    service = new LinkWebhookService(
      prisma as any,
      settings as any,
      http as any,
      producer as any,
    );
  });

  it('does nothing when no target is subscribed to the event', async () => {
    settings.listTargetsForEvent.mockResolvedValue([]);
    await service.emitAffiliateDataSynced({
      houseSlug: 'betano',
      dates: ['2026-06-15'],
      rowsUpserted: 10,
    });
    expect(prisma.linkWebhookDelivery.create).not.toHaveBeenCalled();
    expect(producer.enqueueDelivery).not.toHaveBeenCalled();
  });

  it('creates a delivery and enqueues it for a subscribed global target', async () => {
    settings.listTargetsForEvent.mockResolvedValue([
      {
        ownerUserId: null,
        webhookUrl: 'https://hooks.partner.com',
        secret: 's',
        events: ['affiliate_data.synced'],
      },
    ]);
    prisma.linkWebhookDelivery.findUnique.mockResolvedValue(null);
    prisma.linkWebhookDelivery.create.mockResolvedValue({ id: 'del-1' });

    await service.emitAffiliateDataSynced({
      houseSlug: 'betano',
      dates: ['2026-06-15'],
      rowsUpserted: 10,
    });

    expect(prisma.linkWebhookDelivery.create).toHaveBeenCalledTimes(1);
    expect(producer.enqueueDelivery).toHaveBeenCalledWith('del-1');
  });

  it('skips creating a delivery when the idempotency key already exists', async () => {
    settings.listTargetsForEvent.mockResolvedValue([
      {
        ownerUserId: null,
        webhookUrl: 'https://hooks.partner.com',
        secret: 's',
        events: ['affiliate_data.synced'],
      },
    ]);
    prisma.linkWebhookDelivery.findUnique.mockResolvedValue({ id: 'existing' });

    await service.emitAffiliateDataSynced({
      houseSlug: 'betano',
      dates: ['2026-06-15'],
      rowsUpserted: 10,
    });

    expect(prisma.linkWebhookDelivery.create).not.toHaveBeenCalled();
    expect(producer.enqueueDelivery).not.toHaveBeenCalled();
  });

  describe('redeliver', () => {
    it('clones a delivery and enqueues a new attempt', async () => {
      settings.ownerIdForActor.mockReturnValue(null); // admin
      prisma.linkWebhookDelivery.findUnique.mockResolvedValue({
        id: 'orig',
        linkRequestId: null,
        ownerUserId: 'owner-1',
        event: 'affiliate_data.synced',
        idempotencyKey: 'k',
        payload: { event: 'affiliate_data.synced' },
      });
      prisma.linkWebhookDelivery.create.mockResolvedValue({ id: 'clone-1' });

      const res = await service.redeliver(
        { sub: 'admin', role: 'ADMIN' } as any,
        'orig',
      );

      expect(res.id).toBe('clone-1');
      expect(producer.enqueueDelivery).toHaveBeenCalledWith('clone-1');
    });

    it('throws NotFound for unknown delivery', async () => {
      settings.ownerIdForActor.mockReturnValue(null);
      prisma.linkWebhookDelivery.findUnique.mockResolvedValue(null);
      await expect(
        service.redeliver({ sub: 'a', role: 'ADMIN' } as any, 'missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('forbids redelivering a delivery outside the actor scope', async () => {
      settings.ownerIdForActor.mockReturnValue('owner-2');
      prisma.linkWebhookDelivery.findUnique.mockResolvedValue({
        id: 'orig',
        ownerUserId: 'owner-1',
        idempotencyKey: 'k',
        payload: {},
      });
      await expect(
        service.redeliver({ sub: 'owner-2', role: 'AFFILIATE' } as any, 'orig'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('listDeliveries (partner filters)', () => {
    it('aceita search + from/to e monta o where (scoped ao owner)', async () => {
      settings.ownerIdForActor.mockReturnValue('owner-1');
      await service.listDeliveries(
        { sub: 'owner-1', role: 'AFFILIATE' } as any,
        {
          page: 1,
          limit: 20,
          search: 'kau',
          from: '2026-06-01',
          to: '2026-06-25',
        } as any,
      );

      const where = prisma.linkWebhookDelivery.findMany.mock.calls.at(-1)?.[0]
        ?.where as Record<string, any>;
      expect(where.ownerUserId).toBe('owner-1');
      expect(where.createdAt?.gte).toBeInstanceOf(Date);
      expect(where.createdAt?.lte).toBeInstanceOf(Date);
      expect(where.linkRequest?.user?.OR).toEqual([
        { name: { contains: 'kau', mode: 'insensitive' } },
        { email: { contains: 'kau', mode: 'insensitive' } },
      ]);
    });

    it('sem search/datas o where não inclui esses filtros', async () => {
      settings.ownerIdForActor.mockReturnValue('owner-1');
      await service.listDeliveries(
        { sub: 'owner-1', role: 'AFFILIATE' } as any,
        {
          page: 1,
          limit: 20,
        } as any,
      );
      const where = prisma.linkWebhookDelivery.findMany.mock.calls.at(-1)?.[0]
        ?.where as Record<string, any>;
      expect(where.linkRequest).toBeUndefined();
      expect(where.createdAt).toBeUndefined();
    });
  });

  describe('sendTestWebhook', () => {
    const actor = {
      sub: 'owner-1',
      email: 'p@x.com',
      role: 'AFFILIATE',
    } as any;

    beforeEach(() => {
      settings.ownerIdForActor.mockReturnValue('owner-1');
      settings.getSettingsRow.mockResolvedValue({
        webhookUrl: 'https://hook.example.com',
        webhookSecret: 'sek',
      });
      http.post.mockResolvedValue({
        httpStatus: 200,
        responseBody: 'ok',
        request: {
          headers: { 'x-vallex-signature': 'sha256=abc' },
          timestamp: '1',
          body: '{}',
        },
      });
    });

    it('sends a withdrawal sample and returns the signed request + response', async () => {
      const res = await service.sendTestWebhook(
        actor,
        'withdrawal.status_changed',
      );
      expect(res.success).toBe(true);
      expect(res.event).toBe('withdrawal.status_changed');
      expect(res.request?.headers['x-vallex-signature']).toBe('sha256=abc');
      const sentPayload = http.post.mock.calls[0][2];
      expect(sentPayload.event).toBe('withdrawal.status_changed');
      expect(sentPayload.withdrawal).toMatchObject({ status: 'COMPLETED' });
    });

    it('defaults to link_request.approved for an unknown/missing event', async () => {
      const res = await service.sendTestWebhook(actor);
      expect(res.event).toBe('link_request.approved');
      expect(http.post.mock.calls[0][2].event).toBe('link_request.approved');
    });

    it('does NOT persist a delivery row (isolation)', async () => {
      await service.sendTestWebhook(actor, 'withdrawal.created');
      expect(prisma.linkWebhookDelivery.create).not.toHaveBeenCalled();
    });
  });

  describe('withdrawal events', () => {
    it('emitWithdrawalCreated dispatches the withdrawal.created event (owner-scoped)', async () => {
      settings.listTargetsForEvent.mockResolvedValue([]); // no targets → early return
      await service.emitWithdrawalCreated({
        withdrawalId: 'w1',
        userId: 'sub-1',
        bettingHouse: 'superbet',
        amount: 130,
        originalAmount: 130,
        status: 'PENDING',
        createdAt: '2026-06-24T00:00:00.000Z',
      });
      expect(settings.listTargetsForEvent).toHaveBeenCalledWith(
        'withdrawal.created',
      );
    });
  });
});
