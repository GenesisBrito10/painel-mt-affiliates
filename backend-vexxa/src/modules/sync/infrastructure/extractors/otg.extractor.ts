import { Injectable, Logger } from '@nestjs/common';
import type {
  ExtractedReport,
  IProviderExtractor,
  ProviderCredentials,
} from '../../domain/ports/provider-extractor.port.js';
import {
  ProviderFetchFailedException,
  ProviderLoginFailedException,
} from '../../domain/exceptions/sync.exceptions.js';

interface OtgAnalyticsRow {
  affiliate?: unknown;
  campaign?: unknown;
  clicks?: unknown;
  registrations?: unknown;
  ftd?: unknown;
  cpa_qual?: unknown;
  deposits?: unknown;
  bet_amount?: unknown;
  ngr?: unknown;
}

interface OtgAnalyticsPayload {
  data?: {
    rows?: unknown;
    meta?: {
      totalPages?: unknown;
    };
  };
}

const DEFAULT_API_BASE = 'https://affiliate-api-prd.partnersotg.com/api/v1';
const PAGE_SIZE = 10_000;

const finiteNumber = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

const normalizeApiBase = (value: string): string =>
  value.trim().replace(/\/+$/u, '');

const previousDate = (date: string): string => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
};

@Injectable()
export class OtgExtractor implements IProviderExtractor {
  readonly providerSlug = 'otg';
  readonly dateScope = 'current-day-only' as const;
  readonly supportsExplicitDates = true;
  readonly tokenTtlMs = 10 * 60 * 1000;

  private readonly logger = new Logger(OtgExtractor.name);
  private apiBaseUrl = DEFAULT_API_BASE;

  async login(credentials: ProviderCredentials): Promise<string> {
    this.apiBaseUrl = normalizeApiBase(credentials.apiBaseUrl);
    const res = await fetch(`${this.apiBaseUrl}/auth/login`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: credentials.email,
        password: credentials.password,
      }),
    });

    if (!res.ok) {
      throw new ProviderLoginFailedException('otg', `HTTP ${res.status}`);
    }

    let payload: unknown;
    try {
      payload = await res.json();
    } catch {
      throw new ProviderLoginFailedException('otg', 'invalid JSON response');
    }

    const token =
      typeof payload === 'object' &&
      payload !== null &&
      'data' in payload &&
      typeof payload.data === 'object' &&
      payload.data !== null &&
      'access_token' in payload.data &&
      typeof payload.data.access_token === 'string'
        ? payload.data.access_token.trim()
        : '';

    if (!token) {
      throw new ProviderLoginFailedException(
        'otg',
        'missing data.access_token',
      );
    }
    return token;
  }

  async fetchReports(
    accessToken: string,
    date: string,
    bookmarkerId: string,
  ): Promise<ExtractedReport[]> {
    void bookmarkerId;
    const queryDate = previousDate(date);
    const rows: OtgAnalyticsRow[] = [];
    let totalPages = 1;

    for (let page = 1; page <= totalPages; page++) {
      const url = new URL(`${this.apiBaseUrl}/agency/sportingbet-analytics`);
      url.search = new URLSearchParams({
        initialDate: queryDate,
        finalDate: queryDate,
        scope: 'CAMPAIGNS',
        sortBy: 'affiliate',
        sortDirection: 'asc',
        page: String(page),
        pageSize: String(PAGE_SIZE),
      }).toString();

      const res = await fetch(url.toString(), {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
      });
      if (!res.ok) {
        throw new ProviderFetchFailedException(
          'otg',
          date,
          `page ${page}: HTTP ${res.status}`,
        );
      }

      let payload: OtgAnalyticsPayload;
      try {
        payload = (await res.json()) as OtgAnalyticsPayload;
      } catch {
        throw new ProviderFetchFailedException(
          'otg',
          date,
          `page ${page}: invalid JSON response`,
        );
      }

      const pageRows = payload.data?.rows;
      const pageCount = payload.data?.meta?.totalPages;
      const isValidEmptyReport =
        page === 1 &&
        Array.isArray(pageRows) &&
        pageRows.length === 0 &&
        pageCount === 0;
      if (
        !Array.isArray(pageRows) ||
        typeof pageCount !== 'number' ||
        !Number.isInteger(pageCount) ||
        pageCount < 0 ||
        (pageCount === 0 && !isValidEmptyReport)
      ) {
        throw new ProviderFetchFailedException(
          'otg',
          date,
          `page ${page}: invalid payload shape`,
        );
      }

      totalPages = pageCount;
      rows.push(...(pageRows as OtgAnalyticsRow[]));
    }

    const reports = rows.flatMap((row): ExtractedReport[] => {
      const affiliate =
        typeof row.affiliate === 'string'
          ? row.affiliate.trim().replace(/\s+/gu, '')
          : '';
      const campaign =
        typeof row.campaign === 'string' ? row.campaign.trim() : '';
      if (!affiliate || !campaign) return [];

      const qualifiedCpa = finiteNumber(row.cpa_qual);
      const report: ExtractedReport = {
        campaignId: `${affiliate}::${campaign}`,
        affiliateId: affiliate,
        date: new Date(`${date}T00:00:00.000Z`),
        clicks: finiteNumber(row.clicks),
        registrations: finiteNumber(row.registrations),
        ftds: finiteNumber(row.ftd),
        qftd: qualifiedCpa,
        deposit: finiteNumber(row.deposits),
        netPl: null,
        withdrawalTotal: null,
        volume: finiteNumber(row.bet_amount),
        revShare: 0,
        cpaQualified: qualifiedCpa,
        cpaValue: 0,
        totalCommission: 0,
      };
      const hasOperationalData = [
        report.clicks,
        report.registrations,
        report.ftds,
        report.qftd,
        report.deposit,
        report.volume,
      ].some((value) => value !== 0);

      return hasOperationalData ? [report] : [];
    });

    this.logger.debug(
      `[otg] ${date} → ${reports.length} reports across ${totalPages} page(s)`,
    );
    return reports;
  }
}
