import { query } from '../db.js';
import { currentMonthRange } from '../utils/date-range.js';
import {
  aggregateCampaignFromExperts,
  betboardFetchRange,
  betboardLogin,
  type BetboardCampaignMetrics,
  type BetboardCredentials,
} from './betboard.client.js';

export interface BetboardAccountConfig {
  name: string;
  email: string;
  password: string;
  origin?: string;
  referer?: string;
  houses: { slug: string; bookmarkerId: string }[];
}

export interface BetboardLookupHit {
  accountName: string;
  accountEmail: string;
  house: string;
  bookmarkerId: string;
  metrics: BetboardCampaignMetrics;
  periodStart: string;
  periodEnd: string;
}

function parseAccountsJson(raw: string | undefined): BetboardAccountConfig[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as Array<{
      name: string;
      email: string;
      password: string;
      origin?: string;
      referer?: string;
      houses: string[];
    }>;
    return parsed.map((a) => ({
      name: a.name,
      email: a.email,
      password: a.password,
      origin: a.origin,
      referer: a.referer,
      houses: a.houses.map((slug) => ({ slug, bookmarkerId: '' })),
    }));
  } catch {
    console.error('BETBOARD_ACCOUNTS JSON inválido');
    return [];
  }
}

/** Enriquece bookmarkerIds a partir do Postgres (provider_account_houses + betting_houses). */
async function resolveBookmarkerIds(
  accounts: BetboardAccountConfig[],
): Promise<BetboardAccountConfig[]> {
  const emails = accounts.map((a) => a.email);
  if (emails.length === 0) return accounts;

  const fromProvider = await query<{
    email: string;
    bettingHouseSlug: string;
    bookmarkerId: string;
  }>(
    `SELECT pa.email, pah."bettingHouseSlug", pah."bookmarkerId"
     FROM provider_accounts pa
     JOIN provider_account_houses pah ON pah."providerAccountId" = pa.id
     WHERE pa.email = ANY($1::text[]) AND pah.active = true`,
    [emails],
  );

  const fromHouses = await query<{ slug: string; apiKey: string }>(
    `SELECT slug, "apiKey"
     FROM betting_houses
     WHERE "apiKey" IS NOT NULL AND "apiKey" <> ''`,
  );
  const houseKeyMap = new Map(fromHouses.map((h) => [h.slug, h.apiKey]));

  return accounts.map((acc) => ({
    ...acc,
    houses: acc.houses.map((h) => {
      const fromDb = fromProvider.find(
        (p) => p.email === acc.email && p.bettingHouseSlug === h.slug,
      );
      return {
        slug: h.slug,
        bookmarkerId:
          fromDb?.bookmarkerId ||
          h.bookmarkerId ||
          houseKeyMap.get(h.slug) ||
          '',
      };
    }),
  }));
}

export async function loadBetboardAccounts(): Promise<BetboardAccountConfig[]> {
  const base = parseAccountsJson(process.env.BETBOARD_ACCOUNTS);
  if (base.length === 0) return [];
  return resolveBookmarkerIds(base);
}

export async function lookupCampaignOnBetboard(
  campaignId: string,
  code: string,
): Promise<BetboardLookupHit[]> {
  const enabled = process.env.BETBOARD_ENABLED !== 'false';
  if (!enabled) return [];

  const accounts = await loadBetboardAccounts();
  if (accounts.length === 0) return [];

  const { start, end } = currentMonthRange();

  const hits: BetboardLookupHit[] = [];
  const searchIds = [campaignId, code];
  if (campaignId.includes('-')) {
    searchIds.push(campaignId.split('-').slice(1).join('-'));
  }

  for (const account of accounts) {
    let token: string;
    try {
      const creds: BetboardCredentials = {
        email: account.email,
        password: account.password,
        origin: account.origin,
        referer: account.referer,
      };
      token = await betboardLogin(creds);
    } catch (err) {
      console.error(`Betboard login ${account.name}:`, err);
      continue;
    }

    for (const house of account.houses) {
      if (!house.bookmarkerId) continue;

      try {
        const experts = await betboardFetchRange(
          {
            email: account.email,
            password: account.password,
            origin: account.origin,
            referer: account.referer,
          },
          token,
          house.bookmarkerId,
          start,
          end,
        );

        let metrics: BetboardCampaignMetrics | null = null;
        for (const id of searchIds) {
          metrics = aggregateCampaignFromExperts(experts, id);
          if (metrics) break;
        }

        if (metrics && (metrics.qftd > 0 || metrics.clicks > 0 || metrics.cpaValue > 0)) {
          hits.push({
            accountName: account.name,
            accountEmail: account.email,
            house: house.slug,
            bookmarkerId: house.bookmarkerId,
            metrics,
            periodStart: start,
            periodEnd: end,
          });
        }
      } catch (err) {
        console.error(`Betboard fetch ${account.name}/${house.slug}:`, err);
      }
    }
  }

  return hits;
}
