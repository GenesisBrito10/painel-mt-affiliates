// Seleciona 108 afiliados reais aleatorios com link ativo de superbet e sem
// fraude superbet positiva, cadastra 1 CPA fraude para cada um e apaga saques
// PENDING desses usuarios para que solicitem novamente.
// DRY-RUN por padrao; grava somente com --apply.
import pg from 'pg';
import { randomUUID } from 'node:crypto';

const APPLY = process.argv.includes('--apply');
const HOUSE = 'superbet';
const TARGET_COUNT = 108;
const CHANGED_BY_EMAIL = 'admin@vallexgroup.com.br';
const BATCH_ID = 'random-superbet-fraud-108-2026-07-13';
const REASON = `Carga aleatoria de ${TARGET_COUNT} CPAs fraude (${BATCH_ID})`;

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

try {
  await c.query('BEGIN');

  const existingBatch = await c.query(
    'SELECT count(*)::int AS count FROM fraud_logs WHERE reason = $1',
    [REASON],
  );
  if (existingBatch.rows[0].count > 0) {
    throw new Error(
      `Lote ${BATCH_ID} ja foi aplicado (${existingBatch.rows[0].count} logs encontrados).`,
    );
  }

  const changedBy = await c.query(
    `SELECT id, email
       FROM users
      WHERE email = $1 AND role IN ('ADMIN', 'SUPERADMIN') AND "deletedAt" IS NULL
      LIMIT 1`,
    [CHANGED_BY_EMAIL],
  );
  if (!changedBy.rowCount) {
    throw new Error(`Admin ${CHANGED_BY_EMAIL} nao encontrado para auditar fraud_logs.`);
  }

  const eligibleCount = await c.query(
    `SELECT count(DISTINCT u.id)::int AS count
       FROM users u
       JOIN affiliate_links al ON al."userId" = u.id
      WHERE u."deletedAt" IS NULL
        AND u.role = 'AFFILIATE'
        AND u.status = 'APPROVED'
        AND u.active = true
        AND u."isExternal" = false
        AND al."bettingHouse" = $1
        AND al."deletedAt" IS NULL
        AND COALESCE(al.cpa, 0) > 0
        AND NOT EXISTS (
          SELECT 1 FROM fraud_counts fc
           WHERE fc."userId" = u.id
             AND fc."bettingHouse" = $1
             AND fc.count > 0
        )`,
    [HOUSE],
  );
  if (eligibleCount.rows[0].count < TARGET_COUNT) {
    throw new Error(
      `Elegiveis insuficientes: ${eligibleCount.rows[0].count} disponiveis para ${TARGET_COUNT}.`,
    );
  }

  const targets = await c.query(
    `WITH latest_link AS (
       SELECT DISTINCT ON (u.id)
              u.id AS "userId",
              u.email,
              u.name,
              al.cpa::text AS cpa
         FROM users u
         JOIN affiliate_links al ON al."userId" = u.id
        WHERE u."deletedAt" IS NULL
          AND u.role = 'AFFILIATE'
          AND u.status = 'APPROVED'
          AND u.active = true
          AND u."isExternal" = false
          AND al."bettingHouse" = $1
          AND al."deletedAt" IS NULL
          AND COALESCE(al.cpa, 0) > 0
          AND NOT EXISTS (
            SELECT 1 FROM fraud_counts fc
             WHERE fc."userId" = u.id
               AND fc."bettingHouse" = $1
               AND fc.count > 0
          )
        ORDER BY u.id, al."createdAt" DESC
     )
     SELECT *
       FROM latest_link
      ORDER BY random()
      LIMIT $2`,
    [HOUSE, TARGET_COUNT],
  );

  console.log(
    `Casa: ${HOUSE} | elegiveis: ${eligibleCount.rows[0].count} | selecionados: ${targets.rowCount}`,
  );
  console.log(`Auditoria: ${changedBy.rows[0].email} | lote: ${BATCH_ID}`);

  const targetIds = targets.rows.map((t) => t.userId);
  const pendingBefore = await c.query(
    `SELECT count(*)::int AS withdrawals,
            count(DISTINCT "userId")::int AS users,
            COALESCE(sum(amount), 0)::text AS amount
       FROM withdrawal_requests
      WHERE status = 'PENDING'
        AND "userId" = ANY($1)`,
    [targetIds],
  );
  console.log(`Saques PENDING dos selecionados: ${JSON.stringify(pendingBefore.rows[0])}`);

  console.log('\nSelecionados:');
  for (const [i, t] of targets.rows.entries()) {
    console.log(
      `${String(i + 1).padStart(3)}  ${String(t.cpa).padStart(6)}  ${t.email}`,
    );
  }

  if (!APPLY) {
    console.log('\nDRY-RUN - rode com --apply para gravar e apagar pendentes.');
    await c.query('ROLLBACK');
    process.exit(0);
  }

  for (const t of targets.rows) {
    await c.query(
      `INSERT INTO fraud_counts (id, "userId", "bettingHouse", count, "updatedById", "updatedAt")
       VALUES ($1, $2, $3, 1, $4, now())
       ON CONFLICT ("userId", "bettingHouse")
       DO UPDATE SET count = 1, "updatedById" = $4, "updatedAt" = now()
       WHERE fraud_counts.count = 0`,
      [randomUUID(), t.userId, HOUSE, changedBy.rows[0].id],
    );

    await c.query(
      `INSERT INTO fraud_logs
       (id, "userId", "changedById", "bettingHouse", "oldCount", "newCount", reason, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 0, 1, $5, now(), now())`,
      [randomUUID(), t.userId, changedBy.rows[0].id, HOUSE, REASON],
    );
  }

  const deleted = await c.query(
    `DELETE FROM withdrawal_requests
      WHERE status = 'PENDING'
        AND "userId" = ANY($1)
      RETURNING id, "userId", "createdAt", "bettingHouse", amount::text AS amount`,
    [targetIds],
  );

  await c.query('COMMIT');

  console.log(`\nOK - ${targets.rowCount} CPAs fraude cadastrados.`);
  console.log(`OK - ${deleted.rowCount} saques PENDING apagados dos selecionados.`);
  if (deleted.rowCount > 0) {
    console.log('\nSaques apagados:');
    for (const d of deleted.rows) {
      console.log(`${d.createdAt.toISOString()}  ${d.amount}  ${d.bettingHouse}  ${d.id}`);
    }
  }
} catch (error) {
  await c.query('ROLLBACK');
  console.error(error);
  process.exitCode = 1;
} finally {
  await c.end();
}
