import type {
  DashboardSummary,
  DailyDataPoint,
  BalanceData,
  DashboardFilterOptions,
  DashboardScope,
  PinbetMetricsResponse,
} from '~/types/dashboard'

/**
 * Dashboard composable — fetches real data from the NestJS backend.
 *
 * Backend returns RAW responses (no envelope wrapper).
 *
 * Endpoints consumed:
 *   GET /v1/dashboard/balance   → BalanceData
 *   GET /v1/dashboard/summary   → DashboardSummary (AggregatedMetrics)
 *   GET /v1/dashboard/daily     → { data: DailyDataPoint[], myData: DailyDataPoint[], networkData: DailyDataPoint[] }
 *   GET /v1/dashboard/filters   → DashboardFilterOptions
 */

interface DailyResponse {
  data: DailyDataPoint[]
  myData: DailyDataPoint[]
  networkData: DailyDataPoint[]
}

export function useDashboard() {
  const { authHeaders } = useAuth()
  const apiBase = useApiBase()

  const balance = useState<BalanceData | null>('dash-balance', () => null)
  const summary = useState<DashboardSummary | null>('dash-summary', () => null)
  const previousSummary = useState<DashboardSummary | null>('dash-prev-summary', () => null)
  const dailyData = useState<DailyDataPoint[]>('dash-daily', () => [])
  const filterOptions = useState<DashboardFilterOptions | null>('dash-filters', () => null)
  const pinbetMetrics = useState<PinbetMetricsResponse>('dash-pinbet-metrics', () => ({ houses: [] }))
  const pending = ref(true)
  const error = ref('')

  // Intervalo escolhido pelo filtro "Personalizado" (persiste entre refetches).
  const customRange = useState<{ startDate: string; endDate: string } | null>(
    'dash-custom-range',
    () => null,
  )

  function getDateRange(preset: string): { startDate: string; endDate: string } {
    const today = new Date()
    const fmt = (d: Date): string => d.toISOString().slice(0, 10)

    switch (preset) {
      case 'Personalizado': {
        if (customRange.value) return { ...customRange.value }
        // Sem intervalo ainda: cai nos últimos 7 dias.
        const d = new Date()
        d.setDate(d.getDate() - 6)
        return { startDate: fmt(d), endDate: fmt(today) }
      }
      case 'Hoje':
        return { startDate: fmt(today), endDate: fmt(today) }
      case '7 dias': {
        const d = new Date()
        d.setDate(d.getDate() - 6)
        return { startDate: fmt(d), endDate: fmt(today) }
      }
      case '30 dias': {
        const d = new Date()
        d.setDate(d.getDate() - 29)
        return { startDate: fmt(d), endDate: fmt(today) }
      }
      case 'Este Mês': {
        const d = new Date(today.getFullYear(), today.getMonth(), 1)
        return { startDate: fmt(d), endDate: fmt(today) }
      }
      case 'Mês Passado': {
        const firstDay = new Date(today.getFullYear(), today.getMonth() - 1, 1)
        const lastDay = new Date(today.getFullYear(), today.getMonth(), 0)
        return { startDate: fmt(firstDay), endDate: fmt(lastDay) }
      }
      case 'Todo o tempo':
        return { startDate: '2020-01-01', endDate: fmt(today) }
      default: {
        const d = new Date(today.getFullYear(), today.getMonth(), 1)
        return { startDate: fmt(d), endDate: fmt(today) }
      }
    }
  }

  function getPreviousDateRange(
    startDate: string,
    endDate: string,
  ): { startDate: string; endDate: string } {
    const start = new Date(startDate + 'T00:00:00')
    const end = new Date(endDate + 'T00:00:00')
    const durationMs = end.getTime() - start.getTime()
    const prevEnd = new Date(start.getTime() - 86_400_000) // day before start
    const prevStart = new Date(prevEnd.getTime() - durationMs)
    const fmt = (d: Date): string => d.toISOString().slice(0, 10)
    return { startDate: fmt(prevStart), endDate: fmt(prevEnd) }
  }

  function buildQuery(
    startDate: string,
    endDate: string,
    houseSlug?: string,
    scope?: DashboardScope,
  ): Record<string, string> {
    const query: Record<string, string> = { startDate, endDate }
    if (houseSlug) query.bettingHouse = houseSlug
    if (scope && scope !== 'all') query.scope = scope
    return query
  }

  /**
   * Extracts the correct daily data slice based on scope.
   * Backend returns { data (all), myData (mine), networkData (network) }.
   */
  function extractDailyForScope(res: DailyResponse, scope: DashboardScope): DailyDataPoint[] {
    switch (scope) {
      case 'mine':
        return Array.isArray(res.myData) ? res.myData : res.data
      case 'network':
        return Array.isArray(res.networkData) ? res.networkData : []
      case 'all':
      default:
        return res.data
    }
  }

  /**
   * Full dashboard load — called on mount.
   * Fires 5 parallel requests: balance, summary, daily, previous summary, filters.
   */
  async function loadDashboard(
    preset: string,
    houseSlug?: string,
    scope: DashboardScope = 'all',
  ): Promise<void> {
    pending.value = true
    error.value = ''

    const { startDate, endDate } = getDateRange(preset)
    const prev = getPreviousDateRange(startDate, endDate)

    const query = buildQuery(startDate, endDate, houseSlug, scope)
    const prevQuery = buildQuery(prev.startDate, prev.endDate, houseSlug, scope)

    try {
      const balanceQuery: Record<string, string> = houseSlug ? { bettingHouse: houseSlug } : {}
      const [balanceRes, summaryRes, dailyRes, prevSummaryRes, filtersRes, pinbetRes] =
        await Promise.all([
          $fetch<BalanceData>(`${apiBase}/v1/dashboard/balance`, {
            headers: authHeaders(),
            query: balanceQuery,
          }),
          $fetch<DashboardSummary>(
            `${apiBase}/v1/dashboard/summary`,
            { headers: authHeaders(), query },
          ),
          $fetch<DailyResponse>(
            `${apiBase}/v1/dashboard/daily`,
            { headers: authHeaders(), query },
          ),
          $fetch<DashboardSummary>(
            `${apiBase}/v1/dashboard/summary`,
            { headers: authHeaders(), query: prevQuery },
          ),
          filterOptions.value
            ? Promise.resolve(null)
            : $fetch<DashboardFilterOptions>(
                `${apiBase}/v1/dashboard/filters`,
                { headers: authHeaders() },
              ),
          $fetch<PinbetMetricsResponse>(
            `${apiBase}/v1/dashboard/pinbet-metrics`,
            { headers: authHeaders(), query },
          ),
        ])

      balance.value = balanceRes
      summary.value = summaryRes
      dailyData.value = extractDailyForScope(dailyRes, scope)
      previousSummary.value = prevSummaryRes
      if (filtersRes) filterOptions.value = filtersRes
      pinbetMetrics.value = pinbetRes
    } catch (err: unknown) {
      error.value = parseApiError(err)
    } finally {
      pending.value = false
    }
  }

  /**
   * Scoped refetch — called when scope, preset, or house changes.
   * Only re-fetches summary + daily (balance is scope-independent).
   */
  async function refetchScoped(
    preset: string,
    houseSlug?: string,
    scope: DashboardScope = 'all',
  ): Promise<void> {
    error.value = ''

    const { startDate, endDate } = getDateRange(preset)
    const prev = getPreviousDateRange(startDate, endDate)

    const query = buildQuery(startDate, endDate, houseSlug, scope)
    const prevQuery = buildQuery(prev.startDate, prev.endDate, houseSlug, scope)

    try {
      const balanceQuery2: Record<string, string> = houseSlug ? { bettingHouse: houseSlug } : {}
      const [balanceRes, summaryRes, dailyRes, prevRes, pinbetRes] = await Promise.all([
        $fetch<BalanceData>(`${apiBase}/v1/dashboard/balance`, {
          headers: authHeaders(),
          query: balanceQuery2,
        }),
        $fetch<DashboardSummary>(
          `${apiBase}/v1/dashboard/summary`,
          { headers: authHeaders(), query },
        ),
        $fetch<DailyResponse>(
          `${apiBase}/v1/dashboard/daily`,
          { headers: authHeaders(), query },
        ),
        $fetch<DashboardSummary>(
          `${apiBase}/v1/dashboard/summary`,
          { headers: authHeaders(), query: prevQuery },
        ),
        $fetch<PinbetMetricsResponse>(
          `${apiBase}/v1/dashboard/pinbet-metrics`,
          { headers: authHeaders(), query },
        ),
      ])

      balance.value = balanceRes
      summary.value = summaryRes
      dailyData.value = extractDailyForScope(dailyRes, scope)
      previousSummary.value = prevRes
      pinbetMetrics.value = pinbetRes
    } catch (err: unknown) {
      error.value = parseApiError(err)
    }
  }

  return {
    balance,
    summary,
    previousSummary,
    dailyData,
    filterOptions,
    pinbetMetrics,
    pending,
    error,
    loadDashboard,
    refetchScoped,
    getDateRange,
    customRange,
  }
}
