// Executa TUDO: cria role+db, aplica schema (prisma migrate deploy) e copia
// só os dados que importam de vallex_db -> vallex_db2 (mesmo servidor).
// Rodar a partir de backend-vexxa:  node prisma/clone-db2/run-all.mjs
import pg from 'pg';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const backendDir = resolve(here, '../..'); // backend-vexxa
const env = readFileSync(resolve(backendDir, '.env'), 'utf8');
const SRC_URL = env.match(/DATABASE_URL="?([^"\n]+)"?/)[1];

const u = new URL(SRC_URL);
const PASS = decodeURIComponent(u.password);
const HOST = u.hostname;
const PORT = u.port || '5432';
const NEW_DB = 'vallex_db2';
const NEW_USER = 'vallex2_user';
const DST_URL = `postgresql://${NEW_USER}:${PASS}@${HOST}:${PORT}/${NEW_DB}?schema=public`;

// ordem respeita foreign keys (pai antes do filho). where opcional p/ filtrar linhas.
const TABLES = [
  { table: 'betting_houses' },
  { table: 'provider_accounts' },
  { table: 'provider_account_houses' },
  { table: 'deals' },
  { table: 'house_link_rules' },
  { table: 'users', where: "role <> 'AFFILIATE'" },
  { table: 'settings' },
  { table: 'login_modals' },
  { table: 'whatsapp_settings' },
  { table: 'whatsapp_connection_state' },
];

async function columnsOf(client, table) {
  const r = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
    [table],
  );
  return r.rows.map((x) => x.column_name);
}

const JSON_OIDS = new Set([114, 3802]); // json, jsonb

async function main() {
  // ---- A: criar role + database (conectado como superuser vallex_user) ----
  const admin = new pg.Client({ connectionString: SRC_URL });
  await admin.connect();
  await admin.query(
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${NEW_USER}')
     THEN CREATE ROLE ${NEW_USER} WITH LOGIN PASSWORD '${PASS}'; END IF; END $$;`,
  );
  const exists = await admin.query(`SELECT 1 FROM pg_database WHERE datname='${NEW_DB}'`);
  if (exists.rowCount === 0) {
    await admin.query(`CREATE DATABASE ${NEW_DB} OWNER ${NEW_USER}`);
    console.log(`[A] database ${NEW_DB} criado`);
  } else {
    console.log(`[A] database ${NEW_DB} já existe — reusando`);
  }
  await admin.end();

  // ---- B: grants no schema public do banco novo ----
  const dstAdmin = new pg.Client({
    connectionString: `postgresql://${u.username}:${PASS}@${HOST}:${PORT}/${NEW_DB}`,
  });
  await dstAdmin.connect();
  await dstAdmin.query(`GRANT ALL ON SCHEMA public TO ${NEW_USER}`);
  await dstAdmin.query(`ALTER SCHEMA public OWNER TO ${NEW_USER}`);
  await dstAdmin.end();
  console.log('[B] grants ok');

  // ---- C: aplicar schema via prisma migrate deploy ----
  console.log('[C] prisma migrate deploy no banco novo...');
  execSync('node_modules/.bin/prisma migrate deploy', {
    cwd: backendDir,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: DST_URL },
  });

  // ---- D: copiar dados ----
  const src = new pg.Client({ connectionString: SRC_URL });
  const dst = new pg.Client({ connectionString: DST_URL });
  await src.connect();
  await dst.connect();

  // limpa os alvos (algumas migrations já inserem defaults, ex.: login_modals)
  const allTargets = TABLES.map(({ table }) => table).join(', ');
  await dst.query(`TRUNCATE ${allTargets} RESTART IDENTITY CASCADE`);
  console.log('[D] alvos limpos (truncate cascade)');

  for (const { table, where } of TABLES) {
    // só colunas presentes nos DOIS bancos (trata drift de schema)
    const srcCols = new Set(await columnsOf(src, table));
    const tgtCols = await columnsOf(dst, table);
    const common = tgtCols.filter((c) => srcCols.has(c));
    const onlySrc = [...srcCols].filter((c) => !tgtCols.includes(c));
    if (onlySrc.length) console.log(`[D] ${table}: ignorando colunas só-origem: ${onlySrc.join(', ')}`);

    const selectList = common.map((c) => `"${c}"`).join(', ');
    const sql = `SELECT ${selectList} FROM ${table}${where ? ` WHERE ${where}` : ''}`;
    const res = await src.query({ text: sql, rowMode: 'array' });
    if (res.rowCount === 0) {
      console.log(`[D] ${table}: 0 linhas (pulado)`);
      continue;
    }
    const jsonIdx = res.fields.map((f) => JSON_OIDS.has(f.dataTypeID));
    const placeholders = res.fields
      .map((_, i) => (jsonIdx[i] ? `$${i + 1}::jsonb` : `$${i + 1}`))
      .join(', ');
    const insert = `INSERT INTO ${table} (${selectList}) VALUES (${placeholders})`;

    for (const row of res.rows) {
      const params = row.map((v, i) => {
        if (v === null || v === undefined) return null;
        if (jsonIdx[i]) return JSON.stringify(v); // json/jsonb -> string + cast
        return v; // node-postgres formata arrays/datas/etc corretamente
      });
      await dst.query(insert, params);
    }
    console.log(`[D] ${table}: ${res.rowCount} linhas copiadas`);
  }

  // ---- E: conferência ----
  const chk = await dst.query(`SELECT
    (SELECT count(*) FROM betting_houses) AS casas,
    (SELECT count(*) FROM deals) AS deals,
    (SELECT count(*) FROM provider_accounts) AS contas,
    (SELECT count(*) FROM users WHERE role<>'AFFILIATE') AS admins,
    (SELECT count(*) FROM login_modals) AS modais,
    (SELECT count(*) FROM house_link_rules) AS regras`);
  console.log('[E] conferência:', chk.rows[0]);

  await src.end();
  await dst.end();
  console.log('\nOK — vallex_db2 pronto.');
}

main().catch((e) => {
  console.error('FALHOU:', e.message);
  process.exit(1);
});
