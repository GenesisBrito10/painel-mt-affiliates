import { query, queryOne } from '../db.js';
import {
  lookupCampaignOnBetboard,
  type BetboardLookupHit,
} from './betboard-lookup.service.js';
import { currentMonthRange, currentMonthStartDate } from '../utils/date-range.js';
import { parseLinkInput, type ParsedLinkRef } from '../utils/link-parser.js';

export interface LinkOwnerRow {
  linkId: string;
  campaignId: string;
  bettingHouse: string;
  affiliateId: string;
  cpa: string;
  revshare: string;
  userLink: string | null;
  source: string;
  deletedAt: string | null;
  userId: string;
  userName: string;
  userEmail: string;
  userStatus: string;
  providerId: string | null;
  providerName: string | null;
  providerType: string | null;
  providerEmail: string | null;
  providerActive: boolean | null;
  providerLastUsed: string | null;
  providerLastError: string | null;
  bookmarkerId: string | null;
}

export interface LinkMetricsRow {
  cpaQualified: string;
  qftd: string;
  ftds: string;
  clicks: string;
  registrations: string;
  deposit: string;
  cpaValue: string;
  revShare: string;
  totalCommission: string;
  lastSyncAt: string | null;
  utmCampaign: string | null;
}

export interface ProviderHouseRow {
  id: string;
  name: string;
  provider: string;
  email: string;
  active: boolean;
  lastUsedAt: string | null;
  lastError: string | null;
  bookmarkerId: string;
}

export interface LinkRequestRow {
  id: string;
  status: string;
  userEmail: string;
  createdAt: string;
  fulfilledAt: string | null;
}

export interface LinkLookupResult {
  parsed: ParsedLinkRef;
  matches: LinkOwnerRow[];
  metrics: LinkMetricsRow | null;
  dailyMetrics: { date: string; cpaQualified: number; deposit: string }[];
  providerAccountsForHouse: ProviderHouseRow[];
  linkRequests: LinkRequestRow[];
  resolvedCampaignId: string | null;
  betboardHits: BetboardLookupHit[];
  period: { start: string; end: string; label: string };
}

export async function lookupByLink(input: string): Promise<LinkLookupResult | null> {
  const parsed = parseLinkInput(input);
  if (!parsed) return null;

  const period = currentMonthRange();
  const monthStart = currentMonthStartDate();

  const codePattern = `%-${parsed.code}`;
  const urlPattern = `%c=${parsed.code}%`;

  let matches = await query<LinkOwnerRow>(
    `SELECT
       al.id AS "linkId",
       al."campaignId",
       al."bettingHouse",
       al."affiliateId",
       al.cpa::text,
       al.revshare::text,
       al."userLink",
       al.source::text,
       al."deletedAt"::text,
       u.id AS "userId",
       u.name AS "userName",
       u.email AS "userEmail",
       u.status::text AS "userStatus",
       pa.id AS "providerId",
       pa.name AS "providerName",
       pa.provider AS "providerType",
       pa.email AS "providerEmail",
       pa.active AS "providerActive",
       pa."lastUsedAt"::text AS "providerLastUsed",
       pa."lastError" AS "providerLastError",
       pah."bookmarkerId"
     FROM affiliate_links al
     JOIN users u ON u.id = al."userId"
     LEFT JOIN provider_accounts pa ON pa.id = al."providerAccountId"
     LEFT JOIN provider_account_houses pah
       ON pah."providerAccountId" = pa.id
      AND pah."bettingHouseSlug" = al."bettingHouse"
     WHERE al."campaignId" = $1
        OR al."campaignId" LIKE $2
        OR al."userLink" ILIKE $3
     ORDER BY al."deletedAt" NULLS FIRST, al."createdAt" DESC
     LIMIT 10`,
    [parsed.campaignId, codePattern, urlPattern],
  );

  const resolvedCampaignId =
    matches.find((m) => !m.deletedAt)?.campaignId ??
    matches[0]?.campaignId ??
    parsed.campaignId;

  const house =
    matches.find((m) => !m.deletedAt)?.bettingHouse ??
    matches[0]?.bettingHouse ??
    parsed.bettingHouse;

  const metrics = resolvedCampaignId
    ? await queryOne<LinkMetricsRow>(
        `SELECT
           COALESCE(SUM("cpaQualified"), 0)::text AS "cpaQualified",
           COALESCE(SUM(qftd), 0)::text AS qftd,
           COALESCE(SUM(ftds), 0)::text AS ftds,
           COALESCE(SUM(clicks), 0)::text AS clicks,
           COALESCE(SUM(registrations), 0)::text AS registrations,
           COALESCE(SUM(deposit), 0)::text AS deposit,
           COALESCE(SUM("cpaValue"), 0)::text AS "cpaValue",
           COALESCE(SUM("revShare"), 0)::text AS "revShare",
           COALESCE(SUM("totalCommission"), 0)::text AS "totalCommission",
           MAX("lastSyncAt")::text AS "lastSyncAt",
           (ARRAY_AGG("utmCampaign" ORDER BY date DESC))[1] AS "utmCampaign"
         FROM affiliate_data
         WHERE "campaignId" = $1 AND "bettingHouse" = $2
           AND date >= $3::date`,
        [resolvedCampaignId, house, monthStart],
      )
    : null;

  const dailyMetrics = resolvedCampaignId
    ? await query<{ date: string; cpaQualified: number; deposit: string }>(
        `SELECT
           date::text,
           "cpaQualified",
           deposit::text
         FROM affiliate_data
         WHERE "campaignId" = $1
           AND "bettingHouse" = $2
           AND date >= $3::date
           AND "cpaQualified" > 0
         ORDER BY date DESC
         LIMIT 15`,
        [resolvedCampaignId, house, monthStart],
      )
    : [];

  const providerAccountsForHouse = await query<ProviderHouseRow>(
    `SELECT
       pa.id,
       pa.name,
       pa.provider,
       pa.email,
       pa.active,
       pa."lastUsedAt"::text AS "lastUsedAt",
       pa."lastError",
       pah."bookmarkerId"
     FROM provider_accounts pa
     JOIN provider_account_houses pah ON pah."providerAccountId" = pa.id
     WHERE pah."bettingHouseSlug" = $1
     ORDER BY pa.name`,
    [house],
  );

  const linkRequests = await query<LinkRequestRow>(
    `SELECT
       lr.id,
       lr.status::text,
       u.email AS "userEmail",
       lr."createdAt"::text,
       lr."fulfilledAt"::text
     FROM link_requests lr
     JOIN users u ON u.id = lr."userId"
     WHERE lr."bettingHouseSlug" = $1
       AND lr.links::text ILIKE $2
     ORDER BY lr."createdAt" DESC
     LIMIT 5`,
    [house, `%${parsed.code}%`],
  );

  // Se não achou link ativo, tenta só pelo código no affiliate_data
  if (matches.length === 0) {
    const dataHit = await queryOne<{ campaignId: string; bettingHouse: string }>(
      `SELECT "campaignId", "bettingHouse"
       FROM affiliate_data
       WHERE "campaignId" LIKE $1 OR "campaignId" = $2
       LIMIT 1`,
      [codePattern, parsed.campaignId],
    );
    if (dataHit) {
      parsed.campaignId = dataHit.campaignId;
      matches = await query<LinkOwnerRow>(
        `SELECT
           al.id AS "linkId",
           al."campaignId",
           al."bettingHouse",
           al."affiliateId",
           al.cpa::text,
           al.revshare::text,
           al."userLink",
           al.source::text,
           al."deletedAt"::text,
           u.id AS "userId",
           u.name AS "userName",
           u.email AS "userEmail",
           u.status::text AS "userStatus",
           pa.id AS "providerId",
           pa.name AS "providerName",
           pa.provider AS "providerType",
           pa.email AS "providerEmail",
           pa.active AS "providerActive",
           pa."lastUsedAt"::text AS "providerLastUsed",
           pa."lastError" AS "providerLastError",
           pah."bookmarkerId"
         FROM affiliate_links al
         JOIN users u ON u.id = al."userId"
         LEFT JOIN provider_accounts pa ON pa.id = al."providerAccountId"
         LEFT JOIN provider_account_houses pah
           ON pah."providerAccountId" = pa.id
          AND pah."bettingHouseSlug" = al."bettingHouse"
         WHERE al."campaignId" = $1
         ORDER BY al."deletedAt" NULLS FIRST
         LIMIT 10`,
        [dataHit.campaignId],
      );
    }
  }

  const finalCampaignId =
    matches.length > 0 || metrics ? resolvedCampaignId : null;

  const betboardHits = await lookupCampaignOnBetboard(
    finalCampaignId ?? parsed.campaignId,
    parsed.code,
  );

  return {
    parsed,
    matches,
    metrics,
    dailyMetrics,
    providerAccountsForHouse,
    linkRequests,
    resolvedCampaignId: finalCampaignId,
    betboardHits,
    period,
  };
}

export function computeExpectedCpa(
  cpaRate: string,
  cpaQualified: string,
): number {
  return (parseFloat(cpaRate) || 0) * (parseInt(cpaQualified, 10) || 0);
}
