/**
 * useAffiliateReferrals — loads direct referrals (convidados diretos)
 * for the authenticated user via GET /v1/network/referrals?house=X.
 */
import type { ReferralEntry } from '~/types/affiliates'



export function useAffiliateReferrals(houseSlug: Ref<string | null>) {
  const { authHeaders } = useAuth()
  const apiBase = useApiBase()

  const referrals = ref<ReferralEntry[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function fetchReferrals(house: string | null) {
    loading.value = true
    error.value = null
    try {
      const query: Record<string, string> = {}
      if (house) query.house = house

      const res = await $fetch<ReferralEntry[]>(
        `${apiBase}/v1/network/referrals`,
        { headers: authHeaders(), query },
      )
      referrals.value = res
    } catch (err: unknown) {
      error.value = parseApiError(err)
      referrals.value = []
    } finally {
      loading.value = false
    }
  }

  watch(
    houseSlug,
    (house) => { fetchReferrals(house) },
    { immediate: true },
  )

  return {
    referrals,
    loading,
    error,
    refresh: () => fetchReferrals(houseSlug.value),
  }
}

