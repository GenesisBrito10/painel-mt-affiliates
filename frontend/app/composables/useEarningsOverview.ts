import { ref } from 'vue'
import { useRuntimeConfig } from '#app'
import { useAuth } from './useAuth'
import type { EarningsOverview } from '~/types/earnings'
import { parseApiError } from '~/utils/api-errors'

export const useEarningsOverview = () => {
  const apiBase = useApiBase()
  const { authHeaders } = useAuth()

  const data = useState<EarningsOverview | null>('earnings-overview', () => null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const fetchOverview = async () => {
    loading.value = true
    error.value = null
    try {
      const res = await $fetch<EarningsOverview>(`${apiBase}/v1/earnings/overview`, {
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
    fetchOverview,
  }
}
