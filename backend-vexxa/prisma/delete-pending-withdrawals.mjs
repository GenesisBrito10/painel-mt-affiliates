// One-off: delete all PENDING withdrawal requests for betnacional + hiperbet.
// Authorized by user (2026-05-29). PENDING => no gateway payout sent, so no
// money moved; deletion just releases the dynamically-computed held balance.
// Prints every row it removes (audit trail), then hard-deletes.
//
// Usage:
//   node prisma/delete-pending-withdrawals.mjs --dry-run   # list only
//   node prisma/delete-pending-withdrawals.mjs             # delete
import fs from 'node:fs';
import pg from 'pg';

const DRY_RUN = process.argv.includes('--dry-run');
const HOUSES = ['betnacional', 'hiperbet'];

// DATABASE_URL from .env (same prod DB the app uses).
const envLine = fs
  .readFileSync(new URL('../.env', import.meta.url), 'utf8')
  .split('\n')
  .find((l) => l.startsWith('DATABASE_URL'));
const url = envLine.slice(envLine.indexOf('=') + 1).trim().replace(/^"|"$/g, '');

const client = new pg.Client({ connectionString: url });
await client.connect();

try {
  const sel = await client.query(
    `SELECT w.id, w."bettingHouse", w.amount, w."createdAt", u.email, u.name
       FROM withdrawal_requests w
       JOIN users u ON u.id = w."userId"
      WHERE w."bettingHouse" = ANY($1) AND w."status" = 'PENDING'
      ORDER BY w."bettingHouse" ASC, w."createdAt" ASC`,
    [HOUSES],
  );

  const byHouse = {};
  for (const r of sel.rows) {
    byHouse[r.bettingHouse] = (byHouse[r.bettingHouse] ?? 0) + 1;
    console.log(
      `${r.bettingHouse}\t${r.email}\t${r.amount}\t${r.createdAt.toISOString()}\t${r.id}`,
    );
  }
  console.log('---');
  console.log('PENDING found:', sel.rows.length, JSON.stringify(byHouse));

  if (DRY_RUN) {
    console.log('DRY RUN — nothing deleted.');
  } else {
    const del = await client.query(
      `DELETE FROM withdrawal_requests
        WHERE "bettingHouse" = ANY($1) AND "status" = 'PENDING'`,
      [HOUSES],
    );
    console.log('DELETED:', del.rowCount);
  }
} finally {
  await client.end();
}
