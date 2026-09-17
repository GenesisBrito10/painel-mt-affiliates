import { describe, expect, it, vi } from 'vitest';
import { PinbetMensalSchedulerService } from './pinbet-mensal-scheduler.service.js';

describe('PinbetMensalSchedulerService', () => {
  it('does not consume pending requests while the monthly house is inactive', async () => {
    const prisma = {
      bettingHouse: {
        findUnique: vi.fn().mockResolvedValue({ active: false }),
      },
      setting: { findUnique: vi.fn() },
      linkRequest: { findMany: vi.fn() },
    };
    const redis = {
      set: vi.fn().mockResolvedValue('OK'),
      eval: vi.fn().mockResolvedValue(1),
    };
    const service = new PinbetMensalSchedulerService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      redis as never,
    );

    await service.backfillPending();

    expect(prisma.bettingHouse.findUnique).toHaveBeenCalledWith({
      where: { slug: 'pinbet-mensal' },
      select: { active: true },
    });
    expect(prisma.setting.findUnique).not.toHaveBeenCalled();
    expect(prisma.linkRequest.findMany).not.toHaveBeenCalled();
  });

  it('does not consume pending requests while assignments are explicitly paused', async () => {
    const prisma = {
      bettingHouse: {
        findUnique: vi.fn().mockResolvedValue({ active: true }),
      },
      setting: {
        findUnique: vi.fn().mockResolvedValue({ value: 'true' }),
      },
      linkRequest: { findMany: vi.fn() },
    };
    const service = new PinbetMensalSchedulerService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {
        set: vi.fn().mockResolvedValue('OK'),
        eval: vi.fn().mockResolvedValue(1),
      } as never,
    );

    await service.backfillPending();

    expect(prisma.setting.findUnique).toHaveBeenCalledWith({
      where: { key: 'pinbet_mensal_assignment_paused' },
      select: { value: true },
    });
    expect(prisma.linkRequest.findMany).not.toHaveBeenCalled();
  });
});
