// Domain port — persistence interface for the sync module.
// Implemented in infrastructure layer by SyncPrismaRepository.

export const SYNC_REPOSITORY = Symbol('ISyncRepository');

export interface UpsertAffiliateDataInput {
  campaignId: string; // unique identifier per house
  affiliateId: string;
  bettingHouse: string;
  campaignName: string;
  utmCampaign: string;
  date: Date;
  clicks: number;
  registrations: number;
  ftds: number;
  qftd: number;
  deposit: number;
  netPl: number | null;
  withdrawalTotal: number | null;
  volume: number | null;
  revShare: number;
  cpaQualified: number;
  cpaValue: number;
  totalCommission: number;
}

export interface CreateSyncLogInput {
  bettingHouse: string;
  triggeredBy: string;
  periodStart: Date;
  periodEnd: Date;
}

export interface SyncLogStats {
  totalRecords: number;
  inserted: number;
  updated: number;
  errors: number;
}

export interface ISyncRepository {
  /**
   * Upsert a batch of affiliate reports using the composite unique key.
   * `syncLogId` is recorded on any change-log row emitted by this batch,
   * making it trivial to ask "what did sync X change?".
   */
  upsertBatch(
    rows: UpsertAffiliateDataInput[],
    syncLogId?: string | null,
  ): Promise<{ inserted: number; updated: number }>;

  /** Create a RUNNING sync log entry, returns its id */
  createSyncLog(data: CreateSyncLogInput): Promise<string>;

  /** Mark a sync log as SUCCESS with final stats */
  completeSyncLog(
    id: string,
    endTime: Date,
    stats: SyncLogStats,
  ): Promise<void>;

  /** Mark a sync log as ERROR */
  failSyncLog(id: string, endTime: Date, errorMessage: string): Promise<void>;

  /**
   * Return ISO date strings that have NO affiliate_data rows for the given house,
   * in the range [since, yesterday].
   */
  findMissingDays(bettingHouse: string, since: Date): Promise<string[]>;

  /**
   * Earliest day whose Pinbet-only operational metrics still need the initial
   * backfill. null means the one-time backfill is already complete.
   */
  findOperationalMetricsBackfillStart(
    bettingHouse: string,
    since?: string,
  ): Promise<string | null>;

  /** Set BettingHouse.lastSyncAt = now */
  updateHouseLastSync(slug: string): Promise<void>;

  /**
   * Cutover de sync POR CASA (setting `ledger_cutover_date_<slug>`, 'YYYY-MM-DD').
   * O sync NÃO puxa datas anteriores a este dia para a casa. null = sem cutover.
   */
  getHouseCutoverDate(slug: string): Promise<string | null>;

  /**
   * Set providerAccountId on AffiliateLink rows whose (bettingHouse, campaignId)
   * matches the synced batch. Idempotent — only touches rows where the value
   * differs from the target accountId.
   */
  enrichAffiliateLinks(
    providerAccountId: string,
    bettingHouse: string,
    campaignIds: string[],
  ): Promise<number>;

  /**
   * Map campaignId → contracted affiliate rates for a house (active links only).
   * Used so synced cpaValue/totalCommission reflect the AFFILIATE'S real rate
   * instead of the provider's gross number.
   */
  getLinkRates(
    bettingHouse: string,
  ): Promise<Map<string, { cpa: number; revshare: number }>>;

  /**
   * Campaign ids encoded in fulfilled requests of the house's active deals.
   * null means the house has no active deal and should not be filtered.
   * An empty Set means an active deal exists but no campaign is fulfilled yet.
   */
  getActiveDealCampaignIds(bettingHouse: string): Promise<Set<string> | null>;

  /**
   * Anti-duplication guard: delete affiliate_data rows for the given campaigns
   * whose utmCampaign differs from `keepUtm`. Prevents double-counting when the
   * provider account is renamed (utmCampaign forks the unique key).
   */
  purgeStaleUtm(
    bettingHouse: string,
    keepUtm: string,
    campaignIds: string[],
  ): Promise<number>;

  /**
   * Returns per-house health: last sync time, lag hours, recent-day coverage,
   * missing recent days, and an `ok` flag (lag < 4h + no missing recent days).
   */
  getSyncHealth(): Promise<{
    byHouse: Array<{
      house: string;
      active: boolean;
      lastSyncAt: Date | null;
      lagHours: number | null;
      recentDays: Array<{ date: string; rows: number }>;
      missingRecentDays: string[];
      ok: boolean;
    }>;
  }>;
}
