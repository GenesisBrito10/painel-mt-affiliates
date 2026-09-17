// Cadastra as fraudes da tabela MJM (casa superbet). Mapeia campaignId ->
// AffiliateLink -> userId e faz UPSERT em fraud_counts (count = SOMA das
// campanhas do mesmo user+casa). Idempotente por (userId,bettingHouse).
// DRY-RUN por padrão; grava só com --apply.
import pg from 'pg';
import { randomUUID } from 'node:crypto';

const APPLY = process.argv.includes('--apply');

const DESIRED = {
  '5602-MJM232': 22, '5602-MJM616': 20, '32666-MJM375': 17, '5602-MJM195': 15,
  '5602-MJM547': 14, '32666-MJM129': 13, '5602-MJM634': 11, '5602-MJM502': 9,
  '5602-MJM613': 9, '5602-MJM387': 8, '5602-MJM412': 7, '5602-MJM336': 6,
  '5602-MJM608': 5, '5602-MJM833': 5, '5602-MJM09': 4, '5602-MJM16': 4,
  '5602-MJM463': 3, '5602-MJM763': 3, '32666-MJM267': 3, '5602-MJM429': 2,
  '5602-MJM501': 2, '5602-MJM99': 2, '5602-MJM145': 1, '5602-MJM522': 1,
  '5602-MJM558': 1, '5602-MJM240': 1, '32666-MJM326': 1, '5602-MJM311': 1,
  '5602-MJM511': 1, '5602-MJM661': 1, '5602-MJM800': 1, '5602-MJM410': 1,
};

const c = new pg.Client({ connectionString: process.env.DBURL });
await c.connect();

const ids = Object.keys(DESIRED);
const rows = await c.query(
  `SELECT al."campaignId", al."bettingHouse", al."userId", al."deletedAt", u.email
     FROM affiliate_links al
     JOIN users u ON u.id = al."userId"
    WHERE al."campaignId" = ANY($1)`,
  [ids],
);

// campaignId -> {userId, house, email} (ignora soft-deleted)
const byId = new Map();
for (const r of rows.rows) {
  if (r.deletedAt) continue;
  if (!byId.has(r.campaignId)) byId.set(r.campaignId, r);
}

// Agrega por (userId|house): soma as fraudes das campanhas daquele user.
const agg = new Map(); // key -> {userId, house, email, count, campaigns[] }
const missing = [];
for (const id of ids) {
  const m = byId.get(id);
  if (!m) { missing.push(id); continue; }
  const key = `${m.userId}|${m.bettingHouse}`;
  const cur = agg.get(key) ?? { userId: m.userId, house: m.bettingHouse, email: m.email, count: 0, campaigns: [] };
  cur.count += DESIRED[id];
  cur.campaigns.push(`${id}=${DESIRED[id]}`);
  agg.set(key, cur);
}

if (missing.length) {
  console.log('ABORTA — campanhas não encontradas:', missing.join(', '));
  await c.end();
  process.exit(1);
}

const targets = [...agg.values()];
const total = targets.reduce((a, t) => a + t.count, 0);
console.log(`Usuários (user+casa): ${targets.length} | soma fraudes: ${total}\n`);

for (const t of targets) {
  const note = t.campaigns.length > 1 ? `  [soma ${t.campaigns.join(' + ')}]` : '';
  console.log(`${String(t.count).padStart(3)}  ${t.house.padEnd(10)} ${t.email}${note}`);
  if (APPLY) {
    await c.query(
      `INSERT INTO fraud_counts (id, "userId", "bettingHouse", count, "updatedAt")
       VALUES ($1,$2,$3,$4,now())
       ON CONFLICT ("userId","bettingHouse")
       DO UPDATE SET count = EXCLUDED.count, "updatedAt" = now()`,
      [randomUUID(), t.userId, t.house, t.count],
    );
  }
}

console.log('\nEMAILS:');
console.log(targets.map((t) => t.email).join('\n'));

if (!APPLY) console.log('\nDRY-RUN — rode com --apply para gravar.');
else console.log('\nOK — fraudes gravadas.');

await c.end();
