/**
 * Remove TUDO da EsportivaBet do banco (link, campaignId, affiliate_data,
 * link_requests) para que os usuários solicitem o link novamente pelo painel
 * (recebendo um link da planilha nova). DELETE de verdade, em transação.
 *
 * Uso:
 *   node prisma/remove-esportiva-links.mjs           # dry-run (só conta)
 *   node prisma/remove-esportiva-links.mjs --apply   # aplica
 */
import fs from 'node:fs';
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const SLUG = 'esportivabet';

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')
    .filter((l) => l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }),
);
if (!env.DATABASE_URL) throw new Error('faltando DATABASE_URL no .env');

const c = new pg.Client({ connectionString: env.DATABASE_URL });
await c.connect();
try {
  console.log(`\n=== Remover EsportivaBet do banco (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===\n`);

  const counts = async () => {
    const al = await c.query(`SELECT count(*) n FROM affiliate_links WHERE "bettingHouse"=$1`, [SLUG]);
    const ad = await c.query(`SELECT count(*) n FROM affiliate_data WHERE "bettingHouse"=$1`, [SLUG]);
    const lr = await c.query(`SELECT count(*) n FROM link_requests WHERE "bettingHouseSlug"=$1`, [SLUG]);
    return { al: +al.rows[0].n, ad: +ad.rows[0].n, lr: +lr.rows[0].n };
  };

  const before = await counts();
  console.log(`affiliate_links: ${before.al}`);
  console.log(`affiliate_data:  ${before.ad}`);
  console.log(`link_requests:   ${before.lr}`);

  if (!APPLY) {
    console.log('\nDRY-RUN — nada removido. Rode com --apply para aplicar.\n');
    process.exit(0);
  }

  await c.query('BEGIN');
  try {
    const d1 = await c.query(`DELETE FROM affiliate_links WHERE "bettingHouse"=$1`, [SLUG]);
    const d2 = await c.query(`DELETE FROM affiliate_data WHERE "bettingHouse"=$1`, [SLUG]);
    const d3 = await c.query(`DELETE FROM link_requests WHERE "bettingHouseSlug"=$1`, [SLUG]);
    await c.query('COMMIT');
    console.log(`\nRemovidos → affiliate_links:${d1.rowCount} affiliate_data:${d2.rowCount} link_requests:${d3.rowCount}`);
  } catch (err) {
    await c.query('ROLLBACK');
    throw err;
  }

  const after = await counts();
  console.log(`\nApós: affiliate_links:${after.al} affiliate_data:${after.ad} link_requests:${after.lr}`);
  console.log(`\n✅ EsportivaBet removida do banco.\n`);
} catch (err) {
  console.error('ERRO:', err.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
