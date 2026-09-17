import { describe, it, expect, vi } from 'vitest';
import {
  SyncOrchestratorService,
  syncDelayBetweenDaysMs,
  syncRetryDelayMs,
} from './sync-orchestrator.service.js';
import type { ISyncRepository } from '../domain/ports/sync.repository.port.js';
import type { IProviderExtractor } from '../domain/ports/provider-extractor.port.js';
import { SyncAlreadyRunningException } from '../domain/exceptions/sync.exceptions.js';
import type { ProviderAccountCredentialService } from '../../provider-account/application/provider-account-credential.service.js';
import type { AccountWithHouses } from '../../provider-account/domain/types/provider-account.types.js';

describe('Smartico sync rate limiting', () => {
  it('builds a seven-day window ending on the São Paulo calendar day', () => {
    const service = makeService(
      makeRepo(),
      makeCredentialService(),
      makeExtractor(),
    );

    expect(
      service.getRecentDates(7, new Date('2026-08-05T02:30:00.000Z')),
    ).toEqual([
      '2026-07-29',
      '2026-07-30',
      '2026-07-31',
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
      '2026-08-04',
    ]);
  });

  it('paces Smartico day requests more slowly than other providers', () => {
    expect(syncDelayBetweenDaysMs('smartico')).toBe(3_000);
    expect(syncDelayBetweenDaysMs('betboard')).toBe(200);
  });

  it('uses a long cooldown after Smartico HTTP 291 throttling', () => {
    const error = new Error(
      'Fetch failed for provider "smartico": HTTP 291: Too many requests',
    );

    expect(syncRetryDelayMs(error, 0)).toBe(60_000);
    expect(syncRetryDelayMs(error, 1)).toBe(120_000);
    expect(syncRetryDelayMs(new Error('HTTP 500'), 0)).toBe(1_000);
  });
});

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeRepo(overrides: Partial<ISyncRepository> = {}): ISyncRepository {
  return {
    upsertBatch: vi.fn().mockResolvedValue({ inserted: 1, updated: 0 }),
    createSyncLog: vi.fn().mockResolvedValue('log-id-123'),
    completeSyncLog: vi.fn().mockResolvedValue(undefined),
    failSyncLog: vi.fn().mockResolvedValue(undefined),
    findMissingDays: vi.fn().mockResolvedValue([]),
    findOperationalMetricsBackfillStart: vi.fn().mockResolvedValue(null),
    updateHouseLastSync: vi.fn().mockResolvedValue(undefined),
    getHouseCutoverDate: vi.fn().mockResolvedValue(null),
    enrichAffiliateLinks: vi.fn().mockResolvedValue(0),
    getLinkRates: vi.fn().mockResolvedValue(new Map()),
    getActiveDealCampaignIds: vi.fn().mockResolvedValue(null),
    purgeStaleUtm: vi.fn().mockResolvedValue(0),
    getSyncHealth: vi.fn().mockResolvedValue({ byHouse: [] }),
    ...overrides,
  };
}

function makeExtractor(
  overrides: Partial<IProviderExtractor> = {},
): IProviderExtractor {
  return {
    providerSlug: 'betboard',
    login: vi.fn().mockResolvedValue('mock-token'),
    fetchReports: vi.fn().mockResolvedValue([
      {
        campaignId: 'TEST-CAMPAIGN',
        affiliateId: 'aff-001',
        date: new Date('2026-03-15T00:00:00.000Z'),
        clicks: 10,
        registrations: 3,
        ftds: 1,
        qftd: 1,
        deposit: 200,
        revShare: 20,
        cpaQualified: 1,
        cpaValue: 100,
        totalCommission: 120,
      },
    ]),
    ...overrides,
  };
}

function makeCredentialService(): ProviderAccountCredentialService {
  return {
    getDecryptedCredentials: vi.fn().mockResolvedValue({
      email: 'admin@vexxa.com',
      password: 'secret',
      apiBaseUrl: 'https://api.betboard.com.br/api',
    }),
    markUsed: vi.fn().mockResolvedValue(undefined),
  } as unknown as ProviderAccountCredentialService;
}

function makeAccount(provider = 'betboard'): AccountWithHouses {
  return {
    id: 'account-id',
    name: 'VEXXA',
    provider,
    email: 'admin@vexxa.com',
    encryptedPassword: 'enc',
    apiBaseUrl: 'https://api.betboard.com.br/api',
    active: true,
    lastUsedAt: null,
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    houses: [],
  } as unknown as AccountWithHouses;
}

function makeService(
  repo: ISyncRepository,
  creds: ProviderAccountCredentialService,
  extractor: IProviderExtractor,
  linkWebhook: { emitAffiliateDataSynced: ReturnType<typeof vi.fn> } = {
    emitAffiliateDataSynced: vi.fn(),
  },
): SyncOrchestratorService {
  const map = new Map<string, IProviderExtractor>();
  map.set(extractor.providerSlug, extractor);
  return new SyncOrchestratorService(repo, creds, map, linkWebhook as any);
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('SyncOrchestratorService', () => {
  describe('runSync()', () => {
    it('syncs only the current São Paulo day for Smartico after the historical backfill', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-26T01:30:00.000Z'));

      const findOperationalMetricsBackfillStart = vi
        .fn()
        .mockResolvedValue('2026-07-21');
      const findMissingDays = vi
        .fn()
        .mockResolvedValue(['2026-07-21', '2026-07-22']);
      const repo = makeRepo({
        findOperationalMetricsBackfillStart,
        findMissingDays,
      });

      const fetchReports = vi.fn().mockResolvedValue([]);
      const fetchReportsRange = vi.fn().mockResolvedValue([]);
      const extractor = makeExtractor({
        providerSlug: 'smartico',
        dateScope: 'current-day-only',
        fetchReports,
      }) as IProviderExtractor & {
        fetchReportsRange: ReturnType<typeof vi.fn>;
      };
      extractor.fetchReportsRange = fetchReportsRange;

      try {
        const svc = makeService(repo, makeCredentialService(), extractor);
        await svc.runSync({
          account: makeAccount('smartico'),
          houseSlug: 'pinbet-diario',
          bookmarkerId: 'afp1',
          triggeredBy: 'cron',
        });

        expect(fetchReports).toHaveBeenCalledTimes(1);
        expect(fetchReports).toHaveBeenCalledWith(
          'mock-token',
          '2026-07-25',
          'afp1',
        );
        expect(fetchReportsRange).not.toHaveBeenCalled();
        expect(findMissingDays).not.toHaveBeenCalled();
        expect(findOperationalMetricsBackfillStart).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('honors a Smartico explicit range in one provider request', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-25T15:00:00.000Z'));

      const repo = makeRepo({
        findOperationalMetricsBackfillStart: vi.fn().mockResolvedValue(null),
      });
      const fetchReports = vi.fn().mockResolvedValue([]);
      const fetchReportsRange = vi.fn().mockResolvedValue([]);
      const extractor = makeExtractor({
        providerSlug: 'smartico',
        dateScope: 'current-day-only',
        supportsExplicitDates: true,
        fetchReports,
        fetchReportsRange,
      });

      try {
        const svc = makeService(repo, makeCredentialService(), extractor);
        await svc.runSync({
          account: makeAccount('smartico'),
          houseSlug: 'pinbet-mensal',
          bookmarkerId: 'afp2',
          triggeredBy: 'cron',
          dates: ['2026-07-21', '2026-07-22'],
        });

        expect(fetchReports).not.toHaveBeenCalled();
        expect(fetchReportsRange).toHaveBeenCalledTimes(1);
        expect(fetchReportsRange).toHaveBeenCalledWith(
          'mock-token',
          '2026-07-21',
          '2026-07-23',
          'afp2',
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('uses extractor capability to keep OTG on the current São Paulo day', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-27T01:30:00.000Z'));

      const findMissingDays = vi
        .fn()
        .mockResolvedValue(['2026-07-20', '2026-07-21']);
      const repo = makeRepo({ findMissingDays });
      const fetchReports = vi.fn().mockResolvedValue([]);
      const extractor = makeExtractor({
        providerSlug: 'otg',
        dateScope: 'current-day-only',
        fetchReports,
      });

      try {
        const svc = makeService(repo, makeCredentialService(), extractor);
        await svc.runSync({
          account: makeAccount('otg'),
          houseSlug: 'sportingbet',
          bookmarkerId: 'otg-house-id',
          triggeredBy: 'cron',
          dates: ['2026-07-20'],
        });

        expect(fetchReports).toHaveBeenCalledTimes(1);
        expect(fetchReports).toHaveBeenCalledWith(
          'mock-token',
          '2026-07-26',
          'otg-house-id',
        );
        expect(findMissingDays).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('honors explicit OTG dates for a controlled historical backfill', async () => {
      const repo = makeRepo();
      const fetchReports = vi.fn().mockResolvedValue([]);
      const extractor = makeExtractor({
        providerSlug: 'otg',
        dateScope: 'current-day-only',
        supportsExplicitDates: true,
        fetchReports,
      });
      const svc = makeService(repo, makeCredentialService(), extractor);

      await svc.runSync({
        account: makeAccount('otg'),
        houseSlug: 'sportingbet',
        bookmarkerId: 'otg-house-id',
        triggeredBy: 'manual-backfill',
        dates: ['2026-07-22', '2026-07-23'],
      });

      expect(fetchReports).toHaveBeenNthCalledWith(
        1,
        'mock-token',
        '2026-07-22',
        'otg-house-id',
      );
      expect(fetchReports).toHaveBeenNthCalledWith(
        2,
        'mock-token',
        '2026-07-23',
        'otg-house-id',
      );
    });

    it('refreshes a cached token after the extractor-specific TTL', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-27T12:00:00.000Z'));

      const repo = makeRepo();
      const creds = makeCredentialService();
      const login = vi.fn().mockResolvedValue('mock-token');
      const extractor = makeExtractor({
        providerSlug: 'otg',
        dateScope: 'current-day-only',
        tokenTtlMs: 10 * 60 * 1000,
        login,
        fetchReports: vi.fn().mockResolvedValue([]),
      });
      const svc = makeService(repo, creds, extractor);
      const dto = {
        account: makeAccount('otg'),
        houseSlug: 'sportingbet',
        bookmarkerId: 'otg-house-id',
        triggeredBy: 'cron',
        dates: ['2026-07-20'],
      };

      try {
        await svc.runSync(dto);
        vi.advanceTimersByTime(9 * 60 * 1000);
        await svc.runSync(dto);
        expect(login).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(2 * 60 * 1000);
        await svc.runSync(dto);
        expect(login).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('creates sync log, upserts data, and completes the log', async () => {
      const repo = makeRepo();
      const creds = makeCredentialService();
      const extractor = makeExtractor();
      const linkWebhook = { emitAffiliateDataSynced: vi.fn() };
      const svc = makeService(repo, creds, extractor, linkWebhook);

      const result = await svc.runSync({
        account: makeAccount(),
        houseSlug: 'esportivabet',
        bookmarkerId: 'bm-001',
        triggeredBy: 'test',
        dates: ['2026-03-15'],
      });

      expect(result.success).toBe(true);
      expect(result.houseSlug).toBe('esportivabet');
      expect(repo.createSyncLog).toHaveBeenCalledWith(
        expect.objectContaining({
          bettingHouse: 'esportivabet',
          triggeredBy: 'test',
        }),
      );
      expect(extractor.login).toHaveBeenCalledTimes(1);
      expect(extractor.fetchReports).toHaveBeenCalledWith(
        'mock-token',
        '2026-03-15',
        'bm-001',
      );
      expect(repo.upsertBatch).toHaveBeenCalledTimes(1);
      expect(repo.completeSyncLog).toHaveBeenCalledWith(
        'log-id-123',
        expect.any(Date),
        expect.objectContaining({ totalRecords: 1, inserted: 1 }),
      );
      expect(repo.updateHouseLastSync).toHaveBeenCalledWith('esportivabet');
      expect(linkWebhook.emitAffiliateDataSynced).toHaveBeenCalledWith(
        expect.objectContaining({
          houseSlug: 'esportivabet',
          rowsUpserted: 1,
          triggeredBy: 'test',
        }),
      );
      expect(linkWebhook.emitAffiliateDataSynced).toHaveBeenCalledWith(
        expect.objectContaining({
          houseSlug: 'esportiva-diario',
          sourceHouseSlug: 'esportivabet',
          rowsUpserted: 1,
          triggeredBy: 'test',
        }),
      );
    });

    it('persists only campaigns from the active Superbet deal', async () => {
      const upsertBatch = vi
        .fn()
        .mockResolvedValue({ inserted: 1, updated: 0 });
      const repo = makeRepo({
        upsertBatch,
        getActiveDealCampaignIds: vi
          .fn()
          .mockResolvedValue(new Set(['5565-MJM01'])),
      });
      const extractor = makeExtractor({
        fetchReports: vi.fn().mockResolvedValue([
          {
            campaignId: '5565-MJM01',
            affiliateId: 'new-deal',
            date: new Date('2026-08-24T00:00:00.000Z'),
            clicks: 10,
            registrations: 3,
            ftds: 1,
            qftd: 1,
            deposit: 200,
            revShare: 0,
            cpaQualified: 1,
            cpaValue: 95,
            totalCommission: 95,
          },
          {
            campaignId: '5602-VALLEXBR1774',
            affiliateId: 'retired-deal',
            date: new Date('2026-08-24T00:00:00.000Z'),
            clicks: 20,
            registrations: 4,
            ftds: 2,
            qftd: 2,
            deposit: 400,
            revShare: 0,
            cpaQualified: 2,
            cpaValue: 200,
            totalCommission: 200,
          },
        ]),
      });
      const svc = makeService(repo, makeCredentialService(), extractor);

      const result = await svc.runSync({
        account: makeAccount(),
        houseSlug: 'superbet',
        bookmarkerId: 'superbet-bookmarker',
        triggeredBy: 'test',
        dates: ['2026-08-24'],
      });

      expect(upsertBatch).toHaveBeenCalledTimes(1);
      expect(upsertBatch).toHaveBeenCalledWith(
        [expect.objectContaining({ campaignId: '5565-MJM01' })],
        'log-id-123',
      );
      expect(result.stats.total).toBe(1);
    });

    it('fills gaps before regular sync', async () => {
      const repo = makeRepo({
        findMissingDays: vi
          .fn()
          .mockResolvedValue(['2026-03-10', '2026-03-11']),
      });
      const creds = makeCredentialService();
      const extractor = makeExtractor({
        fetchReports: vi.fn().mockResolvedValue([]),
      });
      const svc = makeService(repo, creds, extractor);
      Object.assign(svc, { sleep: vi.fn().mockResolvedValue(undefined) });

      // `dates` omitted on purpose — gap-fill only runs when caller doesn't
      // pin an explicit date range. High-frequency cron passes dates and
      // intentionally skips the gap-fill query.
      const result = await svc.runSync({
        account: makeAccount(),
        houseSlug: 'esportivabet',
        bookmarkerId: 'bm-001',
        triggeredBy: 'test',
      });

      expect(result.gapsFilled).toBe(2);
      // Token is cached after first login — gap-fill + regular sync share it.
      expect(extractor.login).toHaveBeenCalledTimes(1);
    });

    it('throws SyncAlreadyRunningException if house is locked', async () => {
      const repo = makeRepo({
        completeSyncLog: vi
          .fn()
          .mockImplementation(() => new Promise((r) => setTimeout(r, 5_000))),
      });
      const creds = makeCredentialService();
      const extractor = makeExtractor({
        fetchReports: vi.fn().mockResolvedValue([]),
      });
      const svc = makeService(repo, creds, extractor);

      // Start first sync without awaiting
      const first = svc.runSync({
        account: makeAccount(),
        houseSlug: 'esportivabet',
        bookmarkerId: 'bm-001',
        triggeredBy: 'cron',
        dates: [],
      });

      // Second sync should throw immediately
      await expect(
        svc.runSync({
          account: makeAccount(),
          houseSlug: 'esportivabet',
          bookmarkerId: 'bm-001',
          triggeredBy: 'admin',
          dates: [],
        }),
      ).rejects.toThrow(SyncAlreadyRunningException);

      // Clean up
      first.catch(() => {});
    });

    it('skips fetch when no extractor registered for provider', async () => {
      const repo = makeRepo();
      const creds = makeCredentialService();
      const svc = makeService(
        repo,
        creds,
        makeExtractor({ providerSlug: 'betboard' }),
      );

      const result = await svc.runSync({
        account: makeAccount('unknown-provider'),
        houseSlug: 'someHouse',
        bookmarkerId: 'bm-999',
        triggeredBy: 'test',
        dates: ['2026-03-15'],
      });

      expect(result.success).toBe(true);
      expect(repo.upsertBatch).not.toHaveBeenCalled();
    });

    it('counts errors when fetch fails after all retries', async () => {
      const repo = makeRepo();
      const creds = makeCredentialService();
      const extractor = makeExtractor({
        fetchReports: vi.fn().mockRejectedValue(new Error('Network error')),
      });
      const svc = makeService(repo, creds, extractor);

      const result = await svc.runSync({
        account: makeAccount(),
        houseSlug: 'esportivabet',
        bookmarkerId: 'bm-001',
        triggeredBy: 'test',
        dates: ['2026-03-15'],
      });

      expect(result.success).toBe(true);
      expect(result.stats.errors).toBe(1);
      expect(repo.upsertBatch).not.toHaveBeenCalled();
    }, 20_000); // 20s: extractor retries with exponential backoff
  });

  describe('getRunningHouses()', () => {
    it('returns empty array when no syncs running', () => {
      const svc = makeService(
        makeRepo(),
        makeCredentialService(),
        makeExtractor(),
      );
      expect(svc.getRunningHouses()).toEqual([]);
    });
  });
});
