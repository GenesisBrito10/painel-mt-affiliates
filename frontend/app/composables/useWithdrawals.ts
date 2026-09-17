/**
 * useWithdrawals — manages the withdrawal flow for affiliates.
 *
 * Endpoints consumed:
 *   GET  /v1/withdrawals              → list paginated
 *   POST /v1/withdrawals              → create request
 *   GET  /v1/dashboard/balance        → full balance breakdown incl. fraud
 *   GET  /v1/dashboard/fraud-details  → enriched fraud per member
 *   GET  /v1/users/me                 → PIX data pre-fill
 *   PATCH /v1/users/me               → save PIX config
 */
import type { BalanceData, FraudDetail, FraudDetailsResponse } from '~/types/dashboard'

export interface WithdrawalItem {
  id: string
  userId: string
  userName: string
  userEmail: string
  amount: number
  originalAmount: number
  withdrawalFee: number
  bettingHouse: string
  pixKeyType: string
  pixKey: string
  accountHolder: string
  status: 'PENDING' | 'APPROVED' | 'PROCESSING' | 'COMPLETED' | 'REJECTED' | 'FAILED'
  requestNote: string | null
  adminNote: string | null
  approvedAt: string | null
  approvedByName: string | null
  approvedByEmail: string | null
  createdAt: string
}

interface WithdrawalsListResponse {
  data: WithdrawalItem[]
  total: number
  page: number
  limit: number
}

export interface WithdrawalRule {
  slug: string
  name: string
  frequencyLabel: string
  allowedToday: boolean
  nextWithdrawalDate: string | null
  availableBalance: number
  minCpaToWithdraw: number
  minWithdrawalAmount: number
  cpaCount: number
  withdrawalEnabled: boolean
  financialBalance: number
  netPl: number | null
  netPlWithdrawalLimit: number | null
  netPlLimitConsumed: number
  withdrawalRestriction: 'METRICS_SYNCING' | 'NET_PL_NON_POSITIVE' | 'NET_PL_CAP' | null
  // Admin liberou 1 saque EXTRA hoje nesta casa (bypass do limite 1/dia).
  dayReleaseAvailable?: boolean
}

interface MeResponse {
  id: string
  name: string
  email: string
  pixKeyType: string
  pixKey: string
  bankName: string
  bankAgency: string
  bankAccount: string
  accountHolder: string
  withdrawalBlocked: boolean
}

export function useWithdrawals() {
  const { authHeaders } = useAuth()
  const apiBase = useApiBase()

  // ─── State ──────────────────────────────────────────────────────────────
  const items = ref<WithdrawalItem[]>([])
  const total = ref(0)
  const page = ref(1)
  const limit = ref(10)
  const loadingList = ref(false)
  const listError = ref<string | null>(null)
  // '' = todos. Demais valores correspondem ao enum de status do backend.
  const statusFilter = ref<string>('')

  const balance = ref(0)
  const originalBalance = ref(0)
  const grossBalance = ref(0)
  const feeAmount = ref(0)
  const feeRate = ref(0.06)
  // Disponível para saque (fonte única, vinda do backend): casas sacáveis + bônus.
  const bonusAvailable = ref(0)
  const withdrawableTotal = ref(0)
  const withdrawableNet = ref(0)
  const minWithdrawalAmount = ref(0)
  const loadingBalance = ref(false)

  // Fraud aggregate (from balance endpoint)
  const directFraud = ref(0)
  const networkFraud = ref(0)
  const totalFraud = ref(0)
  const fraudDetails = ref<FraudDetail[]>([])

  // Fraud detailed (from /fraud-details endpoint — includes member info)
  const directFraudDetails = ref<FraudDetail[]>([])
  const networkFraudDetails = ref<FraudDetail[]>([])
  const loadingFraudDetails = ref(false)

  // Full balance breakdown (per house + commissions)
  const cpa = ref(0)
  const rev = ref(0)
  const networkCpa = ref(0)
  const networkRev = ref(0)
  const approvedWithdrawals = ref(0)
  const withdrawalsApproved = ref(0)
  const withdrawalsPending = ref(0)

  const meData = ref<MeResponse | null>(null)
  const loadingMe = ref(false)
  const savingPix = ref(false)

  const submitting = ref(false)
  const submitError = ref<string | null>(null)

  // Per-casa cadence + per-casa available balance from /v1/withdrawals/rules
  const withdrawalRules = ref<WithdrawalRule[]>([])
  const loadingRules = ref(false)
  const selectedHouse = ref<string | null>(null)

  // ─── Derived ─────────────────────────────────────────────────────────────
  const totalPages = computed(() => Math.ceil(total.value / limit.value))
  const hasPix = computed(() => !!(meData.value?.pixKey && meData.value?.pixKeyType))

  // ─── List ─────────────────────────────────────────────────────────────────
  async function fetchList(p = 1) {
    loadingList.value = true
    listError.value = null
    page.value = p
    try {
      const res = await $fetch<WithdrawalsListResponse>(`${apiBase}/v1/withdrawals`, {
        headers: authHeaders(),
        query: {
          page: p,
          limit: limit.value,
          ...(statusFilter.value ? { status: statusFilter.value } : {}),
        },
      })
      items.value = res.data
      total.value = res.total
    } catch (err: unknown) {
      listError.value = parseApiError(err)
    } finally {
      loadingList.value = false
    }
  }

  // ─── Balance ──────────────────────────────────────────────────────────────
  async function fetchBalance() {
    loadingBalance.value = true
    try {
      const res = await $fetch<BalanceData>(`${apiBase}/v1/dashboard/balance`, {
        headers: authHeaders(),
      })
      grossBalance.value = res.grossBalance
      minWithdrawalAmount.value = res.minWithdrawalAmount ?? 50
      originalBalance.value = res.balance // this is now netBalance before fee from the backend perspective if not updated, but wait: backend actually returns balance = netBalance and netBalance = netAfterFee
      // the backend returned `balance: netBalance`, `netBalance: netAfterFee`
      feeAmount.value = res.withdrawalFee ?? 0
      feeRate.value = res.withdrawalFeeRate ?? 0.06
      bonusAvailable.value = res.bonusAvailable ?? 0
      withdrawableTotal.value = res.withdrawableTotal ?? 0
      withdrawableNet.value = res.withdrawableNet ?? 0
      balance.value = Math.max(0, res.netBalance ?? res.balance)
      // Fraud aggregates
      directFraud.value = res.fraudDeduction
      networkFraud.value = res.networkFraudDeduction
      totalFraud.value = res.totalFraudDeduction
      fraudDetails.value = res.fraudDetails ?? []
      // Commissions
      cpa.value = res.cpa
      rev.value = res.rev
      networkCpa.value = res.networkCpa
      networkRev.value = res.networkRev
      approvedWithdrawals.value = res.approvedWithdrawals
      withdrawalsApproved.value = res.withdrawalsApproved ?? 0
      withdrawalsPending.value = res.withdrawalsPending ?? 0
    } catch {
      balance.value = 0
    } finally {
      loadingBalance.value = false
    }
  }

  // ─── Fraud Details (enriched with member info) ────────────────────────────
  async function fetchFraudDetails() {
    loadingFraudDetails.value = true
    try {
      const res = await $fetch<FraudDetailsResponse>(`${apiBase}/v1/dashboard/fraud-details`, {
        headers: authHeaders(),
      })
      directFraudDetails.value = res.directFrauds ?? []
      networkFraudDetails.value = res.networkFrauds ?? []
    } catch {
      directFraudDetails.value = []
      networkFraudDetails.value = []
    } finally {
      loadingFraudDetails.value = false
    }
  }

  // ─── Me/PIX ───────────────────────────────────────────────────────────────
  async function fetchMe() {
    loadingMe.value = true
    try {
      const res = await $fetch<MeResponse>(`${apiBase}/v1/users/me`, {
        headers: authHeaders(),
      })
      meData.value = res
    } catch {
      // silent
    } finally {
      loadingMe.value = false
    }
  }

  async function savePix(payload: {
    pixKeyType: string
    pixKey: string
    accountHolder: string
    bankName?: string
    bankAgency?: string
    bankAccount?: string
  }) {
    savingPix.value = true
    try {
      const res = await $fetch<MeResponse>(`${apiBase}/v1/users/me`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: payload,
      })
      meData.value = res
      return { success: true }
    } catch (err: unknown) {
      return { success: false, error: parseApiError(err) }
    } finally {
      savingPix.value = false
    }
  }

  // ─── Receipt (HeartPay comprovante PNG base64) ────────────────────────────
  const loadingReceipt = ref(false)

  async function fetchReceipt(
    withdrawalId: string,
  ): Promise<{ format: string; base64: string; endToEndId?: string } | { error: string }> {
    loadingReceipt.value = true
    try {
      const res = await $fetch<{ format: string; base64: string; endToEndId?: string }>(
        `${apiBase}/v1/withdrawals/${withdrawalId}/receipt`,
        { headers: authHeaders() },
      )
      return res
    } catch (err: unknown) {
      return { error: parseApiError(err) }
    } finally {
      loadingReceipt.value = false
    }
  }

  // ─── Withdrawal Rules (per-casa cadence + per-casa balance) ──────────────
  async function fetchWithdrawalRules() {
    loadingRules.value = true
    try {
      const res = await $fetch<WithdrawalRule[]>(`${apiBase}/v1/withdrawals/rules`, {
        headers: authHeaders(),
      })
      // Dedupe por slug — evita card de bônus duplicado (casa real 'bonus' +
      // bônus virtual). Mantém a entrada de maior availableBalance.
      const bySlug = new Map<string, WithdrawalRule>()
      for (const r of res) {
        const cur = bySlug.get(r.slug)
        if (!cur || r.availableBalance > cur.availableBalance) bySlug.set(r.slug, r)
      }
      withdrawalRules.value = [...bySlug.values()]
    } catch {
      withdrawalRules.value = []
    } finally {
      loadingRules.value = false
    }
  }

  // ─── Create withdrawal ────────────────────────────────────────────────────
  async function requestWithdrawal(bettingHouse: string, requestNote = '') {
    submitting.value = true
    submitError.value = null
    try {
      await $fetch(`${apiBase}/v1/withdrawals`, {
        method: 'POST',
        headers: authHeaders(),
        body: { bettingHouse, requestNote: requestNote.trim() || undefined },
      })
      await Promise.all([fetchList(1), fetchBalance(), fetchWithdrawalRules()])
      return { success: true }
    } catch (err: unknown) {
      const msg = parseApiError(err)
      submitError.value = msg
      return { success: false, error: msg }
    } finally {
      submitting.value = false
    }
  }

  // ─── Init ─────────────────────────────────────────────────────────────────
  async function init() {
    await Promise.all([
      fetchList(1),
      fetchBalance(),
      fetchMe(),
      fetchFraudDetails(),
      fetchWithdrawalRules(),
    ])
  }

  return {
    // list
    items,
    total,
    page,
    limit,
    totalPages,
    loadingList,
    listError,
    statusFilter,
    fetchList,
    // balance
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
    fetchBalance,
    // fraud aggregates
    directFraud,
    networkFraud,
    totalFraud,
    fraudDetails,
    // fraud detailed (with member info)
    directFraudDetails,
    networkFraudDetails,
    loadingFraudDetails,
    fetchFraudDetails,
    // commissions
    cpa,
    rev,
    networkCpa,
    networkRev,
    approvedWithdrawals,
    withdrawalsApproved,
    withdrawalsPending,
    // pix / me
    meData,
    hasPix,
    loadingMe,
    savingPix,
    fetchMe,
    savePix,
    // receipt
    loadingReceipt,
    fetchReceipt,
    // withdraw
    submitting,
    submitError,
    requestWithdrawal,
    // withdrawal rules (per-casa)
    withdrawalRules,
    loadingRules,
    selectedHouse,
    fetchWithdrawalRules,
    // init
    init,
  }
}
