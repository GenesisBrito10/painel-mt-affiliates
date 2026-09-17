/**
 * useAffiliateNetwork — loads the per-house referral network tree with server-side pagination.
 * Accepts optional `house` slug, `search` string, and `status` filter.
 * All filtering is done server-side: GET /v1/network/tree?house=X&search=Y&status=Z&page=N&limit=N
 */
import type { NetworkTreeResponse } from '~/types/affiliates'

export function useAffiliateNetwork(
  houseSlug: Ref<string | null>,
  search: Ref<string> = ref(''),
  statusFilter: Ref<string> = ref('all'),
) {
  const { authHeaders } = useAuth()
  const apiBase = useApiBase()

  const treeData = ref<NetworkTreeResponse | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  // ─── Pagination state ─────────────────────────────────────
  const currentPage = ref(1)
  const pageSize = 20
  const total = computed(() => treeData.value?.total ?? 0)
  const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)))

  const networkSummary = computed(() => {
    if (!treeData.value) return { total: 0, pending: 0, approved: 0, rejected: 0 }
    if (treeData.value.statusSummary) return treeData.value.statusSummary
    const network = treeData.value.network
    return {
      total: treeData.value.totalReferrals ?? treeData.value.total ?? network.length,
      pending: network.filter((n) => n.status?.toLowerCase() === 'pending').length,
      approved: network.filter((n) => n.status?.toLowerCase() === 'approved').length,
      rejected: network.filter((n) => n.status?.toLowerCase() === 'rejected').length,
    }
  })

  async function fetchTree(house: string | null, page = 1) {
    loading.value = true
    error.value = null
    try {
      // maxLevel=1: a aba "Árvore da rede" mostra só convidados diretos (nível 1),
      // que é o único nível que o convidante pode aprovar. Nível 2+ fica oculto.
      const query: Record<string, string | number> = { page, limit: pageSize, maxLevel: 1 }
      if (house) query.house = house

      const q = search.value.trim()
      if (q) query.search = q

      if (statusFilter.value !== 'all') {
        query.status = statusFilter.value.toUpperCase()
      }

      const res = await $fetch<NetworkTreeResponse>(
        `${apiBase}/v1/network/tree`,
        { headers: authHeaders(), query },
      )
      treeData.value = res
    } catch (err: unknown) {
      error.value = parseApiError(err)
      treeData.value = null
    } finally {
      loading.value = false
    }
  }

  // Reset to page 1 and refetch when any filter changes
  watch(
    [houseSlug, search, statusFilter],
    () => {
      currentPage.value = 1
      fetchTree(houseSlug.value, 1)
    },
    { immediate: true },
  )

  // Refetch when page changes
  watch(currentPage, (page) => {
    fetchTree(houseSlug.value, page)
  })

  function goToPage(page: number) {
    currentPage.value = Math.max(1, Math.min(page, totalPages.value))
  }

  return {
    treeData,
    loading,
    error,
    networkSummary,
    currentPage,
    pageSize,
    total,
    totalPages,
    goToPage,
    refresh: () => fetchTree(houseSlug.value, currentPage.value),
  }
}
