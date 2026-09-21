<script setup lang="ts">
definePageMeta({ layout: 'default' })

interface AffiliateProfile {
  id: string
  name: string
  email: string
  cpf: string | null
  whatsapp: string | null
  status: string
  withdrawalBlocked: boolean
  exclusiveDealsAccess?: boolean
  apiAccessEnabled?: boolean
  profileCompleted: boolean
  pixKeyType: string
  pixKey: string
  bankName: string
  bankAgency: string
  bankAccount: string
  accountHolder: string
  referredBy?: { id: string, name: string, email: string } | null
  affiliateLinks: Array<{ id: string, bettingHouse: string, campaignId: string, affiliateId: string, cpa: string | null, revshare: string | null, userLink: string | null }>
}

interface HouseOption {
  id: string
  name: string
  slug: string
  logoUrl?: string
}

interface Summary {
  clicks: number
  registrations: number
  ftds: number
  qftd: number
  cpaQualified: number
  deposit: number
  volume: number
  revShare: number
  cpaValue: number
  totalCommission: number
}

interface Balance {
  balance: number
  periodBalance: number
  isFiltered: boolean
  grossBalance: number
  baseGross: number
  cpa: number
  rev: number
  networkCpa: number
  networkRev: number
  networkTotal: number
  fraudDeduction: number
  networkFraudDeduction: number
  totalFraudDeduction: number
  withdrawalsPending: number
  withdrawalsApproved: number
  approvedWithdrawals: number
  netBalance: number
  bonusBalance: number
  perHouse?: Array<{ house: string, cpa: number, rev: number, networkCpa: number, networkRev: number, fraudDeduction: number, total: number }>
}

interface CampaignRow {
  campaignId: string
  bettingHouse: string
  campaignName: string
  utmCampaign: string
  clicks: number
  registrations: number
  ftds: number
  qftd: number
  deposit: number
  volume: number
  revShare: number
  cpaValue: number
  cpaQualified: number
  totalCommission: number
}

interface LinkPerformance {
  key: string
  bettingHouse: string
  campaignId: string
  cpaRate: number
  revRate: number
  myCpa: number
  myRev: number
  myCommission: number
  clicks: number
  registrations: number
  ftds: number
  qftd: number
  deposit: number
  volume: number
  revShare: number
}

interface DailyPerHouseRow {
  date: string
  bettingHouse: string
  clicks: number
  registrations: number
  ftds: number
  qftd: number
  deposit: number
  volume: number
  revShare: number
  cpaValue: number
  totalCommission: number
}

interface NetworkResponse {
  totalReferrals: number
  networkEarnings: number
  networkFraudLoss: number
  network: Array<{ userId: string, name: string, email: string, level: number, status: string, myEarnings: number }>
}

interface ReferralOriginResponse {
  userId: string
  name: string
  email: string
  joinedAt: string
  referralDepth: number
  isDirect: boolean
  originLabel: string
  upline: Array<{ id: string, name: string, email: string, depthFromRoot: number, depthToTarget: number }>
  directReferrer: { id: string, name: string, email: string } | null
  directReferrals: number
  totalDownline: number
}

interface WithdrawalItem {
  id: string
  amount: number
  originalAmount: number
  bettingHouse: string
  status: string
  requestNote?: string
  adminNote?: string
  createdAt: string
  pixKeyType?: string
  isExternal?: boolean
  externalApprovedByName?: string | null
  externalApprovedByEmail?: string | null
}

interface FraudLogItem {
  id: string
  userId: string
  bettingHouse: string
  oldCount: number
  newCount: number
  reason: string
  createdAt: string
  user: { name: string; email: string }
  changedBy: { name: string; email: string }
}

interface FraudDetailItem {
  bettingHouse: string
  fraudCount: number
  deduction: number
  source: 'direct' | 'network'
  memberName?: string
  memberEmail?: string
}

interface FraudResponse {
  directFrauds: FraudDetailItem[]
  networkFrauds: FraudDetailItem[]
  totalDirectDeduction: number
  totalNetworkDeduction: number
  totalDeduction: number
  logs: FraudLogItem[]
  logsTotal: number
  logsPage: number
  logsLimit: number
}

const route = useRoute()
const id = computed(() => String(route.params.id))
const { authHeaders } = useAuth()
const apiBase = useApiBase()
const toast = useToast()

const loading = ref(true)
const refreshing = ref(false)
const activeTab = ref((route.query.tab as string) || 'dashboard')

// ── Profile edit mode ─────────────────────────────────────────────────────
const editingProfile = ref(route.query.edit === 'true')
const profileSaving = ref(false)
const editForm = reactive({
  name: '',
  email: '',
  cpf: '',
  whatsapp: '',
  pixKeyType: '',
  pixKey: '',
  bankName: '',
  bankAgency: '',
  bankAccount: '',
  accountHolder: '',
})

const passwordSaving = ref(false)
const showPassword = ref(false)
const passwordForm = reactive({
  password: '',
  confirmPassword: ''
})

const passwordError = computed(() => {
  if (!passwordForm.password) return ''
  if (passwordForm.password.length < 8) return 'A senha deve ter no mínimo 8 caracteres.'
  if (!/[A-Z]/.test(passwordForm.password)) return 'A senha precisa ter pelo menos 1 letra maiúscula.'
  if (!/\d/.test(passwordForm.password)) return 'A senha precisa ter pelo menos 1 número.'
  if (!/[@$!%*?&]/.test(passwordForm.password)) return 'A senha precisa ter pelo menos 1 caractere especial.'
  if (passwordForm.confirmPassword && passwordForm.password !== passwordForm.confirmPassword) return 'As senhas não conferem.'
  return ''
})

const pixTypes = [
  { label: 'CPF', value: 'cpf' },
  { label: 'CNPJ', value: 'cnpj' },
  { label: 'E-mail', value: 'email' },
  { label: 'Telefone', value: 'phone' },
  { label: 'Chave aleatória', value: 'random' },
]

function openEditProfile() {
  if (!profile.value) return
  editForm.name = profile.value.name || ''
  editForm.email = profile.value.email || ''
  editForm.cpf = profile.value.cpf || ''
  editForm.whatsapp = profile.value.whatsapp || ''
  editForm.pixKeyType = profile.value.pixKeyType || ''
  editForm.pixKey = profile.value.pixKey || ''
  editForm.bankName = profile.value.bankName || ''
  editForm.bankAgency = profile.value.bankAgency || ''
  editForm.bankAccount = profile.value.bankAccount || ''
  editForm.accountHolder = profile.value.accountHolder || ''
  editingProfile.value = true
}

function cancelEditProfile() {
  editingProfile.value = false
}

async function saveProfile() {
  profileSaving.value = true
  try {
    await $fetch(`${apiBase}/v1/admin/users/${id.value}`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: {
        name: editForm.name || undefined,
        email: editForm.email || undefined,
        cpf: editForm.cpf || undefined,
        whatsapp: editForm.whatsapp || undefined,
        pixKeyType: editForm.pixKeyType || undefined,
        pixKey: editForm.pixKey || undefined,
        bankName: editForm.bankName || undefined,
        bankAgency: editForm.bankAgency || undefined,
        bankAccount: editForm.bankAccount || undefined,
        accountHolder: editForm.accountHolder || undefined,
      }
    })
    toast.add({ title: 'Dados salvos com sucesso.', color: 'success' })
    editingProfile.value = false
    await loadProfile()
  } catch (err: unknown) {
    const e = err as { data?: { detail?: string, message?: string }; message?: string }
    toast.add({
      title: 'Erro ao salvar dados',
      description: e.data?.detail || e.data?.message || e.message || '',
      color: 'error'
    })
  } finally {
    profileSaving.value = false
  }
}

async function changePassword() {
  if (!profile.value) return
  if (!passwordForm.password || !passwordForm.confirmPassword || passwordError.value) {
    toast.add({
      title: 'Revise a nova senha',
      description: passwordError.value || 'Informe e confirme a nova senha.',
      color: 'warning'
    })
    return
  }

  passwordSaving.value = true
  try {
    await $fetch(`${apiBase}/v1/admin/users/${id.value}/password`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: { password: passwordForm.password }
    })
    passwordForm.password = ''
    passwordForm.confirmPassword = ''
    showPassword.value = false
    toast.add({ title: 'Senha alterada com sucesso.', color: 'success' })
  } catch (err: unknown) {
    const e = err as { data?: { detail?: string, message?: string }; message?: string }
    toast.add({
      title: 'Erro ao alterar senha',
      description: e.data?.detail || e.data?.message || e.message || '',
      color: 'error'
    })
  } finally {
    passwordSaving.value = false
  }
}

// ── Affiliate link modal ───────────────────────────────────────────────────
const showLinkModal = ref(false)
const linkModalMode = ref<'create' | 'edit'>('create')
const linkModalSaving = ref(false)
const editingLinkId = ref('')
const linkForm = reactive({
  bettingHouse: '',
  campaignId: '',
  affiliateId: '',
  cpa: '',
  revshare: '',
  userLink: '',
})

// Auto-preenche campaignId/affiliateId ao colar o link de divulgação:
//  - Superbet: ...C.ashx?siteid=X&c=Y → campaignId "X-Y", affiliateId "X"
//    (espelha extractSuperbetCampaignId do backend).
//  - Smartico / Bateu Bet: ...?afp=CODIGO → campaignId "CODIGO". É o mesmo
//    valor que o sync lê em group_by=afp, então o link casa com o dado bruto.
// Só age em criação e sem sobrescrever campos já digitados manualmente.
function onUserLinkInput() {
  if (linkModalMode.value !== 'create') return
  const url = linkForm.userLink.trim()
  if (!url) return

  let qs: URLSearchParams | null = null
  try {
    qs = new URL(url).searchParams
  } catch {
    qs = null
  }
  const param = (name: string): string => {
    const fromQs = qs?.get(name)
    if (fromQs) return fromQs.trim()
    const m = url.match(new RegExp(`[?&]${name}=([^&]+)`, 'i'))
    return m?.[1] ? decodeURIComponent(m[1].replace(/\+/g, ' ')).trim() : ''
  }

  const siteid = param('siteid') || param('siteId')
  const c = param('c')
  if (siteid && c) {
    if (!linkForm.campaignId) linkForm.campaignId = `${siteid}-${c}`
    if (!linkForm.affiliateId) linkForm.affiliateId = siteid
    return
  }

  // Smartico aceita afp e afp1..afp5 — a casa define qual dimensão o sync lê.
  const afp = ['afp', 'afp1', 'afp2', 'afp3', 'afp4', 'afp5']
    .map(name => param(name))
    .find(value => value !== '')
  if (afp && !linkForm.campaignId) linkForm.campaignId = afp
}

// Delete link state
const showDeleteLinkModal = ref(false)
const deletingLinkId = ref('')
const deletingLinkSaving = ref(false)

// Liberação de saque extra: libera 1 saque adicional na casa hoje, ignorando
// o limite de 1/dia/casa. Ação exclusiva do painel admin.
const releasingHouse = ref('')
async function grantWithdrawalRelease(bettingHouse: string) {
  releasingHouse.value = bettingHouse
  try {
    const res = await $fetch<{ alreadyExisted: boolean }>(
      `${apiBase}/v1/admin/affiliates/${id.value}/withdrawal-release`,
      { method: 'POST', headers: authHeaders(), body: { bettingHouse } },
    )
    toast.add({
      title: res?.alreadyExisted ? 'Saque já estava liberado hoje' : 'Saque extra liberado',
      description: `Casa: ${bettingHouse}. Vale para 1 saque adicional hoje.`,
      color: 'success',
      icon: 'i-lucide-unlock',
    })
  } catch (err: unknown) {
    const e = err as { data?: { detail?: string, message?: string }; message?: string }
    toast.add({
      title: 'Erro ao liberar saque',
      description: e.data?.detail || e.data?.message || e.message || '',
      color: 'error',
    })
  } finally {
    releasingHouse.value = ''
  }
}

const houseSelectItems = computed(() =>
  globalHouses.value.map(h => ({ label: `${h.name} (${h.slug})`, value: h.slug }))
)

function openCreateLink() {
  linkModalMode.value = 'create'
  linkForm.bettingHouse = ''
  linkForm.campaignId = ''
  linkForm.affiliateId = ''
  linkForm.cpa = ''
  linkForm.revshare = ''
  linkForm.userLink = ''
  showLinkModal.value = true
}

function openEditLink(link: AffiliateProfile['affiliateLinks'][number]) {
  linkModalMode.value = 'edit'
  editingLinkId.value = link.id
  linkForm.bettingHouse = link.bettingHouse
  linkForm.campaignId = link.campaignId
  linkForm.affiliateId = link.affiliateId || ''
  linkForm.cpa = link.cpa || ''
  linkForm.revshare = link.revshare || ''
  linkForm.userLink = link.userLink || ''
  showLinkModal.value = true
}

async function saveLinkModal() {
  linkModalSaving.value = true

  // IsDecimal() on backend expects string — convert numbers to decimal strings
  const toDecimalStr = (v: string | number): string | undefined => {
    if (v === '' || v === null || v === undefined) return undefined
    const n = parseFloat(String(v))
    if (isNaN(n)) return undefined
    return n.toFixed(4)
  }

  try {
    if (linkModalMode.value === 'create') {
      await $fetch(`${apiBase}/v1/admin/users/${id.value}/affiliate-links`, {
        method: 'POST',
        headers: authHeaders(),
        body: {
          bettingHouse: linkForm.bettingHouse,
          campaignId: linkForm.campaignId,
          affiliateId: linkForm.affiliateId || undefined,
          cpa: toDecimalStr(linkForm.cpa),
          revshare: toDecimalStr(linkForm.revshare),
          userLink: linkForm.userLink || undefined,
        }
      })
      toast.add({ title: 'Link criado com sucesso.', color: 'success' })
    } else {
      await $fetch(`${apiBase}/v1/admin/users/${id.value}/affiliate-links/${editingLinkId.value}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: {
          affiliateId: linkForm.affiliateId || undefined,
          cpa: toDecimalStr(linkForm.cpa),
          revshare: toDecimalStr(linkForm.revshare),
          userLink: linkForm.userLink || undefined,
        }
      })
      toast.add({ title: 'Link atualizado com sucesso.', color: 'success' })
    }
    showLinkModal.value = false
    await loadProfile()
  } catch (err: unknown) {
    const e = err as { data?: { detail?: string, message?: string }; message?: string }
    toast.add({
      title: 'Erro ao salvar link',
      description: e.data?.detail || e.data?.message || e.message || '',
      color: 'error'
    })
  } finally {
    linkModalSaving.value = false
  }
}

function openDeleteLink(linkId: string) {
  deletingLinkId.value = linkId
  showDeleteLinkModal.value = true
}

async function confirmDeleteLink() {
  deletingLinkSaving.value = true
  try {
    await $fetch(`${apiBase}/v1/admin/users/${id.value}/affiliate-links/${deletingLinkId.value}`, {
      method: 'DELETE',
      headers: authHeaders(),
    })
    toast.add({ title: 'Link removido.', color: 'success' })
    showDeleteLinkModal.value = false
    await loadProfile()
  } catch (err: unknown) {
    const e = err as { data?: { detail?: string, message?: string }; message?: string }
    toast.add({
      title: 'Erro ao remover link',
      description: e.data?.detail || e.data?.message || e.message || '',
      color: 'error'
    })
  } finally {
    deletingLinkSaving.value = false
  }
}

const profile = ref<AffiliateProfile | null>(null)
const summary = ref<Summary | null>(null)
const balance = ref<Balance | null>(null)
const allTimeBalance = ref<Balance | null>(null)
const campaigns = ref<CampaignRow[]>([])
const linksPerf = ref<LinkPerformance[]>([])
const dailyPerHouse = ref<DailyPerHouseRow[]>([])
const network = ref<NetworkResponse | null>(null)
const referralOrigin = ref<ReferralOriginResponse | null>(null)
const referralOriginLoading = ref(false)
const referralOriginDirty = ref(true)
const withdrawals = ref<WithdrawalItem[]>([])
const fraudLogs = ref<FraudLogItem[]>([])
const fraudDirect = ref<FraudDetailItem[]>([])
const fraudNetwork = ref<FraudDetailItem[]>([])
const fraudTotals = ref({ direct: 0, network: 0, total: 0 })
const fraudsTotal = ref(0)
const fraudsDirty = ref(true)
const availableHouses = ref<HouseOption[]>([])
const globalHouses = ref<HouseOption[]>([])

const presets = [
  { label: 'Hoje', value: 'today' },
  { label: '7 dias', value: '7d' },
  { label: '30 dias', value: '30d' },
  { label: 'Este Mês', value: 'month' },
  { label: 'Mês Passado', value: 'prevMonth' },
  { label: 'Todo o tempo', value: 'all' },
  { label: 'Dia Específico', value: 'custom' }
]
const activePreset = ref('7d')
const customDate = ref('')
const selectedHouse = ref('__all__')

// Per-tab local search and filters (client-side over already-fetched data)
const campaignsSearch = ref('')
const linksSearch = ref('')
const linksOnlyEarning = ref(false)
const networkSearch = ref('')
const networkLevelFilter = ref<string>('__all__')
const networkStatusFilter = ref<'__all__' | 'APPROVED' | 'PENDING' | 'REJECTED' | 'BLOCKED'>('__all__')
const withdrawalsSearch = ref('')
const withdrawalsStatusFilter = ref<'__all__' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'PROCESSING' | 'COMPLETED' | 'FAILED'>('__all__')
const fraudsSearch = ref('')
const fraudsHouseFilter = ref('__all__')

// Per-tab pagination
const TAB_PAGE_SIZE = 10
const campaignsPage = ref(1)
const linksPage = ref(1)
const networkPage = ref(1)
const withdrawalsPage = ref(1)
const dailyPerHousePage = ref(1)
const fraudsPage = ref(1)

function buildDateRange(preset: string) {
  if (preset === 'custom') {
    if (!customDate.value) return { startDate: new Date().toISOString().slice(0, 10), endDate: new Date().toISOString().slice(0, 10) }
    return { startDate: customDate.value, endDate: customDate.value }
  }

  const now = new Date()
  const end = new Date(now)
  const start = new Date(now)
  if (preset === 'today') {
    start.setHours(0, 0, 0, 0)
  } else if (preset === '7d') {
    start.setDate(start.getDate() - 6)
    start.setHours(0, 0, 0, 0)
  } else if (preset === '30d') {
    start.setDate(start.getDate() - 29)
    start.setHours(0, 0, 0, 0)
  } else if (preset === 'month') {
    start.setDate(1)
    start.setHours(0, 0, 0, 0)
  } else if (preset === 'prevMonth') {
    start.setMonth(start.getMonth() - 1)
    start.setDate(1)
    start.setHours(0, 0, 0, 0)
    end.setDate(0)
    end.setHours(23, 59, 59, 999)
  } else if (preset === 'all') {
    return { startDate: '2020-01-01', endDate: new Date().toISOString().slice(0, 10) }
  }
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return { startDate: fmt(start), endDate: fmt(end) }
}

const money = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0)
const integer = (value: number) => new Intl.NumberFormat('pt-BR').format(value || 0)
// `YYYY-MM-DD` strings parse as UTC midnight, which shifts to the previous
// day on negative-offset browsers. Anchor at local noon to dodge DST/UTC drift.
const date = (value: string) => {
  if (!value) return ''
  const anchored = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value
  return new Date(anchored).toLocaleDateString('pt-BR')
}

const activeDateRangeLabel = computed(() => {
  const { startDate, endDate } = buildDateRange(activePreset.value)
  const fmtDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('pt-BR')
  if (startDate === endDate) return fmtDate(startDate)
  return `${fmtDate(startDate)} — ${fmtDate(endDate)}`
})

const tabs = [
  { label: 'Dashboard', value: 'dashboard', icon: 'i-lucide-layout-dashboard' },
  { label: 'Campanhas', value: 'campaigns', icon: 'i-lucide-target' },
  { label: 'Origem', value: 'origin', icon: 'i-lucide-git-branch' },
  { label: 'Rede', value: 'network', icon: 'i-lucide-network' },
  { label: 'Saques', value: 'withdrawals', icon: 'i-lucide-banknote' },
  //{ label: 'Fraudes', value: 'frauds', icon: 'i-lucide-shield-alert' },
  { label: 'Perfil', value: 'profile', icon: 'i-lucide-user' }
]

async function loadReferralOrigin() {
  referralOriginLoading.value = true
  try {
    referralOrigin.value = await $fetch<ReferralOriginResponse>(
      `${apiBase}/v1/admin/affiliates/${id.value}/referral-origin`,
      { headers: authHeaders() },
    )
    referralOriginDirty.value = false
  } catch {
    referralOrigin.value = null
  } finally {
    referralOriginLoading.value = false
  }
}

async function loadProfile() {
  const [profileRes, filtersRes] = await Promise.all([
    $fetch<AffiliateProfile>(`${apiBase}/v1/admin/affiliates/${id.value}/profile`, { headers: authHeaders() }),
    $fetch<{ bettingHouses: HouseOption[] }>(`${apiBase}/v1/admin/affiliates/${id.value}/dashboard/filters`, { headers: authHeaders() }).catch((err) => {
      console.warn('[Admin] Falha ao carregar filtros do dashboard, usando fallback:', err?.data?.message || err?.message || err)
      return { bettingHouses: [] as HouseOption[] }
    })
  ])
  profile.value = profileRes

  // Primary: use filters endpoint response
  let houses = filtersRes.bettingHouses || []

  // Fallback: if filters returned no houses but the affiliate has links,
  // derive house options from their affiliateLinks (already loaded in profile)
  if (houses.length === 0 && profileRes.affiliateLinks?.length) {
    const slugSet = new Set(profileRes.affiliateLinks.map(l => l.bettingHouse))
    // Fetch house details for the slugs we found
    try {
      const allHouses = await $fetch<{ data: HouseOption[] }>(`${apiBase}/v1/link-requests/houses`, { headers: authHeaders() })
      globalHouses.value = allHouses.data || []
      houses = (allHouses.data || []).filter(h => slugSet.has(h.slug))
    } catch {
      // Last resort: use raw slug as both name and slug
      houses = Array.from(slugSet).map(slug => ({ id: slug, name: slug, slug }))
    }
  } else {
    // If we didn't fetch allHouses above, fetch them now so globalHouses is populated
    try {
      const allHouses = await $fetch<{ data: HouseOption[] }>(`${apiBase}/v1/link-requests/houses`, { headers: authHeaders() })
      globalHouses.value = allHouses.data || []
    } catch (e) {
      console.warn('Could not fetch global houses', e)
    }
  }

  availableHouses.value = houses

  // Always fetch global houses for translation map to ensure old/inactive houses display correctly
  try {
    const allReq = await $fetch<{ data: HouseOption[] }>(`${apiBase}/v1/link-requests/houses`, { headers: authHeaders() })
    globalHouses.value = allReq.data || []
  } catch (err) {
    console.warn('[Admin] Falha ao carregar lista global de casas', err)
  }
}

// Cancel previous in-flight requests on every new load wave so a fast filter
// change does not stack rajadas on top of each other and saturate the pool.
let dashboardAbortController: AbortController | null = null
let withdrawalsAbortController: AbortController | null = null
let dashboardDebounceTimer: ReturnType<typeof setTimeout> | null = null
const withdrawalsDirty = ref(true)

async function loadDashboardData() {
  if (dashboardAbortController) dashboardAbortController.abort()
  dashboardAbortController = new AbortController()
  const signal = dashboardAbortController.signal

  refreshing.value = true
  try {
    const { startDate, endDate } = buildDateRange(activePreset.value)
    const query: Record<string, string> = { startDate, endDate }
    if (selectedHouse.value !== '__all__') query.bettingHouse = selectedHouse.value

    const balanceQuery: Record<string, string> = { startDate, endDate }
    if (selectedHouse.value !== '__all__') balanceQuery.bettingHouse = selectedHouse.value

    // /network has its own DTO (NetworkTreeQueryDto) that whitelists `house`
    // not `bettingHouse`. Sending bettingHouse would 400 due to global
    // forbidNonWhitelisted ValidationPipe, which is why the Rede tab was empty.
    // Fetch the full network (all levels) so the level filter + dropdown work
    // correctly client-side. getTree returns members in BFS order (level 1
    // first), so a small page would hide deeper levels for heads with many
    // direct referrals. Mirrors the affiliate Earnings tab, which loads all.
    const networkQuery: Record<string, string> = { startDate, endDate, limit: '100000' }
    if (selectedHouse.value !== '__all__') networkQuery.house = selectedHouse.value

    const allTimeBalanceQuery: Record<string, string> = {}
    if (selectedHouse.value !== '__all__') allTimeBalanceQuery.bettingHouse = selectedHouse.value

    const [summaryRes, balanceRes, allTimeBalanceRes, campaignsRes, dailyPerHouseRes, linksRes, networkRes] = await Promise.all([
      $fetch<Summary>(`${apiBase}/v1/admin/affiliates/${id.value}/dashboard/summary`, { headers: authHeaders(), query, signal }).catch(() => null),
      $fetch<Balance>(`${apiBase}/v1/admin/affiliates/${id.value}/dashboard/balance`, { headers: authHeaders(), query: balanceQuery, signal }).catch(() => null),
      $fetch<Balance>(`${apiBase}/v1/admin/affiliates/${id.value}/dashboard/balance`, { headers: authHeaders(), query: allTimeBalanceQuery, signal }).catch(() => null),
      $fetch<CampaignRow[]>(`${apiBase}/v1/admin/affiliates/${id.value}/dashboard/campaigns`, { headers: authHeaders(), query, signal }).catch(() => []),
      $fetch<DailyPerHouseRow[]>(`${apiBase}/v1/admin/affiliates/${id.value}/dashboard/daily-per-house`, { headers: authHeaders(), query, signal }).catch(() => []),
      $fetch<{ data: LinkPerformance[] }>(`${apiBase}/v1/admin/affiliates/${id.value}/dashboard/links-performance`, { headers: authHeaders(), query, signal }).catch(() => ({ data: [] })),
      $fetch<NetworkResponse>(`${apiBase}/v1/admin/affiliates/${id.value}/network`, { headers: authHeaders(), query: networkQuery, signal }).catch(() => null)
    ])

    if (signal.aborted) return

    summary.value = summaryRes
    balance.value = balanceRes
    allTimeBalance.value = allTimeBalanceRes
    campaigns.value = Array.isArray(campaignsRes) ? campaignsRes : []
    dailyPerHouse.value = Array.isArray(dailyPerHouseRes) ? dailyPerHouseRes : []
    linksPerf.value = linksRes.data ?? []
    network.value = networkRes

    // Withdrawals search hits an admin endpoint that joins users; deferred to
    // when the Saques tab is actually open. Marked dirty otherwise.
    if (activeTab.value === 'withdrawals') {
      void loadWithdrawals()
    } else {
      withdrawalsDirty.value = true
    }
  } finally {
    if (dashboardAbortController?.signal === signal) {
      refreshing.value = false
      dashboardAbortController = null
    }
  }
}

async function loadWithdrawals() {
  if (!profile.value?.email) {
    withdrawals.value = []
    withdrawalsDirty.value = false
    return
  }
  if (withdrawalsAbortController) withdrawalsAbortController.abort()
  withdrawalsAbortController = new AbortController()
  const signal = withdrawalsAbortController.signal
  try {
    const res = await $fetch<{ data: WithdrawalItem[] }>(`${apiBase}/v1/withdrawals`, {
      headers: authHeaders(),
      // includeExternal: mostra também os saques via API (usuário externo) com selo.
      query: { search: profile.value.email, limit: 20, includeExternal: true },
      signal
    }).catch(() => ({ data: [] as WithdrawalItem[] }))
    if (signal.aborted) return
    withdrawals.value = res.data
    withdrawalsDirty.value = false
  } finally {
    if (withdrawalsAbortController?.signal === signal) {
      withdrawalsAbortController = null
    }
  }
}

async function loadFrauds() {
  const query: Record<string, string | number> = { page: fraudsPage.value, limit: TAB_PAGE_SIZE }
  if (fraudsHouseFilter.value !== '__all__') query.bettingHouse = fraudsHouseFilter.value
  const empty: FraudResponse = {
    directFrauds: [], networkFrauds: [],
    totalDirectDeduction: 0, totalNetworkDeduction: 0, totalDeduction: 0,
    logs: [], logsTotal: 0, logsPage: 1, logsLimit: TAB_PAGE_SIZE
  }
  const res = await $fetch<FraudResponse>(
    `${apiBase}/v1/admin/affiliates/${id.value}/fraud-logs`,
    { headers: authHeaders(), query }
  ).catch((err) => {
    console.warn('[Admin] Falha ao carregar fraudes:', err?.data?.message || err?.message || err)
    return empty
  })
  fraudDirect.value = res.directFrauds
  fraudNetwork.value = res.networkFrauds
  fraudTotals.value = {
    direct: res.totalDirectDeduction,
    network: res.totalNetworkDeduction,
    total: res.totalDeduction,
  }
  fraudLogs.value = res.logs
  fraudsTotal.value = res.logsTotal
  fraudsDirty.value = false
}

async function load() {
  loading.value = true
  try {
    await loadProfile()
    // Auto-populate edit form if coming from ?edit=true (pencil button in list)
    if (editingProfile.value) openEditProfile()
    await loadBalanceAdjustments()
    await loadDashboardData()
    if (activeTab.value === 'origin') {
      await loadReferralOrigin()
    }
  } finally {
    loading.value = false
  }
}

watch([activePreset, customDate, selectedHouse], () => {
  if (activePreset.value === 'custom' && !customDate.value) return
  if (loading.value) return
  if (dashboardDebounceTimer) clearTimeout(dashboardDebounceTimer)
  dashboardDebounceTimer = setTimeout(() => {
    dashboardDebounceTimer = null
    loadDashboardData()
  }, 300)
})

watch(activeTab, (tab) => {
  if (tab === 'origin' && referralOriginDirty.value && !referralOriginLoading.value) {
    void loadReferralOrigin()
  }
  if (tab === 'withdrawals' && withdrawalsDirty.value && !loading.value) {
    void loadWithdrawals()
  }
  if (tab === 'frauds' && (fraudsDirty.value || !fraudLogs.value.length) && !loading.value) {
    void loadFrauds()
  }
})

onBeforeUnmount(() => {
  if (dashboardDebounceTimer) clearTimeout(dashboardDebounceTimer)
  dashboardAbortController?.abort()
  withdrawalsAbortController?.abort()
})

// ── Per-tab filtered views (client-side over fetched data) ──────────────────

// Reset pagination to 1 when search/filter changes
watch(campaignsSearch, () => { campaignsPage.value = 1 })
watch([networkSearch, networkLevelFilter, networkStatusFilter], () => { networkPage.value = 1 })
watch([withdrawalsSearch, withdrawalsStatusFilter], () => { withdrawalsPage.value = 1 })
watch(dailyPerHouse, () => { dailyPerHousePage.value = 1 })
watch([fraudsHouseFilter], () => {
  fraudsPage.value = 1
  void loadFrauds()
})
watch(fraudsPage, () => { void loadFrauds() })

// Merge campaigns + linksPerf por bettingHouse+campaignId
const mergedCampaigns = computed(() => {
  const linkMap = new Map<string, LinkPerformance>()
  for (const l of linksPerf.value) {
    linkMap.set(`${l.bettingHouse}||${l.campaignId}`, l)
  }
  return campaigns.value.map((c) => {
    const link = linkMap.get(`${c.bettingHouse}||${c.campaignId}`)
    return {
      ...c,
      cpaRate:      link?.cpaRate      ?? 0,
      revRate:      link?.revRate      ?? 0,
      myCpa:        link?.myCpa        ?? 0,
      myRev:        link?.myRev        ?? 0,
      myCommission: link?.myCommission ?? c.totalCommission,
      volume: c.volume ?? link?.volume ?? 0,
    }
  })
})

const filteredCampaigns = computed(() => {
  const q = campaignsSearch.value.trim().toLowerCase()
  if (!q) return mergedCampaigns.value
  return mergedCampaigns.value.filter((c) =>
    houseName(c.bettingHouse).toLowerCase().includes(q)
    || c.bettingHouse.toLowerCase().includes(q)
    || c.campaignId.toLowerCase().includes(q)
    || (c.campaignName ?? '').toLowerCase().includes(q)
    || (c.utmCampaign ?? '').toLowerCase().includes(q)
  )
})
const pagedCampaigns = computed(() => {
  const start = (campaignsPage.value - 1) * TAB_PAGE_SIZE
  return filteredCampaigns.value.slice(start, start + TAB_PAGE_SIZE)
})

const filteredNetwork = computed(() => {
  const q = networkSearch.value.trim().toLowerCase()
  const members = network.value?.network ?? []
  return members.filter((m) => {
    if (networkLevelFilter.value !== '__all__' && String(m.level) !== networkLevelFilter.value) return false
    if (networkStatusFilter.value !== '__all__' && m.status !== networkStatusFilter.value) return false
    if (!q) return true
    return m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)
  })
})
const pagedNetwork = computed(() => {
  const start = (networkPage.value - 1) * TAB_PAGE_SIZE
  return filteredNetwork.value.slice(start, start + TAB_PAGE_SIZE)
})

// Level filter options: only the levels that actually exist in this
// affiliate's tree (the tree goes up to 10 levels deep), not a fixed 1..3.
const networkLevelOptions = computed(() => {
  const levels = new Set<number>()
  for (const m of network.value?.network ?? []) levels.add(m.level)
  const sorted = Array.from(levels).sort((a, b) => a - b)
  return [
    { label: 'Todos os níveis', value: '__all__' },
    ...sorted.map(level => ({ label: `Nível ${level}`, value: String(level) })),
  ]
})

const filteredWithdrawals = computed(() => {
  const q = withdrawalsSearch.value.trim().toLowerCase()
  return withdrawals.value.filter((w) => {
    if (withdrawalsStatusFilter.value !== '__all__' && w.status !== withdrawalsStatusFilter.value) return false
    if (!q) return true
    return houseName(w.bettingHouse).toLowerCase().includes(q)
      || w.bettingHouse.toLowerCase().includes(q)
      || w.status.toLowerCase().includes(q)
      || (w.requestNote ?? '').toLowerCase().includes(q)
      || (w.adminNote ?? '').toLowerCase().includes(q)
  })
})
const pagedWithdrawals = computed(() => {
  const start = (withdrawalsPage.value - 1) * TAB_PAGE_SIZE
  return filteredWithdrawals.value.slice(start, start + TAB_PAGE_SIZE)
})

// House name lookup: slug → name (falls back to slug if not found)
const houseNameMap = computed(() => {
  const m = new Map<string, string>()
  // Put available houses first
  for (const h of availableHouses.value) m.set(h.slug, h.name)
  // Put global houses (will override or add anything missing)
  for (const h of globalHouses.value) {
    if (!m.has(h.slug)) m.set(h.slug, h.name)
  }
  return m
})
const houseName = (slug: string) =>
  slug === 'all'
    ? 'Todas as casas'
    : (houseNameMap.value.get(slug) ?? slug)

const pagedDailyPerHouse = computed(() => {
  const start = (dailyPerHousePage.value - 1) * TAB_PAGE_SIZE
  return dailyPerHouse.value.slice(start, start + TAB_PAGE_SIZE)
})

async function toggleBalanceBlock() {
  if (!profile.value) return
  const blocked = !profile.value.withdrawalBlocked
  await $fetch(`${apiBase}/v1/admin/affiliates/${id.value}/balance-block`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: {
      blocked,
      reason: blocked ? 'Bloqueio manual no detalhe do afiliado.' : 'Desbloqueio manual no detalhe do afiliado.'
    }
  })
  toast.add({ title: blocked ? 'Saldo bloqueado' : 'Saldo liberado', color: blocked ? 'warning' : 'success' })
  await loadProfile()
}

// Liga/desliga o acesso a deals exclusivas (usuário "exclusivo").
async function toggleExclusiveDeals() {
  if (!profile.value) return
  const exclusive = !profile.value.exclusiveDealsAccess
  try {
    await $fetch(`${apiBase}/v1/admin/affiliates/${id.value}/exclusive-deals`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: { exclusive }
    })
    toast.add({
      title: exclusive ? 'Usuário marcado como exclusivo' : 'Acesso exclusivo removido',
      description: exclusive
        ? 'Agora vê as deals públicas + as exclusivas.'
        : 'Volta a ver só as deals públicas.',
      color: 'success'
    })
    await loadProfile()
  } catch (err: unknown) {
    toast.add({ title: 'Erro ao atualizar', description: (err as Error)?.message, color: 'error' })
  }
}

async function toggleApiAccess() {
  if (!profile.value) return
  const enabled = !profile.value.apiAccessEnabled
  try {
    await $fetch(`${apiBase}/v1/admin/affiliates/${id.value}/api-access`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: { enabled }
    })
    toast.add({
      title: enabled ? 'Acesso à API/Webhooks liberado' : 'Acesso à API/Webhooks bloqueado',
      description: enabled
        ? 'O usuário agora vê as abas de API e Webhook.'
        : 'As abas de API e Webhook foram ocultadas para o usuário.',
      color: 'success'
    })
    await loadProfile()
  } catch (err: unknown) {
    toast.add({ title: 'Erro ao atualizar', description: (err as Error)?.message, color: 'error' })
  }
}

// ── Ajuste de saldo (por casa) ─────────────────────────────────────────────
// Valor ABSOLUTO (SET) somado ao saldo da casa no DashboardBalanceService
// (campo `adjustment`). Negativo abate; positivo credita. Upsert por casa.
interface BalanceAdjustment {
  bettingHouse: string
  amount: number
  reason: string | null
  updatedAt: string
}
const balanceAdjustments = ref<BalanceAdjustment[]>([])
const adjSaving = ref(false)
const adjForm = reactive({
  bettingHouse: '',
  amount: '' as string | number,
  reason: '',
})

async function loadBalanceAdjustments() {
  try {
    balanceAdjustments.value = await $fetch<BalanceAdjustment[]>(
      `${apiBase}/v1/admin/affiliates/${id.value}/balance-adjustments`,
      { headers: authHeaders() },
    )
  } catch {
    balanceAdjustments.value = []
  }
}

async function saveBalanceAdjustment() {
  const house = adjForm.bettingHouse
  const amount = Number(adjForm.amount)
  if (!house) {
    toast.add({ title: 'Selecione a casa', color: 'warning' })
    return
  }
  if (!Number.isFinite(amount)) {
    toast.add({ title: 'Informe um valor válido', color: 'warning' })
    return
  }
  adjSaving.value = true
  try {
    await $fetch(
      `${apiBase}/v1/admin/affiliates/${id.value}/balance-adjustments`,
      {
        method: 'PUT',
        headers: authHeaders(),
        body: { bettingHouse: house, amount, reason: adjForm.reason || undefined },
      },
    )
    toast.add({
      title: 'Ajuste salvo',
      description: `${houseName(house)}: ${amount < 0 ? 'abate' : 'crédito'} de R$ ${Math.abs(amount).toFixed(2)}.`,
      color: 'success',
      icon: 'i-lucide-scale',
    })
    adjForm.bettingHouse = ''
    adjForm.amount = ''
    adjForm.reason = ''
    await loadBalanceAdjustments()
  } catch (err: unknown) {
    const e = err as { data?: { detail?: string, message?: string }; message?: string }
    toast.add({
      title: 'Erro ao salvar ajuste',
      description: e.data?.detail || e.data?.message || e.message || '',
      color: 'error',
    })
  } finally {
    adjSaving.value = false
  }
}

function editAdjustment(a: BalanceAdjustment) {
  adjForm.bettingHouse = a.bettingHouse
  adjForm.amount = a.amount
  adjForm.reason = a.reason || ''
}

onMounted(load)
</script>

<template>
  <div class="fade-up">
    <!-- Mirror banner -->
    <div
      class="flex items-center gap-3.5 flex-wrap"
      style="padding: 14px 28px; background: var(--color-purple-soft); border-bottom: 1px solid var(--color-purple-border)"
    >
      <NuxtLink
        to="/affiliates"
        class="btn btn-ghost btn-sm"
      >
        <UIcon
          name="i-lucide-chevron-left"
          class="size-3.5"
        />
        Voltar
      </NuxtLink>
      <UIcon
        name="i-lucide-eye"
        class="size-4"
        style="color: #A78BFA"
      />
      <div style="font-size: 13px">
        <span style="color: var(--color-text-secondary)">Visualizando painel de</span>
        <strong style="margin-left: 4px">{{ profile?.name || 'afiliado' }}</strong>
        <span style="color: var(--color-text-muted); margin-left: 8px">· {{ profile?.email || '' }}</span>
      </div>
      <span
        class="badge badge-purple"
        style="margin-left: auto"
      >
        Modo leitura
      </span>
    </div>

    <div
      v-if="loading"
      class="flex flex-col items-center justify-center py-20 text-muted"
    >
      <UIcon
        name="i-lucide-loader-2"
        class="size-8 animate-spin mb-4"
        style="color: var(--color-purple)"
      />
      <p>Carregando informações do afiliado...</p>
    </div>

    <div
      v-else
      class="space-y-5"
      style="padding: 24px 28px"
    >
      <!-- Header -->
      <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div class="space-y-1">
          <UButton
            to="/affiliates"
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="link"
            class="px-0 -mt-1"
          >
            Voltar
          </UButton>
          <div class="flex items-center gap-3 flex-wrap">
            <div class="size-10 rounded-full bg-primary/20 flex items-center justify-center text-sm font-bold text-primary">
              {{ profile?.name?.charAt(0)?.toUpperCase() || 'A' }}
            </div>
            <div>
              <h1 class="text-xl font-black text-highlighted leading-tight">
                {{ profile?.name || 'Afiliado' }}
              </h1>
              <p class="text-xs text-muted">
                {{ profile?.email }}
              </p>
            </div>
            <UBadge
              v-if="profile"
              :color="profile.status === 'APPROVED' ? 'success' : profile.status === 'BLOCKED' ? 'error' : 'warning'"
              variant="soft"
            >
              {{ profile.status }}
            </UBadge>
            <UBadge
              v-if="profile?.withdrawalBlocked"
              color="error"
              variant="soft"
              icon="i-lucide-lock"
            >
              Saldo bloqueado
            </UBadge>
          </div>
          <!-- Always-visible total balance pill -->
          <div
            v-if="allTimeBalance"
            class="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold mt-3"
            style="background: color-mix(in srgb, var(--ui-color-success-500) 12%, transparent); color: var(--ui-color-success-700); border: 1px solid color-mix(in srgb, var(--ui-color-success-500) 30%, transparent); width: fit-content;"
          >
            <UIcon name="i-lucide-wallet" class="size-3.5" />
            <span>Saldo disponível total:</span>
            <strong>{{ money(allTimeBalance.balance) }}</strong>
          </div>
        </div>
        <div class="flex gap-2 flex-wrap">
          <UButton
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="soft"
            :loading="refreshing"
            @click="loadDashboardData()"
          >
            Atualizar
          </UButton>
          <UButton
            :icon="profile?.withdrawalBlocked ? 'i-lucide-unlock' : 'i-lucide-lock'"
            :color="profile?.withdrawalBlocked ? 'success' : 'warning'"
            variant="soft"
            @click="toggleBalanceBlock"
          >
            {{ profile?.withdrawalBlocked ? 'Liberar saldo' : 'Bloquear saldo' }}
          </UButton>
        </div>
      </div>

      <!-- Filters -->
      <section class="admin-section p-3 flex flex-wrap items-center gap-2">
        <div class="flex rounded-lg overflow-hidden border border-muted">
          <button
            v-for="p in presets"
            :key="p.value"
            class="px-3 py-1.5 text-xs font-semibold transition-all"
            :class="activePreset === p.value ? 'bg-primary text-white' : 'text-muted hover:text-highlighted'"
            @click="activePreset = p.value"
          >
            {{ p.label }}
          </button>
        </div>
        <div class="flex items-center gap-2">
          <input
            v-if="activePreset === 'custom'"
            v-model="customDate"
            type="date"
            class="px-3 py-1.5 text-xs font-semibold bg-transparent border border-muted rounded-lg text-highlighted outline-none focus:border-primary"
          />
          <USelect
            v-model="selectedHouse"
            :items="[
              { label: 'Todas as casas', value: '__all__' },
              ...availableHouses.map(h => ({ label: h.name, value: h.slug }))
            ]"
            value-key="value"
            class="min-w-[10rem]"
            size="sm"
            icon="i-lucide-building-2"
          />
        </div>
        <p class="text-xs text-muted ml-auto">
          Espelhamento do painel do afiliado
        </p>
      </section>

      <div
        v-if="refreshing"
        class="flex flex-col items-center justify-center py-20 text-muted"
      >
        <UIcon
          name="i-lucide-loader-2"
          class="size-8 animate-spin mb-4"
          style="color: var(--color-purple)"
        />
        <p>Atualizando informações...</p>
      </div>

      <template v-else>
        <!-- Tabs -->
        <UTabs
        v-model="activeTab"
        :items="tabs"
      />

      <!-- DASHBOARD TAB -->
      <template v-if="activeTab === 'dashboard'">
        <p class="text-xs text-muted mb-1">
          📅 Período: <strong class="text-highlighted">{{ activeDateRangeLabel }}</strong>
        </p>
        <div class="grid gap-3 md:grid-cols-4">
          <UCard>
            <p class="text-xs text-muted">
              {{ activePreset === 'all' ? 'Saldo disponível' : 'Ganhos no período' }}
            </p>
            <template v-if="activePreset === 'all'">
              <p class="text-2xl font-black text-success mt-1">
                {{ money(balance?.balance || 0) }}
              </p>
              
            </template>
            <template v-else>
              <p class="text-2xl font-black text-success mt-1">
                {{ money(balance?.periodBalance || 0) }}
              </p>
              <p class="text-xs text-muted mt-1">
                Saques históricos: {{ money(balance?.approvedWithdrawals || 0) }}
              </p>
            </template>
          </UCard>
          <UCard>
            <p class="text-xs text-muted">
              CPA direto
            </p>
            <p class="text-2xl font-black text-highlighted mt-1">
              {{ money(balance?.cpa || 0) }}
            </p>
            <p class="text-xs text-muted mt-1">
              RevShare: {{ money(balance?.rev || 0) }}
            </p>
          </UCard>
          <UCard>
            <p class="text-xs text-muted">
              Rede (CPA + Rev)
            </p>
            <p class="text-2xl font-black text-info mt-1">
              {{ money(balance?.networkTotal || 0) }}
            </p>
            <p class="text-xs text-muted mt-1">
              {{ network?.totalReferrals || 0 }} indicados
            </p>
          </UCard>
          <UCard>
            <p class="text-xs text-muted">
              Fraude deduzida
              <span v-if="activePreset !== 'all'" class="text-[10px] opacity-60">(total histórico)</span>
            </p>
            <p class="text-2xl font-black text-error mt-1">
              -{{ money(balance?.totalFraudDeduction || 0) }}
            </p>
            <p class="text-xs text-muted mt-1">
              Direto: {{ money(balance?.fraudDeduction || 0) }}
            </p>
          </UCard>
        </div>


        <div class="grid gap-3 md:grid-cols-6">
          <UCard>
            <p class="text-xs text-muted">
              Clicks
            </p>
            <p class="text-xl font-black mt-1">
              {{ integer(summary?.clicks || 0) }}
            </p>
          </UCard>
          <UCard>
            <p class="text-xs text-muted">
              Cadastros
            </p>
            <p class="text-xl font-black mt-1">
              {{ integer(summary?.registrations || 0) }}
            </p>
          </UCard>
          <UCard>
            <p class="text-xs text-muted">
              FTDs
            </p>
            <p class="text-xl font-black mt-1">
              {{ integer(summary?.ftds || 0) }}
            </p>
          </UCard>
          <UCard>
            <p class="text-xs text-muted">
              QFTD (CPA qualificado)
            </p>
            <p class="text-xl font-black mt-1">
              {{ integer(summary?.cpaQualified || 0) }}
            </p>
          </UCard>
          <UCard>
            <p class="text-xs text-muted">
              Depósitos
            </p>
            <p class="text-xl font-black mt-1">
              {{ money(summary?.deposit || 0) }}
            </p>
          </UCard>
          <UCard>
            <p class="text-xs text-muted">
              Volume apostado
            </p>
            <p class="text-xl font-black mt-1">
              {{ money(summary?.volume || 0) }}
            </p>
          </UCard>
        </div>

        <section
          class="admin-section overflow-hidden"
        >
          <div class="p-4 flex items-center justify-between gap-3">
            <div>
              <h2 class="text-sm font-bold text-highlighted">
                Ganhos por Casa
              </h2>
              <p class="text-xs text-muted">
                Detalhamento diário por casa de apostas no período selecionado.
              </p>
            </div>
            <span v-if="dailyPerHouse.length" class="text-xs text-muted">{{ dailyPerHouse.length }} registros</span>
          </div>
          <div class="overflow-x-auto">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Casa</th>
                  <th>Clicks</th>
                  <th>Cadastros</th>
                  <th>FTDs</th>
                  <th>QFTD</th>
                  <th>Depósito</th>
                  <th>Volume apostado</th>
                  <th>CPA</th>
                  <th>RevShare</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="dailyPerHouse.length === 0">
                  <td colspan="11" style="text-align: center; padding: 2rem 1rem; color: var(--ui-text-muted);">
                    <div style="display: flex; flex-direction: column; align-items: center; gap: 0.5rem;">
                      <span style="font-size: 1.5rem;">📊</span>
                      <span style="font-size: 0.875rem;">Nenhum ganho encontrado neste período</span>
                    </div>
                  </td>
                </tr>
                <tr
                  v-for="row in pagedDailyPerHouse"
                  :key="`${row.date}-${row.bettingHouse}`"
                >
                  <td class="text-muted" style="white-space: nowrap">
                    {{ date(row.date) }}
                  </td>
                  <td class="font-bold text-highlighted">
                    {{ houseName(row.bettingHouse) }}
                  </td>
                  <td>{{ integer(row.clicks) }}</td>
                  <td>{{ integer(row.registrations) }}</td>
                  <td>{{ integer(row.ftds) }}</td>
                  <td>{{ integer(row.qftd) }}</td>
                  <td>{{ money(row.deposit) }}</td>
                  <td>{{ money(row.volume) }}</td>
                  <td>{{ money(row.cpaValue) }}</td>
                  <td>{{ money(row.revShare) }}</td>
                  <td class="font-bold">
                    {{ money(row.totalCommission) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div
            v-if="dailyPerHouse.length > TAB_PAGE_SIZE"
            class="p-4 flex justify-center border-t border-[var(--vex-border)]"
          >
            <UPagination
              v-model:page="dailyPerHousePage"
              :total="dailyPerHouse.length"
              :items-per-page="TAB_PAGE_SIZE"
              size="sm"
            />
          </div>
        </section>



        <div class="grid gap-3 md:grid-cols-3">
          <UCard>
            <p class="text-xs text-muted">
              Saques aprovados
            </p>
            <p class="text-xl font-black text-success mt-1">
              {{ money(balance?.withdrawalsApproved || 0) }}
            </p>
          </UCard>
          <UCard>
            <p class="text-xs text-muted">
              Saques pendentes
            </p>
            <p class="text-xl font-black text-warning mt-1">
              {{ money(balance?.withdrawalsPending || 0) }}
            </p>
          </UCard>
          <UCard>
            <p class="text-xs text-muted">
              Saldo bônus
            </p>
            <p class="text-xl font-black text-info mt-1">
              {{ money(balance?.bonusBalance || 0) }}
            </p>
          </UCard>
        </div>
      </template>

      <!-- CAMPANHAS (merged com Links Performance) -->
      <template v-if="activeTab === 'campaigns'">
        <section class="admin-section p-3 flex flex-wrap items-center gap-2">
          <div
            class="relative"
            style="flex: 1; min-width: 16rem"
          >
            <UIcon
              name="i-lucide-search"
              class="absolute size-3.5"
              style="left: 12px; top: 50%; transform: translateY(-50%); color: var(--color-text-muted)"
            />
            <input
              v-model="campaignsSearch"
              class="vex-input"
              placeholder="Buscar por casa ou campanha..."
              style="padding-left: 36px; font-size: 13px"
            >
          </div>
          <span class="text-xs text-muted">
            {{ filteredCampaigns.length }} de {{ mergedCampaigns.length }}
          </span>
        </section>
        <section class="admin-section overflow-x-auto">
          <table class="admin-table">
            <thead>
              <tr>
                <th>Casa / Campanha</th>
                <th>Taxa CPA</th>
                <th>Taxa Rev</th>
                <th>Clicks</th>
                <th>Cadastros</th>
                <th>FTDs</th>
                <th>QFTD</th>
                <th>Depósito</th>
                <th>Volume apostado</th>
                <th>Meu CPA</th>
                <th>Meu Rev</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!filteredCampaigns.length">
                <td
                  colspan="12"
                  class="text-muted"
                >
                  {{ mergedCampaigns.length ? 'Nenhuma campanha bate com a busca.' : 'Nenhuma campanha com dados no período.' }}
                </td>
              </tr>
              <tr
                v-for="c in pagedCampaigns"
                :key="`${c.bettingHouse}-${c.campaignId}`"
              >
                <td>
                  <p class="font-bold text-highlighted">
                    {{ houseName(c.bettingHouse) }}
                  </p>
                  <p class="text-xs text-muted">
                    {{ c.campaignName || c.campaignId }}
                  </p>
                </td>
                <td>{{ c.cpaRate ? money(c.cpaRate) : '—' }}</td>
                <td>{{ c.revRate ? c.revRate + '%' : '—' }}</td>
                <td>{{ integer(c.clicks) }}</td>
                <td>{{ integer(c.registrations) }}</td>
                <td>{{ integer(c.ftds) }}</td>
                <td>{{ integer(c.qftd) }}</td>
                <td>{{ money(c.deposit) }}</td>
                <td>{{ money(c.volume) }}</td>
                <td>{{ money(c.myCpa) }}</td>
                <td>{{ money(c.myRev) }}</td>
                <td class="font-bold">
                  {{ money(c.myCommission) }}
                </td>
              </tr>
            </tbody>
          </table>
        </section>
        <div
          v-if="filteredCampaigns.length > TAB_PAGE_SIZE"
          class="flex items-center justify-between flex-wrap gap-2 mt-2"
          style="font-size: 12px; color: var(--color-text-muted)"
        >
          <div>Página {{ campaignsPage }} de {{ Math.ceil(filteredCampaigns.length / TAB_PAGE_SIZE) }}</div>
          <UPagination
            v-model:page="campaignsPage"
            :total="filteredCampaigns.length"
            :items-per-page="TAB_PAGE_SIZE"
          />
        </div>
      </template>

      <!-- ORIGIN TAB -->
      <template v-if="activeTab === 'origin'">
        <div
          v-if="referralOriginLoading"
          class="flex items-center justify-center py-16 text-muted"
        >
          <UIcon
            name="i-lucide-loader-2"
            class="size-6 animate-spin mr-2"
          />
          Carregando origem...
        </div>
        <template v-else-if="referralOrigin">
          <div class="grid gap-3 md:grid-cols-4 mb-4">
            <UCard>
              <p class="text-xs text-muted">
                Origem no painel
              </p>
              <UBadge
                :color="referralOrigin.isDirect ? 'primary' : 'warning'"
                variant="soft"
                class="mt-2"
              >
                {{ referralOrigin.originLabel }}
              </UBadge>
            </UCard>
            <UCard>
              <p class="text-xs text-muted">
                Indicador direto
              </p>
              <p class="font-semibold mt-1">
                <NuxtLink
                  v-if="referralOrigin.directReferrer"
                  :to="`/affiliates/${referralOrigin.directReferrer.id}?tab=origin`"
                  class="hover:underline"
                >
                  {{ referralOrigin.directReferrer.name }}
                </NuxtLink>
                <span v-else>—</span>
              </p>
              <p
                v-if="referralOrigin.directReferrer"
                class="text-xs text-muted"
              >
                {{ referralOrigin.directReferrer.email }}
              </p>
            </UCard>
            <UCard>
              <p class="text-xs text-muted">
                Indicados diretos
              </p>
              <p class="text-2xl font-black mt-1">
                {{ integer(referralOrigin.directReferrals) }}
              </p>
            </UCard>
            <UCard>
              <p class="text-xs text-muted">
                Rede total (todos níveis)
              </p>
              <p class="text-2xl font-black mt-1">
                {{ integer(referralOrigin.totalDownline) }}
              </p>
            </UCard>
          </div>

          <UCard class="mb-4">
            <template #header>
              <div class="flex items-center justify-between gap-3 flex-wrap">
                <h2 class="font-bold">
                  Cadeia de indicação (upline)
                </h2>
                <UButton
                  v-if="referralOrigin.totalDownline > 0"
                  size="xs"
                  variant="soft"
                  icon="i-lucide-network"
                  @click="activeTab = 'network'"
                >
                  Ver rede abaixo
                </UButton>
              </div>
            </template>

            <div
              v-if="referralOrigin.isDirect"
              class="text-sm text-muted"
            >
              Este afiliado entrou <strong>direto ao painel</strong>, sem link de indicação.
            </div>
            <div
              v-else
              class="space-y-0"
            >
              <div
                v-for="(member, index) in referralOrigin.upline"
                :key="member.id"
                class="flex gap-3"
              >
                <div class="flex flex-col items-center shrink-0" style="width: 20px">
                  <div
                    class="rounded-full shrink-0"
                    style="width: 10px; height: 10px; background: var(--color-purple); margin-top: 6px"
                  />
                  <div
                    v-if="index < referralOrigin.upline.length"
                    style="width: 2px; flex: 1; min-height: 24px; background: var(--color-border)"
                  />
                </div>
                <div
                  class="pb-4"
                  :style="{ paddingLeft: `${member.depthFromRoot * 12}px` }"
                >
                  <div class="flex items-center gap-2 flex-wrap">
                    <UBadge
                      color="neutral"
                      variant="outline"
                      size="sm"
                    >
                      {{ index === 0 ? 'Raiz da cadeia' : index === referralOrigin.upline.length - 1 ? 'Indicador direto' : 'Intermediário' }}
                    </UBadge>
                    <NuxtLink
                      :to="`/affiliates/${member.id}?tab=origin`"
                      class="font-semibold hover:underline"
                    >
                      {{ member.name }}
                    </NuxtLink>
                  </div>
                  <p class="text-xs text-muted mt-0.5">
                    {{ member.email }}
                  </p>
                </div>
              </div>

              <div class="flex gap-3">
                <div class="flex flex-col items-center shrink-0" style="width: 20px">
                  <div
                    class="rounded-full shrink-0"
                    style="width: 12px; height: 12px; background: var(--color-gold); margin-top: 6px; box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-gold) 25%, transparent)"
                  />
                </div>
                <div class="pb-2">
                  <div class="flex items-center gap-2 flex-wrap">
                    <UBadge
                      color="primary"
                      variant="soft"
                      size="sm"
                    >
                      Atual · {{ referralOrigin.originLabel }}
                    </UBadge>
                    <span class="font-bold">{{ referralOrigin.name }}</span>
                  </div>
                  <p class="text-xs text-muted mt-0.5">
                    {{ referralOrigin.email }}
                  </p>
                </div>
              </div>
            </div>
          </UCard>
        </template>
        <UCard v-else>
          <p class="text-muted text-sm">
            Não foi possível carregar a origem deste afiliado.
          </p>
        </UCard>
      </template>

      <!-- NETWORK TAB -->
      <template v-if="activeTab === 'network'">
        <div class="grid gap-3 md:grid-cols-3">
          <UCard>
            <p class="text-xs text-muted">
              Total de indicados
            </p>
            <p class="text-2xl font-black mt-1">
              {{ integer(network?.totalReferrals || 0) }}
            </p>
          </UCard>
          <UCard>
            <p class="text-xs text-muted">
              Ganhos da rede
            </p>
            <p class="text-2xl font-black text-success mt-1">
              {{ money(network?.networkEarnings || 0) }}
            </p>
          </UCard>
          <UCard>
            <p class="text-xs text-muted">
              Perda por fraude na rede
            </p>
            <p class="text-2xl font-black text-error mt-1">
              -{{ money(network?.networkFraudLoss || 0) }}
            </p>
          </UCard>
        </div>
        <section class="admin-section p-3 flex flex-wrap items-center gap-2 mt-4">
          <div
            class="relative"
            style="flex: 1; min-width: 16rem"
          >
            <UIcon
              name="i-lucide-search"
              class="absolute size-3.5"
              style="left: 12px; top: 50%; transform: translateY(-50%); color: var(--color-text-muted)"
            />
            <input
              v-model="networkSearch"
              class="vex-input"
              placeholder="Buscar por nome ou e-mail..."
              style="padding-left: 36px; font-size: 13px"
            >
          </div>
          <USelect
            v-model="networkLevelFilter"
            :items="networkLevelOptions"
            value-key="value"
            class="min-w-[10rem]"
            size="sm"
            icon="i-lucide-layers"
          />
          <USelect
            v-model="networkStatusFilter"
            :items="[
              { label: 'Todos os status', value: '__all__' },
              { label: 'Aprovados', value: 'APPROVED' },
              { label: 'Pendentes', value: 'PENDING' },
              { label: 'Recusados', value: 'REJECTED' },
              { label: 'Bloqueados', value: 'BLOCKED' }
            ]"
            value-key="value"
            class="min-w-[10rem]"
            size="sm"
            icon="i-lucide-circle-check-big"
          />
          <span class="text-xs text-muted">
            {{ filteredNetwork.length }} de {{ network?.network?.length || 0 }}
          </span>
        </section>
        <section class="admin-section overflow-hidden mt-3">
          <table class="admin-table">
            <thead>
              <tr>
                <th>Afiliado</th>
                <th>Nível</th>
                <th>Status</th>
                <th>Ganho no espelho</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!filteredNetwork.length">
                <td
                  colspan="4"
                  class="text-muted"
                >
                  {{ (network?.network?.length || 0) ? 'Nenhum integrante bate com a busca/filtro.' : 'Rede vazia.' }}
                </td>
              </tr>
              <tr
                v-for="member in pagedNetwork"
                :key="member.userId"
              >
                <td>
                  <p class="font-semibold">
                    {{ member.name }}
                  </p>
                  <p class="text-xs text-muted">
                    {{ member.email }}
                  </p>
                </td>
                <td>
                  <UBadge
                    color="neutral"
                    variant="outline"
                  >
                    Nível {{ member.level }}
                  </UBadge>
                </td>
                <td>
                  <UBadge
                    :color="member.status === 'APPROVED' ? 'success' : member.status === 'BLOCKED' ? 'error' : 'warning'"
                    variant="soft"
                  >
                    {{ member.status }}
                  </UBadge>
                </td>
                <td class="font-bold text-success">
                  {{ money(member.myEarnings) }}
                </td>
              </tr>
            </tbody>
          </table>
        </section>
        <div
          v-if="filteredNetwork.length > TAB_PAGE_SIZE"
          class="flex items-center justify-between flex-wrap gap-2 mt-2"
          style="font-size: 12px; color: var(--color-text-muted)"
        >
          <div>Página {{ networkPage }} de {{ Math.ceil(filteredNetwork.length / TAB_PAGE_SIZE) }}</div>
          <UPagination
            v-model:page="networkPage"
            :total="filteredNetwork.length"
            :items-per-page="TAB_PAGE_SIZE"
          />
        </div>
      </template>

      <!-- WITHDRAWALS TAB -->
      <template v-if="activeTab === 'withdrawals'">
        <section class="admin-section p-3 flex flex-wrap items-center gap-2">
          <div
            class="relative"
            style="flex: 1; min-width: 16rem"
          >
            <UIcon
              name="i-lucide-search"
              class="absolute size-3.5"
              style="left: 12px; top: 50%; transform: translateY(-50%); color: var(--color-text-muted)"
            />
            <input
              v-model="withdrawalsSearch"
              class="vex-input"
              placeholder="Buscar por casa, status ou observação..."
              style="padding-left: 36px; font-size: 13px"
            >
          </div>
          <USelect
            v-model="withdrawalsStatusFilter"
            :items="[
              { label: 'Todos os status', value: '__all__' },
              { label: 'Pendentes', value: 'PENDING' },
              { label: 'Aprovados', value: 'APPROVED' },
              { label: 'Recusados', value: 'REJECTED' },
              { label: 'Processando', value: 'PROCESSING' },
              { label: 'Concluídos', value: 'COMPLETED' },
              { label: 'Falharam', value: 'FAILED' }
            ]"
            value-key="value"
            class="min-w-[10rem]"
            size="sm"
            icon="i-lucide-circle-check-big"
          />
          <span class="text-xs text-muted">
            {{ filteredWithdrawals.length }} de {{ withdrawals.length }}
          </span>
        </section>
        <section class="admin-section overflow-hidden mt-3">
          <table class="admin-table">
            <thead>
              <tr>
                <th>Data</th>
                <!--<th>Casa</th>-->
                <th>Valor integral</th>
                <th>Líquido</th>
                <th>Status</th>
                <th>Observações</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!filteredWithdrawals.length">
                <td
                  colspan="6"
                  class="text-muted"
                >
                  {{ withdrawals.length ? 'Nenhum saque bate com a busca/filtro.' : 'Sem saques recentes.' }}
                </td>
              </tr>
              <tr
                v-for="item in pagedWithdrawals"
                :key="item.id"
              >
                <td>{{ date(item.createdAt) }}</td>
                <td>{{ houseName(item.bettingHouse) }}</td>
                <td>{{ money(item.originalAmount) }}</td>
                <td class="font-bold">
                  {{ money(item.amount) }}
                </td>
                <td>
                  <div class="flex flex-wrap items-center gap-1">
                    <UBadge
                      :color="item.status === 'COMPLETED' || item.status === 'APPROVED' ? 'success' : item.status === 'REJECTED' || item.status === 'FAILED' ? 'error' : 'warning'"
                      variant="soft"
                    >
                      {{ item.status }}
                    </UBadge>
                    <UBadge
                      v-if="item.isExternal"
                      color="neutral"
                      variant="soft"
                      icon="i-lucide-plug"
                    >
                      Externo (API)
                    </UBadge>
                  </div>
                </td>
                <td class="whitespace-normal min-w-48">
                  <p
                    v-if="item.isExternal"
                    class="text-xs text-muted"
                  >
                    <strong>Aprovação externa:</strong>
                    {{ item.externalApprovedByName || 'Parceiro da API' }}
                    <template v-if="item.externalApprovedByEmail"> ({{ item.externalApprovedByEmail }})</template>
                  </p>
                  <p
                    v-if="item.requestNote"
                    class="text-xs"
                  >
                    <strong>Afiliado:</strong> {{ item.requestNote }}
                  </p>
                  <p
                    v-if="item.adminNote"
                    class="text-xs text-muted"
                  >
                    <strong>Admin:</strong> {{ item.adminNote }}
                  </p>
                  <span
                    v-if="!item.isExternal && !item.requestNote && !item.adminNote"
                    class="text-muted"
                  >—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </section>
        <div
          v-if="filteredWithdrawals.length > TAB_PAGE_SIZE"
          class="flex items-center justify-between flex-wrap gap-2 mt-2"
          style="font-size: 12px; color: var(--color-text-muted)"
        >
          <div>Página {{ withdrawalsPage }} de {{ Math.ceil(filteredWithdrawals.length / TAB_PAGE_SIZE) }}</div>
          <UPagination
            v-model:page="withdrawalsPage"
            :total="filteredWithdrawals.length"
            :items-per-page="TAB_PAGE_SIZE"
          />
        </div>
      </template>

      <!-- FRAUDES TAB -->
      <template v-if="activeTab === 'frauds'">
        <!-- Resumo de deduções -->
        <section class="grid gap-3 mb-4 md:grid-cols-3">
          <div
            class="admin-section"
            style="background: var(--color-error-soft, #fee2e2)"
          >
            <p class="text-xs text-muted">
              Dedução direta
            </p>
            <p class="text-lg font-bold" style="color: #dc2626">
              {{ money(fraudTotals.direct) }}
            </p>
            <p class="text-[11px] opacity-70">
              {{ fraudDirect.length }} entrada{{ fraudDirect.length !== 1 ? 's' : '' }}
            </p>
          </div>
          <div
            class="admin-section"
            style="background: var(--color-warning-soft, #fef3c7)"
          >
            <p class="text-xs text-muted">
              Dedução de rede
            </p>
            <p class="text-lg font-bold" style="color: #d97706">
              {{ money(fraudTotals.network) }}
            </p>
            <p class="text-[11px] opacity-70">
              {{ fraudNetwork.length }} entrada{{ fraudNetwork.length !== 1 ? 's' : '' }}
            </p>
          </div>
          <div class="admin-section">
            <p class="text-xs text-muted">
              Total deduzido
            </p>
            <p class="text-lg font-bold">
              {{ money(fraudTotals.total) }}
            </p>
            <p class="text-[11px] opacity-70">
              direta + rede
            </p>
          </div>
        </section>

        <!-- Filtro por casa -->
        <section class="flex flex-wrap items-center gap-3 mb-3">
          <USelect
            v-model="fraudsHouseFilter"
            :items="[
              { label: 'Todas as casas', value: '__all__' },
              ...Array.from(new Set([
                ...fraudDirect.map(f => f.bettingHouse),
                ...fraudNetwork.map(f => f.bettingHouse),
                ...fraudLogs.map(l => l.bettingHouse)
              ])).map(slug => ({ label: houseName(slug), value: slug }))
            ]"
            value-key="value"
            class="min-w-[12rem]"
            size="sm"
            icon="i-lucide-building-2"
          />
        </section>

        <!-- Fraudes diretas -->
        <section
          v-if="fraudDirect.length"
          class="admin-section mb-4"
        >
          <h3 class="text-sm font-semibold mb-2 flex items-center gap-2">
            <UIcon name="i-lucide-shield-alert" class="size-4" style="color: #dc2626" />
            Fraudes diretas (deste afiliado)
          </h3>
          <table class="admin-table">
            <thead>
              <tr>
                <th>Casa</th>
                <th class="text-right">Qtd. fraudes</th>
                <th class="text-right">Dedução</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(f, i) in fraudDirect"
                :key="`d-${i}`"
              >
                <td>{{ houseName(f.bettingHouse) }}</td>
                <td class="text-right">{{ integer(f.fraudCount) }}</td>
                <td class="text-right" style="color: #dc2626; font-weight: 600">
                  -{{ money(f.deduction) }}
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <!-- Fraudes da rede -->
        <section
          v-if="fraudNetwork.length"
          class="admin-section mb-4"
        >
          <h3 class="text-sm font-semibold mb-2 flex items-center gap-2">
            <UIcon name="i-lucide-network" class="size-4" style="color: #d97706" />
            Fraudes da rede (sub-afiliados)
          </h3>
          <table class="admin-table">
            <thead>
              <tr>
                <th>Membro</th>
                <th>Casa</th>
                <th class="text-right">Qtd.</th>
                <th class="text-right">Dedução (spread)</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(f, i) in fraudNetwork"
                :key="`n-${i}`"
              >
                <td style="font-size: 12px">
                  <span class="font-medium">{{ f.memberName || '—' }}</span>
                  <span class="text-muted block">{{ f.memberEmail || '' }}</span>
                </td>
                <td>{{ houseName(f.bettingHouse) }}</td>
                <td class="text-right">{{ integer(f.fraudCount) }}</td>
                <td class="text-right" style="color: #d97706; font-weight: 600">
                  -{{ money(f.deduction) }}
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <!-- Vazio -->
        <section
          v-if="!fraudDirect.length && !fraudNetwork.length && !fraudLogs.length"
          class="admin-section text-center text-muted py-8"
        >
          <UIcon name="i-lucide-shield-check" class="size-8 mx-auto mb-2 opacity-50" />
          <p>Nenhuma fraude registrada para este afiliado.</p>
        </section>

        <!-- Histórico de alterações -->
        <section
          v-if="fraudLogs.length || fraudsTotal > 0"
          class="admin-section"
        >
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-sm font-semibold flex items-center gap-2">
              <UIcon name="i-lucide-history" class="size-4" />
              Histórico de alterações
            </h3>
            <span class="text-xs text-muted">
              {{ fraudsTotal }} registro{{ fraudsTotal !== 1 ? 's' : '' }}
            </span>
          </div>
          <table class="admin-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Afiliado</th>
                <th>Casa</th>
                <th>Alteração</th>
                <th>Motivo</th>
                <th>Alterado por</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!fraudLogs.length">
                <td
                  colspan="6"
                  class="text-center text-muted py-6"
                >
                  Nenhum log encontrado.
                </td>
              </tr>
              <tr
                v-for="log in fraudLogs"
                :key="log.id"
              >
                <td style="white-space: nowrap; font-size: 12px">
                  {{ date(log.createdAt) }}
                </td>
                <td style="font-size: 12px">
                  <span
                    v-if="log.userId === id"
                    class="badge"
                    style="background: #fee2e2; color: #dc2626"
                  >Direto</span>
                  <span
                    v-else
                    class="badge"
                    style="background: #fef3c7; color: #d97706"
                  >Rede</span>
                  <span class="block mt-0.5">{{ log.user.name }}</span>
                </td>
                <td>{{ houseName(log.bettingHouse) }}</td>
                <td style="white-space: nowrap">
                  <span :style="log.newCount > log.oldCount ? 'color:#dc2626' : 'color:#16a34a'">
                    {{ log.oldCount }} → {{ log.newCount }}
                    <UIcon
                      :name="log.newCount > log.oldCount ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down'"
                      class="size-3 inline"
                    />
                  </span>
                </td>
                <td style="max-width: 240px; font-size: 12px">
                  {{ log.reason || '—' }}
                </td>
                <td style="font-size: 12px">
                  <span class="font-medium">{{ log.changedBy.name }}</span>
                  <span class="text-muted block">{{ log.changedBy.email }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <!-- Paginação server-side -->
        <div
          v-if="fraudsTotal > TAB_PAGE_SIZE"
          class="flex items-center justify-between flex-wrap gap-2 mt-2"
          style="font-size: 12px; color: var(--color-text-muted)"
        >
          <div>Página {{ fraudsPage }} de {{ Math.ceil(fraudsTotal / TAB_PAGE_SIZE) }}</div>
          <UPagination
            v-model:page="fraudsPage"
            :total="fraudsTotal"
            :items-per-page="TAB_PAGE_SIZE"
          />
        </div>
      </template>

      <!-- PROFILE TAB -->
      <template v-if="activeTab === 'profile'">
        <div class="grid gap-4 lg:grid-cols-3">
          <!-- Personal data card (edit-aware) -->
          <UCard class="lg:col-span-2">
            <template #header>
              <div class="flex items-center justify-between">
                <h2 class="font-bold">
                  Dados pessoais
                </h2>
                <div class="flex gap-2">
                  <template v-if="!editingProfile">
                    <UButton
                      size="xs"
                      color="neutral"
                      variant="soft"
                      icon="i-lucide-pencil"
                      @click="openEditProfile"
                    >
                      Editar
                    </UButton>
                  </template>
                  <template v-else>
                    <UButton
                      size="xs"
                      color="neutral"
                      variant="ghost"
                      @click="cancelEditProfile"
                    >
                      Cancelar
                    </UButton>
                    <UButton
                      size="xs"
                      color="primary"
                      :loading="profileSaving"
                      icon="i-lucide-save"
                      @click="saveProfile"
                    >
                      Salvar
                    </UButton>
                  </template>
                </div>
              </div>
            </template>

            <!-- Read mode -->
            <div
              v-if="!editingProfile"
              class="grid gap-4 md:grid-cols-2"
            >
              <div>
                <p class="text-xs text-muted">
                  Nome completo
                </p>
                <p class="font-semibold">
                  {{ profile?.name || '—' }}
                </p>
              </div>
              <div>
                <p class="text-xs text-muted">
                  E-mail
                </p>
                <p class="font-semibold">
                  {{ profile?.email || '—' }}
                </p>
              </div>
              <div>
                <p class="text-xs text-muted">
                  CPF
                </p>
                <p class="font-semibold">
                  {{ profile?.cpf || '—' }}
                </p>
              </div>
              <div>
                <p class="text-xs text-muted">
                  Telefone/WhatsApp
                </p>
                <p class="font-semibold">
                  {{ profile?.whatsapp || '—' }}
                </p>
              </div>
              <div>
                <p class="text-xs text-muted">
                  PIX
                </p>
                <p class="font-semibold">
                  {{ profile?.pixKeyType || '—' }} · {{ profile?.pixKey || '—' }}
                </p>
              </div>
              <div>
                <p class="text-xs text-muted">
                  Titular
                </p>
                <p class="font-semibold">
                  {{ profile?.accountHolder || '—' }}
                </p>
              </div>
            </div>

            <!-- Edit mode -->
            <div
              v-else
              class="grid gap-4 md:grid-cols-2"
            >
              <UFormField label="Nome completo">
                <UInput
                  v-model="editForm.name"
                  placeholder="Nome completo"
                />
              </UFormField>
              <UFormField label="E-mail">
                <UInput
                  v-model="editForm.email"
                  type="email"
                  placeholder="email@exemplo.com"
                />
              </UFormField>
              <UFormField label="CPF">
                <UInput
                  v-model="editForm.cpf"
                  placeholder="000.000.000-00"
                />
              </UFormField>
              <UFormField label="Telefone/WhatsApp">
                <UInput
                  v-model="editForm.whatsapp"
                  placeholder="+55 11 99999-9999"
                />
              </UFormField>
              <UFormField label="Tipo de chave PIX">
                <USelect
                  v-model="editForm.pixKeyType"
                  :items="pixTypes"
                  value-key="value"
                  placeholder="Selecione"
                />
              </UFormField>
              <UFormField label="Chave PIX">
                <UInput
                  v-model="editForm.pixKey"
                  placeholder="Chave PIX"
                />
              </UFormField>
              <UFormField label="Titular da conta">
                <UInput
                  v-model="editForm.accountHolder"
                  placeholder="Nome do titular"
                />
              </UFormField>
              <UFormField label="Banco">
                <UInput
                  v-model="editForm.bankName"
                  placeholder="Nome do banco"
                />
              </UFormField>
              <UFormField label="Agência">
                <UInput
                  v-model="editForm.bankAgency"
                  placeholder="0001"
                />
              </UFormField>
              <UFormField label="Conta">
                <UInput
                  v-model="editForm.bankAccount"
                  placeholder="00000-0"
                />
              </UFormField>
            </div>
          </UCard>

          <div class="space-y-4">
            <!-- Status & Network (read-only) -->
            <UCard>
              <template #header>
                <h2 class="font-bold">
                  Status & Rede
                </h2>
              </template>
              <div class="space-y-3">
                <div>
                  <p class="text-xs text-muted">
                    Status
                  </p>
                  <UBadge
                    :color="profile?.status === 'APPROVED' ? 'success' : profile?.status === 'BLOCKED' ? 'error' : 'warning'"
                    variant="soft"
                    class="mt-1"
                  >
                    {{ profile?.status }}
                  </UBadge>
                </div>
                <div>
                  <p class="text-xs text-muted">
                    Saldo para saque
                  </p>
                  <p class="font-semibold">
                    {{ profile?.withdrawalBlocked ? 'Bloqueado' : 'Liberado' }}
                  </p>
                </div>
                <div>
                  <p class="text-xs text-muted">
                    Indicado por
                  </p>
                  <p class="font-semibold">
                    {{ profile?.referredBy?.name || '—' }}
                  </p>
                  <p
                    v-if="profile?.referredBy"
                    class="text-xs text-muted"
                  >
                    {{ profile.referredBy.email }}
                  </p>
                </div>
                <div>
                  <p class="text-xs text-muted">
                    Onboarding
                  </p>
                  <UBadge
                    :color="profile?.profileCompleted ? 'success' : 'warning'"
                    variant="soft"
                    class="mt-1"
                  >
                    {{ profile?.profileCompleted ? 'Completo' : 'Pendente' }}
                  </UBadge>
                </div>
                <div class="flex items-center justify-between gap-3 pt-1">
                  <div>
                    <p class="text-xs text-muted">
                      Deals exclusivas
                    </p>
                    <p class="font-semibold">
                      {{ profile?.exclusiveDealsAccess ? 'Liberado' : 'Comum' }}
                    </p>
                  </div>
                  <UButton
                    size="xs"
                    variant="soft"
                    :icon="profile?.exclusiveDealsAccess ? 'i-lucide-x-circle' : 'i-lucide-unlock'"
                    :color="profile?.exclusiveDealsAccess ? 'neutral' : 'warning'"
                    @click="toggleExclusiveDeals"
                  >
                    {{ profile?.exclusiveDealsAccess ? 'Remover' : 'Marcar exclusivo' }}
                  </UButton>
                </div>
                <div class="flex items-center justify-between gap-3 pt-1">
                  <div>
                    <p class="text-xs text-muted">
                      Acesso à API / Webhooks
                    </p>
                    <p class="font-semibold">
                      {{ profile?.apiAccessEnabled ? 'Liberado' : 'Bloqueado' }}
                    </p>
                  </div>
                  <UButton
                    size="xs"
                    variant="soft"
                    :icon="profile?.apiAccessEnabled ? 'i-lucide-x-circle' : 'i-lucide-unlock'"
                    :color="profile?.apiAccessEnabled ? 'neutral' : 'primary'"
                    @click="toggleApiAccess"
                  >
                    {{ profile?.apiAccessEnabled ? 'Bloquear' : 'Liberar' }}
                  </UButton>
                </div>
              </div>
            </UCard>

            <UCard>
              <template #header>
                <div class="flex items-center gap-2">
                  <UIcon name="i-lucide-scale" class="size-4" />
                  <h2 class="font-bold">
                    Ajuste de saldo
                  </h2>
                </div>
              </template>
              <div class="space-y-3">
                <p class="text-xs text-muted">
                  Valor somado ao saldo da casa. Use <strong>negativo</strong> para abater
                  (ex.: <code>-150</code> tira R$ 150) e positivo para creditar. Substitui o
                  ajuste atual da casa (não é somado ao anterior).
                </p>

                <UFormField label="Casa">
                  <USelect
                    v-model="adjForm.bettingHouse"
                    :items="houseSelectItems"
                    placeholder="Selecione a casa"
                    class="w-full"
                  />
                </UFormField>

                <UFormField label="Valor do ajuste (R$)">
                  <UInput
                    v-model="adjForm.amount"
                    type="number"
                    step="0.01"
                    placeholder="Ex.: -150.00"
                    class="w-full"
                  />
                </UFormField>

                <UFormField label="Motivo (auditoria)">
                  <UInput
                    v-model="adjForm.reason"
                    placeholder="Motivo do ajuste"
                    maxlength="500"
                    class="w-full"
                  />
                </UFormField>

                <UButton
                  block
                  icon="i-lucide-save"
                  :loading="adjSaving"
                  :disabled="!adjForm.bettingHouse || adjForm.amount === ''"
                  @click="saveBalanceAdjustment"
                >
                  Salvar ajuste
                </UButton>

                <div v-if="balanceAdjustments.length" class="pt-1 space-y-1.5">
                  <p class="text-xs font-semibold text-muted">
                    Ajustes atuais
                  </p>
                  <div
                    v-for="a in balanceAdjustments"
                    :key="a.bettingHouse"
                    class="flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5"
                    :style="{ background: 'var(--ui-bg-muted, rgba(120,120,120,0.08))' }"
                  >
                    <div class="min-w-0">
                      <p class="text-sm font-medium truncate">
                        {{ houseName(a.bettingHouse) }}
                      </p>
                      <p v-if="a.reason" class="text-[11px] text-muted truncate">
                        {{ a.reason }}
                      </p>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                      <span
                        class="text-sm font-bold font-mono"
                        :class="a.amount < 0 ? 'text-error' : 'text-success'"
                      >
                        {{ a.amount < 0 ? '−' : '+' }}R$ {{ Math.abs(a.amount).toFixed(2) }}
                      </span>
                      <UButton
                        size="xs"
                        variant="ghost"
                        color="neutral"
                        icon="i-lucide-pencil"
                        square
                        @click="editAdjustment(a)"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </UCard>

            <UCard>
              <template #header>
                <h2 class="font-bold">
                  Acesso
                </h2>
              </template>
              <div class="space-y-3">
                <UFormField
                  label="Nova senha"
                  :error="passwordError || undefined"
                >
                  <UInput
                    v-model="passwordForm.password"
                    :type="showPassword ? 'text' : 'password'"
                    autocomplete="new-password"
                    placeholder="Nova senha"
                  >
                    <template #trailing>
                      <UButton
                        color="neutral"
                        variant="ghost"
                        size="xs"
                        :icon="showPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                        @click="showPassword = !showPassword"
                      />
                    </template>
                  </UInput>
                </UFormField>
                <UFormField label="Confirmar senha">
                  <UInput
                    v-model="passwordForm.confirmPassword"
                    :type="showPassword ? 'text' : 'password'"
                    autocomplete="new-password"
                    placeholder="Repita a nova senha"
                  />
                </UFormField>
                <UButton
                  block
                  color="primary"
                  icon="i-lucide-key-round"
                  :loading="passwordSaving"
                  :disabled="!passwordForm.password || !passwordForm.confirmPassword || !!passwordError"
                  @click="changePassword"
                >
                  Alterar senha
                </UButton>
              </div>
            </UCard>
          </div>
        </div>

        <!-- Affiliate Links management -->
        <section class="mt-4">
          <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h2 class="text-sm font-bold text-highlighted">
              Links de afiliado
            </h2>
            <UButton
              size="xs"
              color="primary"
              variant="soft"
              icon="i-lucide-plus"
              @click="openCreateLink"
            >
              Novo link
            </UButton>
          </div>

          <div
            v-if="!profile?.affiliateLinks.length"
            class="card-vex flex flex-col items-center justify-center py-10 gap-2"
            style="background: var(--color-surface-2)"
          >
            <UIcon
              name="i-lucide-link-2-off"
              class="size-8 opacity-30"
            />
            <p class="text-sm text-muted">
              Nenhum link cadastrado
            </p>
            <UButton
              size="xs"
              color="primary"
              variant="soft"
              icon="i-lucide-plus"
              @click="openCreateLink"
            >
              Criar primeiro link
            </UButton>
          </div>

          <div
            v-else
            class="grid gap-3 md:grid-cols-2 lg:grid-cols-3"
          >
            <UCard
              v-for="link in profile.affiliateLinks"
              :key="link.id"
            >
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <p class="font-bold text-highlighted truncate">
                    {{ houseName(link.bettingHouse) }}
                  </p>
                  <p class="text-xs text-muted mt-0.5 truncate">
                    Campanha: {{ link.campaignId }}
                  </p>
                  <p class="text-xs text-muted truncate">
                    Affiliate ID: {{ link.affiliateId || '—' }}
                  </p>
                  <p v-if="link.userLink" class="text-xs text-muted truncate" :title="link.userLink">
                    Link:
                    <a
                      :href="link.userLink"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="text-primary hover:underline"
                    >{{ link.userLink }}</a>
                  </p>
                </div>
                <div class="flex gap-1 shrink-0">
                  <button
                    class="btn btn-ghost btn-sm"
                    style="padding: 4px 6px"
                    title="Editar link"
                    @click="openEditLink(link)"
                  >
                    <UIcon
                      name="i-lucide-pencil"
                      class="size-3.5"
                    />
                  </button>
                  <button
                    class="btn btn-ghost btn-sm"
                    style="padding: 4px 6px; color: var(--ui-color-error-500)"
                    title="Remover link"
                    @click="openDeleteLink(link.id)"
                  >
                    <UIcon
                      name="i-lucide-trash-2"
                      class="size-3.5"
                    />
                  </button>
                </div>
              </div>
              <div class="mt-2 flex gap-2 flex-wrap">
                <UBadge
                  color="success"
                  variant="soft"
                >
                  CPA {{ link.cpa || '0' }}
                </UBadge>
                <UBadge
                  color="info"
                  variant="soft"
                >
                  Rev {{ link.revshare || '0' }}%
                </UBadge>
              </div>
              <div
                v-if="link.bettingHouse !== 'bonus'"
                class="mt-3"
              >
                <UButton
                  size="xs"
                  color="warning"
                  variant="soft"
                  icon="i-lucide-unlock"
                  label="Liberar saque hoje"
                  block
                  :loading="releasingHouse === link.bettingHouse"
                  :disabled="!!releasingHouse"
                  @click="grantWithdrawalRelease(link.bettingHouse)"
                />
              </div>
            </UCard>
          </div>
        </section>
      </template>
      </template>
    </div>
  </div>

  <!-- ── Affiliate Link Modal (create / edit) ──────────────────────── -->
  <UModal
    v-model:open="showLinkModal"
    :title="linkModalMode === 'create' ? 'Novo Link de Afiliado' : 'Editar Link'"
  >
    <template #body>
      <div class="space-y-4">
        <!-- House select (only for create) -->
        <UFormField
          v-if="linkModalMode === 'create'"
          label="Casa de apostas"
          required
        >
          <USelect
            v-model="linkForm.bettingHouse"
            :items="houseSelectItems"
            value-key="value"
            placeholder="Selecione a casa"
          />
        </UFormField>
        <div
          v-else
          class="rounded-lg border border-muted p-3 grid grid-cols-2 gap-3"
        >
          <div class="min-w-0">
            <p class="text-xs text-muted">
              Casa
            </p>
            <p class="font-bold truncate">
              {{ houseName(linkForm.bettingHouse) }}
            </p>
            <p class="text-xs text-muted mt-0.5 truncate">
              {{ linkForm.bettingHouse }}
            </p>
          </div>
          <!-- Campaign ID é a chave que casa o link com o dado bruto do sync,
               então não dá para editar depois de criado — mas precisa estar
               visível aqui, senão não há como saber a que campanha o link se
               refere. -->
          <div class="min-w-0">
            <p class="text-xs text-muted">
              Campaign ID
            </p>
            <p
              class="font-bold truncate"
              :title="linkForm.campaignId"
            >
              {{ linkForm.campaignId || '—' }}
            </p>
            <p class="text-xs text-muted mt-0.5">
              não editável
            </p>
          </div>
        </div>

        <!-- Link do usuário (URL de divulgação que o afiliado compartilha) -->
        <UFormField
          label="Link do usuário"
          hint="URL que o afiliado divulga. Link Superbet (siteid + c) ou Bateu Bet (?afp=) preenche o Campaign ID automaticamente."
        >
          <UInput
            v-model="linkForm.userLink"
            placeholder="https://go.aff.bateu.bet.br/ibqecrdp?afp=CODIGO"
            @blur="onUserLinkInput"
            @paste="$nextTick(onUserLinkInput)"
          />
        </UFormField>

        <!-- Campaign ID (only for create) -->
        <UFormField
          v-if="linkModalMode === 'create'"
          label="Campaign ID"
          required
        >
          <UInput
            v-model="linkForm.campaignId"
            placeholder="ID único da campanha na casa"
          />
        </UFormField>

        <!-- Affiliate ID -->
        <UFormField label="Affiliate ID (nome do afiliado no provedor)">
          <UInput
            v-model="linkForm.affiliateId"
            placeholder="aff_123"
          />
        </UFormField>

        <div class="grid grid-cols-2 gap-4">
          <UFormField label="CPA (R$)">
            <UInput
              v-model="linkForm.cpa"
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
            />
          </UFormField>
          <UFormField label="RevShare (%)">
            <UInput
              v-model="linkForm.revshare"
              type="number"
              step="0.01"
              min="0"
              max="100"
              placeholder="0.00"
            />
          </UFormField>
        </div>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          color="neutral"
          variant="ghost"
          @click="showLinkModal = false"
        >
          Cancelar
        </UButton>
        <UButton
          :color="linkModalMode === 'create' ? 'primary' : 'success'"
          :loading="linkModalSaving"
          @click="saveLinkModal"
        >
          {{ linkModalMode === 'create' ? 'Criar link' : 'Salvar alterações' }}
        </UButton>
      </div>
    </template>
  </UModal>

  <!-- ── Delete Link Confirmation Modal ──────────────────────────────── -->
  <UModal
    v-model:open="showDeleteLinkModal"
    title="Remover Link"
  >
    <template #body>
      <p class="text-sm">
        Tem certeza que deseja remover este link de afiliado? Esta ação não pode ser desfeita e pode impactar os relatórios de performance.
      </p>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          color="neutral"
          variant="ghost"
          @click="showDeleteLinkModal = false"
        >
          Cancelar
        </UButton>
        <UButton
          color="error"
          :loading="deletingLinkSaving"
          @click="confirmDeleteLink"
        >
          Remover
        </UButton>
      </div>
    </template>
  </UModal>
</template>
