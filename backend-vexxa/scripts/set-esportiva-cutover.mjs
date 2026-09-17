// Seta o cutover POR CASA (feature per-house-cutover) de esportivabet e
// esportiva-diario para a DATA informada (via env CUTOVER_DATE).
// Só tem efeito APÓS deploy do código que lê `ledger_cutover_date_<slug>`.
// DRY-RUN por padrão; grava só com --apply.
import pg from 'pg';
import { randomUUID } from 'node:crypto';

const APPLY = process.argv.includes('--apply');
const DATE = process.env.CUTOVER_DATE; // 'YYYY-MM-DD' — obrigatório
const KEYS = [
  'ledger_cutover_date_esportivabet',
  'ledger_cutover_date_esportiva-diario',
];

if (!DATE || !/^\d{4}-\d{2}-\d{2}$/.test(DATE)) {
  console.error('Defina CUTOVER_DATE=YYYY-MM-DD');
  process.exit(1);
}

const c = new pg.Client({ connectionString: process.env.DBURL });
await c.connect();
try {
  for (const key of KEYS) {
    const cur = await c.query('SELECT value FROM settings WHERE key=$1', [key]);
    console.log(`${key}: ${cur.rowCount ? cur.rows[0].value : '(nao existe)'} -> ${DATE}`);
    if (APPLY) {
      await c.query(
        `INSERT INTO settings (id, key, value, label, "updatedAt")
         VALUES ($1,$2,$3,$4,now())
         ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, "updatedAt"=now()`,
        [randomUUID(), key, DATE, 'Cutover por casa (ledger)'],
      );
    }
  }
  console.log(APPLY ? '\nOK — settings gravadas. (ativa apos deploy do codigo)' : '\nDRY-RUN — rode com --apply para gravar.');
} finally {
  await c.end();
}
