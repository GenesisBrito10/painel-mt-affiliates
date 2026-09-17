import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncSchedulerService } from './sync-scheduler.service.js';

function makeAccount(associationActive: boolean, provider = 'otg') {
  return {
    id: 'account-id',
    name: 'Sportingbet OTG',
    provider,
    active: true,
    houses: [
      {
        id: 'association-id',
        active: associationActive,
        bettingHouseSlug: 'sportingbet',
        bookmarkerId: 'otg-house-id',
        bettingHouse: {
          slug: 'sportingbet',
          active: true,
          syncMode: 'AUTO',
        },
      },
    ],
  };
}

describe('SyncSchedulerService provider-house eligibility', () => {
  const runSync = vi.fn().mockResolvedValue(undefined);
  const getRecentDates = vi.fn((days = 2) =>
    days === 7
      ? [
          '2026-07-21',
          '2026-07-22',
          '2026-07-23',
          '2026-07-24',
          '2026-07-25',
          '2026-07-26',
          '2026-07-27',
        ]
      : ['2026-07-26', '2026-07-27'],
  );
  const findAll = vi.fn();
  const findByHouseSlug = vi.fn();

  const makeService = () =>
    new SyncSchedulerService(
      { runSync, getRecentDates } as never,
      {} as never,
      { findAll, findByHouseSlug } as never,
    );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips inactive associations in the regular scheduler', async () => {
    findAll.mockResolvedValue([makeAccount(false)]);

    await makeService().runAllHouses('cron');

    expect(runSync).not.toHaveBeenCalled();
  });

  it('skips inactive associations in the recent scheduler', async () => {
    findAll.mockResolvedValue([makeAccount(false)]);

    await makeService().runRecentForAllHouses('cron-recent');

    expect(runSync).not.toHaveBeenCalled();
  });

  it('skips inactive associations in a manual house run', async () => {
    findByHouseSlug.mockResolvedValue([makeAccount(false)]);

    await makeService().runHouse('sportingbet', 'admin');

    expect(runSync).not.toHaveBeenCalled();
  });

  it('runs an active association with its configured bookmaker id', async () => {
    findAll.mockResolvedValue([makeAccount(true)]);

    await makeService().runAllHouses('cron');

    expect(runSync).toHaveBeenCalledWith(
      expect.objectContaining({
        houseSlug: 'sportingbet',
        bookmarkerId: 'otg-house-id',
        triggeredBy: 'cron',
      }),
    );
  });

  it('uses a seven-day recent window only for Smartico accounts', async () => {
    findAll.mockResolvedValue([makeAccount(true, 'smartico')]);

    await makeService().runRecentForAllHouses('cron-recent');

    expect(getRecentDates).toHaveBeenCalledWith(7);
    expect(runSync).toHaveBeenCalledWith(
      expect.objectContaining({
        houseSlug: 'sportingbet',
        dates: [
          '2026-07-21',
          '2026-07-22',
          '2026-07-23',
          '2026-07-24',
          '2026-07-25',
          '2026-07-26',
          '2026-07-27',
        ],
      }),
    );
  });
});
