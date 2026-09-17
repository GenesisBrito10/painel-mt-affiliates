import type { FilterHouseOption } from '~/types/dashboard'

export function useHouseFilter() {
  const selectedSlug = useState<string>('house-filter-slug', () => '__all__')
  const houses = useState<FilterHouseOption[]>('house-filter-options', () => [])
  const loaded = useState<boolean>('house-filter-loaded', () => false)

  const { authHeaders } = useAuth()
  const apiBase = useApiBase()

  /** Fetch houses approved for the current user. No-ops if already loaded. */
  async function fetchHouses(force = false) {
    if (loaded.value && !force) return
    try {
      const res = await $fetch<{ bettingHouses: FilterHouseOption[] }>(
        `${apiBase}/v1/dashboard/filters`,
        { headers: authHeaders() },
      )
      houses.value = res.bettingHouses ?? []
      loaded.value = true
    } catch { /* silent */ }
  }

  /** Reset state — call on logout or user switch */
  function reset() {
    houses.value = []
    loaded.value = false
    selectedSlug.value = '__all__'
  }

  function select(slug: string) {
    selectedSlug.value = slug
  }

  const selectedHouse = computed(() =>
    selectedSlug.value === '__all__'
      ? null
      : houses.value.find(h => h.slug === selectedSlug.value) ?? null,
  )

  const resolvedSlug = computed(() =>
    selectedSlug.value === '__all__' ? undefined : selectedSlug.value,
  )

  const houseMap = computed(() => {
    const map = new Map<string, FilterHouseOption>()
    for (const h of houses.value) map.set(h.slug, h)
    return map
  })

  function getHouse(slug: string): FilterHouseOption | undefined {
    return houseMap.value.get(slug)
  }

  function getLogoUrl(slug: string): string {
    return houseMap.value.get(slug)?.logoUrl ?? ''
  }

  function getHouseName(slug: string): string {
    return houseMap.value.get(slug)?.name ?? slug
  }

  return {
    selectedSlug,
    houses,
    loaded,
    selectedHouse,
    resolvedSlug,
    fetchHouses,
    reset,
    select,
    getHouse,
    getLogoUrl,
    getHouseName,
  }
}
