// Cria/atualiza casas + deals + house_link_rules: superbet-mensal e betfair.
// Idempotente (upsert). DRY-RUN por padrão; grava só com --apply.
// REQUER a migration 20260527150000 aplicada (coluna betting_houses.minWithdrawalAmount).
import pg from 'pg';
import { randomUUID } from 'node:crypto';

const APPLY = process.argv.includes('--apply');
const c = new pg.Client({ connectionString: process.env.DBURL });
await c.connect();

const HOUSES = [
  {
    slug: 'superbet-mensal',
    name: 'Superbet Mensal',
    withdrawalDay: 30,
    withdrawalDayEnd: 30,
    minWithdrawalAmount: 1000,
    deal: { name: 'Superbet Mensal', cpa: 220, revshare: 0 },
    rule: { autoAssignEnabled: false, defaultCpa: 220, fallbackCpa: 220, defaultRevshare: 0 },
  },
  {
    slug: 'betfair',
    name: 'Betfair',
    withdrawalDay: 30,
    withdrawalDayEnd: 30,
    minWithdrawalAmount: null, // usa mínimo global (100)
    deal: { name: 'Betfair', cpa: 0, revshare: 0 },
    rule: { autoAssignEnabled: false, defaultCpa: 0, fallbackCpa: 0, defaultRevshare: 0 },
  },
];

async function run() {
  for (const h of HOUSES) {
    console.log(`\n=== ${h.slug} ===`);
    if (!APPLY) {
      console.log(`  house: name=${h.name} withdrawalDay=${h.withdrawalDay} min=${h.minWithdrawalAmount ?? 'global'}`);
      console.log(`  deal: cpa=${h.deal.cpa} rev=${h.deal.revshare}`);
      console.log(`  rule: autoAssignEnabled=${h.rule.autoAssignEnabled} defaultCpa=${h.rule.defaultCpa}`);
      continue;
    }

    // 1) BettingHouse (upsert por slug)
    await c.query(
      `INSERT INTO betting_houses (id, name, slug, active, "withdrawalDay", "withdrawalDayEnd", "minWithdrawalAmount", "withdrawalEnabled", "updatedAt")
       VALUES ($1,$2,$3,true,$4,$5,$6,true,now())
       ON CONFLICT (slug) DO UPDATE SET
         name=EXCLUDED.name, active=true, "withdrawalDay"=EXCLUDED."withdrawalDay",
         "withdrawalDayEnd"=EXCLUDED."withdrawalDayEnd", "minWithdrawalAmount"=EXCLUDED."minWithdrawalAmount",
         "withdrawalEnabled"=true, "updatedAt"=now()`,
      [randomUUID(), h.name, h.slug, h.withdrawalDay, h.withdrawalDayEnd, h.minWithdrawalAmount],
    );

    // 2) Deal (idempotente por (bettingHouseSlug, name))
    const dExists = await c.query(
      'SELECT id FROM deals WHERE "bettingHouseSlug"=$1 AND name=$2',
      [h.slug, h.deal.name],
    );
    if (dExists.rowCount === 0) {
      await c.query(
        `INSERT INTO deals (id, "bettingHouseSlug", name, cpa, revshare, active, "updatedAt")
         VALUES ($1,$2,$3,$4,$5,true,now())`,
        [randomUUID(), h.slug, h.deal.name, h.deal.cpa, h.deal.revshare],
      );
    } else {
      await c.query(
        'UPDATE deals SET cpa=$2, revshare=$3, active=true, "updatedAt"=now() WHERE id=$1',
        [dExists.rows[0].id, h.deal.cpa, h.deal.revshare],
      );
    }

    // 3) HouseLinkRule (upsert por houseSlug; autoAssign OFF)
    await c.query(
      `INSERT INTO house_link_rules
        (id, "houseSlug", "requestEnabled", "autoAssignEnabled", "ruleType", "defaultCpa", "fallbackCpa", "defaultRevshare", "updatedAt")
       VALUES ($1,$2,true,$3,'INVITER_DISCOUNT'::"LinkRuleType",$4,$5,$6,now())
       ON CONFLICT ("houseSlug") DO UPDATE SET
         "requestEnabled"=true, "autoAssignEnabled"=EXCLUDED."autoAssignEnabled",
         "defaultCpa"=EXCLUDED."defaultCpa", "fallbackCpa"=EXCLUDED."fallbackCpa",
         "defaultRevshare"=EXCLUDED."defaultRevshare", "updatedAt"=now()`,
      [randomUUID(), h.slug, h.rule.autoAssignEnabled, h.rule.defaultCpa, h.rule.fallbackCpa, h.rule.defaultRevshare],
    );
    console.log(`  OK (house + deal + rule)`);
  }
  if (!APPLY) console.log('\nDRY-RUN — rode com --apply para gravar.');
}

await run();
await c.end();
