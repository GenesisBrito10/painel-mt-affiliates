// Deletes exactly PENDING withdrawal requests from pinbet-diario.
// Dry-run by default; pass --apply to commit.
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const HOUSE = 'pinbet-diario';
const STATUS = 'PENDING';
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

await client.connect();
try {
  await client.query('BEGIN');
  const selected = await client.query(
    `SELECT wr.id, wr."userId", u.email, wr."originalAmount"::text AS amount,
            wr."createdAt"
       FROM withdrawal_requests wr
       JOIN users u ON u.id = wr."userId"
      WHERE wr."bettingHouse" = $1
        AND wr.status = $2
      ORDER BY wr."createdAt", wr.id
      FOR UPDATE OF wr`,
    [HOUSE, STATUS],
  );
  const total = selected.rows.reduce((sum, row) => sum + Number(row.amount), 0);

  console.log(
    `Selecionados: ${selected.rowCount} | casa=${HOUSE} | status=${STATUS} | total bruto=R$${total.toFixed(2)}`,
  );
  for (const row of selected.rows) {
    console.log(
      `${row.createdAt.toISOString()} | ${row.email} | R$${Number(row.amount).toFixed(2)} | ${row.id}`,
    );
  }

  if (!APPLY) {
    await client.query('ROLLBACK');
    console.log('DRY-RUN concluído; nenhuma linha foi apagada.');
  } else {
    const deleted = await client.query(
      `DELETE FROM withdrawal_requests
        WHERE "bettingHouse" = $1
          AND status = $2
          AND id = ANY($3::text[])
        RETURNING id`,
      [HOUSE, STATUS, selected.rows.map((row) => row.id)],
    );
    if (deleted.rowCount !== selected.rowCount) {
      throw new Error(
        `Contagem divergente: selecionados=${selected.rowCount}, apagados=${deleted.rowCount}`,
      );
    }
    await client.query('COMMIT');
    console.log(`APLICADO: ${deleted.rowCount} pagamento(s) pendente(s) apagado(s).`);
  }
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
