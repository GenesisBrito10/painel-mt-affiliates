/**
 * Configura a regra de link da SportingBet como MIRROR (CPA = CPA do próprio
 * usuário na Superbet) e aplica esse padrão aos links de SportingBet JÁ
 * atribuídos: define affiliate_links.cpa (sportingbet) = cpa do usuário na
 * superbet (link ativo POOL/MANUAL com cpa).
 *
 * Uso:
 *   node prisma/sportingbet-mirror-superbet.mjs           # dry-run (não altera)
 *   node prisma/sportingbet-mirror-superbet.mjs --apply   # aplica
 */
import fs from 'node:fs';
import pg from 'pg';
import { randomUUID } from 'node:crypto';

const APPLY = process.argv.includes('--apply');

const env = Object.fromEntries(
  fs
    .readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')];
    }),
);
const DATABASE_URL = env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('faltando DATABASE_URL no .env');

const SPORTINGBET = 'sportingbet';
const SUPERBET = 'superbet';

const c = new pg.Client({ connectionString: DATABASE_URL });
await c.connect();
try {
  console.log(`\n=== SportingBet MIRROR Superbet (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===\n`);

  // ── Prévia do backfill: sportingbet link x cpa do usuário na superbet ──
  const previewSql = `
    WITH sb AS (
      SELECT DISTINCT ON ("userId") "userId", cpa
        FROM affiliate_links
       WHERE "bettingHouse" = $2 AND "deletedAt" IS NULL
         AND source IN ('POOL','MANUAL') AND cpa IS NOT NULL
       ORDER BY "userId", "updatedAt" DESC
    )
    SELECT sp.id, sp."userId", sp.cpa AS sportingbet_cpa, sb.cpa AS superbet_cpa
      FROM affiliate_links sp
      LEFT JOIN sb ON sb."userId" = sp."userId"
     WHERE sp."bettingHouse" = $1 AND sp."deletedAt" IS NULL
       AND sp.source IN ('POOL','MANUAL')`;
  const { rows } = await c.query(previewSql, [SPORTINGBET, SUPERBET]);

  const total = rows.length;
  const noSuperbet = rows.filter((r) => r.superbet_cpa === null);
  const willChange = rows.filter(
    (r) =>
      r.superbet_cpa !== null &&
      Number(r.sportingbet_cpa) !== Number(r.superbet_cpa),
  );
  const alreadyOk = total - noSuperbet.length - willChange.length;

  console.log(`Links SportingBet ativos:        ${total}`);
  console.log(`  já com CPA igual ao superbet:  ${alreadyOk}`);
  console.log(`  serão atualizados:             ${willChange.length}`);
  console.log(`  sem CPA na superbet (skip):    ${noSuperbet.length}\n`);

  if (willChange.length > 0) {
    console.log('Amostra (até 15):');
    for (const r of willChange.slice(0, 15)) {
      console.log(
        `  user ${r.userId}: ${r.sportingbet_cpa} -> ${r.superbet_cpa}`,
      );
    }
    console.log('');
  }

  if (!APPLY) {
    console.log('DRY-RUN — nada alterado. Rode com --apply para aplicar.\n');
    process.exit(0);
  }

  await c.query('BEGIN');

  // ── 1) Regra de link da SportingBet → MIRROR (ref: superbet) ──
  const ruleSql = `
    INSERT INTO house_link_rules (id, "houseSlug", "ruleType", "rangeReferenceHouse", "updatedByName", "updatedAt")
    VALUES ($1, $2, 'MIRROR', $3, 'script:mirror-superbet', now())
    ON CONFLICT ("houseSlug") DO UPDATE
      SET "ruleType" = 'MIRROR',
          "rangeReferenceHouse" = $3,
          "updatedByName" = 'script:mirror-superbet',
          "updatedAt" = now()
    RETURNING id, "ruleType", "rangeReferenceHouse"`;
  const ruleRes = await c.query(ruleSql, [randomUUID(), SPORTINGBET, SUPERBET]);
  console.log('Regra SportingBet:', ruleRes.rows[0]);

  // ── 2) Backfill dos links já atribuídos ──
  const updateSql = `
    WITH sb AS (
      SELECT DISTINCT ON ("userId") "userId", cpa
        FROM affiliate_links
       WHERE "bettingHouse" = $2 AND "deletedAt" IS NULL
         AND source IN ('POOL','MANUAL') AND cpa IS NOT NULL
       ORDER BY "userId", "updatedAt" DESC
    )
    UPDATE affiliate_links sp
       SET cpa = sb.cpa, "updatedAt" = now()
      FROM sb
     WHERE sp."bettingHouse" = $1 AND sp."deletedAt" IS NULL
       AND sp.source IN ('POOL','MANUAL')
       AND sp."userId" = sb."userId"
       AND sp.cpa IS DISTINCT FROM sb.cpa`;
  const upd = await c.query(updateSql, [SPORTINGBET, SUPERBET]);
  console.log(`\nLinks SportingBet atualizados: ${upd.rowCount}`);

  await c.query('COMMIT');
  console.log('\n✅ Aplicado com sucesso.\n');
} catch (err) {
  await c.query('ROLLBACK').catch(() => {});
  console.error('ERRO — rollback:', err.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
