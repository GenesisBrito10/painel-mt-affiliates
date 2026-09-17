import { query, queryOne } from '../db.js';

export interface UserRow {
  id: string;
  name: string;
  email: string;
  status: string;
}

export interface LinkRow {
  campaignId: string;
  bettingHouse: string;
  cpa: string;
  revshare: string;
}

export interface OwnCpaRow {
  bettingHouse: string;
  campaignId: string;
  cpa: string;
  cpaQualified: string;
  deposit: string;
}

export interface NetworkCpaRow {
  name: string;
  email: string;
  campaignId: string;
  bettingHouse: string;
  cpa: string;
  cpaQualified: string;
}

export interface DailyCpaRow {
  date: string;
  bettingHouse: string;
  campaignId: string;
  cpaQualified: number;
  deposit: string;
}

export interface InvestigationResult {
  user: UserRow;
  links: LinkRow[];
  ownCpas: OwnCpaRow[];
  networkCpas: NetworkCpaRow[];
  dailyBreakdown: DailyCpaRow[];
  referralsCount: number;
  fraud: { bettingHouse: string; count: number }[];
  withdrawalsTotal: number;
  ledgerCutover: string | null;
  diagnosis: string[];
}

function num(value: string | number | null | undefined): number {
  if (value == null) return 0;
  return typeof value === 'number' ? value : parseFloat(value);
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  return queryOne<UserRow>(
    `SELECT id, name, email, status::text
     FROM users
     WHERE lower(email) = lower($1)
       AND "deletedAt" IS NULL
     LIMIT 1`,
    [email.trim()],
  );
}

export async function investigateAffiliate(
  email: string,
  houseFilter?: string,
): Promise<InvestigationResult | null> {
  const user = await findUserByEmail(email);
  if (!user) return null;

  const links = await query<LinkRow>(
    `SELECT "campaignId", "bettingHouse", cpa::text, revshare::text
     FROM affiliate_links
     WHERE "userId" = $1 AND "deletedAt" IS NULL
     ${houseFilter ? 'AND "bettingHouse" = $2' : ''}
     ORDER BY "bettingHouse"`,
    houseFilter ? [user.id, houseFilter] : [user.id],
  );

  const ownCpas = await query<OwnCpaRow>(
    `SELECT
       al."bettingHouse",
       al."campaignId",
       al.cpa::text,
       COALESCE(SUM(ad."cpaQualified"), 0)::text AS "cpaQualified",
       COALESCE(SUM(ad.deposit), 0)::text AS deposit
     FROM affiliate_links al
     LEFT JOIN affiliate_data ad
       ON ad."campaignId" = al."campaignId"
      AND ad."bettingHouse" = al."bettingHouse"
     WHERE al."userId" = $1
       AND al."deletedAt" IS NULL
       ${houseFilter ? 'AND al."bettingHouse" = $2' : ''}
     GROUP BY al."bettingHouse", al."campaignId", al.cpa
     ORDER BY al."bettingHouse"`,
    houseFilter ? [user.id, houseFilter] : [user.id],
  );

  const networkCpas = await query<NetworkCpaRow>(
    `WITH indicados AS (
       SELECT id, name, email
       FROM users
       WHERE "referredById" = $1 AND "deletedAt" IS NULL
     )
     SELECT
       i.name,
       i.email,
       al."campaignId",
       al."bettingHouse",
       al.cpa::text,
       COALESCE(SUM(ad."cpaQualified"), 0)::text AS "cpaQualified"
     FROM indicados i
     JOIN affiliate_links al ON al."userId" = i.id AND al."deletedAt" IS NULL
     LEFT JOIN affiliate_data ad
       ON ad."campaignId" = al."campaignId"
      AND ad."bettingHouse" = al."bettingHouse"
     ${houseFilter ? 'WHERE al."bettingHouse" = $2' : ''}
     GROUP BY i.name, i.email, al."campaignId", al."bettingHouse", al.cpa
     HAVING COALESCE(SUM(ad."cpaQualified"), 0) > 0
     ORDER BY SUM(ad."cpaQualified") DESC`,
    houseFilter ? [user.id, houseFilter] : [user.id],
  );

  const dailyBreakdown = await query<DailyCpaRow>(
    `SELECT
       ad.date::text,
       ad."bettingHouse",
       ad."campaignId",
       ad."cpaQualified",
       ad.deposit::text
     FROM affiliate_data ad
     JOIN affiliate_links al
       ON al."campaignId" = ad."campaignId"
      AND al."bettingHouse" = ad."bettingHouse"
     WHERE al."userId" = $1
       AND al."deletedAt" IS NULL
       AND ad."cpaQualified" > 0
       ${houseFilter ? 'AND ad."bettingHouse" = $2' : ''}
     ORDER BY ad.date`,
    houseFilter ? [user.id, houseFilter] : [user.id],
  );

  const referrals = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM users
     WHERE "referredById" = $1 AND "deletedAt" IS NULL`,
    [user.id],
  );

  const fraud = await query<{ bettingHouse: string; count: number }>(
    `SELECT "bettingHouse", count
     FROM fraud_counts
     WHERE "userId" = $1 AND count > 0`,
    [user.id],
  );

  const cutoverRow = await queryOne<{ value: string }>(
    `SELECT value FROM settings WHERE key = 'ledger_cutover_date' LIMIT 1`,
  );

  const withdrawals = await queryOne<{ total: string }>(
    `SELECT COALESCE(SUM("originalAmount" - COALESCE("gatewayRefundedAmount", 0)), 0)::text AS total
     FROM withdrawal_requests
     WHERE "userId" = $1
       AND status IN ('PENDING','APPROVED','PROCESSING','COMPLETED')
       AND "bettingHouse" <> 'all'`,
    [user.id],
  );

  const diagnosis = buildDiagnosis(links, ownCpas, networkCpas);

  return {
    user,
    links,
    ownCpas,
    networkCpas,
    dailyBreakdown,
    referralsCount: num(referrals?.count),
    fraud,
    withdrawalsTotal: num(withdrawals?.total),
    ledgerCutover: cutoverRow?.value ?? null,
    diagnosis,
  };
}

function buildDiagnosis(
  links: LinkRow[],
  ownCpas: OwnCpaRow[],
  networkCpas: NetworkCpaRow[],
): string[] {
  const notes: string[] = [];

  const ownTotal = ownCpas.reduce((s, r) => s + num(r.cpaQualified), 0);
  const networkTotal = networkCpas.reduce((s, r) => s + num(r.cpaQualified), 0);
  const dashboardQftd = ownTotal + networkTotal;

  let ownCpaEarnings = 0;
  for (const row of ownCpas) {
    ownCpaEarnings += num(row.cpa) * num(row.cpaQualified);
  }

  let networkEarnings = 0;
  for (const net of networkCpas) {
    const headLink = links.find((l) => l.bettingHouse === net.bettingHouse);
    const headRate = num(headLink?.cpa);
    const margin = Math.max(0, headRate - num(net.cpa));
    networkEarnings += margin * num(net.cpaQualified);
  }

  notes.push(
    `Dashboard (escopo "all") mostra QFTD = ${dashboardQftd} (${ownTotal} próprios + ${networkTotal} da rede).`,
  );
  notes.push(
    `CPA direto esperado = ${ownTotal} × taxa = ${ownCpaEarnings.toFixed(2)} (só ganhos próprios).`,
  );

  if (networkTotal > 0) {
    notes.push(
      `Rede esperada ≈ ${networkEarnings.toFixed(2)} (spread sobre ${networkTotal} CPA(s) de indicados).`,
    );
    notes.push(
      '⚠️ Não multiplique o QFTD total pela taxa do afiliado — CPAs da rede geram só o spread.',
    );
  }

  if (ownTotal === 0 && links.length > 0) {
    notes.push('Nenhum CPA qualificado próprio encontrado no affiliate_data.');
  }

  return notes;
}

export function computeTotals(result: InvestigationResult) {
  const ownCpaCount = result.ownCpas.reduce((s, r) => s + num(r.cpaQualified), 0);
  const networkCpaCount = result.networkCpas.reduce(
    (s, r) => s + num(r.cpaQualified),
    0,
  );

  let ownCpaEarnings = 0;
  for (const row of result.ownCpas) {
    ownCpaEarnings += num(row.cpa) * num(row.cpaQualified);
  }

  let networkEarnings = 0;
  for (const net of result.networkCpas) {
    const headLink = result.links.find((l) => l.bettingHouse === net.bettingHouse);
    const margin = Math.max(0, num(headLink?.cpa) - num(net.cpa));
    networkEarnings += margin * num(net.cpaQualified);
  }

  return {
    ownCpaCount,
    networkCpaCount,
    dashboardQftd: ownCpaCount + networkCpaCount,
    ownCpaEarnings,
    networkEarnings,
    grossTotal: ownCpaEarnings + networkEarnings,
  };
}
