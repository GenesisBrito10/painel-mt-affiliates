// usePublicBettingHouses — casas de apostas ativas para a vitrine da tela de
// login (GET /v1/public/betting-houses, sem autenticação).

export interface PublicBettingHouse {
  id: string
  name: string
  slug: string
  logoUrl: string
}

export function usePublicBettingHouses() {
  const houses = useState<PublicBettingHouse[]>('public-betting-houses', () => [])
  const loading = ref(false)

  async function refresh() {
    if (typeof window === 'undefined') return
    loading.value = true
    try {
      const apiBase = useApiBase()
      const res = await $fetch<{ data: PublicBettingHouse[] }>(
        `${apiBase}/v1/public/betting-houses`,
        { timeout: 5000 },
      )
      houses.value = res.data ?? []
    } catch {
      // silencioso: a vitrine de casas é decorativa, mantém lista vazia
    } finally {
      loading.value = false
    }
  }

  return { houses, loading, refresh }
}
