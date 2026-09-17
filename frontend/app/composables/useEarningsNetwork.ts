import { ref } from 'vue'
import { useRuntimeConfig } from '#app'
import { useAuth } from './useAuth'
import type { EarningsNetwork } from '~/types/earnings'
import { parseApiError } from '~/utils/api-errors'

export interface EarningsNetworkFilters {
  startDate?: string
  endDate?: string
  bettingHouse?: string
}

export const useEarningsNetwork = () => {
  const apiBase = useApiBase()
  const { authHeaders } = useAuth()

  const data = useState<EarningsNetwork | null>('earnings-network', () => null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const fetchNetwork = async (filters: EarningsNetworkFilters = {}) => {
    loading.value = true
    error.value = null
    try {
      const params = new URLSearchParams()
      if (filters.startDate) params.set('startDate', filters.startDate)
      if (filters.endDate) params.set('endDate', filters.endDate)
      if (filters.bettingHouse) params.set('bettingHouse', filters.bettingHouse)
      const qs = params.toString()
      const res = await $fetch<EarningsNetwork>(`${apiBase}/v1/earnings/network${qs ? `?${qs}` : ''}`, {
        headers: authHeaders(),
      })
      data.value = res
    } catch (err) {
      error.value = parseApiError(err)
    } finally {
      loading.value = false
    }
  }

  return {
    data,
    loading,
    error,
    fetchNetwork,
  }
}
