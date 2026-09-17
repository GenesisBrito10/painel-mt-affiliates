import { describe, expect, it, vi } from 'vitest';
import { UserStatus } from '@prisma/client';
import { SuperbetInactivityService } from './superbet-inactivity.service.js';

const targetDate = new Date('2026-05-18T00:00:00.000Z');

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-001',
    name: 'Afiliado Teste',
    email: 'afiliado@vexxa.test',
    status: UserStatus.APPROVED,
    active: true,
    superbetInactiveDays: 0,
    affiliateLinks: [
      {
        id: 'link-001',
        campaignId: 'campaign-superbet-001',
      },
    ],
    ...overrides,
  } as any;
}

function makeService() {
  const tx = {
    affiliateLink: {
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    user: {
      update: vi.fn().mockResolvedValue({}),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
  };
  const prisma = {
    user: {
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
    },
    affiliateData: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  const mail = {
    send: vi.fn().mockResolvedValue(undefined),
  };
  const sheet = {
    readPool: vi.fn().mockResolvedValue([]),
    clearRowAssignment: vi.fn().mockResolvedValue(undefined),
  };

  const service = new SuperbetInactivityService(
    prisma as any,
    mail as any,
    sheet as any,
  );

  return { service, prisma, mail, sheet, tx };
}

describe('SuperbetInactivityService', () => {
  it('resets the counter when the affiliate generated Superbet QFTD yesterday', async () => {
    const { service, prisma, mail } = makeService();
    prisma.affiliateData.findFirst.mockResolvedValue({ id: 'data-001' });
    const user = makeUser({ superbetInactiveDays: 2 });

    await service.processUser(user, targetDate);

    expect(prisma.affiliateData.findFirst).toHaveBeenCalledWith({
      where: {
        bettingHouse: 'superbet',
        campaignId: { in: ['campaign-superbet-001'] },
        date: {
          gte: targetDate,
          lt: new Date('2026-05-19T00:00:00.000Z'),
        },
        qftd: { gt: 0 },
      },
      select: { id: true },
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-001' },
      data: {
        superbetInactiveDays: 0,
        superbetLastActiveAt: targetDate,
      },
    });
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('increments to day 1 and sends the first warning when there is no QFTD', async () => {
    const { service, prisma, mail } = makeService();

    await service.processUser(
      makeUser({ superbetInactiveDays: 0 }),
      targetDate,
    );

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-001' },
      data: { superbetInactiveDays: 1 },
    });
    expect(mail.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'afiliado@vexxa.test',
        bcc: undefined,
        subject: '⚠️ Você está inativo na Superbet',
        text: expect.stringContaining('Acessar painel:'),
        html: expect.stringContaining('Acessar painel'),
      }),
    );
    expect(mail.send.mock.calls[0][0].text).toContain(
      'primeiro aviso da regra de inatividade',
    );
    expect(mail.send.mock.calls[0][0].html).toContain('Aviso 1 de 3');
    expect(mail.send.mock.calls[0][0].html).toContain(
      'https://affiliates.vallexgroup.com.br/vallex-logo-white.png',
    );
  });

  it('increments to day 2 and sends the final warning when there is no QFTD', async () => {
    const { service, prisma, mail } = makeService();

    await service.processUser(
      makeUser({ superbetInactiveDays: 1 }),
      targetDate,
    );

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-001' },
      data: { superbetInactiveDays: 2 },
    });
    expect(mail.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'afiliado@vexxa.test',
        bcc: undefined,
        subject: '⚠️ Último aviso — link da Superbet será suspenso',
        text: expect.stringContaining('Acessar painel:'),
        html: expect.stringContaining('Acessar painel'),
      }),
    );
    expect(mail.send.mock.calls[0][0].text).toContain('2 dias consecutivos');
    expect(mail.send.mock.calls[0][0].html).toContain('Aviso 2 de 3');
    expect(mail.send.mock.calls[0][0].html).toContain(
      'https://affiliates.vallexgroup.com.br/vallex-logo-white.png',
    );
  });

  it('blocks the affiliate, removes Superbet links, sends warning 3 and writes audit log on day 3', async () => {
    const { service, prisma, mail, tx } = makeService();

    await service.processUser(
      makeUser({ superbetInactiveDays: 2 }),
      targetDate,
    );

    expect(prisma.$transaction).toHaveBeenCalledOnce();
    // SOFT-DELETE: nunca hard-delete (preserva campaignId/link/cpa).
    expect(tx.affiliateLink.deleteMany).not.toHaveBeenCalled();
    expect(tx.affiliateLink.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-001', bettingHouse: 'superbet', deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-001' },
      data: {
        status: UserStatus.BLOCKED,
        active: false,
        superbetInactiveDays: 0,
      },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: null,
        userName: 'Sistema',
        userEmail: 'system@vexxa.local',
        action: 'SUPERBET_AUTO_BLOCK',
        resource: 'users',
        method: 'CRON',
        path: 'superbet-inactivity',
        details: expect.objectContaining({
          reason: '3_consecutive_days_without_qftd',
          targetUserId: 'user-001',
          removedCampaignIds: ['campaign-superbet-001'],
        }),
      }),
    });
    expect(mail.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'afiliado@vexxa.test',
        bcc: undefined,
        subject: '🔒 Sua conta foi bloqueada por inatividade',
        text: expect.stringContaining('Equipe Vallex Company'),
        html: expect.stringContaining('Aviso 3 de 3'),
      }),
    );
    expect(mail.send.mock.calls[0][0].text).not.toContain('Acessar painel:');
    expect(mail.send.mock.calls[0][0].html).not.toContain('Acessar painel');
    expect(mail.send.mock.calls[0][0].html).toContain(
      'https://affiliates.vallexgroup.com.br/vallex-logo-white.png',
    );
  });

  it('uses only Superbet campaign ids, so production in another house does not count', async () => {
    const { service, prisma } = makeService();

    await service.processUser(
      makeUser({
        affiliateLinks: [
          { id: 'link-superbet', campaignId: 'campaign-superbet' },
        ],
      }),
      targetDate,
    );

    expect(prisma.affiliateData.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          bettingHouse: 'superbet',
          campaignId: { in: ['campaign-superbet'] },
        }),
      }),
    );
  });

  it('searches only approved and active affiliates that have a Superbet link', async () => {
    const { service, prisma } = makeService();

    vi.stubEnv('SUPERBET_INACTIVITY_ENABLED', 'true');
    await service.handleDailyCheck();
    vi.unstubAllEnvs();

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: UserStatus.APPROVED,
          active: true,
          affiliateLinks: {
            some: { bettingHouse: 'superbet', deletedAt: null },
          },
        },
        take: 50,
      }),
    );
  });
});
