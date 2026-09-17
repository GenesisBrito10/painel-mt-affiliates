// Cria/atualiza as casas + deals tipo FORM: "Zona de Jogo" e "Mega Aposta".
// Deals kind=FORM abrem um formulário dinâmico (formSchema) que o afiliado
// preenche; o admin libera setando ID de afiliado + CPA/REV e notifica.
// Idempotente (upsert por slug / por (bettingHouseSlug,name)).
// DRY-RUN por padrão; grava só com --apply.
// REQUER a migration 20260707180000_deals_forms_kind_formschema aplicada
// (enum DealKind + deals.kind/formSchema).
//
// Uso:
//   DBURL="postgresql://user:pass@host:port/db" node prisma/setup-forms-deals.mjs           # dry-run
//   DBURL="postgresql://user:pass@host:port/db" node prisma/setup-forms-deals.mjs --apply    # grava
import pg from 'pg';
import { randomUUID } from 'node:crypto';

const APPLY = process.argv.includes('--apply');
const c = new pg.Client({ connectionString: process.env.DBURL });
await c.connect();

// Opções das casas — usadas no multiselect "qual casa deseja solicitar".
const HOUSE_OPTIONS = [
  { value: 'zona-de-jogo', label: 'Zona de Jogo' },
  { value: 'mega-aposta', label: 'Mega Aposta' },
];

// Gera o formSchema (campos dinâmicos) de um form-deal. `ownSlug` é a casa do
// próprio deal — vem pré-marcada no multiselect no front (campo `default`).
function buildFormSchema(ownSlug) {
  return [
    { key: 'firstName', label: 'Nome', type: 'text', required: true, prefill: 'user.firstName', readonly: true, group: 'Seus dados' },
    { key: 'lastName', label: 'Sobrenome', type: 'text', required: true, prefill: 'user.lastName', group: 'Seus dados' },
    { key: 'email', label: 'E-mail', type: 'email', required: true, prefill: 'user.email', readonly: true, group: 'Seus dados' },
    { key: 'whatsapp', label: 'WhatsApp', type: 'tel', required: true, prefill: 'user.whatsapp', group: 'Seus dados' },
    { key: 'credUsername', label: 'Nome de usuário desejado', type: 'text', required: true, group: 'Credenciais de Acesso' },
    { key: 'credPassword', label: 'Senha desejada', type: 'password', required: true, secret: true, group: 'Credenciais de Acesso' },
    { key: 'houses', label: 'Qual casa deseja solicitar', type: 'multiselect', required: true, options: HOUSE_OPTIONS, default: [ownSlug], group: 'Acordo' },
    {
      key: 'agreement',
      label: 'Qual acordo deseja operar',
      type: 'select',
      required: true,
      group: 'Acordo',
      options: [
        { value: '30_30_20', label: 'CPA 30/30 + 20% REV', cpa: 30, revshare: 20 },
        { value: '50_50_20', label: 'CPA 50/50 + 20% REV', cpa: 50, revshare: 20 },
        { value: '100_100_20', label: 'CPA 100/100 + 20% REV', cpa: 100, revshare: 20 },
      ],
    },
    {
      key: 'actAs',
      label: 'Você atua como',
      type: 'select',
      required: true,
      group: 'Perfil',
      options: [
        { value: 'afiliado', label: 'Afiliado' },
        { value: 'influenciador', label: 'Influenciador' },
        { value: 'expert', label: 'Expert' },
        { value: 'gestor_trafego', label: 'Gestor de Tráfego' },
        { value: 'outro', label: 'Outro' },
      ],
    },
    { key: 'channel', label: 'Instagram ou canal de divulgação', type: 'text', required: true, group: 'Perfil' },
    { key: 'notes', label: 'Observações adicionais', type: 'textarea', required: false, group: 'Perfil' },
  ];
}

const HOUSES = [
  { slug: 'zona-de-jogo', name: 'Zona de Jogo' },
  { slug: 'mega-aposta', name: 'Mega Aposta' },
];

async function run() {
  for (const h of HOUSES) {
    const formSchema = buildFormSchema(h.slug);
    console.log(`\n=== ${h.slug} (FORM) ===`);
    if (!APPLY) {
      console.log(`  house: name=${h.name}`);
      console.log(`  deal: kind=FORM name="${h.name}" campos=${formSchema.length}`);
      continue;
    }

    // 1) BettingHouse (upsert por slug). Sync desligado — casa de formulário.
    await c.query(
      `INSERT INTO betting_houses (id, name, slug, active, "withdrawalEnabled", "updatedAt")
       VALUES ($1,$2,$3,true,true,now())
       ON CONFLICT (slug) DO UPDATE SET
         name=EXCLUDED.name, active=true, "updatedAt"=now()`,
      [randomUUID(), h.name, h.slug],
    );

    // 2) Deal kind=FORM (idempotente por (bettingHouseSlug, name))
    const dExists = await c.query(
      'SELECT id FROM deals WHERE "bettingHouseSlug"=$1 AND name=$2',
      [h.slug, h.name],
    );
    if (dExists.rowCount === 0) {
      await c.query(
        `INSERT INTO deals (id, "bettingHouseSlug", name, kind, "formSchema", cpa, revshare, active, "updatedAt")
         VALUES ($1,$2,$3,'FORM'::"DealKind",$4::jsonb,0,0,true,now())`,
        [randomUUID(), h.slug, h.name, JSON.stringify(formSchema)],
      );
    } else {
      await c.query(
        `UPDATE deals SET kind='FORM'::"DealKind", "formSchema"=$2::jsonb, active=true, "updatedAt"=now() WHERE id=$1`,
        [dExists.rows[0].id, JSON.stringify(formSchema)],
      );
    }
    console.log(`  OK (house + deal FORM)`);
  }
  if (!APPLY) console.log('\nDRY-RUN — rode com --apply para gravar.');
}

await run();
await c.end();
