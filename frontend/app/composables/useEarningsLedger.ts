import { ref } from 'vue'
import { useRuntimeConfig } from '#app'
import { useAuth } from './useAuth'
import type { EarningsLedger } from '~/types/earnings'
import { parseApiError } from '~/utils/api-errors'

export const useEarningsLedger = () => {
  const apiBase = useApiBase()
  const { authHeaders, token } = useAuth()

  const data = useState<EarningsLedger | null>('earnings-ledger', () => null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const fetchLedger = async (page = 1, limit = 20) => {
    loading.value = true
    error.value = null
    try {
      const res = await $fetch<EarningsLedger>(`${apiBase}/v1/earnings/ledger`, {
        headers: authHeaders(),
        query: { page, limit },
      })
      data.value = res
    } catch (err) {
      error.value = parseApiError(err)
    } finally {
      loading.value = false
    }
  }

  const exportLedgerCsv = async () => {
    try {
      // Create an invisible anchor tag to download the blob
      const res = await $fetch<Blob>(`${apiBase}/v1/earnings/ledger/export`, {
        headers: {
          ...authHeaders(),
          // Ensure we tell the browser we expect a blob/binary response
          Accept: 'text/csv',
        },
        responseType: 'blob',
      })

      const url = window.URL.createObjectURL(res)
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', 'financial_ledger_export.csv')
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Failed to export ledger CSV:', err)
      error.value = parseApiError(err)
    }
  }

  return {
    data,
    loading,
    error,
    fetchLedger,
    exportLedgerCsv,
  }
}
