<script setup lang="ts">
definePageMeta({ layout: 'default' })

const formatCurrency = (val: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val)

const formatDate = (iso: string) => {
  const d = new Date(iso)
  return {
    date: d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }),
    time: d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
  }
}

// ─── Composable ────────────────────────────────────────────────────────────────────────
const {
  items,
  total,
  page,
  limit,
  totalPages,
  loadingList,
  statusFilter,
  balance,
  originalBalance,
  grossBalance,
  feeAmount,
  feeRate,
  bonusAvailable,
  withdrawableTotal,
  withdrawableNet,
  minWithdrawalAmount,
  loadingBalance,
  directFraud,
  networkFraud,
  totalFraud,
  fraudDetails,
  networkFraudDetails,
  directFraudDetails,
  loadingFraudDetails,
  cpa,
  rev,
  networkCpa,
  networkRev,
  approvedWithdrawals,
  withdrawalsApproved,
  withdrawalsPending,
  meData,
  hasPix,
  savingPix,
  submitting,
  submitError,
  requestWithdrawal,
  savePix,
  fetchList,
  loadingReceipt,
  fetchReceipt,
  withdrawalRules,
  loadingRules,
  selectedHouse,
  init,
} = useWithdrawals()

// Derived: rule for the currently-selected house (drives modal preview + validation)
const selectedRule = computed(() =>
  withdrawalRules.value.find((r) => r.slug === selectedHouse.value) ?? null,
)
const selectedHouseBalance = computed(() => selectedRule.value?.availableBalance ?? 0)
// A casa não atinge o mínimo de CPAs qualificados exigido.
function isCpaBlocked(r: { minCpaToWithdraw: number; cpaCount: number }): boolean {
  return r.minCpaToWithdraw > 0 && r.cpaCount < r.minCpaToWithdraw
}
// Bônus não tem valor mínimo de saque — qualquer valor > 0 é sacável.
// As demais casas exigem o mínimo global (min_withdrawal_amount).
function meetsMinimum(r: { slug: string; availableBalance: number; minWithdrawalAmount?: number }): boolean {
  // Bônus não tem mínimo; demais casas usam o mínimo POR CASA (rule) com
  // fallback no global.
  return r.slug === 'bonus'
    ? r.availableBalance > 0
    : r.availableBalance >= (r.minWithdrawalAmount ?? minWithdrawalAmount.value)
}
function ruleEligible(r: {
  slug: string
  allowedToday: boolean
  availableBalance: number
  minCpaToWithdraw: number
  cpaCount: number
  withdrawalEnabled?: boolean
  dayReleaseAvailable?: boolean
}): boolean {
  return (
    r.allowedToday
    && (r.withdrawalEnabled ?? true)
    && meetsMinimum(r)
    && !isCpaBlocked(r)
    // Liberação de saque extra do admin tem precedência sobre o limite 1/dia.
    && (r.dayReleaseAvailable === true || !housesWithdrawnToday.value.has(r.slug))
  )
}
const anyHouseEligible = computed(() =>
  withdrawalRules.value.some((r) => ruleEligible(r)),
)
function formatNextDate(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

// ─── Receipt modal state ──────────────────────────────────────────────────────
const receiptOpen = ref(false)
const receiptError = ref<string | null>(null)
const receiptBase64 = ref<string | null>(null)
const receiptFormat = ref<string>('png')
const receiptEndToEnd = ref<string | null>(null)
const receiptWithdrawalId = ref<string | null>(null)

const receiptDataUrl = computed(() =>
  receiptBase64.value ? `data:image/${receiptFormat.value};base64,${receiptBase64.value}` : null,
)

async function openReceipt(item: { id: string; status: string }) {
  if (item.status !== 'COMPLETED' && item.status !== 'FAILED') return
  receiptOpen.value = true
  receiptError.value = null
  receiptBase64.value = null
  receiptEndToEnd.value = null
  receiptWithdrawalId.value = item.id
  const res = await fetchReceipt(item.id)
  if ('error' in res) {
    receiptError.value = res.error
    return
  }
  receiptBase64.value = res.base64
  receiptFormat.value = res.format || 'png'
  receiptEndToEnd.value = res.endToEndId ?? null
}

function closeReceipt() {
  receiptOpen.value = false
  receiptBase64.value = null
  receiptError.value = null
  receiptEndToEnd.value = null
  receiptWithdrawalId.value = null
}

function downloadReceipt() {
  if (!receiptDataUrl.value) return
  const a = document.createElement('a')
  a.href = receiptDataUrl.value
  a.download = `comprovante-${receiptWithdrawalId.value ?? 'saque'}.${receiptFormat.value}`
  document.body.appendChild(a)
  a.click()
  a.remove()
}

// ─── Fraud derived ────────────────────────────────────────────────────────────────────
const hasFraud = computed(() => totalFraud.value > 0)

// House-level aggregation (for the waterfall summary)
const fraudByHouse = computed(() => {
  const map = new Map<string, { house: string; direct: number; directCount: number; network: number; networkCount: number }>()
  for (const f of fraudDetails.value) {
    const key = f.bettingHouse
    if (!map.has(key)) map.set(key, { house: key, direct: 0, directCount: 0, network: 0, networkCount: 0 })
    const row = map.get(key)!
    if (f.source === 'direct') { row.direct += f.deduction; row.directCount += f.fraudCount }
    else { row.network += f.deduction; row.networkCount += f.fraudCount }
  }
  return [...map.values()]
})

// ─── Fraud tab filters ────────────────────────────────────────────────────────
const { resolvedSlug: globalHouseSlug, getHouseName } = useHouseFilter()
const fraudSearch = ref('')
const fraudHouseFilter = ref<string>('all')
const fraudSourceFilter = ref<'all' | 'direct' | 'network'>('all')

watch(globalHouseSlug, (slug) => {
  fraudHouseFilter.value = slug ?? 'all'
}, { immediate: true })

// All unique houses from the detailed list
const fraudHouseOptions = computed(() => {
  const houses = new Set<string>()
  for (const f of networkFraudDetails.value) houses.add(f.bettingHouse)
  for (const f of directFraudDetails.value) houses.add(f.bettingHouse)
  return ['all', ...Array.from(houses).sort()]
})

// Flat member-level rows for the detailed fraud table
interface FraudMemberRow {
  memberId: string
  memberName: string
  memberEmail: string
  memberStatus?: string
  bettingHouse: string
  fraudCount: number
  cpaRate: number
  deduction: number
  source: 'direct' | 'network'
}

const allFraudRows = computed<FraudMemberRow[]>(() => [
  ...directFraudDetails.value.map(f => ({
    memberId: f.memberId ?? 'me',
    memberName: f.memberName ?? 'Você (direto)',
    memberEmail: f.memberEmail ?? '',
    memberStatus: f.memberStatus,
    bettingHouse: f.bettingHouse,
    fraudCount: f.fraudCount,
    cpaRate: f.cpaRate,
    deduction: f.deduction,
    source: 'direct' as const,
  })),
  ...networkFraudDetails.value.map(f => ({
    memberId: f.memberId ?? '',
    memberName: f.memberName ?? 'Desconhecido',
    memberEmail: f.memberEmail ?? '',
    memberStatus: f.memberStatus,
    bettingHouse: f.bettingHouse,
    fraudCount: f.fraudCount,
    cpaRate: f.cpaRate,
    deduction: f.deduction,
    source: 'network' as const,
  })),
])

const filteredFraudRows = computed(() => {
  const q = fraudSearch.value.toLowerCase().trim()
  return allFraudRows.value.filter(r => {
    if (fraudHouseFilter.value !== 'all' && r.bettingHouse !== fraudHouseFilter.value) return false
    if (fraudSourceFilter.value !== 'all' && r.source !== fraudSourceFilter.value) return false
    if (q && !r.memberName.toLowerCase().includes(q) && !r.memberEmail.toLowerCase().includes(q) && !r.bettingHouse.toLowerCase().includes(q)) return false
    return true
  })
})

const filteredFraudTotal = computed(() => filteredFraudRows.value.reduce((s, r) => s + r.deduction, 0))
const filteredFraudCount = computed(() => filteredFraudRows.value.reduce((s, r) => s + r.fraudCount, 0))

// Group by member for the member-level view
const fraudByMember = computed(() => {
  const map = new Map<string, { memberId: string; memberName: string; memberEmail: string; memberStatus?: string; houses: string[]; totalFrauds: number; totalDeduction: number; source: 'direct' | 'network' }>()
  for (const r of filteredFraudRows.value) {
    const key = r.memberId || r.memberEmail
    if (!map.has(key)) map.set(key, { memberId: r.memberId, memberName: r.memberName, memberEmail: r.memberEmail, memberStatus: r.memberStatus, houses: [], totalFrauds: 0, totalDeduction: 0, source: r.source })
    const m = map.get(key)!
    if (!m.houses.includes(r.bettingHouse)) m.houses.push(r.bettingHouse)
    m.totalFrauds += r.fraudCount
    m.totalDeduction += r.deduction
  }
  return [...map.values()].sort((a, b) => b.totalDeduction - a.totalDeduction)
})

// Tracks successfully blocked users — populated from API data AND from actions in the current session
const blockedUserIds = ref(new Set<string>())

// Pre-populate blockedUserIds when API returns already-blocked members
watch(networkFraudDetails, (details) => {
  const alreadyBlocked = details
    .filter(f => f.memberId && f.memberStatus === 'BLOCKED')
    .map(f => f.memberId!)
  if (alreadyBlocked.length > 0) {
    blockedUserIds.value = new Set([...blockedUserIds.value, ...alreadyBlocked])
  }
}, { immediate: true })

// ─── PIX Form State ──────────────────────────────────────────────────────────
const pixForm = reactive({
  pixKeyType: '',
  pixKey: '',
  accountHolder: '',
  bankName: '',
  bankAgency: '',
  bankAccount: '',
})

// Fill form when meData loads
watch(meData, (val) => {
  if (!val) return
  pixForm.pixKeyType = val.pixKeyType || ''
  pixForm.pixKey = val.pixKey || ''
  pixForm.accountHolder = val.accountHolder || ''
  pixForm.bankName = val.bankName || ''
  pixForm.bankAgency = val.bankAgency || ''
  pixForm.bankAccount = val.bankAccount || ''
}, { immediate: true })

// ─── Tabs ────────────────────────────────────────────────────────────────────
type Tab = 'overview' | 'withdrawals' | 'fraud' | 'pix'
const activeTab = ref<Tab>('overview')

// ─── Modal ───────────────────────────────────────────────────────────────────
const showWithdrawModal = ref(false)
const withdrawalNote = ref('')
const toast = useToast()

// Limite de saque é 1 por dia POR CASA. Casas que já tiveram um saque ATIVO
// (não rejeitado/falho) hoje ficam bloqueadas só elas — as demais seguem livres.
const ACTIVE_WD_STATUSES = ['PENDING', 'APPROVED', 'PROCESSING', 'COMPLETED']
const housesWithdrawnToday = computed(() => {
  const today = new Date().toISOString().slice(0, 10)
  const set = new Set<string>()
  for (const w of items.value) {
    if (ACTIVE_WD_STATUSES.includes(w.status) && w.createdAt.slice(0, 10) === today) {
      set.add(w.bettingHouse)
    }
  }
  return set
})

// Computed guard: button disabled state — per-casa: pelo menos uma casa precisa
// estar em janela, acima do mínimo, sem saque hoje e com PIX configurado.
const canWithdraw = computed(() =>
  !loadingBalance.value
  && !loadingRules.value
  && anyHouseEligible.value
  && hasPix.value
  && !submitting.value,
)

// Bloqueado pelo limite diário: já sacou de alguma casa hoje e não há outra
// casa elegível restante (rótulo/aviso do botão).
const blockedByDailyLimit = computed(() =>
  housesWithdrawnToday.value.size > 0 && !anyHouseEligible.value,
)

// Total de ganhos (comissão own + rede, bruto antes de saques/taxa)
const totalEarnings = computed(
  () => cpa.value + rev.value + networkCpa.value + networkRev.value,
)

// Quanto pode sacar HOJE (casas em janela e acima do mínimo)
const eligibleTodayTotal = computed(() =>
  withdrawalRules.value
    .filter((r) => r.allowedToday && meetsMinimum(r))
    .reduce((sum, r) => sum + r.availableBalance, 0),
)

// Bônus líquido (após taxa) e total líquido disponível = casas + bônus.
// O `balance` do backend exclui o bônus; somamos aqui para o headline refletir
// o que o afiliado realmente saca (ex.: só bônus 500 → 470 líquido).
// Fonte única do backend (sem double-count): sacável líquido = withdrawableNet.
const netWithdrawable = computed(() => withdrawableNet.value)
const bonusNet = computed(() => bonusAvailable.value * (1 - feeRate.value))
// Parte das casas (sacável) = total − bônus, líquido de taxa.
const houseWithdrawableNet = computed(
  () => Math.max(0, withdrawableTotal.value - bonusAvailable.value) * (1 - feeRate.value),
)

// Origem dos ganhos: própria vs rede (downline). Deixa explícito quando o saldo
// vem da rede — afiliado pode estranhar saldo sem produção individual.
const ownEarnings = computed(() => cpa.value + rev.value)
const networkEarnings = computed(() => networkCpa.value + networkRev.value)
const houseBalanceOrigin = computed(() => {
  if (ownEarnings.value > 0 && networkEarnings.value > 0) return 'produção individual + rede'
  if (networkEarnings.value > 0) return 'Produção da sua rede'
  return 'produção individual'
})

// Casas com saldo acima do mínimo mas FORA da janela de saque hoje
const lockedHouses = computed(() =>
  withdrawalRules.value
    .filter((r) => !r.allowedToday && meetsMinimum(r))
    .sort((a, b) => (a.nextWithdrawalDate ?? '').localeCompare(b.nextWithdrawalDate ?? '')),
)

// Motivo explícito de por que o saque está indisponível (null = pode sacar)
const withdrawBlockReason = computed<string | null>(() => {
  if (canWithdraw.value) return null
  if (loadingBalance.value || loadingRules.value) return null
  if (!hasPix.value)
    return 'Configure sua chave PIX na aba "Conta PIX" para liberar saques.'
  if (blockedByDailyLimit.value)
    return 'Você já solicitou saque hoje de todas as casas disponíveis. Cada casa permite 1 saque por dia — tente novamente amanhã.'
  const disabledWithBalance = withdrawalRules.value.filter(
    (r) => r.withdrawalEnabled === false && meetsMinimum(r),
  )
  if (disabledWithBalance.length > 0 && eligibleTodayTotal.value === 0)
    return 'Saques estão temporariamente desativados para suas casas. Tente novamente mais tarde.'
  if (lockedHouses.value.length > 0)
    return 'Seu saldo está em casas fora da janela de saque de hoje. Confira as próximas datas abaixo.'
  return `Nenhuma casa atingiu o mínimo de ${formatCurrency(minWithdrawalAmount.value)} disponível para saque. Veja abaixo o saldo de cada casa e o que falta.`
})

// Detalhamento por casa: saldo atual + motivo específico de bloqueio (para o usuário entender exatamente o porquê)
interface HouseStatus {
  slug: string
  name: string
  isBonus: boolean
  availableBalance: number
  eligible: boolean
  reason: string
}
const houseStatuses = computed<HouseStatus[]>(() =>
  withdrawalRules.value
    // Mostrar todas as casas ativas (o backend já devolve só active:true).
    .map((r) => {
      const isBonus = r.slug === 'bonus'
      let eligible = false
      let reason: string
      if (r.withdrawalRestriction === 'METRICS_SYNCING') {
        reason = 'Sincronizando o histórico da Pinbet para calcular seu limite com segurança'
      } else if (r.withdrawalRestriction === 'NET_PL_NON_POSITIVE') {
        reason = 'O Net P&L está zerado ou negativo; o disponível para saque fica em R$ 0,00'
      } else if (!meetsMinimum(r)) {
        const falta = minWithdrawalAmount.value - r.availableBalance
        reason = `Faltam ${formatCurrency(falta)} para atingir o mínimo de ${formatCurrency(minWithdrawalAmount.value)}`
      } else if (isCpaBlocked(r)) {
        reason = `Faltam CPAs qualificados nesta casa (${r.cpaCount}/${r.minCpaToWithdraw})`
      } else if (r.withdrawalEnabled === false) {
        reason = 'Saque temporariamente desativado para esta casa'
      } else if (housesWithdrawnToday.value.has(r.slug) && r.dayReleaseAvailable && r.allowedToday) {
        eligible = true
        reason = 'Saque extra liberado pelo admin — disponível agora'
      } else if (housesWithdrawnToday.value.has(r.slug)) {
        reason = 'Você já solicitou um saque desta casa hoje (limite: 1 por dia)'
      } else if (!r.allowedToday) {
        reason = isBonus
          ? 'Bônus disponível a qualquer momento'
          : `Fora da janela de saque — libera em ${formatNextDate(r.nextWithdrawalDate) || '—'}`
        eligible = isBonus
      } else {
        eligible = true
        reason = 'Disponível para saque agora'
      }
      return { slug: r.slug, name: r.name, isBonus, availableBalance: r.availableBalance, eligible, reason }
    })
    .sort((a, b) => b.availableBalance - a.availableBalance),
)

// ─── Distribuição do Saldo (sempre visível, independente do botão) ───────────
// Para cada casa com saldo (ou bloqueio de CPA): bruto, taxa (6%), líquido +
// status visual (ícone + tom). Mata a necessidade de abrir o modal só pra ver
// o detalhe do que cai na conta.
interface HouseBreakdown {
  slug: string
  name: string
  isBonus: boolean
  gross: number
  fee: number
  net: number
  eligible: boolean
  reason: string
  statusIcon: 'check' | 'lock' | 'clock' | 'alert' | 'ban'
  statusTone: 'positive' | 'warning' | 'muted' | 'negative'
  frequencyLabel: string
  financialBalance: number
  netPl: number | null
  netPlWithdrawalLimit: number | null
  netPlLimitConsumed: number
  isPinbet: boolean
}

const houseBreakdown = computed<HouseBreakdown[]>(() =>
  withdrawalRules.value
    // Mostrar todas as casas ativas (o backend já devolve só active:true).
    .map<HouseBreakdown>((r) => {
      const isBonus = r.slug === 'bonus'
      const gross = r.availableBalance
      const fee = gross * feeRate.value
      const net = gross - fee

      let eligible = false
      let reason: string
      let statusIcon: HouseBreakdown['statusIcon'] = 'lock'
      let statusTone: HouseBreakdown['statusTone'] = 'muted'

      if (r.withdrawalRestriction === 'METRICS_SYNCING') {
        reason = 'Sincronizando o histórico da Pinbet'
        statusIcon = 'clock'
        statusTone = 'warning'
      } else if (r.withdrawalRestriction === 'NET_PL_NON_POSITIVE') {
        reason = 'Net P&L zerado ou negativo: saque indisponível'
        statusIcon = 'ban'
        statusTone = 'negative'
      } else if (
        r.withdrawalRestriction === 'NET_PL_CAP'
        && r.availableBalance <= 0
        && r.netPlLimitConsumed > 0
      ) {
        reason = `Seus saques anteriores já consumiram o limite atual: você já sacou ${formatCurrency(r.netPlLimitConsumed)} nesta casa`
        statusIcon = 'ban'
        statusTone = 'warning'
      } else if (!meetsMinimum(r)) {
        const falta = minWithdrawalAmount.value - r.availableBalance
        reason = `Faltam ${formatCurrency(falta)} para o mínimo de ${formatCurrency(minWithdrawalAmount.value)}`
        statusIcon = 'alert'
        statusTone = 'muted'
      } else if (isCpaBlocked(r)) {
        reason = `Faltam CPAs qualificados (${r.cpaCount}/${r.minCpaToWithdraw})`
        statusIcon = 'lock'
        statusTone = 'warning'
      } else if (r.withdrawalEnabled === false) {
        reason = 'Saque temporariamente desativado'
        statusIcon = 'ban'
        statusTone = 'negative'
      } else if (housesWithdrawnToday.value.has(r.slug) && r.dayReleaseAvailable && r.allowedToday) {
        reason = 'Saque extra liberado pelo admin — disponível agora'
        eligible = true
        statusIcon = 'check'
        statusTone = 'positive'
      } else if (housesWithdrawnToday.value.has(r.slug)) {
        reason = 'Você já sacou desta casa hoje'
        statusIcon = 'ban'
        statusTone = 'warning'
      } else if (!r.allowedToday) {
        if (isBonus) {
          reason = 'Bônus disponível a qualquer momento'
          eligible = true
          statusIcon = 'check'
          statusTone = 'positive'
        } else {
          reason = `Próxima janela: ${formatNextDate(r.nextWithdrawalDate) || '—'}`
          statusIcon = 'clock'
          statusTone = 'warning'
        }
      } else {
        reason = 'Disponível para saque agora'
        eligible = true
        statusIcon = 'check'
        statusTone = 'positive'
      }

      return {
        slug: r.slug,
        name: r.name,
        isBonus,
        gross,
        fee,
        net,
        eligible,
        reason,
        statusIcon,
        statusTone,
        frequencyLabel: r.frequencyLabel,
        financialBalance: r.financialBalance,
        netPl: r.netPl,
        netPlWithdrawalLimit: r.netPlWithdrawalLimit,
        netPlLimitConsumed: r.netPlLimitConsumed,
        isPinbet: r.slug === 'pinbet-diario' || r.slug === 'pinbet-mensal',
      }
    })
    // Elegíveis primeiro (bônus elegível no topo), depois bloqueadas; desc por bruto
    .sort((a, b) => {
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1
      if (a.isBonus !== b.isBonus && (a.eligible || b.eligible)) return a.isBonus ? -1 : 1
      return b.gross - a.gross
    }),
)

// Totais agregados (só elegíveis hoje somam p/ líquido sacável agora).
const breakdownTotals = computed(() => {
  const eligible = houseBreakdown.value.filter((h) => h.eligible)
  return {
    grossEligible: eligible.reduce((s, h) => s + h.gross, 0),
    feeEligible: eligible.reduce((s, h) => s + h.fee, 0),
    netEligible: eligible.reduce((s, h) => s + h.net, 0),
  }
})

// Mapas de ícone/tom p/ o template (Lucide + vex tokens)
const STATUS_ICON_MAP: Record<HouseBreakdown['statusIcon'], string> = {
  check: 'i-lucide-circle-check',
  lock: 'i-lucide-lock',
  clock: 'i-lucide-clock',
  alert: 'i-lucide-alert-triangle',
  ban: 'i-lucide-ban',
}
const STATUS_TONE_COLOR: Record<HouseBreakdown['statusTone'], string> = {
  positive: 'var(--vex-positive)',
  warning: 'var(--vex-warning)',
  negative: 'var(--vex-negative)',
  muted: 'var(--vex-text-faint)',
}

function reqWithdraw() {
  if (!hasPix.value) {
    toast.add({
      title: 'Configure sua chave PIX primeiro',
      description: 'Preencha os dados de pagamento antes de solicitar um saque.',
      color: 'warning',
      icon: 'i-lucide-alert-triangle',
    })
    return
  }
  if (!anyHouseEligible.value) {
    toast.add({
      title: 'Nenhuma casa disponível para saque',
      description: `Saldo mínimo por casa: ${formatCurrency(minWithdrawalAmount.value)}. Verifique a cadência de cada casa.`,
      color: 'warning',
      icon: 'i-lucide-alert-triangle',
    })
    return
  }
  // Pre-select first eligible house (user can change inside modal)
  if (!selectedRule.value || !ruleEligible(selectedRule.value)) {
    const firstEligible = withdrawalRules.value.find((r) => ruleEligible(r))
    selectedHouse.value = firstEligible?.slug ?? null
  }
  withdrawalNote.value = ''
  showWithdrawModal.value = true
}

async function confirmWithdraw() {
  if (!selectedHouse.value) {
    toast.add({
      title: 'Escolha uma casa',
      description: 'Selecione a casa de origem do saque antes de confirmar.',
      color: 'warning',
      icon: 'i-lucide-alert-triangle',
    })
    return
  }
  const houseSlug = selectedHouse.value
  const houseName = selectedRule.value?.name ?? houseSlug
  const amountToShow = selectedHouseBalance.value
  const result = await requestWithdrawal(houseSlug, withdrawalNote.value)
  showWithdrawModal.value = false
  if (result.success) {
    toast.add({
      title: 'Saque solicitado!',
      description: `Pedido de ${formatCurrency(amountToShow)} (${houseName}) enviado para análise.`,
      color: 'success',
      icon: 'i-lucide-check-circle',
    })
  } else {
    toast.add({
      title: 'Não foi possível solicitar o saque',
      description: result.error ?? 'Tente novamente.',
      color: 'error',
      icon: 'i-lucide-x-circle',
    })
  }
}

async function onSavePix() {
  const result = await savePix({
    pixKeyType: pixForm.pixKeyType,
    pixKey: pixForm.pixKey,
    accountHolder: pixForm.accountHolder,
    bankName: pixForm.bankName,
    bankAgency: pixForm.bankAgency,
    bankAccount: pixForm.bankAccount,
  })
  if (result.success) {
    toast.add({ title: 'Dados PIX atualizados!', color: 'success', icon: 'i-lucide-check-circle' })
  } else {
    toast.add({ title: 'Erro ao salvar', description: result.error, color: 'error', icon: 'i-lucide-x-circle' })
  }
}

// ─── Status config ───────────────────────────────────────────────────────────
const statusConfig: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  PENDING:    { label: 'Em Análise',   color: 'var(--vex-warning)',  bg: 'var(--vex-warning-light)',  icon: 'i-lucide-clock' },
  APPROVED:   { label: 'Aprovado',     color: 'var(--vex-info)',     bg: 'var(--vex-info-soft-bg)',   icon: 'i-lucide-check' },
  PROCESSING: { label: 'Processando',  color: 'var(--vex-brand)',    bg: 'var(--vex-brand-soft-bg)',  icon: 'i-lucide-loader-circle' },
  COMPLETED:  { label: 'Pago',         color: 'var(--vex-positive)', bg: 'var(--vex-positive-light)', icon: 'i-lucide-check-circle' },
  REJECTED:   { label: 'Recusado',     color: 'var(--vex-negative)', bg: 'var(--vex-negative-light)', icon: 'i-lucide-x-circle' },
  FAILED:     { label: 'Falhou',       color: 'var(--vex-negative)', bg: 'var(--vex-negative-light)', icon: 'i-lucide-alert-triangle' },
}

// ─── Filtro do histórico de saques ───────────────────────────────────────────
const statusFilterOptions = [
  { value: '', label: 'Todos os status' },
  { value: 'PENDING', label: 'Em Análise' },
  { value: 'APPROVED', label: 'Aprovado' },
  { value: 'PROCESSING', label: 'Processando' },
  { value: 'COMPLETED', label: 'Pago' },
  { value: 'REJECTED', label: 'Recusado' },
  { value: 'FAILED', label: 'Falhou' },
]

function onStatusFilterChange() {
  // Volta para a primeira página ao trocar o filtro para evitar páginas vazias.
  fetchList(1)
}

const pixKeyTypeOptions = [
  { label: 'CPF', value: 'cpf' },
  { label: 'CNPJ', value: 'cnpj' },
  { label: 'E-mail', value: 'email' },
  { label: 'Telefone', value: 'phone' },
  { label: 'Chave Aleatória', value: 'random' },
]

// ─── Block User (Fraud Tab) ──────────────────────────────────────────────────
const { authHeaders } = useAuth()
const apiBase = useApiBase()

interface BlockTarget {
  memberId: string
  memberName: string
  memberEmail: string
}

const blockTarget = ref<BlockTarget | null>(null)
const blockingUserId = ref<string | null>(null) // tracks which user is currently being blocked
const showBlockModal = ref(false)

function openBlockModal(m: BlockTarget) {
  blockTarget.value = m
  showBlockModal.value = true
}

async function confirmBlock() {
  if (!blockTarget.value?.memberId) return
  const id = blockTarget.value.memberId
  blockingUserId.value = id
  try {
    await $fetch(`${apiBase}/v1/users/${id}/block`, {
      method: 'POST',
      headers: authHeaders(),
    })
    // Mark as blocked immediately for optimistic UI
    blockedUserIds.value = new Set([...blockedUserIds.value, id])
    toast.add({
      title: '🚫 Usuário bloqueado',
      description: `${blockTarget.value.memberName} foi bloqueado da plataforma.`,
      color: 'success',
      icon: 'i-lucide-shield-off',
    })
    showBlockModal.value = false
    blockTarget.value = null
    // Sync backend state in background
    init()
  } catch (err: any) {
    const detail = err?.data?.detail ?? err?.message ?? 'Tente novamente.'
    toast.add({
      title: 'Erro ao bloquear usuário',
      description: detail,
      color: 'error',
      icon: 'i-lucide-x-circle',
    })
  } finally {
    blockingUserId.value = null
  }
}

// ─── Init ────────────────────────────────────────────────────────────────────
onMounted(init)
</script>

<template>
  <div class="min-h-full flex flex-col">
    <!-- ─── PAGE HEADER ─── -->
    <header class="vex-page-header">
      <h1 class="text-base font-bold vex-title">Pagamentos</h1>
    </header>

    <!-- ─── TAB NAV ─── -->
    <div
      class="flex-shrink-0 sticky top-[3.25rem] z-[9] py-2"
      style="border-bottom: 1px solid var(--vex-border-subtle)"
    >
      <div class="vex-shell-segmented inline-flex items-center gap-1 p-1 rounded-xl" style="box-shadow: var(--vex-shadow-sm)">
        <button
          v-for="tab in ([
            { key: 'overview',    label: 'Visão Geral', icon: 'i-lucide-layout-dashboard' },
            { key: 'withdrawals', label: 'Saques',      icon: 'i-lucide-receipt' },
            { key: 'fraud',       label: 'Fraude',      icon: 'i-lucide-shield-alert' },
            { key: 'pix',         label: 'Conta PIX',   icon: 'i-lucide-qr-code' },
          ] as const)"
          :key="tab.key"
          class="vex-shell-tab relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all duration-150 whitespace-nowrap"
          :class="activeTab === tab.key ? 'is-active' : ''"
          @click="activeTab = tab.key"
        >
          <UIcon :name="tab.icon" class="size-3.5 shrink-0" />
          <span class="hidden sm:inline">{{ tab.label }}</span>
          <!-- Fraud badge -->
          <span
            v-if="tab.key === 'fraud' && hasFraud"
            class="absolute -top-1 -right-1 size-2 rounded-full animate-pulse"
            style="background: var(--vex-negative)"
          />
        </button>
      </div>
    </div>

    <!-- ─── CONTENT ─── -->
    <div class="flex-1">
      <div class="py-5 space-y-5 w-full">

        <!-- ═══════════════════════════════════════════
             FINANCIAL OVERVIEW — dark panel + KPIs
             ═══════════════════════════════════════════ -->
        <section class="vex-hero-card overflow-hidden">
          <div class="flex flex-col lg:flex-row items-stretch min-h-[180px]">

            <!-- LEFT: Dark balance panel -->
            <div class="vex-shell-hero-panel flex-1 flex flex-col justify-between p-5 md:p-7 relative">
              <div class="vex-shell-hero-orb--brand absolute top-0 right-0 w-48 h-48 rounded-full opacity-[0.06] pointer-events-none" style="transform: translate(30%, -30%)" />

              <!-- Top: label -->
              <div class="flex items-center justify-between relative">
                <div class="flex items-center gap-2">
                  <div class="size-7 rounded-lg flex items-center justify-center" style="background: var(--vex-brand-soft-bg-strong)">
                    <UIcon name="i-lucide-banknote" class="size-4" style="color: var(--vex-brand-soft-text)" />
                  </div>
                  <span class="text-[11px] font-bold tracking-[0.1em] uppercase" style="color: var(--vex-shell-dark-label)">Saldo Liberado</span>
                </div>
                <div class="flex items-center gap-1.5">
                  <span v-if="!loadingBalance" class="size-1.5 rounded-full animate-pulse" style="background: var(--vex-brand-soft-text)" />
                  <UIcon v-else name="i-lucide-loader-circle" class="size-3 animate-spin" style="color: var(--vex-brand-soft-text)" />
                  <span class="text-[10px] font-semibold" style="color: var(--vex-brand-soft-text-strong)">Disponível</span>
                </div>
              </div>

              <!-- Center: amount -->
              <div class="relative my-4">
                <p class="text-[11px] font-semibold mb-1" style="color: var(--vex-shell-dark-muted)">Disponível para saque</p>
                <h2 v-if="!loadingBalance" class="vex-amount text-[2.75rem] md:text-[3.25rem] text-white leading-none">
                  {{ formatCurrency(netWithdrawable) }}
                </h2>
                <div v-else class="h-12 w-48 rounded-lg animate-pulse" style="background: var(--vex-shell-dark-surface)" />
                <p v-if="!loadingBalance" class="text-[10px] mt-1" style="color: var(--vex-shell-dark-faint)">
                  Valor líquido, já com a taxa de saque de 6% descontada
                </p>

                <div
                  class="mt-3 pt-3 flex items-center gap-2"
                  style="border-top: 1px solid var(--vex-shell-dark-surface)"
                >
                  <UIcon name="i-lucide-clock" class="size-3.5 shrink-0" style="color: var(--vex-brand-soft-text)" />
                  <p class="text-[11px] leading-snug" style="color: var(--vex-shell-dark-muted)">
                    Atualização completa até as
                    <strong style="color: var(--vex-brand-soft-text)">16 horas</strong>
                  </p>
                </div>

                <!-- Composição do saldo disponível -->
                <div v-if="!loadingBalance && !loadingRules" class="mt-3 space-y-1.5">
                  <div v-if="withdrawableTotal - bonusAvailable > 0" class="flex items-baseline justify-between gap-3">
                    <span class="text-[11px]" style="color: var(--vex-shell-dark-muted)">
                      Saldo das casas
                      <span style="color: var(--vex-shell-dark-faint)">+ {{ houseBalanceOrigin }}</span>
                    </span>
                    <span class="text-[12px] font-semibold whitespace-nowrap text-white">
                      {{ formatCurrency(houseWithdrawableNet) }}
                      <span class="text-[10px] font-normal" style="color: var(--vex-shell-dark-faint)"> = ({{ formatCurrency(withdrawableTotal - bonusAvailable) }} − 6%)</span>
                    </span>
                  </div>
                  <div v-if="bonusAvailable > 0" class="flex items-baseline justify-between gap-3">
                    <span class="text-[11px]" style="color: var(--vex-brand-soft-text)">Bônus de prêmios</span>
                    <span class="text-[12px] font-semibold whitespace-nowrap" style="color: var(--vex-brand-soft-text)">
                      {{ formatCurrency(bonusNet) }}
                      <span class="text-[10px] font-normal" style="color: var(--vex-shell-dark-faint)">({{ formatCurrency(bonusAvailable) }} − 6%)</span>
                    </span>
                  </div>
                </div>

                <!-- Ganhos acumulados (individual vs rede) + disponível hoje -->
                <div v-if="!loadingBalance && !loadingRules" class="mt-3 pt-2.5 flex flex-wrap gap-x-5 gap-y-1" style="border-top: 1px solid var(--vex-shell-dark-surface)">
                  <span class="text-[11px]" style="color: var(--vex-shell-dark-muted)">
                    Liberado p/ saque hoje:
                    <strong style="color: var(--vex-brand-soft-text)">{{ formatCurrency(eligibleTodayTotal) }}</strong>
                  </span>
                  <span class="text-[11px]" style="color: var(--vex-shell-dark-muted)">
                    Ganhos individuais:
                    <strong style="color: #fff">{{ formatCurrency(ownEarnings) }}</strong>
                  </span>
                  <span class="text-[11px]" style="color: var(--vex-shell-dark-muted)">
                    Ganhos da rede:
                    <strong style="color: #fff">{{ formatCurrency(networkEarnings) }}</strong>
                  </span>
                </div>
              </div>

              <!-- Bottom: CTA -->
              <div class="flex items-center gap-3 relative">
                <button
                  class="flex items-center gap-2 px-5 py-2.5 rounded-lg text-[13px] font-bold transition-all duration-200 hover:opacity-90 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
                  style="background: var(--vex-brand-soft-text); color: #1c1917"
                  :disabled="!canWithdraw"
                  @click="reqWithdraw"
                >
                  <UIcon name="i-lucide-arrow-right-left" class="size-4" />
                  {{ blockedByDailyLimit ? 'Saque Já Solicitado' : balance < minWithdrawalAmount ? 'Saldo Insuficiente' : 'Solicitar Saque' }}
                </button>
                <span v-if="blockedByDailyLimit" class="text-[11px] hidden sm:inline" style="color: var(--vex-warning-soft-text-strong)">Limite diário por casa atingido</span>
                <span v-else class="text-[11px] hidden sm:inline" style="color: var(--vex-shell-dark-subtle)">Processamento em até 48h</span>
              </div>

              <!-- Motivo: por que o saque está indisponível -->
              <div
                v-if="withdrawBlockReason"
                class="mt-3 rounded-lg p-3 relative"
                style="background: var(--vex-shell-dark-surface); border: 1px solid var(--vex-shell-dark-border, rgba(255,255,255,0.08))"
              >
                <div class="flex items-start gap-2">
                  <UIcon name="i-lucide-info" class="size-4 mt-0.5 shrink-0" style="color: var(--vex-warning-soft-text-strong)" />
                  <div class="min-w-0">
                    <p class="text-[12px] font-semibold" style="color: #fff">Por que não consigo sacar?</p>
                    <p class="text-[11px] mt-0.5" style="color: var(--vex-shell-dark-muted)">{{ withdrawBlockReason }}</p>
                    <p class="text-[10.5px] mt-1.5" style="color: var(--vex-shell-dark-faint)">
                      Veja o saldo, taxa e líquido de cada casa logo abaixo em <strong style="color: #fff">Distribuição do Saldo</strong>.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <!-- RIGHT: supplementary KPIs from real data -->
            <div class="vex-hero-breakdown">
              <p class="text-[10px] font-bold uppercase tracking-[0.14em] mb-5 vex-breakdown-label">
                Resumo Financeiro
              </p>

              <div class="space-y-4">
                <!-- Pending amount -->
                <div>
                  <div class="flex items-center justify-between mb-1.5">
                    <div class="flex items-center gap-2">
                      <div class="vex-icon-badge vex-icon-badge--sm vex-icon-badge--warning">
                        <UIcon name="i-lucide-clock" class="size-3" />
                      </div>
                      <div>
                        <p class="text-[12px] font-semibold vex-breakdown-text">Restrito / Em Análise</p>
                        <p class="text-[10px] vex-breakdown-label">Saques aguardando liberação (sem taxa)</p>
                      </div>
                    </div>
                    <span class="vex-amount text-[15px] vex-breakdown-text">
                      {{ formatCurrency(withdrawalsPending) }}
                    </span>
                  </div>
                </div>

                <!-- Total approved -->
                <div>
                  <div class="flex items-center justify-between mb-1.5">
                    <div class="flex items-center gap-2">
                      <div class="vex-icon-badge vex-icon-badge--sm vex-icon-badge--info">
                        <UIcon name="i-lucide-landmark" class="size-3" />
                      </div>
                      <div>
                        <p class="text-[12px] font-semibold vex-breakdown-text">Total Sacado</p>
                        <p class="text-[10px] vex-breakdown-label">
                          Valores já aprovados (sem taxa)
                        </p>
                      </div>
                    </div>
                    <span class="vex-amount text-[15px] vex-breakdown-text">
                      {{ formatCurrency(withdrawalsApproved) }}
                    </span>
                  </div>
                </div>

                <!-- Fraud deduction -->
                <div v-if="hasFraud">
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                      <div class="vex-icon-badge vex-icon-badge--sm vex-icon-badge--negative">
                        <UIcon name="i-lucide-shield-x" class="size-3" />
                      </div>
                      <div>
                        <p class="text-[12px] font-semibold" style="color: var(--vex-negative-soft-text)">Desconto por Fraudes</p>
                        <button
                          class="text-[10px] underline underline-offset-2 transition-opacity hover:opacity-80"
                          style="color: var(--vex-negative-soft-text-strong)"
                          @click="activeTab = 'fraud'"
                        >
                          {{ networkFraudDetails.length }} ocorrência{{ networkFraudDetails.length !== 1 ? 's' : '' }} na rede · ver detalhes →
                        </button>
                      </div>
                    </div>
                    <span class="vex-amount text-[15px]" style="color: var(--vex-negative-soft-text)">−{{ formatCurrency(totalFraud) }}</span>
                  </div>
                </div>

                <!-- Total -->
                <div class="pt-3 vex-breakdown-divider">
                  <div class="flex items-center justify-between">
                    <span class="text-[11px] font-bold uppercase tracking-wide vex-breakdown-label">Total de transações</span>
                    <span class="vex-amount text-[1.05rem]" style="color: var(--vex-positive)">{{ total }}</span>
                  </div>
                </div>

              </div>
            </div>

          </div>
        </section>

        <!-- ═══════════════════════════════════════════
             PIX CONFIG FORM
             ═══════════════════════════════════════════ -->
        <!-- ─── OVERVIEW TAB: commission mini-cards ─── -->
        <section v-show="activeTab === 'overview'" class="vex-card overflow-hidden">
          <div class="vex-table-header">
            <div>
              <h2 class="text-sm font-bold vex-title" style="color: var(--vex-text)">Composição das Comissões</h2>
              <p class="text-[11px] mt-0.5" style="color: var(--vex-text-faint)">Valores brutos gerados no período</p>
            </div>
          </div>
          <div class="p-5 grid grid-cols-2 md:grid-cols-4 gap-3">
            <div v-for="card in [
              { label: 'CPA Direto',     value: cpa,        icon: 'i-lucide-user',      color: 'var(--vex-brand)' },
              { label: 'RevShare',       value: rev,        icon: 'i-lucide-percent',   color: 'var(--vex-brand)' },
              { label: 'Rede CPA',       value: networkCpa, icon: 'i-lucide-network',   color: 'var(--vex-info)'  },
              { label: 'Rede RevShare',  value: networkRev, icon: 'i-lucide-chart-pie', color: 'var(--vex-info)'  },
            ]" :key="card.label" class="rounded-xl p-3.5" style="background: var(--vex-surface-strong); border: 1px solid var(--vex-border-subtle)">
              <div class="flex items-center gap-1.5 mb-2">
                <UIcon :name="card.icon" class="size-3.5" :style="{ color: card.color }" />
                <span class="text-[10px] font-bold uppercase tracking-wide" style="color: var(--vex-text-faint)">{{ card.label }}</span>
              </div>
              <div v-if="loadingBalance" class="h-6 rounded animate-pulse" style="background: var(--vex-surface)" />
              <p v-else class="vex-amount text-[1.1rem] font-bold" style="color: var(--vex-text)">{{ formatCurrency(card.value) }}</p>
            </div>
          </div>
          <!-- Fraud alert pill for overview -->
          <div v-if="hasFraud" class="mx-5 mb-4 flex items-center justify-between rounded-lg px-4 py-2.5 cursor-pointer" style="background: var(--vex-negative-soft-bg); border: 1px solid var(--vex-negative-soft-border)" @click="activeTab = 'fraud'">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-shield-alert" class="size-4" style="color: var(--vex-negative)" />
              <span class="text-[12px] font-semibold" style="color: var(--vex-negative)">Desconto por fraude detectado: {{ formatCurrency(totalFraud) }}</span>
            </div>
            <UIcon name="i-lucide-chevron-right" class="size-4" style="color: var(--vex-negative)" />
          </div>
        </section>

        <!-- ═══════════════════════════════════════════
             OVERVIEW TAB: Distribuição do Saldo (sempre visível)
             ═══════════════════════════════════════════ -->
        <section v-show="activeTab === 'overview'" class="vex-card overflow-hidden">
          <div class="vex-table-header">
            <div>
              <h2 class="text-sm font-bold vex-title" style="color: var(--vex-text)">Distribuição do Saldo</h2>
              <p class="text-[11px] mt-0.5" style="color: var(--vex-text-faint)">
                Saldo bruto, taxa ({{ Math.round(feeRate * 100) }}%) e líquido por casa — sempre visível, mesmo sem poder sacar.
              </p>
            </div>
          </div>

          <!-- Loading -->
          <div v-if="loadingRules" class="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div v-for="i in 3" :key="i" class="rounded-xl p-4 animate-pulse" style="background: var(--vex-surface-strong); height: 140px" />
          </div>

          <!-- Empty -->
          <div v-else-if="houseBreakdown.length === 0" class="p-8 text-center">
            <div class="vex-icon-badge mx-auto mb-3" style="width: 2.5rem; height: 2.5rem">
              <UIcon name="i-lucide-wallet" class="size-5" />
            </div>
            <p class="text-[13px] font-semibold" style="color: var(--vex-text)">Você ainda não acumulou saldo em nenhuma casa.</p>
            <p class="text-[11px] mt-1" style="color: var(--vex-text-faint)">Conforme suas comissões forem qualificadas, elas aparecem aqui detalhadas por casa.</p>
          </div>

          <template v-else>
            <!-- KPIs agregados: bruto / taxa / líquido (só elegíveis hoje) -->
            <div class="px-5 pt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div class="rounded-xl p-3.5" style="background: var(--vex-surface-strong); border: 1px solid var(--vex-border-subtle)">
                <p class="text-[10px] font-bold uppercase tracking-wide" style="color: var(--vex-text-faint)">Bruto sacável agora</p>
                <p class="vex-amount text-[1.1rem] font-bold mt-1" style="color: var(--vex-text)">{{ formatCurrency(breakdownTotals.grossEligible) }}</p>
              </div>
              <div class="rounded-xl p-3.5" style="background: var(--vex-surface-strong); border: 1px solid var(--vex-border-subtle)">
                <p class="text-[10px] font-bold uppercase tracking-wide" style="color: var(--vex-text-faint)">Taxa ({{ Math.round(feeRate * 100) }}%)</p>
                <p class="vex-amount text-[1.1rem] font-bold mt-1" style="color: var(--vex-negative)">−{{ formatCurrency(breakdownTotals.feeEligible) }}</p>
              </div>
              <div class="rounded-xl p-3.5" style="background: var(--vex-surface-strong); border: 1px solid var(--vex-border-subtle)">
                <p class="text-[10px] font-bold uppercase tracking-wide" style="color: var(--vex-text-faint)">Líquido sacável agora</p>
                <p class="vex-amount text-[1.1rem] font-bold mt-1" style="color: var(--vex-positive)">{{ formatCurrency(breakdownTotals.netEligible) }}</p>
              </div>
            </div>

            <!-- Cards por casa -->
            <div class="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <article
                v-for="h in houseBreakdown"
                :key="h.slug"
                class="rounded-xl p-4 flex flex-col gap-2"
                :style="{
                  background: 'var(--vex-surface-strong)',
                  border: `1px solid ${h.eligible ? 'var(--vex-positive-soft-border)' : 'var(--vex-border-subtle)'}`,
                  opacity: h.eligible ? 1 : 0.92,
                }"
              >
                <!-- Header: nome + badges -->
                <div class="flex items-center justify-between gap-2">
                  <div class="flex items-center gap-1.5 min-w-0">
                    <span class="text-[12px] font-bold truncate" style="color: var(--vex-text)">{{ h.name }}</span>
                    <span
                      v-if="h.isBonus"
                      class="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide shrink-0"
                      style="background: var(--vex-brand-soft-bg); color: var(--vex-brand-soft-text)"
                    >Bônus</span>
                  </div>
                  <span
                    class="text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
                    :style="{
                      background: h.eligible ? 'var(--vex-positive-soft-bg)' : 'var(--vex-bg-muted)',
                      color: h.eligible ? 'var(--vex-positive)' : 'var(--vex-text-faint)',
                    }"
                  >{{ h.frequencyLabel }}</span>
                </div>

                <!-- Valores -->
                <div class="space-y-1">
                  <div v-if="h.isPinbet" class="flex items-center justify-between">
                    <span class="text-[10.5px]" style="color: var(--vex-text-faint)">Saldo disponível</span>
                    <span class="vex-amount text-[12px] font-semibold tabular-nums" style="color: var(--vex-text)">{{ formatCurrency(h.financialBalance) }}</span>
                  </div>
                  <div v-if="h.isPinbet" class="flex items-center justify-between">
                    <span class="text-[10.5px]" style="color: var(--vex-text-faint)">Net P&amp;L</span>
                    <span
                      class="vex-amount text-[12px] font-semibold tabular-nums"
                      :style="{ color: h.netPl === null ? 'var(--vex-warning)' : h.netPl > 0 ? 'var(--vex-positive)' : 'var(--vex-negative)' }"
                    >{{ h.netPl === null ? 'Sincronizando' : formatCurrency(h.netPl) }}</span>
                  </div>
                  <div v-if="h.isPinbet && h.netPl !== null" class="flex items-center justify-between">
                    <span class="text-[10.5px]" style="color: var(--vex-text-faint)">Limite de saque (80% do Net P&amp;L)</span>
                    <span class="vex-amount text-[12px] font-semibold tabular-nums" style="color: var(--vex-text)">
                      {{ formatCurrency(h.netPlWithdrawalLimit ?? 0) }}
                    </span>
                  </div>
                  <div v-if="h.isPinbet && h.netPlLimitConsumed > 0" class="flex items-center justify-between">
                    <span class="text-[10.5px]" style="color: var(--vex-text-faint)">Total já sacado nesta casa</span>
                    <span class="vex-amount text-[12px] font-semibold tabular-nums" style="color: var(--vex-warning)">
                      {{ formatCurrency(h.netPlLimitConsumed) }}
                    </span>
                  </div>
                  <div class="flex items-center justify-between">
                    <span class="text-[10.5px]" style="color: var(--vex-text-faint)">{{ h.isPinbet ? 'Saldo disponível para saque' : 'Bruto' }}</span>
                    <span class="vex-amount text-[14px] font-bold tabular-nums" style="color: var(--vex-text)">{{ formatCurrency(h.gross) }}</span>
                  </div>
                  <div class="flex items-center justify-between">
                    <span class="text-[10.5px]" style="color: var(--vex-text-faint)">Taxa ({{ Math.round(feeRate * 100) }}%)</span>
                    <span class="text-[11px] font-semibold tabular-nums" style="color: var(--vex-negative)">−{{ formatCurrency(h.fee) }}</span>
                  </div>
                  <div class="flex items-center justify-between pt-1.5" style="border-top: 1px solid var(--vex-border-subtle)">
                    <span class="text-[10.5px] font-semibold uppercase tracking-wide" style="color: var(--vex-text-faint)">Líquido</span>
                    <span class="vex-amount text-[15px] font-bold tabular-nums" style="color: var(--vex-positive)">{{ formatCurrency(h.net) }}</span>
                  </div>
                </div>

                <div
                  v-if="h.isPinbet"
                  class="rounded-lg px-2.5 py-2"
                  style="background: var(--vex-brand-soft-bg); border: 1px solid var(--vex-border-subtle)"
                >
                  <p class="text-[10.5px] leading-relaxed" style="color: var(--vex-text-secondary)">
                    Seu limite de saque é <strong style="color: var(--vex-text)">80% do Net P&amp;L positivo</strong>.
                    <template v-if="h.netPl !== null && h.netPlLimitConsumed > 0">
                      Você já sacou <strong style="color: var(--vex-text)">{{ formatCurrency(h.netPlLimitConsumed) }}</strong> nesta casa.
                      <template v-if="h.gross <= 0"> Seus saques anteriores já consumiram o limite atual.</template>
                    </template>
                    <template v-else-if="h.netPl !== null"> Nenhum saque anterior foi descontado desse limite.</template>
                    <template v-else> O histórico ainda está sendo sincronizado.</template>
                  </p>
                </div>

                <!-- Status -->
                <div
                  class="flex items-start gap-1.5 mt-1 rounded-md px-2 py-1.5"
                  :style="{ background: 'var(--vex-bg-muted)' }"
                >
                  <UIcon
                    :name="STATUS_ICON_MAP[h.statusIcon]"
                    class="size-3.5 shrink-0 mt-px"
                    :style="{ color: STATUS_TONE_COLOR[h.statusTone] }"
                  />
                  <span class="text-[10.5px] leading-snug" :style="{ color: STATUS_TONE_COLOR[h.statusTone] }">{{ h.reason }}</span>
                </div>
              </article>
            </div>

            <!-- Bônus explicação (sempre visível se houver bônus disponível) -->
            <div
              v-if="bonusAvailable > 0"
              class="mx-5 mb-4 rounded-lg p-3.5 flex gap-2.5"
              style="background: var(--vex-brand-soft-bg); border: 1px solid var(--vex-border-subtle)"
            >
              <UIcon name="i-lucide-gift" class="size-4 shrink-0 mt-0.5" style="color: var(--vex-brand)" />
              <p class="text-[11.5px] leading-relaxed" style="color: var(--vex-text-secondary)">
                <strong style="color: var(--vex-text)">Saldo de Bônus</strong> — créditos que não vêm de uma casa específica:
                prêmios de ranking, ajustes ou acertos da plataforma. Liberado para saque
                <strong>a qualquer momento</strong>, sem janela de cadência.
              </p>
            </div>
          </template>
        </section>

        <!-- ─── PIX TAB ─── -->
        <section v-show="activeTab === 'pix'" class="vex-card overflow-hidden">
          <div class="vex-table-header">
            <div>
              <h2 class="text-sm font-bold vex-title" style="color: var(--vex-text)">Conta PIX de Recebimento</h2>
              <p class="text-[11px] mt-0.5" style="color: var(--vex-text-faint)">Dados bancários para recebimento dos saques. Estes dados serão usados automaticamente ao solicitar um saque.</p>
            </div>
          </div>

          <div class="p-5">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <UFormField label="Tipo de Chave">
                <USelect
                  v-model="pixForm.pixKeyType"
                  :items="pixKeyTypeOptions"
                  value-key="value"
                  label-key="label"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="Chave PIX">
                <UInput v-model="pixForm.pixKey" class="w-full" placeholder="Ex: 123.456.789-00" />
              </UFormField>
              <UFormField label="Nome do Titular">
                <UInput v-model="pixForm.accountHolder" class="w-full" />
              </UFormField>
              <UFormField label="Banco (opcional)">
                <UInput v-model="pixForm.bankName" class="w-full" placeholder="Ex: Nubank" />
              </UFormField>
            </div>

            <div class="flex flex-col sm:flex-row items-center justify-between gap-4 mt-5 pt-4" style="border-top: 1px solid var(--vex-border-subtle)">
              <p class="text-[11px] max-w-xl" style="color: var(--vex-text-faint)">
                O titular da conta deve ser o mesmo cadastrado na plataforma. Alterações passam por análise de segurança de até 24h.
              </p>
              <UButton
                :loading="savingPix"
                icon="i-lucide-refresh-cw"
                label="Atualizar PIX"
                color="neutral"
                variant="outline"
                size="sm"
                @click="onSavePix"
              />
            </div>
          </div>
        </section>

        <!-- ═══════════════════════════════════════════
             FINANCIAL ANALYSIS — commissions + fraud
             ═══════════════════════════════════════════ -->
        <!-- ─── FRAUD TAB ─── -->
        <section v-show="activeTab === 'fraud'" class="vex-card overflow-hidden">
          <!-- Header -->
          <div class="vex-table-header">
            <div class="flex items-center gap-2">
              <div class="vex-icon-badge vex-icon-badge--sm vex-icon-badge--negative">
                <UIcon name="i-lucide-shield-x" class="size-3.5" />
              </div>
              <div>
                <h2 class="text-sm font-bold vex-title" style="color: var(--vex-text)">Análise de Fraudes</h2>
                <p class="text-[11px] mt-0.5" style="color: var(--vex-text-faint)">Detalhamento de FTDs irregulares e descontos aplicados na sua rede</p>
              </div>
            </div>
          </div>

          <div v-if="loadingFraudDetails" class="p-5 space-y-3">
            <div v-for="i in 5" :key="i" class="h-12 rounded-lg animate-pulse" style="background: var(--vex-surface-strong)" />
          </div>

          <template v-else>
            <!-- No fraud state -->
            <div v-if="!hasFraud" class="flex flex-col items-center justify-center py-16 gap-3">
              <div class="size-12 rounded-full flex items-center justify-center" style="background: var(--vex-positive-light)">
                <UIcon name="i-lucide-shield-check" class="size-6" style="color: var(--vex-positive)" />
              </div>
              <p class="text-sm font-semibold" style="color: var(--vex-text)">Nenhuma fraude detectada</p>
              <p class="text-[12px]" style="color: var(--vex-text-faint)">Sua rede não possui FTDs irregulares no período</p>
            </div>

            <template v-else>
              <!-- KPI strip -->
              <div class="grid grid-cols-2 md:grid-cols-4 gap-3 p-5 pb-0">
                <div class="rounded-xl p-3.5" style="background: var(--vex-negative-soft-bg); border: 1px solid var(--vex-negative-soft-border)">
                  <p class="text-[10px] font-bold uppercase tracking-wide mb-1" style="color: var(--vex-negative)">Total Descontado</p>
                  <p class="vex-amount text-[1.1rem]" style="color: var(--vex-negative)">−{{ formatCurrency(filteredFraudTotal) }}</p>
                  <p class="text-[10px] mt-0.5" style="color: var(--vex-text-faint)">filtro atual</p>
                </div>
                <div class="rounded-xl p-3.5" style="background: var(--vex-surface-strong); border: 1px solid var(--vex-border-subtle)">
                  <p class="text-[10px] font-bold uppercase tracking-wide mb-1" style="color: var(--vex-text-faint)">FTDs Irregulares</p>
                  <p class="vex-amount text-[1.1rem]" style="color: var(--vex-text)">{{ filteredFraudCount }}</p>
                  <p class="text-[10px] mt-0.5" style="color: var(--vex-text-faint)">no filtro</p>
                </div>
                <div class="rounded-xl p-3.5" style="background: var(--vex-surface-strong); border: 1px solid var(--vex-border-subtle)">
                  <p class="text-[10px] font-bold uppercase tracking-wide mb-1" style="color: var(--vex-text-faint)">Membros Afetados</p>
                  <p class="vex-amount text-[1.1rem]" style="color: var(--vex-text)">{{ fraudByMember.length }}</p>
                  <p class="text-[10px] mt-0.5" style="color: var(--vex-text-faint)">na rede</p>
                </div>
                <div class="rounded-xl p-3.5" style="background: var(--vex-surface-strong); border: 1px solid var(--vex-border-subtle)">
                  <p class="text-[10px] font-bold uppercase tracking-wide mb-1" style="color: var(--vex-text-faint)">Casas Afetadas</p>
                  <p class="vex-amount text-[1.1rem]" style="color: var(--vex-text)">{{ fraudHouseOptions.length - 1 }}</p>
                  <p class="text-[10px] mt-0.5" style="color: var(--vex-text-faint)">casas de apostas</p>
                </div>
              </div>

              <!-- Alert banner -->
              <div class="mx-5 mt-4 rounded-lg px-4 py-3 flex items-start gap-2" style="background: var(--vex-negative-soft-bg); border: 1px solid var(--vex-negative-soft-border)">
                <UIcon name="i-lucide-alert-triangle" class="size-4 mt-0.5 shrink-0" style="color: var(--vex-negative)" />
                <p class="text-[12px] leading-relaxed" style="color: var(--vex-negative)">
                  Os valores abaixo representam FTDs identificados como irregulares na sua rede. Cada fraude detectada deduz o CPA do spread gerado pelo membro infrator.
                  FTDs diretos deduzem o CPA da sua comissão própria.
                </p>
              </div>

              <!-- Filter bar -->
              <div class="p-5 pb-0">
                <div class="flex flex-col sm:flex-row gap-3">
                  <!-- Search -->
                  <div class="relative flex-1">
                    <UIcon name="i-lucide-search" class="absolute left-3 top-1/2 -translate-y-1/2 size-3.5" style="color: var(--vex-text-faint)" />
                    <input
                      v-model="fraudSearch"
                      type="text"
                      placeholder="Buscar por nome, email ou casa..."
                      class="w-full pl-9 pr-3 py-2 text-[12px] rounded-lg outline-none transition-all"
                      style="background: var(--vex-surface-strong); border: 1px solid var(--vex-border-subtle); color: var(--vex-text)"
                    />
                  </div>
                  <!-- House filter -->
                  <select
                    v-model="fraudHouseFilter"
                    class="px-3 py-2 text-[12px] rounded-lg outline-none appearance-none min-w-[140px]"
                    style="background: var(--vex-surface-strong); border: 1px solid var(--vex-border-subtle); color: var(--vex-text)"
                  >
                    <option v-for="h in fraudHouseOptions" :key="h" :value="h">
                      {{ h === 'all' ? 'Todas as casas' : getHouseName(h) }}
                    </option>
                  </select>
                  <!-- Source filter pills -->
                  <div class="inline-flex rounded-lg overflow-hidden" style="border: 1px solid var(--vex-border-subtle)">
                    <button
                      v-for="opt in [{ key: 'all', label: 'Todos' }, { key: 'direct', label: 'Direto' }, { key: 'network', label: 'Rede' }]"
                      :key="opt.key"
                      class="px-3 py-2 text-[11px] font-semibold transition-colors"
                      :style="fraudSourceFilter === opt.key
                        ? 'background: var(--vex-brand); color: #fff'
                        : 'background: var(--vex-surface-strong); color: var(--vex-text-faint)'"
                      @click="fraudSourceFilter = opt.key as 'all' | 'direct' | 'network'"
                    >{{ opt.label }}</button>
                  </div>
                </div>
                <!-- Results badge -->
                <p class="text-[11px] mt-2" style="color: var(--vex-text-faint)">
                  <span class="font-semibold" style="color: var(--vex-text)">{{ filteredFraudRows.length }}</span> registros ·
                  <span class="font-semibold" style="color: var(--vex-text)">{{ fraudByMember.length }}</span> membros ·
                  Total: <span class="font-semibold" style="color: var(--vex-negative)">−{{ formatCurrency(filteredFraudTotal) }}</span>
                </p>
              </div>

              <!-- Member summary cards -->
              <div class="p-5 space-y-2">
                <div
                  v-for="m in fraudByMember"
                  :key="m.memberId"
                  class="rounded-xl p-4 transition-all duration-150"
                  :style="m.source === 'direct'
                    ? 'background: var(--vex-negative-soft-bg); border: 1px solid var(--vex-negative-soft-border)'
                    : 'background: var(--vex-surface-strong); border: 1px solid var(--vex-border-subtle)'"
                >
                  <div class="flex items-start justify-between gap-3">
                    <div class="flex items-center gap-3 min-w-0">
                      <!-- Avatar initials -->
                      <div
                        class="size-9 rounded-full flex items-center justify-center text-[13px] font-bold shrink-0"
                        :style="m.source === 'direct'
                          ? 'background: var(--vex-negative-soft-bg-strong); color: var(--vex-negative)'
                          : 'background: var(--vex-surface); border: 1px solid var(--vex-border); color: var(--vex-text-faint)'"
                      >
                        {{ m.memberName.charAt(0).toUpperCase() }}
                      </div>
                      <div class="min-w-0">
                        <p class="text-[13px] font-semibold truncate" style="color: var(--vex-text)">{{ m.memberName }}</p>
                        <p class="text-[11px] truncate font-mono" style="color: var(--vex-text-faint)">{{ m.memberEmail }}</p>
                        <!-- Houses badges -->
                        <div class="flex flex-wrap gap-1 mt-1">
                          <span
                            v-for="h in m.houses"
                            :key="h"
                            class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide"
                            style="background: var(--vex-surface); border: 1px solid var(--vex-border-subtle); color: var(--vex-text-faint)"
                          >
                            <UIcon name="i-lucide-building-2" class="size-2.5" />
                            {{ h }}
                          </span>
                          <span
                            class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide"
                            :style="m.source === 'direct'
                              ? 'background: var(--vex-negative-soft-bg); color: var(--vex-negative)'
                              : 'background: var(--vex-info-soft-bg); color: var(--vex-info)'"
                          >
                            {{ m.source === 'direct' ? 'Direto' : 'Rede' }}
                          </span>
                        </div>
                      </div>
                    </div>
                    <!-- Right: financials + block button -->
                    <div class="text-right shrink-0 flex flex-col items-end gap-2">
                      <div>
                        <p class="vex-amount text-[1.05rem] font-bold" style="color: var(--vex-negative)">−{{ formatCurrency(m.totalDeduction) }}</p>
                        <p class="text-[11px] mt-0.5" style="color: var(--vex-text-faint)">{{ m.totalFrauds }} FTD{{ m.totalFrauds !== 1 ? 's' : '' }}</p>
                      </div>
                      <!-- Block button — only for identifiable network members -->
                      <template v-if="m.memberId && m.memberId !== 'me'">
                        <!-- Already blocked badge -->
                        <span
                          v-if="blockedUserIds.has(m.memberId)"
                          class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wide"
                          style="background: var(--vex-negative-soft-bg-strong); border: 1px solid var(--vex-negative-soft-border-strong); color: var(--vex-negative)"
                        >
                          <UIcon name="i-lucide-shield-off" class="size-3.5" />
                          Bloqueado
                        </span>
                        <!-- Block action button -->
                        <button
                          v-else
                          class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-150 hover:opacity-90 active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed"
                          style="background: var(--vex-negative-soft-bg); border: 1px solid var(--vex-negative-soft-border-strong); color: var(--vex-negative)"
                          :disabled="blockingUserId === m.memberId"
                          @click="openBlockModal(m)"
                        >
                          <UIcon
                            :name="blockingUserId === m.memberId ? 'i-lucide-loader-circle' : 'i-lucide-user-x'"
                            class="size-3.5"
                            :class="{ 'animate-spin': blockingUserId === m.memberId }"
                          />
                          {{ blockingUserId === m.memberId ? 'Bloqueando...' : 'Bloquear' }}
                        </button>
                      </template>
                    </div>
                  </div>
                </div>

                <!-- Empty filter result -->
                <div v-if="fraudByMember.length === 0" class="text-center py-10">
                  <UIcon name="i-lucide-filter-x" class="size-8 mx-auto mb-2" style="color: var(--vex-text-faint)" />
                  <p class="text-[12px]" style="color: var(--vex-text-faint)">Nenhum resultado com os filtros aplicados</p>
                </div>
              </div>

              <!-- Flat detail table -->
              <div class="border-t" style="border-color: var(--vex-border-subtle)">
                <div class="px-5 py-3 flex items-center justify-between" style="background: var(--vex-surface-strong)">
                  <p class="text-[11px] font-bold uppercase tracking-wide" style="color: var(--vex-text-faint)">Registros detalhados ({{ filteredFraudRows.length }})</p>
                </div>
                <div class="overflow-x-auto">
                  <table class="w-full text-left text-[12px] whitespace-nowrap">
                    <thead>
                      <tr style="background: var(--vex-surface-strong); border-bottom: 1px solid var(--vex-border-subtle)">
                        <th class="px-4 py-2.5 text-[10px] uppercase tracking-[0.1em] font-bold" style="color: var(--vex-text-faint)">Membro</th>
                        <th class="px-4 py-2.5 text-[10px] uppercase tracking-[0.1em] font-bold" style="color: var(--vex-text-faint)">Casa</th>
                        <th class="px-4 py-2.5 text-[10px] uppercase tracking-[0.1em] font-bold" style="color: var(--vex-text-faint)">Origem</th>
                        <th class="px-4 py-2.5 text-[10px] uppercase tracking-[0.1em] font-bold text-center" style="color: var(--vex-text-faint)">FTDs</th>
                        <th class="px-4 py-2.5 text-[10px] uppercase tracking-[0.1em] font-bold text-right" style="color: var(--vex-text-faint)">CPA/unit</th>
                        <th class="px-4 py-2.5 text-[10px] uppercase tracking-[0.1em] font-bold text-right" style="color: var(--vex-negative)">Desconto</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr
                        v-for="(row, i) in filteredFraudRows"
                        :key="i"
                        style="border-bottom: 1px solid var(--vex-border-subtle)"
                      >
                        <td class="px-4 py-2.5">
                          <div class="font-semibold" style="color: var(--vex-text)">{{ row.memberName }}</div>
                          <div class="text-[10px] font-mono" style="color: var(--vex-text-faint)">{{ row.memberEmail }}</div>
                        </td>
                        <td class="px-4 py-2.5">
                          <span class="inline-flex items-center gap-1 font-medium" style="color: var(--vex-text)">
                            <HouseBadge :slug="row.bettingHouse" size="xs" />
                          </span>
                        </td>
                        <td class="px-4 py-2.5">
                          <span
                            class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold"
                            :style="row.source === 'direct'
                              ? 'background: var(--vex-negative-soft-bg); color: var(--vex-negative)'
                              : 'background: var(--vex-info-soft-bg); color: var(--vex-info)'"
                          >
                            <UIcon :name="row.source === 'direct' ? 'i-lucide-user' : 'i-lucide-network'" class="size-3" />
                            {{ row.source === 'direct' ? 'Direto' : 'Rede' }}
                          </span>
                        </td>
                        <td class="px-4 py-2.5 tabular-nums text-center font-semibold" style="color: var(--vex-text)">{{ row.fraudCount }}</td>
                        <td class="px-4 py-2.5 tabular-nums text-right" style="color: var(--vex-text-faint)">{{ formatCurrency(row.cpaRate) }}</td>
                        <td class="px-4 py-2.5 tabular-nums text-right font-bold" style="color: var(--vex-negative)">−{{ formatCurrency(row.deduction) }}</td>
                      </tr>
                    </tbody>
                    <tfoot>
                      <tr style="background: var(--vex-negative-soft-bg); border-top: 2px solid var(--vex-negative-soft-border)">
                        <td class="px-4 py-2.5 font-bold text-[11px] uppercase tracking-wide" style="color: var(--vex-negative)" colspan="3">Total filtrado</td>
                        <td class="px-4 py-2.5 tabular-nums text-center font-bold" style="color: var(--vex-text)">{{ filteredFraudCount }}</td>
                        <td class="px-4 py-2.5" />
                        <td class="px-4 py-2.5 tabular-nums text-right font-bold text-[13px]" style="color: var(--vex-negative)">−{{ formatCurrency(filteredFraudTotal) }}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </template>
          </template>
        </section>

        <!-- ═══════════════════════════════════════════
             TRANSACTIONS TABLE
             ═══════════════════════════════════════════ -->
        <!-- ─── WITHDRAWALS TAB ─── -->
        <section v-show="activeTab === 'withdrawals'" class="vex-card overflow-hidden">
          <div class="vex-table-header flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 class="text-sm font-bold vex-title" style="color: var(--vex-text)">Histórico de Saques</h3>
              <p class="text-[11px] mt-0.5" style="color: var(--vex-text-faint)">Acompanhe o status dos seus saques</p>
            </div>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-filter" class="size-3.5 shrink-0" style="color: var(--vex-text-faint)" />
              <select
                v-model="statusFilter"
                class="px-3 py-2 text-[12px] rounded-lg outline-none appearance-none min-w-[150px]"
                style="background: var(--vex-surface-strong); border: 1px solid var(--vex-border-subtle); color: var(--vex-text)"
                @change="onStatusFilterChange"
              >
                <option v-for="opt in statusFilterOptions" :key="opt.value" :value="opt.value">
                  {{ opt.label }}
                </option>
              </select>
            </div>
          </div>

          <!-- Loading skeleton -->
          <div v-if="loadingList" class="p-5 space-y-3">
            <div v-for="i in 4" :key="i" class="h-10 rounded-lg animate-pulse" style="background: var(--vex-surface-strong)" />
          </div>

          <!-- Empty state -->
          <div v-else-if="!items.length" class="flex flex-col items-center justify-center py-16 gap-3">
            <div class="size-12 rounded-full flex items-center justify-center" style="background: var(--vex-surface-strong)">
              <UIcon :name="statusFilter ? 'i-lucide-filter-x' : 'i-lucide-receipt'" class="size-6" style="color: var(--vex-text-faint)" />
            </div>
            <p class="text-sm font-semibold" style="color: var(--vex-text)">Nenhum saque encontrado</p>
            <p class="text-[12px]" style="color: var(--vex-text-faint)">
              {{ statusFilter ? 'Nenhum saque com este status. Tente outro filtro.' : 'Seus saques aparecerão aqui após a primeira solicitação' }}
            </p>
            <button
              v-if="statusFilter"
              type="button"
              class="text-[12px] font-semibold px-3 py-1.5 rounded-lg transition-colors"
              style="color: var(--vex-brand); background: var(--vex-brand-soft-bg)"
              @click="statusFilter = ''; onStatusFilterChange()"
            >
              Limpar filtro
            </button>
          </div>

          <!-- Table -->
          <div v-else class="overflow-x-auto">
            <table class="w-full text-left text-[13px] whitespace-nowrap">
              <thead>
                <tr style="background: var(--vex-surface-strong); border-bottom: 1px solid var(--vex-border-subtle)">
                  <th class="px-5 py-2.5 text-[10px] uppercase tracking-[0.1em] font-bold" style="color: var(--vex-text-faint)">Data</th>
                  <th class="px-5 py-2.5 text-[10px] uppercase tracking-[0.1em] font-bold" style="color: var(--vex-text-faint)">Valor Bruto</th>
                  <th class="px-5 py-2.5 text-[10px] uppercase tracking-[0.1em] font-bold" style="color: var(--vex-text-faint)">Taxa (6%)</th>
                  <th class="px-5 py-2.5 text-[10px] uppercase tracking-[0.1em] font-bold" style="color: var(--vex-text-faint)">Valor Líquido</th>
                  <th class="px-5 py-2.5 text-[10px] uppercase tracking-[0.1em] font-bold" style="color: var(--vex-text-faint)">Chave PIX</th>
                  <th class="px-5 py-2.5 text-[10px] uppercase tracking-[0.1em] font-bold" style="color: var(--vex-text-faint)">Observações</th>
                  <th class="px-5 py-2.5 text-[10px] uppercase tracking-[0.1em] font-bold" style="color: var(--vex-text-faint)">Situação</th>
                  <th class="px-5 py-2.5 text-[10px] uppercase tracking-[0.1em] font-bold" style="color: var(--vex-text-faint)">Comprovante</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="item in items"
                  :key="item.id"
                  class="transition-colors duration-100"
                  style="border-bottom: 1px solid var(--vex-border-subtle)"
                  @mouseenter="($event.currentTarget as HTMLElement).style.background = 'var(--vex-surface-strong)'"
                  @mouseleave="($event.currentTarget as HTMLElement).style.background = ''"
                >
                  <td class="px-5 py-3" style="color: var(--vex-text)">
                    <div>{{ formatDate(item.createdAt).date }}</div>
                    <div class="text-[11px]" style="color: var(--vex-text-faint)">{{ formatDate(item.createdAt).time }}</div>
                  </td>
                  <td class="px-5 py-3 font-money tabular-nums" style="color: var(--vex-text-faint)">
                    {{ formatCurrency(item.originalAmount) }}
                  </td>
                  <td class="px-5 py-3 font-money tabular-nums text-[12px]" style="color: var(--vex-negative)">
                    −{{ formatCurrency(item.withdrawalFee) }}
                  </td>
                  <td class="px-5 py-3 font-money font-semibold tabular-nums" style="color: var(--vex-text)">
                    {{ formatCurrency(item.amount) }}
                  </td>
                  <td class="px-5 py-3 font-mono text-[11px]" style="color: var(--vex-text-faint)">
                    <div>{{ item.pixKey || '—' }}</div>
                    <div class="text-[10px]">{{ item.pixKeyType }}</div>
                  </td>
                  <td class="px-5 py-3 min-w-56 whitespace-normal">
                    <div v-if="item.requestNote" class="text-[11px]" style="color: var(--vex-text)">
                      <span class="font-bold">Você:</span> {{ item.requestNote }}
                    </div>
                    <div v-if="item.adminNote" class="text-[11px] mt-1" style="color: var(--vex-text-faint)">
                      <span class="font-bold">Admin:</span> {{ item.adminNote }}
                    </div>
                    <span v-if="!item.requestNote && !item.adminNote" class="text-[11px]" style="color: var(--vex-text-faint)">—</span>
                  </td>
                  <td class="px-5 py-3">
                    <span
                      class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold"
                      :style="{
                        color: statusConfig[item.status]?.color,
                        background: statusConfig[item.status]?.bg,
                      }"
                    >
                      <UIcon :name="statusConfig[item.status]?.icon ?? 'i-lucide-circle'" class="size-3" />
                      {{ statusConfig[item.status]?.label }}
                    </span>
                  </td>
                  <td class="px-5 py-3">
                    <button
                      v-if="item.status === 'COMPLETED' || item.status === 'FAILED'"
                      type="button"
                      class="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold transition-colors"
                      style="color: var(--vex-brand); background: var(--vex-brand-soft-bg); border: 1px solid var(--vex-brand-soft-border, transparent);"
                      :disabled="loadingReceipt"
                      @click="openReceipt(item)"
                    >
                      <UIcon name="i-lucide-file-text" class="size-3.5" />
                      Ver comprovante
                    </button>
                    <span v-else class="text-[11px]" style="color: var(--vex-text-faint)">—</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Footer + Pagination -->
          <div class="vex-table-footer">
            <p class="text-[11px]" style="color: var(--vex-text-muted)">
              Mostrando <span class="font-bold" style="color: var(--vex-text)">{{ items.length }}</span> de
              <span class="font-bold" style="color: var(--vex-text)">{{ total }}</span> saques
            </p>
            <UPagination
              v-if="totalPages > 1"
              :page="page"
              :total="total"
              :items-per-page="limit"
              @update:page="fetchList($event)"
            />
          </div>
        </section>

      </div>
    </div>

    <!-- ═══════════════════════════════════════════
         WITHDRAWAL CONFIRMATION MODAL
         ═══════════════════════════════════════════ -->
    <UModal v-model:open="showWithdrawModal" title="Confirmar Saque" description="Revise os dados antes de prosseguir">
      <template #body>
        <div class="space-y-5">
          <!-- Per-casa selector -->
          <div class="space-y-2">
            <p class="text-[10px] font-bold uppercase tracking-[0.14em]" style="color: var(--vex-text-faint)">
              Escolha a casa de origem
            </p>
            <div v-if="loadingRules" class="text-[12px]" style="color: var(--vex-text-faint)">Carregando casas…</div>
            <div v-else-if="withdrawalRules.length === 0" class="text-[12px]" style="color: var(--vex-text-faint)">
              Nenhuma casa configurada.
            </div>
            <div v-else class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                v-for="rule in withdrawalRules"
                :key="rule.slug"
                type="button"
                :disabled="!ruleEligible(rule)"
                class="text-left rounded-lg p-3 transition border"
                :class="[
                  selectedHouse === rule.slug
                    ? 'ring-2 ring-offset-1'
                    : '',
                  !ruleEligible(rule)
                    ? 'opacity-50 cursor-not-allowed'
                    : 'hover:border-[color:var(--vex-brand)]',
                ]"
                :style="{
                  background: 'var(--vex-surface-strong)',
                  borderColor: selectedHouse === rule.slug ? 'var(--vex-brand)' : 'var(--vex-border-subtle)',
                }"
                @click="selectedHouse = rule.slug"
              >
                <div class="flex items-center justify-between gap-2">
                  <span class="text-[12px] font-semibold" style="color: var(--vex-text)">{{ rule.name }}</span>
                  <span class="text-[10px] px-2 py-0.5 rounded-full"
                    :style="{
                      background: rule.allowedToday ? 'var(--vex-positive-soft-bg)' : 'var(--vex-warning-soft-bg)',
                      color: rule.allowedToday ? 'var(--vex-positive)' : 'var(--vex-warning)',
                    }"
                  >{{ rule.frequencyLabel }}</span>
                </div>
                <p class="text-[14px] font-bold mt-1 font-money" style="color: var(--vex-text)">
                  {{ formatCurrency(rule.availableBalance) }}
                </p>
                <p v-if="housesWithdrawnToday.has(rule.slug) && rule.dayReleaseAvailable && rule.allowedToday" class="text-[10px] mt-1" style="color: var(--vex-positive)">
                  Saque extra liberado pelo admin — disponível agora
                </p>
                <p v-else-if="housesWithdrawnToday.has(rule.slug)" class="text-[10px] mt-1" style="color: var(--vex-warning)">
                  Já sacou desta casa hoje (limite: 1 por dia)
                </p>
                <p v-else-if="isCpaBlocked(rule)" class="text-[10px] mt-1" style="color: var(--vex-warning)">
                  Requer {{ rule.minCpaToWithdraw }} CPAs qualificados — você tem {{ rule.cpaCount }}
                </p>
                <p v-else-if="!rule.allowedToday" class="text-[10px] mt-1" style="color: var(--vex-warning)">
                  Próxima janela: {{ formatNextDate(rule.nextWithdrawalDate) || '—' }}
                </p>
                <p v-else-if="!meetsMinimum(rule)" class="text-[10px] mt-1" style="color: var(--vex-text-faint)">
                  Abaixo do mínimo de {{ formatCurrency(minWithdrawalAmount) }}
                </p>
              </button>
            </div>
          </div>

          <!-- Amount highlight (selected casa) -->
          <div class="vex-shell-hero-panel rounded-lg p-5 text-center relative overflow-hidden">
            <div class="vex-shell-hero-orb--brand absolute top-0 right-0 w-32 h-32 rounded-full opacity-[0.08] pointer-events-none" style="transform: translate(30%, -30%)" />
            <p class="text-[10px] font-bold uppercase tracking-[0.14em] mb-1" style="color: var(--vex-brand-soft-text-strong)">
              {{ selectedRule ? `Saque ${selectedRule.name}` : 'Selecione uma casa' }}
            </p>
            <p class="vex-amount text-3xl text-white">{{ formatCurrency(selectedHouseBalance) }}</p>
            <p v-if="selectedRule" class="text-[11px] mt-2" style="color: color-mix(in srgb, var(--vex-shell-dark-label) 78%, white 22%)">
              Valor disponível nessa casa. A taxa de {{ Math.round((feeAmount / Math.max(originalBalance, 1)) * 100) }}% é descontada na aprovação.
            </p>
          </div>

          <!-- Bônus: explicação do saldo -->
          <div
            v-if="selectedRule?.slug === 'bonus'"
            class="rounded-lg p-3.5 flex gap-2.5"
            style="background: var(--vex-brand-soft-bg); border: 1px solid var(--vex-border-subtle)"
          >
            <UIcon name="i-lucide-gift" class="size-4 shrink-0 mt-0.5" style="color: var(--vex-brand)" />
            <p class="text-[11.5px] leading-relaxed" style="color: var(--vex-text-secondary)">
              <strong style="color: var(--vex-text)">Saldo de Bônus</strong> — créditos que não vêm de uma casa específica:
              prêmios de ranking, ajustes ou acertos de saldo da plataforma. É liberado para saque
              <strong>a qualquer momento</strong>, sem janela de cadência.
            </p>
          </div>

          <!-- Details rows -->
          <div class="space-y-0">
            <div class="flex items-center justify-between py-2.5" style="border-bottom: 1px solid var(--vex-border-subtle)">
              <span class="text-[12px]" style="color: var(--vex-text-faint)">Tipo da Chave</span>
              <span class="text-[12px] font-semibold" style="color: var(--vex-text)">{{ pixForm.pixKeyType || '—' }}</span>
            </div>
            <div class="flex items-center justify-between py-2.5" style="border-bottom: 1px solid var(--vex-border-subtle)">
              <span class="text-[12px]" style="color: var(--vex-text-faint)">Chave PIX</span>
              <span class="text-[12px] font-semibold font-money" style="color: var(--vex-text)">{{ pixForm.pixKey || '—' }}</span>
            </div>
            <div class="flex items-center justify-between py-2.5">
              <span class="text-[12px]" style="color: var(--vex-text-faint)">Titular</span>
              <span class="text-[12px] font-semibold" style="color: var(--vex-text)">{{ pixForm.accountHolder || '—' }}</span>
            </div>
          </div>

          <UFormField label="Observação para o admin">
            <UTextarea
              v-model="withdrawalNote"
              :rows="3"
              :maxlength="500"
              placeholder="Inclua uma observação opcional sobre este saque"
              class="w-full"
            />
          </UFormField>

          <!-- Notice alert -->
          <div
            class="rounded-lg p-3 flex items-start gap-2"
            :style="{ background: 'var(--vex-warning-soft-bg)', border: '1px solid var(--vex-warning-soft-border)' }"
          >
            <UIcon name="i-lucide-alert-triangle" class="size-4 mt-0.5 shrink-0" style="color: var(--vex-warning)" />
            <p class="text-[11px]" style="color: var(--vex-warning)">
              Após a confirmação, o saque entrará em análise e não poderá ser cancelado. O prazo de processamento é de até 48 horas úteis.
              As informações fornecidas devem ser verdadeiras e precisas.
            </p>
          </div>

          <!-- Error from backend -->
          <div
            v-if="submitError"
            class="rounded-lg p-3 flex items-start gap-2"
            style="background: var(--vex-negative-soft-bg); border: 1px solid var(--vex-negative-soft-border)"
          >
            <UIcon name="i-lucide-x-circle" class="size-4 mt-0.5 shrink-0" style="color: var(--vex-negative)" />
            <p class="text-[11px]" style="color: var(--vex-negative)">{{ submitError }}</p>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex items-center justify-end gap-3 w-full">
          <UButton label="Cancelar" color="neutral" variant="ghost" @click="showWithdrawModal = false" />
          <UButton
            label="Confirmar Saque"
            icon="i-lucide-check"
            color="primary"
            :loading="submitting"
            :disabled="!selectedHouse || !selectedRule?.allowedToday || !selectedRule || !meetsMinimum(selectedRule)"
            class="font-semibold flex-1 sm:flex-none justify-center"
            @click="confirmWithdraw"
          />
        </div>
      </template>
    </UModal>

    <!-- ═══════════════════════════════════════════
         BLOCK USER CONFIRMATION MODAL
         ═══════════════════════════════════════════ -->
    <UModal v-model:open="showBlockModal" title="Bloquear Usuário" description="Esta ação é irreversível">
      <template #body>
        <div class="space-y-4">
          <!-- User info -->
          <div class="flex items-center gap-3 p-4 rounded-xl" style="background: var(--vex-surface-strong); border: 1px solid var(--vex-border-subtle)">
            <div class="size-10 rounded-full flex items-center justify-center text-base font-bold" style="background: var(--vex-negative-soft-bg-strong); color: var(--vex-negative)">
              {{ blockTarget?.memberName?.charAt(0).toUpperCase() }}
            </div>
            <div class="min-w-0">
              <p class="text-[13px] font-semibold truncate" style="color: var(--vex-text)">{{ blockTarget?.memberName }}</p>
              <p class="text-[11px] font-mono truncate" style="color: var(--vex-text-faint)">{{ blockTarget?.memberEmail }}</p>
            </div>
          </div>

          <!-- Danger warning -->
          <div class="rounded-xl p-4 flex items-start gap-3" style="background: var(--vex-negative-soft-bg); border: 1px solid var(--vex-negative-soft-border-strong)">
            <UIcon name="i-lucide-shield-alert" class="size-5 mt-0.5 shrink-0" style="color: var(--vex-negative)" />
            <div class="space-y-1">
              <p class="text-[12px] font-semibold" style="color: var(--vex-negative)">Atenção: ação permanente</p>
              <ul class="text-[11px] space-y-0.5 list-disc list-inside" style="color: var(--vex-text-faint)">
                <li>O usuário não conseguirá mais fazer login na plataforma</li>
                <li>Ele será removido dos cálculos de comissão da rede</li>
                <li>Uma notificação será enviada informando o bloqueio</li>
              </ul>
            </div>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex items-center justify-end gap-3 w-full">
          <UButton label="Cancelar" color="neutral" variant="ghost" :disabled="!!blockingUserId" @click="showBlockModal = false" />
          <UButton
            label="Confirmar Bloqueio"
            icon="i-lucide-user-x"
            color="error"
            :loading="!!blockingUserId"
            class="font-semibold"
            @click="confirmBlock"
          />
        </div>
      </template>
    </UModal>

    <!-- Receipt modal — HeartPay PIX OUT comprovante (PNG base64) -->
    <UModal
      v-model:open="receiptOpen"
      title="Comprovante do saque"
      description="Comprovante emitido pelo gateway de pagamento HeartPay"
      :ui="{ content: 'max-w-2xl' }"
      @after:leave="closeReceipt"
    >
      <template #body>
        <div class="space-y-3">
          <div v-if="loadingReceipt" class="flex items-center justify-center py-10">
            <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin" style="color: var(--vex-brand)" />
          </div>
          <div
            v-else-if="receiptError"
            class="rounded-lg p-3 text-[12px]"
            style="color: var(--vex-negative); background: var(--vex-negative-light); border: 1px solid var(--vex-negative);"
          >
            {{ receiptError }}
          </div>
          <div v-else-if="receiptDataUrl" class="flex flex-col items-center gap-3">
            <img
              :src="receiptDataUrl"
              alt="Comprovante PIX"
              class="rounded-lg border max-w-full"
              style="border-color: var(--vex-border-subtle); background: white;"
            />
            <p v-if="receiptEndToEnd" class="text-[11px] font-mono" style="color: var(--vex-text-faint)">
              EndToEnd: {{ receiptEndToEnd }}
            </p>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex gap-2 justify-end w-full">
          <UButton label="Fechar" color="neutral" variant="ghost" @click="receiptOpen = false" />
          <UButton
            label="Baixar PNG"
            icon="i-lucide-download"
            color="primary"
            :disabled="!receiptDataUrl"
            @click="downloadReceipt"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
