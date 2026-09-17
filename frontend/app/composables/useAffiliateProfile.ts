/**
 * useAffiliateProfile — loads the current user's profile,
 * memberships, and affiliate links per membership.
 * Used by the Affiliate (non-admin) view.
 */
import type {
  EnrichedMembership,
  AffiliateLinkResponse,
  MembershipResponse,
} from '~/types/affiliates'



export function useAffiliateProfile() {
  const { authHeaders } = useAuth()
  const apiBase = useApiBase()

  const memberships = ref<EnrichedMembership[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  const referralCode = computed(() =>
    memberships.value.find((m) => m.referralCode)?.referralCode ?? null,
  )

  const allLinks = computed(() =>
    memberships.value.flatMap((m) => m.affiliateLinks),
  )

  const agreementSummary = computed(() => {
    const mbs = memberships.value
    const totalLinks = mbs.length
    const totalCpa = mbs.reduce((sum, m) => sum + (m.commissionCpa || 0), 0)
    const avgRevshare = totalLinks
      ? Math.round(mbs.reduce((sum, m) => sum + (m.commissionRevshare || 0), 0) / totalLinks)
      : 0
    return { totalLinks, totalCpa, avgRevshare }
  })

  async function fetchProfile() {
    loading.value = true
    error.value = null
    try {
      const res = await $fetch<ApiWrapper<MembershipResponse[]>>(
        `${apiBase}/v1/memberships/mine`,
        { headers: authHeaders() },
      )
      const rawMemberships = res.data

      // Fetch affiliate links for each membership in parallel
      const enriched = await Promise.all(
        rawMemberships.map(async (m): Promise<EnrichedMembership> => {
          try {
            const linkRes = await $fetch<ApiWrapper<AffiliateLinkResponse[]>>(
              `${apiBase}/v1/memberships/${m.id}/affiliate-links`,
              { headers: authHeaders() },
            )
            return { ...m, affiliateLinks: linkRes.data }
          } catch {
            return { ...m, affiliateLinks: [] }
          }
        }),
      )

      memberships.value = enriched
    } catch (err: unknown) {
      error.value = parseApiError(err)
    } finally {
      loading.value = false
    }
  }

  onMounted(fetchProfile)

  return {
    memberships,
    loading,
    error,
    referralCode,
    allLinks,
    agreementSummary,
    refresh: fetchProfile,
  }
}

