import { Injectable, Logger } from '@nestjs/common';
import type {
  IProviderExtractor,
  ExtractedReport,
  ProviderCredentials,
} from '../../domain/ports/provider-extractor.port.js';
import {
  ProviderLoginFailedException,
  ProviderFetchFailedException,
} from '../../domain/exceptions/sync.exceptions.js';

// Betboard API shape — mirrors the old betboard-sync.ts response parsing
interface BetboardReport {
  campaignName: string;
  campaignId?: string;
  affiliateId?: string;
  reportDate: string;
  clicks: number;
  registros: number; // registrations
  ftd: number;
  qftd: number;
  depositos: number; // deposit
  rev: number; // revShare
  cpa: number; // cpaValue / totalCommission
}

interface BetboardExpert {
  expertName: string;
  reports: BetboardReport[];
}

const DEFAULT_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  'Content-Type': 'application/json',
  Origin: 'https://afiliadosexternos.mgaffiliates.site',
  Referer: 'https://afiliadosexternos.mgaffiliates.site/',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
};

export const BETBOARD_API_BASE_URL =
  'https://api-affiliates.mgaffiliates.site/api';
const RETIRED_BETBOARD_API_BASE_URL = 'https://api.betboard.com.br/api';

export function resolveBetboardApiBaseUrl(configuredUrl: string): string {
  const normalized = configuredUrl.trim().replace(/\/+$/, '');
  if (!normalized || normalized === RETIRED_BETBOARD_API_BASE_URL) {
    return BETBOARD_API_BASE_URL;
  }
  return normalized;
}

@Injectable()
export class BetboardExtractor implements IProviderExtractor {
  readonly providerSlug = 'betboard';
  private readonly logger = new Logger(BetboardExtractor.name);
  private apiBaseUrl = BETBOARD_API_BASE_URL;

  async login(credentials: ProviderCredentials): Promise<string> {
    this.apiBaseUrl = resolveBetboardApiBaseUrl(credentials.apiBaseUrl);
    const res = await fetch(`${this.apiBaseUrl}/login`, {
      method: 'POST',
      headers: DEFAULT_HEADERS,
      body: JSON.stringify({
        email: credentials.email,
        password: credentials.password,
        rememberMe: false,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new ProviderLoginFailedException(
        'betboard',
        `HTTP ${res.status}: ${body.slice(0, 200)}`,
      );
    }

    const data = (await res.json()) as { accessToken: string };
    return data.accessToken;
  }

  async fetchReports(
    accessToken: string,
    date: string,
    bookmarkerId: string,
  ): Promise<ExtractedReport[]> {
    const url = `${this.apiBaseUrl}/reports/v2/details?InitialDate=${date}&FinalDate=${date}&BookMakerId=${bookmarkerId}`;

    const res = await fetch(url, {
      headers: { ...DEFAULT_HEADERS, Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new ProviderFetchFailedException(
        'betboard',
        date,
        `HTTP ${res.status}: ${body.slice(0, 200)}`,
      );
    }

    const experts = (await res.json()) as BetboardExpert[];
    if (!Array.isArray(experts)) return [];

    const reports: ExtractedReport[] = [];

    for (const expert of experts) {
      if (!Array.isArray(expert.reports)) continue;
      for (const r of expert.reports) {
        if (r.reportDate !== date) continue;

        // campaignName in Betboard = affiliateName in Mongo = campaignId in Postgres
        const campaignId = r.campaignName || expert.expertName;
        if (!campaignId) continue;

        reports.push({
          campaignId,
          affiliateId: r.affiliateId ?? r.campaignId ?? '',
          date: new Date(`${date}T00:00:00.000Z`),
          clicks: r.clicks ?? 0,
          registrations: r.registros ?? 0,
          ftds: r.ftd ?? 0,
          qftd: r.qftd ?? 0,
          deposit: r.depositos ?? 0,
          netPl: null,
          withdrawalTotal: null,
          volume: null,
          revShare: r.rev ?? 0,
          cpaQualified: r.qftd ?? 0,
          cpaValue: r.cpa ?? 0,
          totalCommission: r.cpa ?? 0,
        });
      }
    }

    this.logger.debug(`[betboard] ${date} → ${reports.length} reports`);
    return reports;
  }
}
