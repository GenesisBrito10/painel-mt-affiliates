export type AffiliateExportFormat = 'csv' | 'pdf'

export interface AffiliateExportFilters {
  search?: string
  status?: string
  role?: string
  referralDepth?: string
}

const ACCEPT_BY_FORMAT: Record<AffiliateExportFormat, string> = {
  csv: 'text/csv',
  pdf: 'application/pdf'
}

function filenameFromDisposition(disposition: string | null): string | null {
  if (!disposition) return null
  // filename*=UTF-8''afiliados-2026-06-26.csv  OR  filename="afiliados-2026-06-26.csv"
  const utf8Match = disposition.match(/filename\*=(?:UTF-8'')?([^;]+)/i)
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim().replace(/^["']|["']$/g, ''))
    } catch {
      // fall through to quoted match
    }
  }
  const quotedMatch = disposition.match(/filename="?([^";]+)"?/i)
  if (quotedMatch?.[1]) return quotedMatch[1].trim()
  return null
}

export function useAffiliateExport() {
  const apiBase = useApiBase()
  const { authHeaders } = useAuth()

  async function exportAffiliates(
    filters: AffiliateExportFilters,
    format: AffiliateExportFormat
  ): Promise<void> {
    let disposition: string | null = null

    const res = await $fetch<Blob>(`${apiBase}/v1/admin/affiliates/export`, {
      headers: {
        ...authHeaders(),
        Accept: ACCEPT_BY_FORMAT[format]
      },
      responseType: 'blob',
      query: {
        format,
        search: filters.search || undefined,
        status: filters.status,
        role: filters.role,
        referralDepth: filters.referralDepth
      },
      onResponse({ response }) {
        disposition = response.headers.get('content-disposition')
      }
    })

    const today = new Date().toISOString().slice(0, 10)
    const fallback = `afiliados-${today}.${format}`
    const filename = filenameFromDisposition(disposition) || fallback

    const url = window.URL.createObjectURL(res)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', filename)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
  }

  return { exportAffiliates }
}
