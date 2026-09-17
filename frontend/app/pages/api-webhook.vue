<script setup lang="ts">
definePageMeta({ layout: 'default' })

type EnvTokenStatus = {
  active: boolean
  token: null | {
    id: string
    hint: string
    createdAt: string
    lastUsedAt: string | null
  }
}

type TokenStatus = {
  live: EnvTokenStatus
  test: EnvTokenStatus
}

type ApiEnv = 'live' | 'test'

type AffiliateOption = {
  id: string
  name: string
  email: string
  level: number
  isOwner: boolean
}

const apiBase = useApiBase()
const { user, authHeaders } = useAuth()
const toast = useToast()

const canAccess = computed(() =>
  user.value?.role === 'admin' || !!user.value?.apiAccessEnabled,
)
const { houses, fetchHouses } = useHouseFilter()

const loading = ref(false)
const generating = ref(false)
const revoking = ref(false)
const testing = ref(false)
const tokenStatus = ref<TokenStatus | null>(null)
const revealedToken = ref('')
const revealedTokens = reactive<Record<ApiEnv, string>>({ live: '', test: '' })
const generatingEnv = ref<ApiEnv | null>(null)
const revokingEnv = ref<ApiEnv | null>(null)
const resettingSandbox = ref(false)
const playgroundToken = ref('')
const playgroundResponse = ref<unknown>(null)
const playgroundError = ref('')
const affiliates = ref<AffiliateOption[]>([])

const filters = reactive({
  startDate: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
  endDate: new Date().toISOString().slice(0, 10),
  houseSlug: '__all__',
  affiliateId: '__all__',
})

const houseOptions = computed(() => [
  { label: 'Todas as casas', value: '__all__' },
  ...houses.value.map(house => ({ label: house.name, value: house.slug }))
])

const affiliateOptions = computed(() => [
  { label: 'Eu + minha rede', value: '__all__' },
  { label: 'Somente eu', value: 'me' },
  ...affiliates.value
    .filter(affiliate => !affiliate.isOwner)
    .map(affiliate => ({
      label: `${affiliate.name} (${affiliate.email})`,
      value: affiliate.id
    }))
])

const queryString = computed(() => {
  const params = new URLSearchParams()
  params.set('startDate', filters.startDate)
  params.set('endDate', filters.endDate)
  if (filters.houseSlug !== '__all__') params.set('houseSlug', filters.houseSlug)
  if (filters.affiliateId !== '__all__') params.set('affiliateId', filters.affiliateId)
  return params.toString()
})

const endpointUrl = computed(() => `https://api.vallexgroup.com.br/api/v1/affiliate-api/metrics?${queryString.value}`)
const playgroundUrl = computed(() => `${apiBase}/v1/affiliate-api/metrics?${queryString.value}`)

const curlExample = computed(() => `curl "${endpointUrl.value}" \\
  -H "Authorization: Bearer SEU_TOKEN"`)

const jsExample = computed(() => `const res = await fetch(
  "${endpointUrl.value}",
  { headers: { Authorization: "Bearer SEU_TOKEN" } }
)

if (!res.ok) throw new Error(\`API error: \${res.status}\`)

const data = await res.json()
console.log(data.summary)`)

const pythonExample = computed(() => `import requests

resp = requests.get(
    "${endpointUrl.value}",
    headers={"Authorization": "Bearer SEU_TOKEN"},
    timeout=30,
)
resp.raise_for_status()

data = resp.json()
print(data["summary"])`)

const postmanCollection = computed(() => {
  const query: Array<{ key: string, value: string }> = [
    { key: 'startDate', value: filters.startDate },
    { key: 'endDate', value: filters.endDate },
  ]
  if (filters.houseSlug !== '__all__') query.push({ key: 'houseSlug', value: filters.houseSlug })
  if (filters.affiliateId !== '__all__') query.push({ key: 'affiliateId', value: filters.affiliateId })

  return {
    info: {
      name: 'Vallex Group — Affiliate API',
      description: 'Consulta de métricas da sua conta e da sua rede de afiliados. Configure a variável {{token}} com o token gerado no painel.',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    variable: [
      { key: 'baseUrl', value: 'https://api.vallexgroup.com.br/api/v1' },
      { key: 'token', value: 'SEU_TOKEN' },
    ],
    item: [
      {
        name: 'Métricas (eu + rede)',
        request: {
          method: 'GET',
          header: [{ key: 'Authorization', value: 'Bearer {{token}}' }],
          url: {
            raw: `{{baseUrl}}/affiliate-api/metrics?${query.map(q => `${q.key}=${q.value}`).join('&')}`,
            host: ['{{baseUrl}}'],
            path: ['affiliate-api', 'metrics'],
            query,
          },
        },
      },
    ],
  }
})

const postmanExample = computed(() => JSON.stringify(postmanCollection.value, null, 2))

const langTabs = [
  { id: 'curl', label: 'cURL' },
  { id: 'js', label: 'JavaScript' },
  { id: 'python', label: 'Python' },
  { id: 'postman', label: 'Postman' },
] as const

const activeLang = ref<(typeof langTabs)[number]['id']>('curl')

const activeCodeExample = computed(() => {
  if (activeLang.value === 'js') return jsExample.value
  if (activeLang.value === 'python') return pythonExample.value
  if (activeLang.value === 'postman') return postmanExample.value
  return curlExample.value
})

const queryParams = [
  { name: 'startDate', type: 'string · YYYY-MM-DD', required: false, desc: 'Início do período. Padrão: 1º dia do mês atual.' },
  { name: 'endDate', type: 'string · YYYY-MM-DD', required: false, desc: 'Fim do período. Padrão: hoje. Intervalo máximo de 90 dias.' },
  { name: 'houseSlug', type: 'string', required: false, desc: 'Filtra por uma casa (ex.: betano). Padrão: todas as casas.' },
  { name: 'affiliateId', type: 'string', required: false, desc: '"me" para somente você, ou o ID de um afiliado da sua rede. Padrão: você + toda a rede.' },
]

const responseFields = [
  { name: 'clicks', type: 'number', desc: 'Cliques no link de afiliado.' },
  { name: 'registrations', type: 'number', desc: 'Cadastros realizados.' },
  { name: 'ftds', type: 'number', desc: 'First Time Deposits (primeiros depósitos).' },
  { name: 'deposits', type: 'number', desc: 'Depósitos qualificados (qFTD).' },
  { name: 'depositAmount', type: 'number · R$', desc: 'Valor total depositado.' },
  { name: 'revShare', type: 'number · R$', desc: 'Receita de RevShare gerada.' },
  { name: 'qualifiedCpa', type: 'number', desc: 'CPAs qualificados (contagem).' },
  { name: 'cpaAmount', type: 'number · R$', desc: 'Valor de CPA.' },
  { name: 'totalCommission', type: 'number · R$', desc: 'Comissão total (CPA + RevShare).' },
]

const errorCodes = [
  { code: '400', label: 'Bad Request', desc: 'Data fora do formato YYYY-MM-DD, startDate maior que endDate, ou intervalo maior que 90 dias.' },
  { code: '401', label: 'Unauthorized', desc: 'Token ausente, inválido ou revogado.' },
  { code: '403', label: 'Forbidden', desc: 'Token não pertence a um afiliado, ou affiliateId está fora da sua rede.' },
]

// ── Webhooks documentation ────────────────────────────────────────────────
const linkRequestBodyExample = `{
  "externalUserId": "id-do-usuario-no-seu-painel",
  "userName": "Nome real do usuário",
  "userEmail": "email-real@dominio.com",
  "bettingHouseSlug": "betano"
}`

// Um exemplo de payload por evento. Todos compartilham o envelope
// { event, timestamp, origin, ... }.
const webhookPayloads = [
  {
    name: 'link_request.created',
    desc: 'Um pedido de link foi criado (status PENDING).',
    json: `{
  "event": "link_request.created",
  "timestamp": "2026-06-15T12:00:00.000Z",
  "origin": "CREATED",
  "linkRequest": {
    "id": "a1b2c3d4-…",
    "status": "PENDING",
    "bettingHouseSlug": "betano",
    "message": "",
    "adminNote": null,
    "links": [],
    "dealId": "deal-uuid",
    "fulfilledAt": null,
    "fulfilledByName": null,
    "createdAt": "2026-06-15T12:00:00.000Z",
    "resolvedCpa": 200,
    "resolvedRevshare": 0,
    "resolvedRuleApplied": "DEFAULT",
    "inviterId": null,
    "inviterCpa": null,
    "requiredHouseSlugs": [],
    "missingHouseSlugs": [],
    "blockedReason": null
  },
  "user": { "id": "u-…", "name": "Cliente do Parceiro", "email": "cliente@parceiro.com", "referredById": "owner-…" },
  "deal": { "id": "deal-uuid", "name": "Betano CPA", "cpa": 200, "revshare": 0 },
  "affiliateLink": null
}`,
  },
  {
    name: 'link_request.approved',
    desc: 'Um pedido de link foi aprovado/atribuído (FULFILLED).',
    json: `{
  "event": "link_request.approved",
  "timestamp": "2026-06-15T12:05:00.000Z",
  "origin": "AUTO_ASSIGN",
  "linkRequest": {
    "id": "a1b2c3d4-…",
    "status": "FULFILLED",
    "bettingHouseSlug": "betano",
    "links": [{ "label": "Link principal", "url": "https://betano.com/aff/2001101-BTJ887" }],
    "dealId": "deal-uuid",
    "fulfilledAt": "2026-06-15T12:05:00.000Z",
    "fulfilledByName": "Sistema (pool)",
    "createdAt": "2026-06-15T12:00:00.000Z",
    "resolvedCpa": 200,
    "resolvedRevshare": 0
  },
  "user": { "id": "u-…", "name": "Cliente do Parceiro", "email": "cliente@parceiro.com", "referredById": "owner-…" },
  "deal": { "id": "deal-uuid", "name": "Betano CPA", "cpa": 200, "revshare": 0 },
  "affiliateLink": {
    "bettingHouse": "betano",
    "campaignId": "2001101-BTJ887",
    "userLink": "https://betano.com/aff/2001101-BTJ887",
    "cpa": 200,
    "revshare": 0
  }
}`,
  },
  {
    name: 'link_request.rejected',
    desc: 'Um pedido de link foi rejeitado/bloqueado.',
    json: `{
  "event": "link_request.rejected",
  "timestamp": "2026-06-15T12:05:00.000Z",
  "origin": "RULE_BLOCKED",
  "linkRequest": {
    "id": "a1b2c3d4-…",
    "status": "REJECTED",
    "bettingHouseSlug": "betano",
    "adminNote": "Reprovado pela regra da casa",
    "blockedReason": "RULE_BLOCKED",
    "requiredHouseSlugs": ["superbet"],
    "missingHouseSlugs": ["superbet"],
    "createdAt": "2026-06-15T12:00:00.000Z"
  },
  "user": { "id": "u-…", "name": "Cliente do Parceiro", "email": "cliente@parceiro.com", "referredById": "owner-…" },
  "deal": { "id": "deal-uuid", "name": "Betano CPA", "cpa": 200, "revshare": 0 },
  "affiliateLink": null
}`,
  },
  {
    name: 'affiliate_data.synced',
    desc: 'Disparado após cada ciclo do cron gravar os dados de uma casa.',
    json: `{
  "event": "affiliate_data.synced",
  "timestamp": "2026-06-15T12:00:00.000Z",
  "origin": "SYNC",
  "houseSlug": "betano",
  "dates": ["2026-06-14", "2026-06-15"],
  "rowsUpserted": 42,
  "totals": { "inserted": 10, "updated": 32, "records": 42 },
  "triggeredBy": "cron-recent"
}`,
  },
  {
    name: 'deal.updated',
    desc: 'Um deal (CPA/revshare) foi alterado.',
    json: `{
  "event": "deal.updated",
  "timestamp": "2026-06-15T12:00:00.000Z",
  "origin": "DEAL",
  "id": "deal-uuid",
  "name": "Betano CPA",
  "bettingHouseSlug": "betano",
  "cpa": 220,
  "revshare": 0,
  "updatedAt": "2026-06-15T12:00:00.000Z"
}`,
  },
  {
    name: 'house.updated',
    desc: 'Uma casa de aposta foi alterada (ativada/desativada/editada).',
    json: `{
  "event": "house.updated",
  "timestamp": "2026-06-15T12:00:00.000Z",
  "origin": "HOUSE",
  "slug": "betano",
  "name": "Betano",
  "active": true,
  "updatedAt": "2026-06-15T12:00:00.000Z"
}`,
  },
]

const selectedWebhookEvent = ref(webhookPayloads[0]!.name)
const selectedWebhookPayload = computed(
  () => webhookPayloads.find(p => p.name === selectedWebhookEvent.value) ?? webhookPayloads[0]!,
)

const verifyNode = `import crypto from 'node:crypto'

// Express handler — req.rawBody é o corpo BRUTO (string), não o JSON parseado.
app.post('/webhooks/vallex', (req, res) => {
  const signature = req.header('x-vallex-signature') || ''
  const timestamp = req.header('x-vallex-timestamp') || ''
  const expected = 'sha256=' + crypto
    .createHmac('sha256', process.env.VALLEX_WEBHOOK_SECRET)
    .update(timestamp + '.' + req.rawBody)
    .digest('hex')

  const ok = signature.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  if (!ok) return res.sendStatus(401)

  // IMPORTANTE: responda 200 rápido. Processe de forma assíncrona.
  res.sendStatus(200)
})`

const verifyPython = `import hmac, hashlib, os

def verify(headers, raw_body: bytes) -> bool:
    signature = headers.get('x-vallex-signature', '')
    timestamp = headers.get('x-vallex-timestamp', '')
    base = timestamp.encode() + b'.' + raw_body
    expected = 'sha256=' + hmac.new(
        os.environ['VALLEX_WEBHOOK_SECRET'].encode(), base, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(signature, expected)

# No seu handler: valide, então retorne HTTP 200 imediatamente.`

// Documento auto-contido para o parceiro colar na IA dele.
// Usa ~~~ como cerca de código (sem crases) para não quebrar este template literal.
const llmDoc = `# Integração Vallex Group — API de Afiliados + Webhooks (spec para IA)

Você é um(a) engenheiro(a) de software. Sua tarefa: implementar a integração com a
plataforma da Vallex Group a partir desta especificação. Entregue: (1) um cliente da
API REST e (2) um receptor de webhooks que valida assinatura e responde HTTP 200.
Pergunte só se algo for ambíguo; caso contrário, gere o código completo na linguagem
que o usuário pedir (padrão: Node.js/Express).

== VISÃO GERAL ==
- A Vallex expõe uma API REST para você consultar suas métricas e solicitar links.
- A Vallex também envia WEBHOOKS (HTTP POST) para uma URL sua quando eventos acontecem.
- Os usuários do SEU painel não existem no sistema da Vallex. Ao pedir um link, você
  envia o id do usuário no seu painel (externalUserId) e a Vallex cria um usuário
  "externo" vinculado à sua conta.

== AUTENTICAÇÃO (API REST) ==
- Gere um token no painel Vallex (página "API"). Formato: vex_live_xxxxxxxx.
- Envie em todas as chamadas REST o header:
  Authorization: Bearer SEU_TOKEN
- O token só enxerga seus dados e a sua rede de afiliados.

== SANDBOX (modo de teste) ==
- Gere um token de TESTE separado no painel. Formato: vex_test_xxxxxxxx.
- Use o token vex_test_ exatamente nas MESMAS URLs — o ambiente é definido pelo token.
- Tudo no sandbox é ISOLADO: nada persiste de verdade, não afeta saldos/dados reais.
  Os usuários de teste já vêm com saldo semeado (~R$1000 por casa) para você testar saques.
- Reset: DELETE /affiliate-api/sandbox (com o token vex_test_) apaga todos os seus dados de teste.
- Para webhooks de teste, use "Enviar teste" no painel (escolha o evento) — ele faz um POST
  assinado de exemplo para a sua URL, sem registrar entrega real.

== BASE URL ==
- https://api.vallexgroup.com.br/api/v1

== ENDPOINT 1 — MÉTRICAS ==
GET /affiliate-api/metrics
Query params (todos opcionais):
- startDate, endDate: formato YYYY-MM-DD (padrão: mês atual; intervalo máx 90 dias)
- houseSlug: betano | betnacional | esportivabet | hiperbet | superbet
- affiliateId: id de um afiliado da sua rede, ou "me" para apenas você
- groupBy: summary | day | house | affiliate
Exemplo:
~~~
curl "https://api.vallexgroup.com.br/api/v1/affiliate-api/metrics?startDate=2026-06-01&endDate=2026-06-15" \\
  -H "Authorization: Bearer SEU_TOKEN"
~~~
Resposta (200, application/json) — formato:
~~~
{
  "filters": { "startDate": "2026-06-01", "endDate": "2026-06-15", "houseSlug": null, "affiliateId": null },
  "scope": { "ownerUserId": "...", "includedAffiliateIds": ["...","..."] },
  "summary": { "clicks": 0, "registrations": 0, "ftds": 0, "deposits": 0, "depositAmount": 0, "revShare": 0, "qualifiedCpa": 0, "cpaAmount": 0, "totalCommission": 0 },
  "records": [ { "date": "2026-06-10", "houseSlug": "betano", "houseName": "Betano", "affiliateId": "...", "affiliateName": "...", "affiliateEmail": "...", "level": 0, "clicks": 0, "registrations": 0, "ftds": 1, "deposits": 1, "depositAmount": 250, "revShare": 0, "qualifiedCpa": 1, "cpaAmount": 250, "totalCommission": 250 } ],
  "byHouse": [ { "houseSlug": "betano", "houseName": "Betano", "...campos de métrica..." } ],
  "byDay": [ { "date": "2026-06-10", "...campos de métrica..." } ],
  "byAffiliate": [ { "affiliateId": "...", "affiliateName": "...", "affiliateEmail": "...", "level": 0, "...campos de métrica..." } ]
}
~~~
Campos de métrica: clicks, registrations, ftds, deposits, depositAmount(R$), revShare(R$),
qualifiedCpa, cpaAmount(R$), totalCommission(R$).

== ENDPOINT 2 — SOLICITAR LINK ==
POST /affiliate-api/link-requests
Headers: Authorization: Bearer SEU_TOKEN ; Content-Type: application/json
Body:
~~~
{
  "externalUserId": "id-do-usuario-no-SEU-painel",   // OBRIGATÓRIO
  "userName": "Nome real do usuário",                  // OBRIGATÓRIO
  "userEmail": "email-real@dominio.com",               // OBRIGATÓRIO (e-mail real do usuário)
  "bettingHouseSlug": "betano",                        // OBRIGATÓRIO — betano|betnacional|esportivabet|hiperbet|superbet
  "dealId": "uuid-do-deal",                            // opcional (refina por deal)
  "message": "texto opcional"
}
~~~
Comportamento: repetir com o mesmo externalUserId reaproveita o mesmo usuário externo
(idempotente por usuário). userName, userEmail e bettingHouseSlug são OBRIGATÓRIOS — envie
sempre o e-mail real do usuário (usado para busca/métricas). O link real é atribuído de forma
assíncrona — acompanhe pelo webhook link_request.approved.

== ENDPOINT 3 — CONSULTAR USUÁRIO + SALDO ==
GET /affiliate-api/users/{externalUserId}
Headers: Authorization: Bearer SEU_TOKEN
Query params (opcionais):
- bettingHouse: limita o saldo a uma casa (ex.: betano). Sem ele, retorna todas.
Exemplo:
~~~
curl "https://api.vallexgroup.com.br/api/v1/affiliate-api/users/id-do-usuario-no-SEU-painel" \\
  -H "Authorization: Bearer SEU_TOKEN"
~~~
Resposta (200) — exemplo:
~~~
{
  "user": {
    "externalUserId": "panel-42",
    "name": "João da Silva",
    "email": "cliente@exemplo.com",
    "status": "APPROVED",
    "createdAt": "2026-06-01T12:00:00.000Z"
  },
  "balance": {
    "balance": 250,
    "withdrawableTotal": 250,
    "minWithdrawalAmount": 100,
    "withdrawalFee": 0,
    "withdrawalFeeRate": 0.06,
    "bonusAvailable": 0,
    "perHouse": [ { "house": "betano", "total": 250 }, { "house": "superbet", "total": 0 } ],
    "depositInfo": { "belowMinimum": false }
  }
}
~~~
(balance traz o BalanceResponseDto completo; acima os campos principais.)
Use este endpoint para mostrar o saldo do usuário e decidir se solicita o saque.

== ENDPOINT 4 — SOLICITAR SAQUE ==
POST /affiliate-api/withdrawals
Headers: Authorization: Bearer SEU_TOKEN ; Content-Type: application/json
Body:
~~~
{
  "externalUserId": "id-do-usuario-no-SEU-painel",   // OBRIGATÓRIO
  "bettingHouse": "betano",                            // OBRIGATÓRIO (casa; "bonus" NÃO é suportado)
  "requestNote": "texto opcional"
}
~~~
Comportamento:
- Saca o SALDO TOTAL disponível da casa (não existe campo amount).
- Sem taxa (withdrawalFee = 0; amount = originalAmount).
- LIMITE: 1 saque por DIA por casa por usuário. Se já houver um saque criado HOJE naquela casa
  (PENDING/PROCESSING/COMPLETED), retorna 429. No dia seguinte libera normalmente.
- Cria com status PENDING e desconta o saldo (reserva). REJECTED libera o saldo de volta.
Resposta (200/201) — exemplo (o saldo da casa fica reservado: betano -> 0):
~~~
{
  "withdrawal": {
    "id": "a1b2c3d4-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
    "amount": 250,
    "originalAmount": 250,
    "withdrawalFee": 0,
    "bettingHouse": "betano",
    "requestNote": "Saque solicitado pelo painel",
    "status": "PENDING",
    "createdAt": "2026-06-22T18:30:00.000Z"
  },
  "balance": {
    "balance": 0,
    "withdrawableTotal": 0,
    "perHouse": [ { "house": "betano", "total": 0 }, { "house": "superbet", "total": 0 } ]
  }
}
~~~

== ENDPOINT 5 — HISTÓRICO DE SAQUES ==
GET /affiliate-api/withdrawals
Headers: Authorization: Bearer SEU_TOKEN
Query params (todos opcionais):
- externalUserId: filtra por um usuário do seu painel
- status: PENDING | PROCESSING | COMPLETED | REJECTED
- bettingHouse: ex. betano
- startDate, endDate: YYYY-MM-DD
- page (padrão 1), limit (padrão 20, máx 100)
Resposta (200) — exemplo:
~~~
{
  "data": [
    {
      "id": "a1b2c3d4-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
      "amount": 250, "originalAmount": 250, "withdrawalFee": 0,
      "bettingHouse": "betano", "status": "PENDING",
      "requestNote": "Saque solicitado pelo painel",
      "createdAt": "2026-06-22T18:30:00.000Z"
    }
  ],
  "total": 1, "page": 1, "limit": 20
}
~~~

== ENDPOINT 6 — DETALHE DE UM SAQUE ==
GET /affiliate-api/withdrawals/{id}
Headers: Authorization: Bearer SEU_TOKEN
Resposta (200) — exemplo (o objeto do saque):
~~~
{
  "id": "a1b2c3d4-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
  "amount": 250, "originalAmount": 250, "withdrawalFee": 0,
  "bettingHouse": "betano", "status": "PENDING",
  "requestNote": "Saque solicitado pelo painel",
  "createdAt": "2026-06-22T18:30:00.000Z"
}
~~~
404 se o saque não pertencer à sua rede.

== ENDPOINT 7 — ATUALIZAR STATUS DO SAQUE ==
PATCH /affiliate-api/withdrawals/{id}/status
Headers: Authorization: Bearer SEU_TOKEN ; Content-Type: application/json
Body:
~~~
{ "status": "completed", "note": "texto opcional" }   // status: processing | completed | rejected
~~~
Matriz de transições permitidas:
- PENDING    -> PROCESSING | COMPLETED | REJECTED
- PROCESSING -> COMPLETED | REJECTED
- COMPLETED  -> (terminal)
- REJECTED   -> (terminal)
Semântica de saldo (saldo é virtual):
- COMPLETED mantém o valor reservado (ou seja, DESCONTA o saldo do usuário).
- REJECTED libera o valor de volta ao saldo.
- Envie "completed" quando você (parceiro) já tiver pago o usuário do seu lado.
Transição fora da matriz retorna 400.
Resposta (200) — exemplo (o saque atualizado):
~~~
{
  "id": "a1b2c3d4-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
  "amount": 250, "originalAmount": 250, "withdrawalFee": 0,
  "bettingHouse": "betano", "status": "COMPLETED",
  "requestNote": "Saque solicitado pelo painel",
  "adminNote": "Pago no painel",
  "createdAt": "2026-06-22T18:30:00.000Z"
}
~~~

== WEBHOOKS — RECEBIMENTO ==
1) No painel Vallex você cadastra a URL do seu endpoint e marca quais eventos quer receber.
2) A Vallex faz POST JSON nessa URL a cada evento.
3) Headers que enviamos em todo POST:
   - x-vallex-event:        nome do evento (ex.: affiliate_data.synced)
   - x-vallex-delivery-id:  id da entrega
   - x-vallex-timestamp:    epoch em segundos (use para anti-replay; tolerância sugerida 300s)
   - x-vallex-signature:    sha256=HEX  (presente se você configurou um segredo)
4) CONTRATO: responda HTTP 200 (qualquer 2xx) em até 15 segundos. Qualquer outro status,
   timeout ou erro de conexão = falha; reenviamos com backoff exponencial até 6 tentativas;
   depois a entrega fica FAILED (reenviável manualmente pelo painel).
   IMPORTANTE: valide a assinatura, ENFILEIRE o processamento e responda 200 na hora.

== VERIFICAÇÃO DE ASSINATURA (HMAC-SHA256) ==
- Calcule: assinaturaEsperada = "sha256=" + HEX( HMAC_SHA256( segredo, x-vallex-timestamp + "." + CORPO_BRUTO ) )
  onde CORPO_BRUTO é o corpo da requisição EXATAMENTE como recebido (bytes/string crua,
  NÃO o JSON re-serializado).
- Compare com o header x-vallex-signature usando comparação de tempo constante.
- Rejeite (401) se não bater ou se x-vallex-timestamp for muito antigo.
Exemplo Node.js (Express, com req.rawBody):
~~~
import crypto from 'node:crypto'
app.post('/webhooks/vallex', (req, res) => {
  const sig = req.header('x-vallex-signature') || ''
  const ts  = req.header('x-vallex-timestamp') || ''
  const expected = 'sha256=' + crypto.createHmac('sha256', process.env.VALLEX_WEBHOOK_SECRET)
    .update(ts + '.' + req.rawBody).digest('hex')
  const ok = sig.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  if (!ok) return res.sendStatus(401)
  res.sendStatus(200)        // responda já; processe depois (fila)
})
~~~

== EVENTOS E PAYLOADS ==
Envelope comum em todo payload: { "event", "timestamp"(ISO), "origin", ...dados }

1) link_request.created — pedido de link criado (PENDING)
~~~
{ "event":"link_request.created","timestamp":"2026-06-15T12:00:00.000Z","origin":"CREATED",
  "linkRequest":{ "id":"...","status":"PENDING","bettingHouseSlug":"betano","dealId":"...","createdAt":"...","resolvedCpa":200,"resolvedRevshare":0,"links":[] },
  "user":{ "id":"...","name":"Cliente","email":"cliente@parceiro.com","referredById":"owner-..." },
  "deal":{ "id":"...","name":"Betano CPA","cpa":200,"revshare":0 }, "affiliateLink":null }
~~~
2) link_request.approved — link aprovado/atribuído (FULFILLED)
~~~
{ "event":"link_request.approved","timestamp":"...","origin":"AUTO_ASSIGN",
  "linkRequest":{ "id":"...","status":"FULFILLED","bettingHouseSlug":"betano","fulfilledAt":"...","links":[{"label":"Link principal","url":"https://..."}] },
  "user":{ ... }, "deal":{ ... },
  "affiliateLink":{ "bettingHouse":"betano","campaignId":"2001101-BTJ887","userLink":"https://...","cpa":200,"revshare":0 } }
~~~
3) link_request.rejected — pedido rejeitado/bloqueado
~~~
{ "event":"link_request.rejected","timestamp":"...","origin":"RULE_BLOCKED",
  "linkRequest":{ "id":"...","status":"REJECTED","bettingHouseSlug":"betano","blockedReason":"RULE_BLOCKED","missingHouseSlugs":["superbet"] },
  "user":{ ... }, "deal":{ ... }, "affiliateLink":null }
~~~
4) affiliate_data.synced — disparado após o cron gravar os dados de uma casa
~~~
{ "event":"affiliate_data.synced","timestamp":"...","origin":"SYNC",
  "houseSlug":"betano","dates":["2026-06-14","2026-06-15"],"rowsUpserted":42,
  "totals":{ "inserted":10,"updated":32,"records":42 },"triggeredBy":"cron-recent" }
~~~
   -> Ao receber, consulte GET /affiliate-api/metrics para puxar os números atualizados.
5) deal.updated — um deal (CPA/revshare) mudou
~~~
{ "event":"deal.updated","timestamp":"...","origin":"DEAL","id":"...","name":"Betano CPA","bettingHouseSlug":"betano","cpa":220,"revshare":0,"updatedAt":"..." }
~~~
6) house.updated — uma casa mudou (ativada/desativada/editada)
~~~
{ "event":"house.updated","timestamp":"...","origin":"HOUSE","slug":"betano","name":"Betano","active":true,"updatedAt":"..." }
~~~

== CÓDIGOS DE ERRO (API REST) ==
- 400: parâmetros inválidos (data fora de YYYY-MM-DD, intervalo > 90 dias, casa/transição inválida, sem saldo)
- 401: token ausente/inválido/revogado
- 403: token fora de escopo (afiliado fora da sua rede)
- 404: usuário externo ou saque fora da sua rede
- 429: limite de 1 saque por dia por casa por usuário atingido (tente no dia seguinte)

== O QUE VOCÊ DEVE IMPLEMENTAR (checklist) ==
[ ] Cliente HTTP que envia Authorization: Bearer e trata 400/401/403/404/429.
[ ] Função para GET /affiliate-api/metrics com filtros (datas, houseSlug, groupBy).
[ ] Função para POST /affiliate-api/link-requests (externalUserId, userName, userEmail e bettingHouseSlug OBRIGATÓRIOS).
[ ] Função para GET /affiliate-api/users/{externalUserId} (usuário + saldo).
[ ] Função para POST /affiliate-api/withdrawals (saca o saldo total da casa; 1/dia por casa, trate 429).
[ ] Função para GET /affiliate-api/withdrawals (histórico, com filtros e paginação).
[ ] Função para GET /affiliate-api/withdrawals/{id} e PATCH .../status (respeite a matriz de transições).
[ ] Endpoint público (HTTPS) para receber os webhooks.
[ ] Acesso ao CORPO BRUTO da requisição (raw body) para validar a assinatura.
[ ] Validação HMAC-SHA256 + checagem de x-vallex-timestamp (anti-replay).
[ ] Responder 200 imediatamente e processar de forma assíncrona (fila/worker).
[ ] Idempotência por x-vallex-delivery-id (pode haver reenvio).
[ ] Tratar os 6 eventos acima (roteie por x-vallex-event ou pelo campo "event").
Gere o código completo, com variáveis de ambiente para token e segredo, e comentários.`

const responseExample = `{
  "filters": {
    "startDate": "2026-05-01",
    "endDate": "2026-05-28",
    "houseSlug": null,
    "affiliateId": null
  },
  "scope": {
    "ownerUserId": "8f1c…",
    "includedAffiliateIds": ["8f1c…", "a93d…"]
  },
  "summary": {
    "clicks": 1412,
    "registrations": 135,
    "ftds": 86,
    "deposits": 86,
    "depositAmount": 7317.46,
    "revShare": 540.20,
    "qualifiedCpa": 86,
    "cpaAmount": 8600,
    "totalCommission": 9140.20
  },
  "records": [
    {
      "date": "2026-05-28",
      "houseSlug": "betano",
      "houseName": "Betano",
      "affiliateId": "a93d…",
      "affiliateName": "Angerleide D.",
      "affiliateEmail": "angerleide@exemplo.com",
      "level": 1,
      "clicks": 1412,
      "registrations": 135,
      "ftds": 86,
      "deposits": 86,
      "depositAmount": 7317.46,
      "revShare": 540.20,
      "qualifiedCpa": 86,
      "cpaAmount": 8600,
      "totalCommission": 9140.20
    }
  ],
  "byHouse": [
    { "houseSlug": "betano", "houseName": "Betano", "clicks": 1412, "qualifiedCpa": 86, "cpaAmount": 8600 }
  ],
  "byDay": [
    { "date": "2026-05-28", "clicks": 1412, "qualifiedCpa": 86, "cpaAmount": 8600 }
  ],
  "byAffiliate": [
    { "affiliateId": "a93d…", "affiliateName": "Angerleide D.", "level": 1, "qualifiedCpa": 86, "cpaAmount": 8600 }
  ]
}`

function downloadPostmanCollection() {
  if (!import.meta.client) return
  const blob = new Blob([postmanExample.value], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'vallex-company-affiliate-api.postman_collection.json'
  anchor.click()
  URL.revokeObjectURL(url)
  toast.add({ title: 'Collection baixada', description: 'No Postman: Import → File → selecione o arquivo.', color: 'success' })
}

const playgroundTokenValue = computed(() => playgroundToken.value.trim() || revealedToken.value.trim())
const playgroundResult = computed(() => {
  if (playgroundError.value) {
    return playgroundError.value
  }

  if (playgroundResponse.value) {
    return JSON.stringify(playgroundResponse.value, null, 2)
  }

  return '{\n  "status": "Aguardando teste..."\n}'
})

onMounted(async () => {
  loading.value = true
  try {
    await Promise.all([loadTokenStatus(), loadAffiliates(), fetchHouses()])
  } finally {
    loading.value = false
  }
})

async function loadTokenStatus() {
  tokenStatus.value = await $fetch<TokenStatus>(`${apiBase}/v1/affiliate-api/token`, {
    headers: authHeaders(),
  })
}

async function generateTokenEnv(env: ApiEnv) {
  generatingEnv.value = env
  try {
    const res = await $fetch<{ token: string, hint: string }>(`${apiBase}/v1/affiliate-api/token`, {
      method: 'POST',
      headers: authHeaders(),
      query: { environment: env },
    })
    revealedTokens[env] = res.token
    if (env === 'live') revealedToken.value = res.token
    await loadTokenStatus()
    toast.add({ title: `Token ${env} gerado`, description: 'Copie agora. Ele não será exibido novamente.', color: 'success' })
  } catch {
    toast.add({ title: 'Erro ao gerar token', color: 'error' })
  } finally {
    generatingEnv.value = null
  }
}

async function revokeTokenEnv(env: ApiEnv) {
  revokingEnv.value = env
  try {
    await $fetch(`${apiBase}/v1/affiliate-api/token`, {
      method: 'DELETE',
      headers: authHeaders(),
      query: { environment: env },
    })
    revealedTokens[env] = ''
    if (env === 'live') revealedToken.value = ''
    await loadTokenStatus()
    toast.add({ title: `Token ${env} revogado`, color: 'success' })
  } catch {
    toast.add({ title: 'Erro ao revogar token', color: 'error' })
  } finally {
    revokingEnv.value = null
  }
}

async function resetSandbox() {
  const testToken = revealedTokens.test.trim()
  if (!testToken) {
    toast.add({ title: 'Gere um token de teste primeiro', description: 'O reset usa o token vex_test_ atual.', color: 'warning' })
    return
  }
  resettingSandbox.value = true
  try {
    await $fetch(`${apiBase}/v1/affiliate-api/sandbox`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${testToken}` },
    })
    toast.add({ title: 'Sandbox resetado', description: 'Todos os dados de teste foram apagados.', color: 'success' })
  } catch {
    toast.add({ title: 'Erro ao resetar sandbox', color: 'error' })
  } finally {
    resettingSandbox.value = false
  }
}

async function loadAffiliates() {
  const res = await $fetch<{ data: AffiliateOption[] }>(`${apiBase}/v1/affiliate-api/affiliates`, {
    headers: authHeaders(),
  })
  affiliates.value = res.data
}

async function generateToken() {
  generating.value = true
  try {
    const res = await $fetch<{ token: string, hint: string }>(`${apiBase}/v1/affiliate-api/token`, {
      method: 'POST',
      headers: authHeaders(),
    })
    revealedToken.value = res.token
    await loadTokenStatus()
    toast.add({ title: 'Token gerado', description: 'Copie agora. Ele não será exibido novamente.', color: 'success' })
  } catch {
    toast.add({ title: 'Erro ao gerar token', color: 'error' })
  } finally {
    generating.value = false
  }
}

async function revokeToken() {
  revoking.value = true
  try {
    await $fetch(`${apiBase}/v1/affiliate-api/token`, {
      method: 'DELETE',
      headers: authHeaders(),
    })
    revealedToken.value = ''
    await loadTokenStatus()
    toast.add({ title: 'Token revogado', color: 'success' })
  } catch {
    toast.add({ title: 'Erro ao revogar token', color: 'error' })
  } finally {
    revoking.value = false
  }
}

async function copyText(text: string, title = 'Copiado') {
  if (!import.meta.client) return
  await navigator.clipboard.writeText(text)
  toast.add({ title, color: 'success' })
}

async function runPlayground() {
  const token = playgroundTokenValue.value
  if (!token) {
    toast.add({ title: 'Informe um token', description: 'Cole um token ou gere um novo nesta tela.', color: 'warning' })
    return
  }

  testing.value = true
  playgroundError.value = ''
  playgroundResponse.value = null

  try {
    playgroundResponse.value = await $fetch(playgroundUrl.value, {
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch (error) {
    const err = error as { status?: number, statusCode?: number, data?: unknown, message?: string }
    playgroundError.value = JSON.stringify({
      status: err.status ?? err.statusCode ?? 500,
      error: err.data ?? err.message ?? 'Erro ao testar endpoint',
    }, null, 2)
  } finally {
    testing.value = false
  }
}

// ── Saques & Usuário — playground + exemplos ───────────────────────────────
const wd = reactive({
  endpoint: 'getUser' as
    | 'getUser'
    | 'createWithdrawal'
    | 'listWithdrawals'
    | 'getWithdrawal'
    | 'setStatus',
  externalUserId: '',
  bettingHouse: '__all__',
  requestNote: '',
  withdrawalId: '',
  status: 'completed' as 'processing' | 'completed' | 'rejected',
  note: '',
  listStatus: '__all__',
  page: 1,
  limit: 20,
})
const wdResponse = ref<unknown>(null)
const wdError = ref('')
const wdTesting = ref(false)
const wdLang = ref<'curl' | 'js' | 'python'>('curl')

const wdEndpoints = [
  { id: 'getUser', label: 'GET usuário + saldo', method: 'GET' },
  { id: 'createWithdrawal', label: 'POST criar saque', method: 'POST' },
  { id: 'listWithdrawals', label: 'GET histórico', method: 'GET' },
  { id: 'getWithdrawal', label: 'GET saque por id', method: 'GET' },
  { id: 'setStatus', label: 'PATCH status', method: 'PATCH' },
] as const

const wdEndpointOptions = wdEndpoints.map(e => ({ label: e.label, value: e.id }))
const wdStatusOptions = [
  { label: 'processing', value: 'processing' },
  { label: 'completed (desconta saldo)', value: 'completed' },
  { label: 'rejected (libera saldo)', value: 'rejected' },
]
const wdListStatusOptions = [
  { label: 'Todos', value: '__all__' },
  { label: 'PENDING', value: 'PENDING' },
  { label: 'PROCESSING', value: 'PROCESSING' },
  { label: 'COMPLETED', value: 'COMPLETED' },
  { label: 'REJECTED', value: 'REJECTED' },
]

// Descreve a requisição da aba selecionada — alimenta exemplos e o teste real.
const wdRequest = computed<{ method: string, path: string, body: Record<string, unknown> | null }>(() => {
  const house = wd.bettingHouse !== '__all__' ? wd.bettingHouse : ''
  if (wd.endpoint === 'getUser') {
    const q = house ? `?bettingHouse=${encodeURIComponent(house)}` : ''
    return { method: 'GET', path: `/users/${encodeURIComponent(wd.externalUserId || 'ID_DO_USUARIO')}${q}`, body: null }
  }
  if (wd.endpoint === 'createWithdrawal') {
    return {
      method: 'POST',
      path: '/withdrawals',
      body: {
        externalUserId: wd.externalUserId || 'ID_DO_USUARIO',
        bettingHouse: house || 'betano',
        ...(wd.requestNote ? { requestNote: wd.requestNote } : {}),
      },
    }
  }
  if (wd.endpoint === 'listWithdrawals') {
    const p = new URLSearchParams()
    if (wd.externalUserId) p.set('externalUserId', wd.externalUserId)
    if (wd.listStatus !== '__all__') p.set('status', wd.listStatus)
    if (house) p.set('bettingHouse', house)
    p.set('page', String(wd.page))
    p.set('limit', String(wd.limit))
    return { method: 'GET', path: `/withdrawals?${p.toString()}`, body: null }
  }
  if (wd.endpoint === 'getWithdrawal') {
    return { method: 'GET', path: `/withdrawals/${encodeURIComponent(wd.withdrawalId || 'ID_DO_SAQUE')}`, body: null }
  }
  return {
    method: 'PATCH',
    path: `/withdrawals/${encodeURIComponent(wd.withdrawalId || 'ID_DO_SAQUE')}/status`,
    body: { status: wd.status, ...(wd.note ? { note: wd.note } : {}) },
  }
})

const wdPublicUrl = computed(() => `https://api.vallexgroup.com.br/api/v1/affiliate-api${wdRequest.value.path}`)
const wdTestUrl = computed(() => `${apiBase}/v1/affiliate-api${wdRequest.value.path}`)

const wdCurlExample = computed(() => {
  const r = wdRequest.value
  if (r.body) {
    return `curl -X ${r.method} "${wdPublicUrl.value}" \\
  -H "Authorization: Bearer SEU_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(r.body)}'`
  }
  return `curl -X ${r.method} "${wdPublicUrl.value}" \\
  -H "Authorization: Bearer SEU_TOKEN"`
})

const wdJsExample = computed(() => {
  const r = wdRequest.value
  const opts = r.body
    ? `{
    method: "${r.method}",
    headers: { Authorization: "Bearer SEU_TOKEN", "Content-Type": "application/json" },
    body: JSON.stringify(${JSON.stringify(r.body)}),
  }`
    : `{ headers: { Authorization: "Bearer SEU_TOKEN" } }`
  return `const res = await fetch(
  "${wdPublicUrl.value}",
  ${opts}
)

if (!res.ok) throw new Error(\`API error: \${res.status}\`)
const data = await res.json()
console.log(data)`
})

const wdPythonExample = computed(() => {
  const r = wdRequest.value
  const method = r.method.toLowerCase()
  if (r.body) {
    return `import requests

resp = requests.${method}(
    "${wdPublicUrl.value}",
    headers={"Authorization": "Bearer SEU_TOKEN"},
    json=${JSON.stringify(r.body)},
    timeout=30,
)
resp.raise_for_status()
print(resp.json())`
  }
  return `import requests

resp = requests.${method}(
    "${wdPublicUrl.value}",
    headers={"Authorization": "Bearer SEU_TOKEN"},
    timeout=30,
)
resp.raise_for_status()
print(resp.json())`
})

const wdLangTabs = [
  { id: 'curl', label: 'cURL' },
  { id: 'js', label: 'JavaScript' },
  { id: 'python', label: 'Python' },
] as const

const activeWdCode = computed(() => {
  if (wdLang.value === 'js') return wdJsExample.value
  if (wdLang.value === 'python') return wdPythonExample.value
  return wdCurlExample.value
})

const wdResult = computed(() => {
  if (wdError.value) return wdError.value
  if (wdResponse.value) return JSON.stringify(wdResponse.value, null, 2)
  return '{\n  "status": "Aguardando teste..."\n}'
})

// Exemplos concretos de resposta (200) por endpoint — usados na doc da página
// e na doc da LLM. Valores ilustrativos; o formato é o real.
const wdExampleWithdrawal = {
  id: 'a1b2c3d4-5e6f-7a8b-9c0d-1e2f3a4b5c6d',
  userId: 'f0e9d8c7-b6a5-4321-9f8e-7d6c5b4a3210',
  userName: 'João da Silva',
  userEmail: 'ext.panel-42.<owner>@external.vallex.local',
  amount: 250,
  originalAmount: 250,
  withdrawalFee: 0,
  bettingHouse: 'betano',
  pixKeyType: 'API',
  pixKey: 'ext:panel-42',
  accountHolder: 'João da Silva',
  status: 'PENDING',
  requestNote: 'Saque solicitado pelo painel',
  adminNote: null,
  approvedAt: null,
  createdAt: '2026-06-22T18:30:00.000Z',
  hasReceipt: false,
  refundedAmount: null,
  refundState: 'NONE',
}
// Saldo (resumido — campos principais; a resposta real traz o BalanceResponseDto completo).
const wdExampleBalance = (betano: number) => ({
  balance: betano,
  withdrawableTotal: betano,
  minWithdrawalAmount: 100,
  withdrawalFee: 0,
  withdrawalFeeRate: 0.06,
  bonusAvailable: 0,
  perHouse: [
    { house: 'betano', total: betano },
    { house: 'superbet', total: 0 },
  ],
  depositInfo: { belowMinimum: false },
})

const wdResponseExample = computed(() => {
  if (wd.endpoint === 'getUser') {
    return JSON.stringify({
      user: {
        externalUserId: 'panel-42',
        name: 'João da Silva',
        email: 'cliente@exemplo.com',
        status: 'APPROVED',
        createdAt: '2026-06-01T12:00:00.000Z',
      },
      balance: wdExampleBalance(250),
    }, null, 2)
  }
  if (wd.endpoint === 'createWithdrawal') {
    // Após criar, o saldo da casa fica reservado (betano → 0).
    return JSON.stringify({
      withdrawal: wdExampleWithdrawal,
      balance: wdExampleBalance(0),
    }, null, 2)
  }
  if (wd.endpoint === 'listWithdrawals') {
    return JSON.stringify({
      data: [wdExampleWithdrawal],
      total: 1,
      page: 1,
      limit: 20,
    }, null, 2)
  }
  if (wd.endpoint === 'getWithdrawal') {
    return JSON.stringify(wdExampleWithdrawal, null, 2)
  }
  // setStatus → o saque atualizado (ex.: completed)
  return JSON.stringify({
    ...wdExampleWithdrawal,
    status: 'COMPLETED',
    adminNote: 'Pago no painel',
  }, null, 2)
})

const withdrawalEndpointDocs = [
  { method: 'GET', path: '/v1/affiliate-api/users/:externalUserId', desc: 'Consulta o usuário do SEU painel + saldo (por casa e total).' },
  { method: 'POST', path: '/v1/affiliate-api/withdrawals', desc: 'Cria um saque do saldo TOTAL disponível da casa para o usuário.' },
  { method: 'GET', path: '/v1/affiliate-api/withdrawals', desc: 'Histórico de saques (filtros: externalUserId, status, casa, datas, paginação).' },
  { method: 'GET', path: '/v1/affiliate-api/withdrawals/:id', desc: 'Detalhe de um saque.' },
  { method: 'PATCH', path: '/v1/affiliate-api/withdrawals/:id/status', desc: 'Atualiza o status (processing | completed | rejected).' },
]

const withdrawalFields = [
  { name: 'id', type: 'string', desc: 'ID do saque (use no GET/PATCH por id).' },
  { name: 'originalAmount', type: 'number · R$', desc: 'Valor bruto (saldo total da casa no momento da criação).' },
  { name: 'amount', type: 'number · R$', desc: 'Valor líquido. Na API é igual ao originalAmount (sem taxa).' },
  { name: 'withdrawalFee', type: 'number · R$', desc: 'Taxa. Sempre 0 para saques via API.' },
  { name: 'bettingHouse', type: 'string', desc: 'Slug da casa.' },
  { name: 'status', type: 'string', desc: 'PENDING | PROCESSING | COMPLETED | REJECTED.' },
  { name: 'requestNote', type: 'string', desc: 'Nota enviada na criação.' },
  { name: 'createdAt', type: 'string · ISO', desc: 'Data de criação.' },
]

const withdrawalErrorCodes = [
  { code: '400', label: 'Bad Request', desc: 'Casa inválida ou "bonus", sem saldo disponível, ou transição de status inválida.' },
  { code: '401', label: 'Unauthorized', desc: 'Token ausente, inválido ou revogado.' },
  { code: '404', label: 'Not Found', desc: 'Usuário externo ou saque fora da sua rede.' },
  { code: '429', label: 'Too Many Requests', desc: 'Limite de 1 saque por dia por casa por usuário atingido. Tente novamente no dia seguinte.' },
]

async function runWithdrawalPlayground() {
  const token = playgroundTokenValue.value
  if (!token) {
    toast.add({ title: 'Informe um token', description: 'Cole um token ou gere um novo nesta tela.', color: 'warning' })
    return
  }
  if (
    (wd.endpoint === 'getUser' || wd.endpoint === 'createWithdrawal') &&
    !wd.externalUserId.trim()
  ) {
    toast.add({ title: 'Informe o externalUserId', color: 'warning' })
    return
  }
  if ((wd.endpoint === 'getWithdrawal' || wd.endpoint === 'setStatus') && !wd.withdrawalId.trim()) {
    toast.add({ title: 'Informe o id do saque', color: 'warning' })
    return
  }
  if (wd.endpoint === 'createWithdrawal' && wd.bettingHouse === '__all__') {
    toast.add({ title: 'Escolha uma casa', description: 'O saque é por casa — selecione uma.', color: 'warning' })
    return
  }

  wdTesting.value = true
  wdError.value = ''
  wdResponse.value = null

  try {
    const r = wdRequest.value
    wdResponse.value = await $fetch(wdTestUrl.value, {
      method: r.method as 'GET' | 'POST' | 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
      ...(r.body ? { body: r.body } : {}),
    })
  } catch (error) {
    const err = error as { status?: number, statusCode?: number, data?: unknown, message?: string }
    wdError.value = JSON.stringify({
      status: err.status ?? err.statusCode ?? 500,
      error: err.data ?? err.message ?? 'Erro ao testar endpoint',
    }, null, 2)
  } finally {
    wdTesting.value = false
  }
}

// ── Doc redesign: sidebar navigation ───────────────────────────────────────
const docSections = [
  { id: 'visao-geral', label: 'Visão geral', icon: 'i-lucide-book-open' },
  { id: 'tokens', label: 'Tokens & Auth', icon: 'i-lucide-key-round' },
  { id: 'sandbox', label: 'Sandbox', icon: 'i-lucide-flask-conical' },
  { id: 'endpoints', label: 'Endpoints', icon: 'i-lucide-braces' },
  { id: 'webhooks', label: 'Webhooks', icon: 'i-lucide-webhook' },
  { id: 'spec-ia', label: 'Spec para IA', icon: 'i-lucide-sparkles' },
]
const activeSection = ref('visao-geral')
function scrollToSection(id: string) {
  if (!import.meta.client) return
  activeSection.value = id
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
onMounted(() => {
  if (!import.meta.client) return
  const obs = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) activeSection.value = e.target.id
  }, { rootMargin: '-15% 0px -75% 0px', threshold: 0 })
  for (const s of docSections) {
    const el = document.getElementById(s.id)
    if (el) obs.observe(el)
  }
})

// ── Per-endpoint canonical code examples (decoupled from the playground) ────
function buildCode(method: string, path: string, body?: Record<string, unknown>) {
  const url = `https://api.vallexgroup.com.br/api/v1/affiliate-api${path}`
  const bodyStr = body ? JSON.stringify(body) : ''
  const curl = body
    ? `curl -X ${method} "${url}" \\\n  -H "Authorization: Bearer SEU_TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d '${bodyStr}'`
    : `curl -X ${method} "${url}" \\\n  -H "Authorization: Bearer SEU_TOKEN"`
  const js = body
    ? `const res = await fetch("${url}", {\n  method: "${method}",\n  headers: { Authorization: "Bearer SEU_TOKEN", "Content-Type": "application/json" },\n  body: JSON.stringify(${bodyStr}),\n})\nif (!res.ok) throw new Error(\`API \${res.status}\`)\nconst data = await res.json()`
    : `const res = await fetch("${url}", {\n  headers: { Authorization: "Bearer SEU_TOKEN" },\n})\nif (!res.ok) throw new Error(\`API \${res.status}\`)\nconst data = await res.json()`
  const py = body
    ? `import requests\nresp = requests.${method.toLowerCase()}(\n    "${url}",\n    headers={"Authorization": "Bearer SEU_TOKEN"},\n    json=${bodyStr},\n    timeout=30,\n)\nresp.raise_for_status()\nprint(resp.json())`
    : `import requests\nresp = requests.${method.toLowerCase()}(\n    "${url}",\n    headers={"Authorization": "Bearer SEU_TOKEN"},\n    timeout=30,\n)\nresp.raise_for_status()\nprint(resp.json())`
  return { curl, js, python: py }
}

// Canonical example bodies/paths per endpoint
const exMetrics = buildCode('GET', '/metrics?startDate=2026-06-01&endDate=2026-06-22')
const exLinkReq = buildCode('POST', '/link-requests', { externalUserId: 'panel-42', userName: 'Cliente', userEmail: 'cliente@dominio.com', bettingHouseSlug: 'betano' })
const exGetUser = buildCode('GET', '/users/panel-42?bettingHouse=betano')
const exCreateWd = buildCode('POST', '/withdrawals', { externalUserId: 'panel-42', bettingHouse: 'betano' })
const exListWd = buildCode('GET', '/withdrawals?status=PENDING&page=1&limit=20')
const exGetWd = buildCode('GET', '/withdrawals/a1b2c3d4-...')
const exPatchWd = buildCode('PATCH', '/withdrawals/a1b2c3d4-.../status', { status: 'completed', note: 'Pago' })

// Static response examples per withdrawal endpoint
const respGetUser = JSON.stringify({ user: { externalUserId: 'panel-42', name: 'João da Silva', email: 'cliente@exemplo.com', status: 'APPROVED', createdAt: '2026-06-01T12:00:00.000Z' }, balance: wdExampleBalance(250) }, null, 2)
const respCreateWd = JSON.stringify({ withdrawal: wdExampleWithdrawal, balance: wdExampleBalance(0) }, null, 2)
const respListWd = JSON.stringify({ data: [wdExampleWithdrawal], total: 1, page: 1, limit: 20 }, null, 2)
const respGetWd = JSON.stringify(wdExampleWithdrawal, null, 2)
const respPatchWd = JSON.stringify({ ...wdExampleWithdrawal, status: 'COMPLETED', adminNote: 'Pago no painel' }, null, 2)
const respLinkReq = JSON.stringify({ id: 'sbx_lr_…', status: 'PENDING', bettingHouseSlug: 'betano', requester: { id: 'sbx_panel-42', externalId: 'panel-42', name: 'Cliente', email: 'cliente@exemplo.com' } }, null, 2)
const respMetrics = responseExample

// Param docs per endpoint
const pLinkReq = [
  { name: 'externalUserId', in: 'body' as const, type: 'string', required: true, desc: 'ID do usuário no SEU painel. Reusar o mesmo ID reaproveita o usuário externo (idempotente).' },
  { name: 'userName', in: 'body' as const, type: 'string', required: true, desc: 'Nome real do usuário.' },
  { name: 'userEmail', in: 'body' as const, type: 'string', required: true, desc: 'E-mail real do usuário — usado para busca e métricas.' },
  { name: 'bettingHouseSlug', in: 'body' as const, type: 'string', required: true, desc: 'Casa do link (ex.: betano).' },
  { name: 'dealId', in: 'body' as const, type: 'string', required: false, desc: 'ID do deal específico (opcional).' },
]
const pGetUser = [
  { name: 'externalUserId', in: 'path' as const, type: 'string', required: true, desc: 'ID do usuário no SEU painel.' },
  { name: 'bettingHouse', in: 'query' as const, type: 'string', required: false, desc: 'Limita o saldo a uma casa. Sem ele, retorna todas.' },
]
const pCreateWd = [
  { name: 'externalUserId', in: 'body' as const, type: 'string', required: true, desc: 'ID do usuário no SEU painel.' },
  { name: 'bettingHouse', in: 'body' as const, type: 'string', required: true, desc: 'Casa do saque. "bonus" NÃO é suportado.' },
  { name: 'requestNote', in: 'body' as const, type: 'string', required: false, desc: 'Nota livre para o histórico.' },
]
const pListWd = [
  { name: 'externalUserId', in: 'query' as const, type: 'string', required: false, desc: 'Filtra por um usuário do seu painel.' },
  { name: 'status', in: 'query' as const, type: 'string', required: false, desc: 'PENDING | PROCESSING | COMPLETED | REJECTED.' },
  { name: 'bettingHouse', in: 'query' as const, type: 'string', required: false, desc: 'Filtra por casa.' },
  { name: 'startDate', in: 'query' as const, type: 'string · YYYY-MM-DD', required: false, desc: 'Início do período.' },
  { name: 'endDate', in: 'query' as const, type: 'string · YYYY-MM-DD', required: false, desc: 'Fim do período.' },
  { name: 'page', in: 'query' as const, type: 'number', required: false, desc: 'Página (padrão 1).' },
  { name: 'limit', in: 'query' as const, type: 'number', required: false, desc: 'Itens por página (padrão 20, máx 100).' },
]
const pGetWd = [{ name: 'id', in: 'path' as const, type: 'string', required: true, desc: 'ID do saque.' }]
const pPatchWd = [
  { name: 'id', in: 'path' as const, type: 'string', required: true, desc: 'ID do saque.' },
  { name: 'status', in: 'body' as const, type: 'string', required: true, desc: 'processing | completed | rejected.' },
  { name: 'note', in: 'body' as const, type: 'string', required: false, desc: 'Nota livre (opcional).' },
]

// Webhook withdrawal.* sample payloads + unified selector
const webhookWithdrawalPayloads = [
  { name: 'withdrawal.created', desc: 'Um saque foi criado (status PENDING).', json: JSON.stringify({ event: 'withdrawal.created', timestamp: '2026-06-22T18:30:00.000Z', origin: 'WITHDRAWAL', withdrawalId: 'a1b2c3d4-…', userId: 'u-…', externalUserId: 'panel-42', bettingHouse: 'betano', amount: 250, originalAmount: 250, status: 'PENDING', previousStatus: null, createdAt: '2026-06-22T18:30:00.000Z' }, null, 2) },
  { name: 'withdrawal.status_changed', desc: 'O status de um saque mudou (ex.: PENDING → COMPLETED).', json: JSON.stringify({ event: 'withdrawal.status_changed', timestamp: '2026-06-22T19:00:00.000Z', origin: 'WITHDRAWAL', withdrawalId: 'a1b2c3d4-…', userId: 'u-…', externalUserId: 'panel-42', bettingHouse: 'betano', amount: 250, originalAmount: 250, status: 'COMPLETED', previousStatus: 'PENDING', createdAt: '2026-06-22T18:30:00.000Z' }, null, 2) },
]
const allWebhookPayloads = [...webhookPayloads, ...webhookWithdrawalPayloads]
const selectedWh = ref(allWebhookPayloads[0]!.name)
const selectedWhPayload = computed(() => allWebhookPayloads.find(p => p.name === selectedWh.value) ?? allWebhookPayloads[0]!)

const reqCreateWd = JSON.stringify({ externalUserId: 'panel-42', bettingHouse: 'betano', requestNote: 'opcional' }, null, 2)
const reqPatchWd = JSON.stringify({ status: 'completed', note: 'opcional' }, null, 2)
const metricsParams = queryParams.map(p => ({ ...p, in: 'query' as const }))
</script>

<template>
  <div class="min-h-full flex flex-col gap-4">
    <header class="vex-page-header">
      <div class="flex items-center gap-3">
        <div class="flex size-10 items-center justify-center rounded-lg" style="background: var(--vex-brand-muted); color: var(--vex-brand)">
          <UIcon name="i-lucide-braces" class="size-5" />
        </div>
        <div>
          <h1 class="vex-title text-base font-bold">API & Webhooks</h1>
          <p class="text-xs" style="color: var(--vex-text-muted)">Documentação de integração — rotas, respostas e webhooks.</p>
        </div>
      </div>
    </header>

    <div v-if="!canAccess" class="vex-card p-6 text-sm" style="color: var(--vex-text-muted)">
      Você não tem permissão.
    </div>

    <div v-else class="lg:grid lg:grid-cols-[212px_minmax(0,1fr)] lg:gap-6 lg:items-start">
      <!-- Sidebar -->
      <aside class="mb-4 lg:mb-0 lg:sticky lg:top-4">
        <USelect
          class="lg:hidden mb-3 w-full"
          :items="docSections.map(s => ({ label: s.label, value: s.id }))"
          value-key="value"
          :model-value="activeSection"
          @update:model-value="scrollToSection"
        />
        <nav class="hidden flex-col gap-1 lg:flex">
          <button
            v-for="s in docSections" :key="s.id" type="button"
            class="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold transition-colors"
            :style="activeSection === s.id ? 'background: var(--vex-brand-muted); color: var(--vex-brand)' : 'color: var(--vex-text-muted)'"
            @click="scrollToSection(s.id)"
          >
            <UIcon :name="s.icon" class="size-4 shrink-0" />{{ s.label }}
          </button>
          <div class="mt-3 flex flex-col gap-2">
            <UButton icon="i-lucide-clipboard-copy" size="xs" label="Copiar spec p/ IA" color="primary" variant="soft" block @click="copyText(llmDoc, 'Documentação para IA copiada — cole na sua IA')" />
            <UButton icon="i-lucide-webhook" size="xs" label="Eventos de Webhook" color="neutral" variant="soft" block to="/webhook-events" />
          </div>
        </nav>
      </aside>

      <!-- Content -->
      <div class="flex min-w-0 flex-col gap-6">
        <!-- ── Visão geral ──────────────────────────────────────────────── -->
        <section id="visao-geral" class="scroll-mt-4 flex flex-col gap-4">
          <div class="vex-card p-5">
            <p class="text-base font-bold">Visão geral</p>
            <p class="mt-1 text-sm" style="color: var(--vex-text-muted)">
              API REST para consultar suas métricas e operar saques pelos usuários do SEU painel, com webhooks
              para receber eventos em tempo real. Tudo autenticado por <strong>Bearer token</strong>.
            </p>
            <div class="mt-4 flex flex-wrap items-center gap-2 rounded-lg p-3" style="background: var(--vex-bg); border: 1px solid var(--vex-border-subtle)">
              <span class="rounded px-2 py-1 text-[11px] font-black" style="background: var(--vex-surface-strong); color: var(--vex-text-muted)">BASE URL</span>
              <code class="min-w-0 flex-1 break-all text-xs" style="color: var(--vex-text)">https://api.vallexgroup.com.br/api/v1/affiliate-api</code>
              <UButton icon="i-lucide-copy" size="xs" color="neutral" variant="ghost" @click="copyText('https://api.vallexgroup.com.br/api/v1/affiliate-api', 'Base URL copiada')" />
            </div>
            <div class="mt-3 grid gap-3 sm:grid-cols-2">
              <div class="rounded-lg p-3 text-xs" style="background: var(--vex-positive-soft-bg); color: var(--vex-positive-soft-text)">
                <p class="font-black">Produção · vex_live_</p>
                <p class="mt-1" style="color: var(--vex-text-muted)">Mexe nos seus dados reais (saques de verdade).</p>
              </div>
              <div class="rounded-lg p-3 text-xs" style="background: var(--vex-warning-soft-bg); color: var(--vex-warning-soft-text)">
                <p class="font-black">Sandbox · vex_test_</p>
                <p class="mt-1" style="color: var(--vex-text-muted)">Isolado — nada persiste; saldos semeados. O ambiente é o token que você envia.</p>
              </div>
            </div>
          </div>

          <div class="vex-card p-5">
            <p class="text-sm font-bold">Início rápido</p>
            <div class="mt-3 grid gap-3 md:grid-cols-3">
              <div v-for="(step, i) in [
                { t: 'Gere um token', d: 'Em Tokens & Auth, gere um token de Produção ou Sandbox. Copie na hora — ele só aparece uma vez.' },
                { t: 'Faça a 1ª chamada', d: 'Envie Authorization: Bearer SEU_TOKEN. Comece por GET /metrics ou GET /users/:id.' },
                { t: 'Trate resposta e erros', d: 'Respostas são JSON. Trate 400/401/403/404/429 (cada rota documenta os seus).' },
              ]" :key="i" class="rounded-lg p-3" style="background: var(--vex-surface-strong); border: 1px solid var(--vex-border-subtle)">
                <div class="flex size-6 items-center justify-center rounded-full text-xs font-black" style="background: var(--vex-brand); color: #fff">{{ i + 1 }}</div>
                <p class="mt-2 text-xs font-bold" style="color: var(--vex-text)">{{ step.t }}</p>
                <p class="mt-1 text-[11px]" style="color: var(--vex-text-muted)">{{ step.d }}</p>
              </div>
            </div>
          </div>
        </section>

        <!-- ── Tokens & Autenticação ────────────────────────────────────── -->
        <section id="tokens" class="scroll-mt-4 flex flex-col gap-4">
          <div class="vex-card p-5">
            <p class="text-base font-bold">Tokens & Autenticação</p>
            <p class="mt-1 text-xs" style="color: var(--vex-text-muted)">
              Dois ambientes independentes (um token ativo cada). Envie o token no header
              <code style="color: var(--vex-brand)">Authorization: Bearer SEU_TOKEN</code>. O token só enxerga
              <strong>você e os afiliados abaixo de você</strong> (até 10 níveis) — fora disso retorna <code>403</code>.
            </p>

            <div class="mt-4 grid gap-3 md:grid-cols-2">
              <div
                v-for="env in (['live', 'test'] as const)"
                :key="env"
                class="rounded-lg p-4"
                style="background: var(--vex-surface-strong); border: 1px solid var(--vex-border-subtle)"
              >
                <div class="flex items-center justify-between gap-2">
                  <span class="rounded px-2 py-0.5 text-[11px] font-black"
                    :style="env === 'live'
                      ? 'background: var(--vex-positive-soft-bg); color: var(--vex-positive-soft-text)'
                      : 'background: var(--vex-warning-soft-bg); color: var(--vex-warning-soft-text)'">
                    {{ env === 'live' ? 'PRODUÇÃO · vex_live_' : 'SANDBOX · vex_test_' }}
                  </span>
                  <div class="flex gap-1">
                    <UButton
                      :label="tokenStatus?.[env]?.active ? 'Regenerar' : 'Gerar'"
                      icon="i-lucide-key-round" size="xs" color="primary"
                      :loading="generatingEnv === env"
                      @click="generateTokenEnv(env)"
                    />
                    <UButton
                      v-if="tokenStatus?.[env]?.active"
                      icon="i-lucide-ban" size="xs" color="error" variant="soft"
                      :loading="revokingEnv === env"
                      @click="revokeTokenEnv(env)"
                    />
                  </div>
                </div>

                <div class="mt-3">
                  <div v-if="loading" class="text-sm" style="color: var(--vex-text-muted)">Carregando...</div>
                  <div v-else-if="revealedTokens[env]" class="flex flex-col gap-2">
                    <p class="text-[11px] font-bold uppercase tracking-wide" style="color: var(--vex-positive)">Token gerado agora — copie</p>
                    <div class="flex items-center gap-2">
                      <code class="min-w-0 flex-1 truncate rounded-md px-3 py-2 text-xs" style="background: var(--vex-bg); color: var(--vex-text)">{{ revealedTokens[env] }}</code>
                      <UButton icon="i-lucide-copy" size="xs" color="neutral" variant="soft" @click="copyText(revealedTokens[env], 'Token copiado')" />
                    </div>
                  </div>
                  <div v-else-if="tokenStatus?.[env]?.active" class="text-sm">
                    Token ativo terminando em <strong>{{ tokenStatus[env].token?.hint }}</strong>
                    <span v-if="tokenStatus[env].token?.lastUsedAt" style="color: var(--vex-text-muted)">
                      · último uso {{ new Date(tokenStatus[env].token!.lastUsedAt!).toLocaleString('pt-BR') }}
                    </span>
                  </div>
                  <div v-else class="text-sm" style="color: var(--vex-text-muted)">Nenhum token ativo.</div>
                </div>

                <div v-if="env === 'test'" class="mt-3 flex items-center justify-between gap-2 rounded-lg p-2" style="background: var(--vex-bg); border: 1px solid var(--vex-border-subtle)">
                  <span class="text-[11px]" style="color: var(--vex-text-muted)">Apaga todos os dados de teste do sandbox.</span>
                  <UButton icon="i-lucide-trash-2" size="xs" color="warning" variant="soft" label="Resetar sandbox" :loading="resettingSandbox" @click="resetSandbox" />
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- ── Sandbox ──────────────────────────────────────────────────── -->
        <section id="sandbox" class="scroll-mt-4">
          <div class="vex-card p-5" style="border-color: var(--vex-warning-soft-border, var(--vex-border-subtle))">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-flask-conical" class="size-5" style="color: var(--vex-warning-soft-text)" />
              <p class="text-base font-bold">Sandbox (modo teste)</p>
            </div>
            <p class="mt-2 text-sm" style="color: var(--vex-text-muted)">
              Use um token <code style="color: var(--vex-brand)">vex_test_</code> nas MESMAS rotas. As chamadas de teste são
              <strong>totalmente isoladas</strong> — não tocam dados reais, saldos, rankings nem pagamentos. Nada persiste de verdade.
            </p>
            <ul class="mt-3 flex flex-col gap-2 text-xs" style="color: var(--vex-text-muted)">
              <li class="flex items-start gap-2"><UIcon name="i-lucide-check" class="mt-0.5 size-3.5 shrink-0" style="color: var(--vex-positive)" /> Cada usuário externo de teste já vem com <strong>saldo semeado (~R$1000/casa)</strong>, então dá pra testar saque na hora.</li>
              <li class="flex items-start gap-2"><UIcon name="i-lucide-check" class="mt-0.5 size-3.5 shrink-0" style="color: var(--vex-positive)" /> Saques de teste seguem as mesmas regras (saldo total da casa, 1 saque/dia por casa, matriz de status).</li>
              <li class="flex items-start gap-2"><UIcon name="i-lucide-check" class="mt-0.5 size-3.5 shrink-0" style="color: var(--vex-positive)" /> <code>DELETE /v1/affiliate-api/sandbox</code> (com token de teste) zera tudo — ou use o botão <strong>Resetar sandbox</strong> acima.</li>
            </ul>
          </div>
        </section>

        <!-- ── Endpoints ────────────────────────────────────────────────── -->
        <section id="endpoints" class="scroll-mt-4 flex flex-col gap-4">
          <div class="vex-card p-5">
            <p class="text-base font-bold">Endpoints</p>
            <p class="mt-1 text-xs" style="color: var(--vex-text-muted)">
              Cada rota tem tudo junto: parâmetros, resposta, exemplos e um “Testar” que executa de verdade.
              Cole um token aqui para usar a aba Testar de qualquer rota (live ou sandbox).
            </p>
            <UFormField class="mt-3 max-w-md" label="Token para testar (live ou test)">
              <UInput v-model="playgroundToken" type="password" placeholder="Cole um token ou use o recém-gerado" />
            </UFormField>
          </div>

          <!-- GET /metrics -->
          <ApiEndpointCard
            anchor-id="ep-metrics" method="GET" path="/v1/affiliate-api/metrics"
            summary="Métricas agregadas suas e da sua rede (cliques, registros, FTDs, depósitos, CPA, RevShare, comissão)."
            auth-note="Bearer token · escopo: você + rede"
            :params="metricsParams"
            :response-example="respMetrics"
            :response-fields="responseFields"
            :errors="errorCodes"
            :curl="curlExample" :js="jsExample" :python="pythonExample"
          >
            <template #testar>
              <div class="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                <div class="flex flex-col gap-3">
                  <div class="grid gap-2 sm:grid-cols-2">
                    <UFormField label="Início"><UInput v-model="filters.startDate" type="date" /></UFormField>
                    <UFormField label="Fim"><UInput v-model="filters.endDate" type="date" /></UFormField>
                    <UFormField label="Casa"><USelect v-model="filters.houseSlug" :items="houseOptions" value-key="value" /></UFormField>
                    <UFormField label="Afiliado"><USelect v-model="filters.affiliateId" :items="affiliateOptions" value-key="value" /></UFormField>
                  </div>
                  <UButton label="Testar endpoint" icon="i-lucide-play" color="primary" :loading="testing" @click="runPlayground" />
                </div>
                <div>
                  <div class="mb-2 flex items-center justify-between gap-2">
                    <p class="text-xs font-bold uppercase tracking-wide" style="color: var(--vex-text-muted)">Resposta</p>
                    <UButton icon="i-lucide-copy" size="xs" color="neutral" variant="ghost" @click="copyText(playgroundResult, 'Resposta copiada')" />
                  </div>
                  <pre class="max-h-[24rem] min-h-[12rem] overflow-auto rounded-lg p-4 text-xs" style="background: var(--vex-bg); color: var(--vex-text); border: 1px solid var(--vex-border-subtle)">{{ playgroundResult }}</pre>
                </div>
              </div>
            </template>
          </ApiEndpointCard>

          <!-- POST /link-requests -->
          <ApiEndpointCard
            anchor-id="ep-linkreq" method="POST" path="/v1/affiliate-api/link-requests"
            summary="Solicita um link para um usuário do SEU painel. Criamos um usuário externo vinculado à sua conta (não acessa nosso painel, não conta em rankings). Repetir com o mesmo externalUserId reaproveita o usuário."
            auth-note="Bearer token"
            :params="pLinkReq"
            :request-example="linkRequestBodyExample"
            :response-example="respLinkReq"
            :errors="[{ code: '400', label: 'Bad Request', desc: 'externalUserId ausente.' }, { code: '401', label: 'Unauthorized', desc: 'Token ausente/invalido/revogado.' }]"
            :curl="exLinkReq.curl" :js="exLinkReq.js" :python="exLinkReq.python"
          />

          <!-- GET /users/:externalUserId -->
          <ApiEndpointCard
            anchor-id="ep-getuser" method="GET" path="/v1/affiliate-api/users/:externalUserId"
            summary="Consulta um usuário do SEU painel + o saldo dele (por casa e total)."
            auth-note="Bearer token"
            :params="pGetUser"
            :response-example="respGetUser"
            :errors="withdrawalErrorCodes"
            :curl="exGetUser.curl" :js="exGetUser.js" :python="exGetUser.python"
          >
            <template #testar>
              <div class="grid gap-4 lg:grid-cols-2">
                <div class="flex flex-col gap-3">
                  <UFormField label="externalUserId"><UInput v-model="wd.externalUserId" placeholder="id no SEU painel" /></UFormField>
                  <UFormField label="Casa (opcional)"><USelect v-model="wd.bettingHouse" :items="houseOptions" value-key="value" /></UFormField>
                  <UButton label="Executar" icon="i-lucide-play" color="primary" :loading="wdTesting" @click="wd.endpoint = 'getUser'; runWithdrawalPlayground()" />
                </div>
                <pre class="max-h-[24rem] min-h-[12rem] overflow-auto rounded-lg p-4 text-xs" style="background: var(--vex-bg); color: var(--vex-text); border: 1px solid var(--vex-border-subtle)">{{ wdResult }}</pre>
              </div>
            </template>
          </ApiEndpointCard>

          <!-- POST /withdrawals -->
          <ApiEndpointCard
            anchor-id="ep-createwd" method="POST" path="/v1/affiliate-api/withdrawals"
            summary="Cria um saque do SALDO TOTAL disponível da casa para o usuário. Vira histórico/prova dos dois lados."
            auth-note="Bearer token"
            :params="pCreateWd"
            :request-example="reqCreateWd"
            :response-example="respCreateWd"
            :errors="withdrawalErrorCodes"
            :notes="[
              { type: 'info', text: 'Saca o saldo total da casa (sem campo amount). Sem taxa (withdrawalFee = 0).' },
              { type: 'warning', text: '1 saque por DIA por casa por usuário: um 2º saque na mesma casa no mesmo dia retorna 429. No dia seguinte libera. Casa \'bonus\' não é suportada.' },
            ]"
            :curl="exCreateWd.curl" :js="exCreateWd.js" :python="exCreateWd.python"
          >
            <template #testar>
              <div class="grid gap-4 lg:grid-cols-2">
                <div class="flex flex-col gap-3">
                  <UFormField label="externalUserId"><UInput v-model="wd.externalUserId" placeholder="id no SEU painel" /></UFormField>
                  <UFormField label="Casa (obrigatório)"><USelect v-model="wd.bettingHouse" :items="houseOptions" value-key="value" /></UFormField>
                  <UFormField label="requestNote (opcional)"><UInput v-model="wd.requestNote" placeholder="Nota para o histórico" /></UFormField>
                  <UButton label="Executar" icon="i-lucide-play" color="primary" :loading="wdTesting" @click="wd.endpoint = 'createWithdrawal'; runWithdrawalPlayground()" />
                </div>
                <pre class="max-h-[24rem] min-h-[12rem] overflow-auto rounded-lg p-4 text-xs" style="background: var(--vex-bg); color: var(--vex-text); border: 1px solid var(--vex-border-subtle)">{{ wdResult }}</pre>
              </div>
            </template>
          </ApiEndpointCard>

          <!-- GET /withdrawals -->
          <ApiEndpointCard
            anchor-id="ep-listwd" method="GET" path="/v1/affiliate-api/withdrawals"
            summary="Histórico de saques (filtros por usuário, status, casa, datas + paginação)."
            auth-note="Bearer token"
            :params="pListWd"
            :response-example="respListWd"
            :response-fields="withdrawalFields"
            :errors="withdrawalErrorCodes"
            :curl="exListWd.curl" :js="exListWd.js" :python="exListWd.python"
          >
            <template #testar>
              <div class="grid gap-4 lg:grid-cols-2">
                <div class="flex flex-col gap-3">
                  <UFormField label="externalUserId (filtro, opcional)"><UInput v-model="wd.externalUserId" placeholder="id no SEU painel" /></UFormField>
                  <UFormField label="Status (filtro)"><USelect v-model="wd.listStatus" :items="wdListStatusOptions" value-key="value" /></UFormField>
                  <div class="grid grid-cols-2 gap-2">
                    <UFormField label="Página"><UInput v-model.number="wd.page" type="number" min="1" /></UFormField>
                    <UFormField label="Limite"><UInput v-model.number="wd.limit" type="number" min="1" max="100" /></UFormField>
                  </div>
                  <UButton label="Executar" icon="i-lucide-play" color="primary" :loading="wdTesting" @click="wd.endpoint = 'listWithdrawals'; runWithdrawalPlayground()" />
                </div>
                <pre class="max-h-[24rem] min-h-[12rem] overflow-auto rounded-lg p-4 text-xs" style="background: var(--vex-bg); color: var(--vex-text); border: 1px solid var(--vex-border-subtle)">{{ wdResult }}</pre>
              </div>
            </template>
          </ApiEndpointCard>

          <!-- GET /withdrawals/:id -->
          <ApiEndpointCard
            anchor-id="ep-getwd" method="GET" path="/v1/affiliate-api/withdrawals/:id"
            summary="Detalhe de um saque."
            auth-note="Bearer token"
            :params="pGetWd"
            :response-example="respGetWd"
            :response-fields="withdrawalFields"
            :errors="[{ code: '404', label: 'Not Found', desc: 'Saque fora da sua rede.' }]"
            :curl="exGetWd.curl" :js="exGetWd.js" :python="exGetWd.python"
          >
            <template #testar>
              <div class="grid gap-4 lg:grid-cols-2">
                <div class="flex flex-col gap-3">
                  <UFormField label="ID do saque"><UInput v-model="wd.withdrawalId" placeholder="id retornado na criação/listagem" /></UFormField>
                  <UButton label="Executar" icon="i-lucide-play" color="primary" :loading="wdTesting" @click="wd.endpoint = 'getWithdrawal'; runWithdrawalPlayground()" />
                </div>
                <pre class="max-h-[24rem] min-h-[12rem] overflow-auto rounded-lg p-4 text-xs" style="background: var(--vex-bg); color: var(--vex-text); border: 1px solid var(--vex-border-subtle)">{{ wdResult }}</pre>
              </div>
            </template>
          </ApiEndpointCard>

          <!-- PATCH /withdrawals/:id/status -->
          <ApiEndpointCard
            anchor-id="ep-patchwd" method="PATCH" path="/v1/affiliate-api/withdrawals/:id/status"
            summary="Atualiza o status do saque. COMPLETED desconta o saldo; REJECTED libera de volta."
            auth-note="Bearer token"
            :params="pPatchWd"
            :request-example="reqPatchWd"
            :response-example="respPatchWd"
            :errors="[{ code: '400', label: 'Bad Request', desc: 'Transição de status inválida.' }, { code: '404', label: 'Not Found', desc: 'Saque fora da sua rede.' }]"
            :notes="[{ type: 'info', text: 'Transições: PENDING → PROCESSING | COMPLETED | REJECTED; PROCESSING → COMPLETED | REJECTED. COMPLETED/REJECTED são terminais.' }]"
            :curl="exPatchWd.curl" :js="exPatchWd.js" :python="exPatchWd.python"
          >
            <template #testar>
              <div class="grid gap-4 lg:grid-cols-2">
                <div class="flex flex-col gap-3">
                  <UFormField label="ID do saque"><UInput v-model="wd.withdrawalId" placeholder="id do saque" /></UFormField>
                  <UFormField label="Novo status"><USelect v-model="wd.status" :items="wdStatusOptions" value-key="value" /></UFormField>
                  <UFormField label="note (opcional)"><UInput v-model="wd.note" placeholder="Observação" /></UFormField>
                  <UButton label="Executar" icon="i-lucide-play" color="primary" :loading="wdTesting" @click="wd.endpoint = 'setStatus'; runWithdrawalPlayground()" />
                </div>
                <pre class="max-h-[24rem] min-h-[12rem] overflow-auto rounded-lg p-4 text-xs" style="background: var(--vex-bg); color: var(--vex-text); border: 1px solid var(--vex-border-subtle)">{{ wdResult }}</pre>
              </div>
            </template>
          </ApiEndpointCard>
        </section>

        <!-- ── Webhooks ─────────────────────────────────────────────────── -->
        <section id="webhooks" class="scroll-mt-4 flex flex-col gap-4">
          <div class="vex-card p-5">
            <p class="text-base font-bold">Webhooks</p>
            <p class="mt-1 text-xs" style="color: var(--vex-text-muted)">
              Configure a URL e os eventos na página
              <NuxtLink to="/link-webhooks" class="font-bold" style="color: var(--vex-brand)">Webhooks de Links</NuxtLink>
              (lá também há um <strong>enviar teste</strong>). Veja as entregas em
              <NuxtLink to="/webhook-events" class="font-bold" style="color: var(--vex-brand)">Eventos de Webhook</NuxtLink>.
              Cada evento é um POST JSON assinado.
            </p>
            <div class="mt-4 overflow-x-auto rounded-lg" style="border: 1px solid var(--vex-border-subtle)">
              <table class="w-full text-[12px] min-w-[420px]">
                <thead>
                  <tr style="background: var(--vex-surface-strong); border-bottom: 1px solid var(--vex-border-subtle)">
                    <th class="px-3 py-2 text-left font-bold" style="color: var(--vex-text-faint)">Evento</th>
                    <th class="px-3 py-2 text-left font-bold" style="color: var(--vex-text-faint)">Quando dispara</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="ev in allWebhookPayloads" :key="ev.name" style="border-bottom: 1px solid var(--vex-border-subtle)">
                    <td class="px-3 py-2"><code style="color: var(--vex-brand)">{{ ev.name }}</code></td>
                    <td class="px-3 py-2" style="color: var(--vex-text-muted)">{{ ev.desc }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div class="vex-card p-5">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <p class="text-sm font-bold">Exemplos de payload — por evento</p>
              <UButton icon="i-lucide-copy" label="Copiar" color="neutral" variant="soft" @click="copyText(selectedWhPayload.json, 'Payload copiado')" />
            </div>
            <div class="mt-3 flex flex-wrap gap-2">
              <button
                v-for="ev in allWebhookPayloads" :key="ev.name"
                class="rounded-md px-2.5 py-1 text-[11px] font-bold"
                :style="selectedWh === ev.name ? 'background: var(--vex-brand); color: #fff' : 'background: var(--vex-surface-strong); color: var(--vex-text-muted); border: 1px solid var(--vex-border-subtle)'"
                @click="selectedWh = ev.name"
              >{{ ev.name }}</button>
            </div>
            <p class="mt-3 text-[12px]" style="color: var(--vex-text-muted)">{{ selectedWhPayload.desc }}</p>
            <pre class="mt-2 max-h-[26rem] overflow-auto rounded-lg p-3 text-[12px] leading-relaxed" style="background: var(--vex-bg); color: var(--vex-text); border: 1px solid var(--vex-border-subtle)">{{ selectedWhPayload.json }}</pre>
          </div>

          <div class="vex-card p-5">
            <div class="flex items-start gap-2 rounded-lg p-3 text-[12px]" style="background: var(--vex-info-soft-bg); border: 1px solid var(--vex-info-soft-border); color: var(--vex-text-muted)">
              <UIcon name="i-lucide-info" class="mt-0.5 size-4 shrink-0" style="color: var(--vex-info-soft-text)" />
              <span>Responda <code style="color: var(--vex-brand)">200</code> (qualquer 2xx) em até 15s. Outro status, timeout ou erro = falha → reenviamos com backoff (até 6 tentativas); depois fica <code>FAILED</code> (reenviável pelo histórico). Valide a assinatura, enfileire o processamento e responda 200 na hora.</span>
            </div>

            <UCollapsible class="mt-4">
              <UButton label="Verificação de assinatura (HMAC-SHA256)" trailing-icon="i-lucide-chevron-down" color="neutral" variant="soft" block class="justify-between" />
              <template #content>
                <p class="mb-3 mt-3 text-[12px]" style="color: var(--vex-text-muted)">
                  Calcule <code>HMAC-SHA256(secret, "{{ '{timestamp}.{corpo-bruto}' }}")</code> e compare com o header
                  <code style="color: var(--vex-brand)">x-vallex-signature</code>. Use <code style="color: var(--vex-brand)">x-vallex-timestamp</code> para rejeitar requisições antigas (replay).
                </p>
                <p class="mb-1 text-[11px] font-bold" style="color: var(--vex-text-faint)">Node.js</p>
                <pre class="overflow-x-auto rounded-lg p-3 text-[12px]" style="background: var(--vex-surface-strong); border: 1px solid var(--vex-border-subtle); color: var(--vex-text-muted)">{{ verifyNode }}</pre>
                <p class="mb-1 mt-3 text-[11px] font-bold" style="color: var(--vex-text-faint)">Python</p>
                <pre class="overflow-x-auto rounded-lg p-3 text-[12px]" style="background: var(--vex-surface-strong); border: 1px solid var(--vex-border-subtle); color: var(--vex-text-muted)">{{ verifyPython }}</pre>
              </template>
            </UCollapsible>
          </div>
        </section>

        <!-- ── Spec para IA ─────────────────────────────────────────────── -->
        <section id="spec-ia" class="scroll-mt-4">
          <div class="vex-card p-5" style="border-color: var(--vex-brand); background: var(--vex-brand-muted)">
            <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div class="flex items-start gap-3">
                <div class="flex size-9 items-center justify-center rounded-lg" style="background: var(--vex-brand); color: #fff">
                  <UIcon name="i-lucide-sparkles" class="size-5" />
                </div>
                <div>
                  <p class="text-sm font-bold">Integração automática com IA</p>
                  <p class="mt-1 max-w-2xl text-xs" style="color: var(--vex-text-muted)">
                    Copie a especificação completa (API, webhooks, assinatura, payloads) e cole no ChatGPT, Claude ou na sua IA —
                    é só pedir para gerar o código de integração.
                  </p>
                </div>
              </div>
              <UButton icon="i-lucide-clipboard-copy" label="Copiar documentação para IA" color="primary" @click="copyText(llmDoc, 'Documentação para IA copiada — cole na sua IA')" />
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
