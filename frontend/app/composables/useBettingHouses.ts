/**
 * useBettingHouses — loads active betting houses for dropdown selectors.
 * Uses GET /betting-houses/link-requests/houses (auth + returns id, name, slug).
 * Falls back to GET /betting-houses (admin-only) when admin token is available.
 */
import type { BettingHouseOption } from '~/types/affiliates'

interface HouseEntry {
  id?: string
  name: string
  slug: string
}



export function useBettingHouses() {
  const { authHeaders, user } = useAuth()
  const apiBase = useApiBase()

  const houses = ref<BettingHouseOption[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function fetchHouses() {
    loading.value = true
    error.value = null
    try {
      // Admin gets full list with IDs; affiliates use public houses endpoint
      const endpoint =
        user.value?.role === 'admin'
          ? `${apiBase}/v1/betting-houses`
          : `${apiBase}/v1/link-requests/houses`

      const res = await $fetch<ApiWrapper<HouseEntry[]>>(endpoint, {
        headers: authHeaders(),
      })

      houses.value = res.data.map((h): BettingHouseOption => ({
        id: h.id ?? h.slug,
        name: h.name,
        slug: h.slug,
      }))
    } catch (err: unknown) {
      error.value = parseApiError(err)
    } finally {
      loading.value = false
    }
  }

  onMounted(fetchHouses)

  return { houses, loading, error, refresh: fetchHouses }
}

