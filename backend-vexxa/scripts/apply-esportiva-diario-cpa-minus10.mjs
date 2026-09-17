// Diminui 10 no CPA dos links ativos da casa esportiva-diario (piso em 0).
// Async/Promise (pg). DRY-RUN por padrão; grava só com --apply.
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const HOUSE = 'esportiva-diario';
const DELTA = 10;

const c = new pg.Client({ connectionString: process.env.DBURL });

async function main() {
  await c.connect();

  // Alvos: links ativos da casa com cpa > 0.
  const sel = await c.query(
    `SELECT al.id, u.email, al.cpa::float8 AS cpa,
            GREATEST(al.cpa - $2, 0)::float8 AS novo
       FROM affiliate_links al
       JOIN users u ON u.id = al."userId"
      WHERE al."bettingHouse" = $1
        AND al."deletedAt" IS NULL
        AND al.cpa IS NOT NULL
        AND al.cpa > 0
      ORDER BY al.cpa DESC`,
    [HOUSE, DELTA],
  );

  console.log(`Casa: ${HOUSE} | links com cpa>0: ${sel.rowCount} | delta: -${DELTA} (piso 0)\n`);
  for (const r of sel.rows.slice(0, 15)) {
    console.log(`  ${String(r.cpa).padStart(6)} -> ${String(r.novo).padStart(6)}  ${r.email}`);
  }
  if (sel.rowCount > 15) console.log(`  ... +${sel.rowCount - 15} linhas`);

  if (APPLY) {
    const upd = await c.query(
      `UPDATE affiliate_links
          SET cpa = GREATEST(cpa - $2, 0), "updatedAt" = now()
        WHERE "bettingHouse" = $1
          AND "deletedAt" IS NULL
          AND cpa IS NOT NULL
          AND cpa > 0`,
      [HOUSE, DELTA],
    );
    console.log(`\nOK — ${upd.rowCount} links atualizados (cpa -${DELTA}).`);
  } else {
    console.log('\nDRY-RUN — rode com --apply para gravar.');
  }

  await c.end();
}

main().catch(async (e) => {
  console.error(e);
  await c.end().catch(() => {});
  process.exit(1);
});
