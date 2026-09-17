// READ-ONLY: verifies Pinbet metric coverage after migration + historical sync.
import pg from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const client = new pg.Client({ connectionString });
await client.connect();

try {
  await client.query('BEGIN READ ONLY');
  const coverage = await client.query(`
    SELECT
      "bettingHouse" AS house,
      COUNT(*)::int AS rows,
      COUNT("netPl")::int AS net_pl_rows,
      COUNT("withdrawalTotal")::int AS withdrawal_rows,
      COUNT(volume)::int AS volume_rows,
      MIN(date)::text AS first_date,
      MAX(date)::text AS last_date,
      ROUND(COALESCE(SUM("netPl"), 0), 2)::text AS net_pl,
      ROUND(COALESCE(SUM(deposit), 0), 2)::text AS deposits,
      ROUND(COALESCE(SUM("withdrawalTotal"), 0), 2)::text AS withdrawals,
      ROUND(COALESCE(SUM(volume), 0), 2)::text AS volume
    FROM affiliate_data
    WHERE "bettingHouse" IN ('pinbet-diario', 'pinbet-mensal')
    GROUP BY "bettingHouse"
    ORDER BY "bettingHouse"
  `);

  const missingLinks = await client.query(`
    SELECT
      al."bettingHouse" AS house,
      COUNT(DISTINCT al."campaignId")::int AS active_campaigns_without_metrics
    FROM affiliate_links al
    WHERE al."deletedAt" IS NULL
      AND al."bettingHouse" IN ('pinbet-diario', 'pinbet-mensal')
      AND NOT EXISTS (
        SELECT 1
        FROM affiliate_data ad
        WHERE ad."campaignId" = al."campaignId"
          AND ad."bettingHouse" = al."bettingHouse"
          AND ad."netPl" IS NOT NULL
      )
    GROUP BY al."bettingHouse"
    ORDER BY al."bettingHouse"
  `);

  console.table(coverage.rows);
  console.table(missingLinks.rows);

  const incomplete = coverage.rows.some(
    (row) =>
      Number(row.rows) !== Number(row.net_pl_rows) ||
      Number(row.rows) !== Number(row.withdrawal_rows) ||
      Number(row.rows) !== Number(row.volume_rows),
  );
  const campaignsMissing = missingLinks.rows.reduce(
    (sum, row) => sum + Number(row.active_campaigns_without_metrics),
    0,
  );
  if (incomplete || campaignsMissing > 0) process.exitCode = 1;

  await client.query('ROLLBACK');
} finally {
  await client.end();
}
