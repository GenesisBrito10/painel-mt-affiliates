import { Injectable, Inject, Logger } from '@nestjs/common';
import {
  SYNC_REPOSITORY,
  type ISyncRepository,
  type UpsertAffiliateDataInput,
} from '../domain/ports/sync.repository.port.js';
import type { IProviderExtractor } from '../domain/ports/provider-extractor.port.js';
import { SyncAlreadyRunningException } from '../domain/exceptions/sync.exceptions.js';
import { ProviderAccountCredentialService } from '../../../modules/provider-account/index.js';
import type { AccountWithHouses } from '../../../modules/provider-account/domain/types/provider-account.types.js';
import type { TriggerSyncDto, SyncResultDto } from './dto/sync.dto.js';
import { LinkWebhookService } from '../../link-webhook/index.js';
import { HOUSE_DATA_SOURCE } from '../../dashboard/domain/house-alias.js';

// Backoff delays for retry logic
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const;
const SMARTICO_RATE_LIMIT_DELAYS_MS = [60_000, 120_000, 300_000] as const;
const DELAY_BETWEEN_DAYS_MS = 200;
const SMARTICO_DELAY_BETWEEN_DAYS_MS = 3_000;
const DELAY_BETWEEN_HOUSES_MS = 1_000;
const BATCH_SIZE = 100;
const SYNC_START_DATE = '2026-05-01';
const TOKEN_TTL_MS = 25 * 60 * 1000; // 25 min — conservative under typical JWT lifetime

export function currentSaoPauloDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function syncDelayBetweenDaysMs(providerSlug: string): number {
  return providerSlug === 'smartico'
    ? SMARTICO_DELAY_BETWEEN_DAYS_MS
    : DELAY_BETWEEN_DAYS_MS;
}

export function syncRetryDelayMs(error: unknown, attempt: number): number {
  const message = error instanceof Error ? error.message : String(error);
  const delays = message.includes('HTTP 291')
    ? SMARTICO_RATE_LIMIT_DELAYS_MS
    : RETRY_DELAYS_MS;
  return delays[Math.min(attempt, delays.length - 1)];
}

@Injectable()
export class SyncOrchestratorService {
  private readonly logger = new Logger(SyncOrchestratorService.name);

  // In-memory lock: one sync per betting house at a time
  private readonly runningHouses = new Set<string>();

  // Token cache shared across houses for the same ProviderAccount.
  // Avoids one login per house per cron tick.
  private readonly tokenCache = new Map<
    string,
    { token: string; expiresAt: number }
  >();

  constructor(
    @Inject(SYNC_REPOSITORY) private readonly repo: ISyncRepository,
    private readonly credentials: ProviderAccountCredentialService,
    @Inject('EXTRACTOR_MAP')
    private readonly extractors: Map<string, IProviderExtractor>,
    private readonly linkWebhook: LinkWebhookService,
  ) {}

  /** Returns all date strings from startDate up to yesterday */
  private getDateRange(from: string): string[] {
    const dates: string[] = [];
    const start = new Date(from);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const current = new Date(start);
    while (current <= yesterday) {
      dates.push(current.toISOString().split('T')[0]);
      current.setDate(current.getDate() + 1);
    }
    return dates;
  }

  /** Current month dates from day 1 to today */
  private getCurrentMonthDates(): string[] {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    return this.getDateRange(first.toISOString().split('T')[0]);
  }

  /** Returns a rolling São Paulo date window ending today. */
  getRecentDates(days = 2, now = new Date()): string[] {
    const safeDays = Math.max(1, Math.trunc(days));
    const end = new Date(`${currentSaoPauloDate(now)}T12:00:00.000Z`);
    return Array.from({ length: safeDays }, (_, index) => {
      const date = new Date(end);
      date.setUTCDate(end.getUTCDate() - (safeDays - index - 1));
      return date.toISOString().slice(0, 10);
    });
  }

  private async getCachedToken(
    account: AccountWithHouses,
    extractor: IProviderExtractor,
  ): Promise<string> {
    const now = Date.now();
    const entry = this.tokenCache.get(account.id);
    if (entry && entry.expiresAt > now) {
      return entry.token;
    }
    const creds = await this.credentials.getDecryptedCredentials(account.id);
    const token = await this.withRetry(`${account.name}:login`, () =>
      extractor.login(creds),
    );
    const tokenTtlMs = extractor.tokenTtlMs ?? TOKEN_TTL_MS;
    this.tokenCache.set(account.id, { token, expiresAt: now + tokenTtlMs });
    return token;
  }

  /** Invalidate a cached token (e.g. on 401) */
  private invalidateToken(accountId: string): void {
    this.tokenCache.delete(accountId);
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** Retry wrapper with exponential backoff */
  private async withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < RETRY_DELAYS_MS.length + 1; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        if (attempt < RETRY_DELAYS_MS.length) {
          const delay = syncRetryDelayMs(err, attempt);
          this.logger.warn(
            `[${label}] attempt ${attempt + 1} failed, retrying in ${delay}ms`,
          );
          await this.sleep(delay);
        }
      }
    }
    throw lastError;
  }

  private linkedHousesForDataSource(sourceHouseSlug: string): string[] {
    return Object.entries(HOUSE_DATA_SOURCE)
      .filter(([, source]) => source === sourceHouseSlug)
      .map(([houseSlug]) => houseSlug);
  }

  private async emitAffiliateDataSyncedEvents(params: {
    houseSlug: string;
    dates: string[];
    rowsUpserted: number;
    totals: Record<string, number>;
    triggeredBy: string;
  }): Promise<void> {
    const houseSlugs = [
      params.houseSlug,
      ...this.linkedHousesForDataSource(params.houseSlug),
    ];

    for (const houseSlug of houseSlugs) {
      try {
        await this.linkWebhook.emitAffiliateDataSynced({
          houseSlug,
          ...(houseSlug !== params.houseSlug
            ? { sourceHouseSlug: params.houseSlug }
            : {}),
          dates: params.dates,
          rowsUpserted: params.rowsUpserted,
          totals: params.totals,
          triggeredBy: params.triggeredBy,
        });
      } catch (err: unknown) {
        this.logger.warn(
          `[${houseSlug}] affiliate_data.synced webhook emit failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /** Sync a single house for the given set of dates */
  private async syncHouseForDates(
    account: AccountWithHouses,
    houseSlug: string,
    bookmarkerId: string,
    dates: string[],
    triggeredBy: string,
  ): Promise<{
    inserted: number;
    updated: number;
    errors: number;
    total: number;
  }> {
    const extractor = this.extractors.get(account.provider);
    if (!extractor) {
      this.logger.error(
        `No extractor registered for provider "${account.provider}"`,
      );
      return { inserted: 0, updated: 0, errors: dates.length, total: 0 };
    }

    const accessToken = await this.getCachedToken(account, extractor);
    this.logger.log(
      `[${account.name}][${houseSlug}] Token ready, syncing ${dates.length} day(s)`,
    );

    const syncLogId = await this.repo.createSyncLog({
      bettingHouse: houseSlug,
      triggeredBy,
      periodStart: new Date(`${dates[0]}T00:00:00.000Z`),
      periodEnd: new Date(`${dates[dates.length - 1]}T23:59:59.999Z`),
    });

    let totalInserted = 0;
    let totalUpdated = 0;
    let totalErrors = 0;
    let totalRecords = 0;

    // Contracted affiliate rates (campaignId → cpa/revshare). Lets us store the
    // AFFILIATE'S real commission instead of the provider's gross number.
    const linkRates = await this.repo.getLinkRates(houseSlug);
    const activeDealCampaignIds =
      houseSlug === 'superbet'
        ? await this.repo.getActiveDealCampaignIds(houseSlug)
        : null;
    const delayBetweenDaysMs = syncDelayBetweenDaysMs(extractor.providerSlug);

    const canFetchAsRange =
      extractor.providerSlug === 'smartico' &&
      dates.length > 1 &&
      extractor.fetchReportsRange !== undefined;
    const fetchRequests = canFetchAsRange
      ? [
          {
            label: `${dates[0]}..${dates[dates.length - 1]}`,
            fetch: () => {
              const dateToExclusive = new Date(
                `${dates[dates.length - 1]}T00:00:00.000Z`,
              );
              dateToExclusive.setUTCDate(dateToExclusive.getUTCDate() + 1);
              return extractor.fetchReportsRange!(
                accessToken,
                dates[0],
                dateToExclusive.toISOString().slice(0, 10),
                bookmarkerId,
              );
            },
          },
        ]
      : dates.map((date) => ({
          label: date,
          fetch: () => extractor.fetchReports(accessToken, date, bookmarkerId),
        }));

    for (
      let requestIndex = 0;
      requestIndex < fetchRequests.length;
      requestIndex++
    ) {
      const request = fetchRequests[requestIndex];
      try {
        const fetchedReports = await this.withRetry(
          `${houseSlug}:fetch:${request.label}`,
          request.fetch,
        );
        const reports = activeDealCampaignIds
          ? fetchedReports.filter((report) =>
              activeDealCampaignIds.has(report.campaignId),
            )
          : fetchedReports;

        const ignoredReports = fetchedReports.length - reports.length;
        if (ignoredReports > 0) {
          this.logger.warn(
            `[${houseSlug}] ignored ${ignoredReports} campaign row(s) outside active deals`,
          );
        }

        if (reports.length === 0) {
          if (requestIndex < fetchRequests.length - 1) {
            await this.sleep(delayBetweenDaysMs);
          }
          continue;
        }

        totalRecords += reports.length;

        // Map ExtractedReport → UpsertAffiliateDataInput.
        // cpaValue/totalCommission use the AFFILIATE'S contracted rate when the
        // campaign maps to a known link (so dashboards never show the provider's
        // gross CPA). Campaigns without a link keep the provider's raw values.
        const rows: UpsertAffiliateDataInput[] = reports.map((r) => {
          const rate = linkRates.get(r.campaignId);
          const cpaValue = rate ? r.cpaQualified * rate.cpa : r.cpaValue;
          const totalCommission = rate
            ? cpaValue + r.revShare * (rate.revshare / 100)
            : r.totalCommission;
          return {
            campaignId: r.campaignId,
            affiliateId: r.affiliateId,
            bettingHouse: houseSlug,
            campaignName: r.campaignId, // Betboard uses campaignName = campaignId
            utmCampaign: account.name, // Account name as UTM campaign (matches old Mongo pattern)
            date: r.date,
            clicks: r.clicks,
            registrations: r.registrations,
            ftds: r.ftds,
            qftd: r.qftd,
            deposit: r.deposit,
            netPl: r.netPl,
            withdrawalTotal: r.withdrawalTotal,
            volume: r.volume,
            revShare: r.revShare,
            cpaQualified: r.cpaQualified,
            cpaValue,
            totalCommission,
          };
        });

        // Process in batches of BATCH_SIZE
        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
          const batch = rows.slice(i, i + BATCH_SIZE);
          const result = await this.repo.upsertBatch(batch, syncLogId);
          totalInserted += result.inserted;
          totalUpdated += result.updated;

          // Tag matching AffiliateLink rows with the originating provider
          // account (painel). Idempotent updateMany — failures are logged
          // but never block the sync.
          const campaignIds = Array.from(
            new Set(batch.map((r) => r.campaignId)),
          );
          try {
            await this.repo.enrichAffiliateLinks(
              account.id,
              houseSlug,
              campaignIds,
            );
          } catch (err: unknown) {
            this.logger.warn(
              `[${houseSlug}] enrichAffiliateLinks failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }

          // Anti-duplication: drop rows left behind under a previous account
          // name (utmCampaign) so renames don't double the dashboard totals.
          try {
            const purged = await this.repo.purgeStaleUtm(
              houseSlug,
              account.name,
              campaignIds,
            );
            if (purged > 0)
              this.logger.warn(
                `[${houseSlug}] purged ${purged} stale-utm row(s) (account rename guard)`,
              );
          } catch (err: unknown) {
            this.logger.warn(
              `[${houseSlug}] purgeStaleUtm failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      } catch (err: unknown) {
        totalErrors++;
        this.logger.error(
          `[${houseSlug}] Error on ${request.label}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      if (requestIndex < fetchRequests.length - 1) {
        await this.sleep(delayBetweenDaysMs);
      }
    }

    await this.repo.completeSyncLog(syncLogId, new Date(), {
      totalRecords,
      inserted: totalInserted,
      updated: totalUpdated,
      errors: totalErrors,
    });
    await this.repo.updateHouseLastSync(houseSlug);
    await this.credentials.markUsed(account.id);

    this.logger.log(
      `[${houseSlug}] Done — ${totalRecords} records | +${totalInserted} inserted | ~${totalUpdated} updated | ${totalErrors} errors`,
    );

    // Notify third-party webhook subscribers that this house's data is fresh.
    // Only fire when the cycle actually wrote something — avoids noise on
    // empty/no-op runs. Never blocks or fails the sync.
    if (totalInserted + totalUpdated > 0) {
      await this.emitAffiliateDataSyncedEvents({
        houseSlug,
        dates,
        rowsUpserted: totalInserted + totalUpdated,
        totals: {
          inserted: totalInserted,
          updated: totalUpdated,
          records: totalRecords,
        },
        triggeredBy,
      });
    }

    return {
      inserted: totalInserted,
      updated: totalUpdated,
      errors: totalErrors,
      total: totalRecords,
    };
  }

  /** Main entry point — called by scheduler or admin endpoint */
  async runSync(dto: TriggerSyncDto): Promise<SyncResultDto> {
    const { account, houseSlug, bookmarkerId, triggeredBy } = dto;

    if (this.runningHouses.has(houseSlug)) {
      throw new SyncAlreadyRunningException(houseSlug);
    }

    this.runningHouses.add(houseSlug);
    this.logger.log(
      `[${houseSlug}] Sync started (triggeredBy: ${triggeredBy})`,
    );

    try {
      // Cutover de sync POR CASA: o sync NÃO puxa datas anteriores a esta data
      // (config no admin → setting `ledger_cutover_date_<slug>`). Aplica-se tanto
      // ao gap-fill quanto ao sync regular (dados antigos nunca são buscados).
      const cutover = await this.repo.getHouseCutoverDate(houseSlug);
      const afterCutover = (dates: string[]): string[] =>
        cutover ? dates.filter((d) => d >= cutover) : dates;
      if (cutover) {
        this.logger.log(`[${houseSlug}] Sync cutover ativo: >= ${cutover}`);
      }

      const extractor = this.extractors.get(account.provider);
      const isCurrentDayOnly = extractor?.dateScope === 'current-day-only';
      const canUseExplicitDates =
        extractor?.supportsExplicitDates === true && dto.dates !== undefined;
      // Providers with completed/unavailable historical backfills query only
      // the current São Paulo day, regardless of which scheduler invoked them.
      const requestedDates =
        isCurrentDayOnly && !canUseExplicitDates
          ? [currentSaoPauloDate()]
          : (dto.dates ?? this.getCurrentMonthDates());
      const targetDates = afterCutover(requestedDates).sort();

      // Step 1: Fill gaps — SKIPPED when explicit dates provided (high-freq cron
      // shouldn't waste a findMissingDays roundtrip every 20 minutes).
      // Current-day-only providers also skip it permanently.
      let missingDays: string[] = [];
      if (!dto.dates && !isCurrentDayOnly) {
        missingDays = afterCutover(
          await this.repo.findMissingDays(houseSlug, new Date(SYNC_START_DATE)),
        );

        if (missingDays.length > 0) {
          this.logger.log(
            `[${houseSlug}] Gap-fill: ${missingDays.length} missing day(s)`,
          );
          await this.syncHouseForDates(
            account,
            houseSlug,
            bookmarkerId,
            missingDays,
            `${triggeredBy}-gap-fill`,
          );
          await this.sleep(DELAY_BETWEEN_HOUSES_MS);
        }
      }

      // Step 2: Regular sync — explicit dates, or current month (pós-cutover).
      const result =
        targetDates.length > 0
          ? await this.syncHouseForDates(
              account,
              houseSlug,
              bookmarkerId,
              targetDates,
              triggeredBy,
            )
          : { inserted: 0, updated: 0, errors: 0, total: 0 };

      return {
        success: true,
        houseSlug,
        triggeredBy,
        gapsFilled: missingDays.length,
        stats: result,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`[${houseSlug}] Sync failed: ${message}`);
      throw err;
    } finally {
      this.runningHouses.delete(houseSlug);
    }
  }

  /** Returns which houses are currently syncing */
  getRunningHouses(): string[] {
    return [...this.runningHouses];
  }

  /**
   * Per-house sync health snapshot. Flags houses with stale data so the admin
   * UI can highlight them.
   */
  async getSyncHealth(): Promise<{
    byHouse: Array<{
      house: string;
      active: boolean;
      lastSyncAt: Date | null;
      lagHours: number | null;
      recentDays: Array<{ date: string; rows: number }>;
      missingRecentDays: string[];
      ok: boolean;
    }>;
  }> {
    return this.repo.getSyncHealth();
  }
}
