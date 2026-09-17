// READ-ONLY: mapeia cada campaignId (tabela MJM) -> AffiliateLink -> user/casa,
// mostra email, casa, fraude atual e a fraude desejada. Detecta colisões
// (mesmo user+casa vindo de >1 campanha). NÃO grava nada.
import pg from 'pg';

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
const total = Object.values(DESIRED).reduce((a, b) => a + b, 0);
console.log(`Campanhas: ${ids.length} | soma fraudes: ${total}\n`);

const rows = await c.query(
  `SELECT al."campaignId", al."bettingHouse", al."userId", al."deletedAt",
          u.email, u.name, u."isExternal",
          fc.count AS fraude_atual
     FROM affiliate_links al
     JOIN users u ON u.id = al."userId"
     LEFT JOIN fraud_counts fc ON fc."userId" = al."userId" AND fc."bettingHouse" = al."bettingHouse"
    WHERE al."campaignId" = ANY($1)`,
  [ids],
);

const byCampaign = new Map();
for (const r of rows.rows) {
  if (r.deletedAt) continue; // ignora links soft-deleted
  const arr = byCampaign.get(r.campaignId) ?? [];
  arr.push(r);
  byCampaign.set(r.campaignId, arr);
}

const notFound = [];
const multi = [];
const userHouse = new Map(); // userId|house -> [{campaignId, desired}]
console.log('campaignId          casa            fraudeAtual  desejada  email');
for (const id of ids) {
  const matches = byCampaign.get(id) ?? [];
  if (matches.length === 0) { notFound.push(id); continue; }
  if (matches.length > 1) multi.push({ id, n: matches.length });
  const m = matches[0];
  const key = `${m.userId}|${m.bettingHouse}`;
  const list = userHouse.get(key) ?? [];
  list.push({ id, desired: DESIRED[id], email: m.email });
  userHouse.set(key, list);
  console.log(
    `${id.padEnd(18)} ${String(m.bettingHouse).padEnd(15)} ${String(m.fraude_atual ?? 0).padEnd(11)} ${String(DESIRED[id]).padEnd(9)} ${m.email}${m.isExternal ? ' [EXTERNAL]' : ''}`,
  );
}

console.log('\n--- CAMPANHAS NÃO ENCONTRADAS ---');
console.log(notFound.length ? notFound.join(', ') : '(nenhuma)');

console.log('\n--- campaignId com >1 AffiliateLink ativo (ambíguo) ---');
console.log(multi.length ? JSON.stringify(multi) : '(nenhum)');

console.log('\n--- COLISÕES (mesmo user+casa em >1 campanha) ---');
let collide = 0;
for (const [key, list] of userHouse) {
  if (list.length > 1) {
    collide++;
    console.log(`${key}: ${list.map((x) => `${x.id}=${x.desired}`).join(', ')} (email ${list[0].email})`);
  }
}
if (!collide) console.log('(nenhuma — cada user+casa vem de 1 campanha)');

console.log('\n--- CASAS ENVOLVIDAS ---');
console.log([...new Set(rows.rows.filter((r) => !r.deletedAt).map((r) => r.bettingHouse))].join(', '));

await c.end();
