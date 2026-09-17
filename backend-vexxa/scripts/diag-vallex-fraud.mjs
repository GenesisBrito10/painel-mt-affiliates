// READ-ONLY: mapeia cada campaignId (tabela VALLEX) -> AffiliateLink -> user/casa,
// mostra email, casa, fraude atual, saque(s) PENDENTE(s). Detecta colisões e
// não-encontrados. NÃO grava nada.
import pg from 'pg';

const DESIRED = {
  '5602-VALLEXBR982': 27, '32666-VALLEXBR53': 19, '5602-VALLEXBR27': 17,
  '32666-VALLEXBR224': 15, '5602-VALLEXBR299': 13, '5602-VALLEXBR875': 13,
  '5602-VALLEXBR757': 11, '5602-VALLEXBR142': 10, '5602-VALLEXBR586': 9,
  '5602-VALLEXBR351': 7, '32666-VALLEXBR55': 7, '5602-VALLEXBR209': 5,
  '5602-VALLEXBR910': 4, '32666-VALLEXBR37': 4, '5602-VALLEXBR558': 4,
  '32666-VALLEXBR62': 3, '5602-VALLEXBR20': 3, '5602-VALLEXBR159': 2,
  '5602-VALLEXBR170': 2, '5602-VALLEXBR878': 2, '5602-VALLEXBR698': 2,
  '32666-VALLEXBR13': 2, '32666-VALLEXBR533': 1, '5602-VALLEXBR291': 1,
  '5602-VALLEXBR368': 1, '5602-VALLEXBR510': 1, '5602-VALLEXBR806': 1,
  '32666-VALLEXBR122': 1, '32666-VALLEXBR388': 1, '5602-VALLEXBR29': 1,
  '5602-VALLEXBR650': 1, '32666-VALLEXBR65': 1, '5602-VALLEXBR789': 1,
  '32666-VALLEXBR112': 1, '32666-VALLEXBR31': 1,
};

const c = new pg.Client({ connectionString: process.env.DBURL });
await c.connect();

const ids = Object.keys(DESIRED);
const total = Object.values(DESIRED).reduce((a, b) => a + b, 0);
console.log(`Campanhas: ${ids.length} | soma fraudes: ${total}\n`);

const rows = await c.query(
  `SELECT al."campaignId", al."bettingHouse", al."userId", al."deletedAt",
          al.cpa, u.email, u."isExternal",
          fc.count AS fraude_atual
     FROM affiliate_links al
     JOIN users u ON u.id = al."userId"
     LEFT JOIN fraud_counts fc ON fc."userId" = al."userId" AND fc."bettingHouse" = al."bettingHouse"
    WHERE al."campaignId" = ANY($1)`,
  [ids],
);

const byCampaign = new Map();
for (const r of rows.rows) {
  if (r.deletedAt) continue;
  const arr = byCampaign.get(r.campaignId) ?? [];
  arr.push(r);
  byCampaign.set(r.campaignId, arr);
}

const notFound = [];
const multi = [];
const userHouse = new Map();
console.log('campaignId            casa        cpa  fraudeAtual  desejada  email');
for (const id of ids) {
  const matches = byCampaign.get(id) ?? [];
  if (matches.length === 0) { notFound.push(id); continue; }
  if (matches.length > 1) multi.push({ id, n: matches.length });
  const m = matches[0];
  const key = `${m.userId}|${m.bettingHouse}`;
  const cur = userHouse.get(key) ?? { userId: m.userId, house: m.bettingHouse, email: m.email, cpa: Number(m.cpa) || 0, count: 0, campaigns: [] };
  cur.count += DESIRED[id];
  cur.campaigns.push(id);
  userHouse.set(key, cur);
  console.log(
    `${id.padEnd(20)} ${String(m.bettingHouse).padEnd(11)} ${String(m.cpa ?? 0).padStart(4)} ${String(m.fraude_atual ?? 0).padStart(11)} ${String(DESIRED[id]).padStart(9)}  ${m.email}${m.isExternal ? ' [EXT]' : ''}`,
  );
}

console.log('\n--- NÃO ENCONTRADAS ---');
console.log(notFound.length ? notFound.join(', ') : '(nenhuma)');
console.log('\n--- campaignId ambíguo (>1 link ativo) ---');
console.log(multi.length ? JSON.stringify(multi) : '(nenhum)');

console.log('\n--- COLISÕES (mesmo user+casa em >1 campanha) ---');
let collide = 0;
for (const [, v] of userHouse) {
  if (v.campaigns.length > 1) { collide++; console.log(`${v.email} (${v.house}): ${v.campaigns.join(', ')} => soma ${v.count}`); }
}
if (!collide) console.log('(nenhuma)');

console.log('\n--- CASAS ENVOLVIDAS ---');
const houses = [...new Set([...userHouse.values()].map((v) => v.house))];
console.log(houses.join(', '));

// Saques PENDENTES dos usuários marcados
const userIds = [...new Set([...userHouse.values()].map((v) => v.userId))];
const wds = await c.query(
  `SELECT w."userId", u.email, w.id, w."bettingHouse", w."originalAmount", w.status
     FROM withdrawal_requests w JOIN users u ON u.id = w."userId"
    WHERE w."userId" = ANY($1) AND w.status = 'PENDING'
    ORDER BY u.email`,
  [userIds],
);
console.log(`\n--- SAQUES PENDENTES dos ${userIds.length} usuários marcados: ${wds.rowCount} ---`);
for (const w of wds.rows) {
  console.log(`  ${w.email}  casa=${w.bettingHouse}  R$${w.originalAmount}  id=${w.id}`);
}

await c.end();
