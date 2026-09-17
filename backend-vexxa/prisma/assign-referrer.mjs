// One-off: set referer (referredById) of TARGET to REFERRER.
// Authorized by user (2026-06-11).
//
// Usage:
//   node prisma/assign-referrer.mjs --dry-run   # show only
//   node prisma/assign-referrer.mjs             # apply
import fs from 'node:fs';
import pg from 'pg';

const DRY_RUN = process.argv.includes('--dry-run');
const TARGET_EMAIL = 'guildafurious778@gmail.com';
const REFERRER_EMAIL = 'network@gmail.com';

// DATABASE_URL from .env (same prod DB the app uses).
const envLine = fs
  .readFileSync(new URL('../.env', import.meta.url), 'utf8')
  .split('\n')
  .find((l) => l.startsWith('DATABASE_URL'));
const url = envLine.slice(envLine.indexOf('=') + 1).trim().replace(/^"|"$/g, '');

const client = new pg.Client({ connectionString: url });
await client.connect();

try {
  const q = async (email) =>
    (await client.query(
      `SELECT id, email, name, "referredById" FROM users WHERE email = $1`,
      [email],
    )).rows[0];

  const target = await q(TARGET_EMAIL);
  const referrer = await q(REFERRER_EMAIL);

  if (!target) throw new Error(`alvo nao encontrado: ${TARGET_EMAIL}`);
  if (!referrer) throw new Error(`convidante nao encontrado: ${REFERRER_EMAIL}`);
  if (target.id === referrer.id) throw new Error('auto-referencia');

  console.log('=== ANTES ===');
  console.log(`alvo:       ${target.email} (${target.id})  referredById=${target.referredById ?? 'null'}`);
  console.log(`convidante: ${referrer.email} (${referrer.id})`);

  if (DRY_RUN) {
    console.log('\nDRY RUN — nada alterado.');
  } else {
    await client.query(`UPDATE users SET "referredById" = $1 WHERE id = $2`, [
      referrer.id,
      target.id,
    ]);
    const after = await q(TARGET_EMAIL);
    console.log('\n=== DEPOIS ===');
    console.log(`alvo: ${after.email}  referredById=${after.referredById}`);
    console.log('OK atribuido.');
  }
} finally {
  await client.end();
}
