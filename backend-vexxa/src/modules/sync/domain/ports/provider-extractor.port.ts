// Domain port — pure interface, zero framework imports
// Implement this to add a new provider (Betboard, TAP, etc.)

export interface ExtractedReport {
  campaignId: string; // = affiliateName in old Mongo schema (unique affiliate ID at provider)
  affiliateId: string; // numeric/string ID assigned by provider
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

export interface ProviderCredentials {
  email: string;
  password: string;
  apiBaseUrl: string;
}

export interface IProviderExtractor {
  /** Identifies which ProviderAccount.provider value this extractor handles */
  readonly providerSlug: string;

  /** Limits providers that do not expose reliable historical reports. */
  readonly dateScope?: 'historical' | 'current-day-only';

  /** Allows a current-day provider to honor explicit dates for a backfill. */
  readonly supportsExplicitDates?: boolean;

  /** Overrides the default in-memory token cache lifetime. */
  readonly tokenTtlMs?: number;

  /** Authenticates with the provider and returns a bearer token */
  login(credentials: ProviderCredentials): Promise<string>;

  /** Fetches performance reports for a single date */
  fetchReports(
    accessToken: string,
    date: string,
    bookmarkerId: string,
  ): Promise<ExtractedReport[]>;

  /**
   * Optional provider capability for a one-shot initial backfill.
   * `dateToExclusive` follows the provider report convention.
   */
  fetchReportsRange?(
    accessToken: string,
    dateFrom: string,
    dateToExclusive: string,
    bookmarkerId: string,
  ): Promise<ExtractedReport[]>;
}
