/**
 * Cliente read-only da API Betboard (mesmo contrato do backend sync).
 * @see backend-vexxa/src/modules/sync/infrastructure/extractors/betboard.extractor.ts
 */

const DEFAULT_ORIGIN = 'https://afiliadosexternos.mgaffiliates.site';
const API_BASE = 'https://api.betboard.com.br/api';

export interface BetboardCredentials {
  email: string;
  password: string;
  origin?: string;
  referer?: string;
}

interface BetboardReport {
  campaignName: string;
  campaignId?: string;
  affiliateId?: string;
  reportDate: string;
  clicks: number;
  registros: number;
  ftd: number;
  qftd: number;
  depositos: number;
  rev: number;
  cpa: number;
}

interface BetboardExpert {
  expertName: string;
  reports: BetboardReport[];
}

export interface BetboardCampaignMetrics {
  campaignId: string;
  affiliateId: string;
  expertName: string;
  clicks: number;
  registrations: number;
  ftds: number;
  qftd: number;
  deposit: number;
  revShare: number;
  cpaValue: number;
  daysWithData: number;
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

function headers(creds: BetboardCredentials, token?: string): Record<string, string> {
  const origin = creds.origin ?? DEFAULT_ORIGIN;
  const referer = creds.referer ?? `${origin}/`;
  return {
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    Origin: origin,
    Referer: referer,
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function betboardLogin(creds: BetboardCredentials): Promise<string> {
  const cached = tokenCache.get(creds.email);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const res = await fetch(`${API_BASE}/login`, {
    method: 'POST',
    headers: headers(creds),
    body: JSON.stringify({
      email: creds.email,
      password: creds.password,
      rememberMe: false,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Login falhou (${res.status}): ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as { accessToken: string };
  tokenCache.set(creds.email, {
    token: data.accessToken,
    expiresAt: Date.now() + 25 * 60 * 1000,
  });
  return data.accessToken;
}

export async function betboardFetchRange(
  creds: BetboardCredentials,
  token: string,
  bookmarkerId: string,
  startDate: string,
  endDate: string,
): Promise<BetboardExpert[]> {
  const url = `${API_BASE}/reports/v2/details?InitialDate=${startDate}&FinalDate=${endDate}&BookMakerId=${bookmarkerId}`;

  const res = await fetch(url, { headers: headers(creds, token) });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Fetch falhou (${res.status}): ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  return Array.isArray(data) ? (data as BetboardExpert[]) : [];
}

export function aggregateCampaignFromExperts(
  experts: BetboardExpert[],
  campaignId: string,
): BetboardCampaignMetrics | null {
  const needle = campaignId.toLowerCase();
  const codeSuffix = campaignId.includes('-')
    ? campaignId.split('-').slice(1).join('-').toLowerCase()
    : campaignId.toLowerCase();

  let found: BetboardCampaignMetrics | null = null;

  for (const expert of experts) {
    if (!Array.isArray(expert.reports)) continue;
    for (const r of expert.reports) {
      const name = (r.campaignName || expert.expertName || '').toLowerCase();
      if (
        name !== needle &&
        !name.endsWith(`-${codeSuffix}`) &&
        name !== codeSuffix
      ) {
        continue;
      }

      if (!found) {
        found = {
          campaignId: r.campaignName || expert.expertName,
          affiliateId: r.affiliateId ?? r.campaignId ?? '',
          expertName: expert.expertName,
          clicks: 0,
          registrations: 0,
          ftds: 0,
          qftd: 0,
          deposit: 0,
          revShare: 0,
          cpaValue: 0,
          daysWithData: 0,
        };
      }

      found.clicks += r.clicks ?? 0;
      found.registrations += r.registros ?? 0;
      found.ftds += r.ftd ?? 0;
      found.qftd += r.qftd ?? 0;
      found.deposit += r.depositos ?? 0;
      found.revShare += r.rev ?? 0;
      found.cpaValue += r.cpa ?? 0;
      if ((r.qftd ?? 0) > 0 || (r.clicks ?? 0) > 0) found.daysWithData += 1;
    }
  }

  return found;
}

export function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
