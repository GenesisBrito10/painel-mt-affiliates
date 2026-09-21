/**
 * Corrige o campaignId dos AffiliateLink da bateubet que ficaram com o
 * placeholder `manual_bateubet_<userId8>`.
 *
 * Contexto: até a correção em extractCampaignIdFromUrl, o backend só sabia ler
 * o padrão da Superbet (siteid + c). Com a URL da Bateu Bet (?afp=CODIGO) a
 * extração devolvia null e o link nascia com placeholder — o sync gravava o
 * dado bruto sob o código real e nunca encontrava o link, deixando o afiliado
 * sem CPA.
 *
 * O campaignId é a chave (campaignId, bettingHouse) com índice único parcial
 * sobre linhas ativas, então o script recusa qualquer destino já ocupado.
 *
 * Uso:
 *   node scripts/fix-bateubet-link-campaign-ids.mjs           # dry-run
 *   node scripts/fix-bateubet-link-campaign-ids.mjs --apply   # aplica
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const HOUSE = 'bateubet';

// email do afiliado → campaignId real (valor de ?afp= no link de divulgação)
const MAPPING = {
  'tonnyusher40@gmail.com': 'Tonny-aviator',
  'ivanlima-01@hotmail.com': 'Ivan-Dados',
};

const envPath = path.resolve(import.meta.dirname, '../.env');
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split('\n')
    .filter((l) => l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }),
);
if (!env.DATABASE_URL) throw new Error('faltando DATABASE_URL no .env');

const c = new pg.Client({ connectionString: env.DATABASE_URL });
await c.connect();
try {
  console.log(`\n=== Corrige campaignId dos links ${HOUSE} (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===\n`);

  const planned = [];
  for (const [email, campaignId] of Object.entries(MAPPING)) {
    const { rows } = await c.query(
      `SELECT l.id, l."campaignId", u.email
         FROM affiliate_links l
         JOIN users u ON u.id = l."userId"
        WHERE l."bettingHouse" = $1 AND u.email = $2 AND l."deletedAt" IS NULL`,
      [HOUSE, email],
    );
    if (rows.length === 0) {
      console.log(`SKIP  ${email}: nenhum link ativo em ${HOUSE}`);
      continue;
    }
    if (rows.length > 1) {
      console.log(`SKIP  ${email}: ${rows.length} links ativos — resolver à mão`);
      continue;
    }
    const link = rows[0];
    if (link.campaignId === campaignId) {
      console.log(`OK    ${email}: já está como "${campaignId}"`);
      continue;
    }
    const taken = await c.query(
      `SELECT u.email FROM affiliate_links l
         JOIN users u ON u.id = l."userId"
        WHERE l."bettingHouse" = $1 AND l."campaignId" = $2
          AND l."deletedAt" IS NULL AND l.id <> $3`,
      [HOUSE, campaignId, link.id],
    );
    if (taken.rows.length > 0) {
      console.log(`ERRO  ${email}: "${campaignId}" já pertence a ${taken.rows[0].email}`);
      continue;
    }
    console.log(`MUDA  ${email}: "${link.campaignId}" → "${campaignId}"`);
    planned.push({ id: link.id, campaignId, email });
  }

  if (planned.length === 0) {
    console.log('\nNada a fazer.\n');
    process.exit(0);
  }
  if (!APPLY) {
    console.log(`\nDRY-RUN — ${planned.length} link(s) seriam alterados. Rode com --apply.\n`);
    process.exit(0);
  }

  await c.query('BEGIN');
  try {
    for (const p of planned) {
      await c.query(
        'UPDATE affiliate_links SET "campaignId" = $1, "updatedAt" = now() WHERE id = $2',
        [p.campaignId, p.id],
      );
    }
    await c.query('COMMIT');
    console.log(`\n✅ ${planned.length} link(s) corrigidos.\n`);
  } catch (err) {
    await c.query('ROLLBACK');
    throw err;
  }
} catch (err) {
  console.error('ERRO:', err.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
