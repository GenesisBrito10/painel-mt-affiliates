export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const configuredBackendUrl = (config.internalApiUrl as string) || 'http://localhost:3011'
  const backendUrl = resolveBackendUrl(configuredBackendUrl)
  const timeoutMs = Number(process.env.NUXT_API_PROXY_TIMEOUT_MS || 15000)

  const path = event.context.params?.path ?? ''
  const query = getQuery(event)
  const qs = new URLSearchParams(query as Record<string, string>).toString()

  // Nitro strips /api/ when matching server/api/[...path].ts — add it back
  const targetUrl = `${backendUrl}/api/${path}${qs ? '?' + qs : ''}`

  const method = event.method
  const reqHeaders: Record<string, string> = {}

  const authorization = getHeader(event, 'authorization')
  if (authorization) reqHeaders['authorization'] = authorization

  const contentType = getHeader(event, 'content-type')
  if (contentType) reqHeaders['content-type'] = contentType

  // Forward cookies from browser → backend (needed for refresh token)
  const cookie = getHeader(event, 'cookie')
  if (cookie) reqHeaders['cookie'] = cookie

  const init: RequestInit = {
    method,
    headers: reqHeaders,
    signal: AbortSignal.timeout(timeoutMs),
  }

  if (['POST', 'PUT', 'PATCH'].includes(method)) {
    const isMultipartOrBinary =
      contentType?.startsWith('multipart/')
      || contentType?.startsWith('application/octet-stream')
      || (contentType !== undefined && !contentType.includes('json') && !contentType.includes('urlencoded'))

    if (isMultipartOrBinary) {
      const raw = await readRawBody(event, false)
      if (raw) init.body = raw as unknown as BodyInit
    } else {
      try {
        const body = await readBody(event)
        if (body != null) {
          init.body = JSON.stringify(body)
          reqHeaders['content-type'] = 'application/json'
        }
      } catch { /* no body */ }
    }
  }

  let res: Response
  try {
    res = await fetch(targetUrl, init)
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'TimeoutError'
    throw createError({
      statusCode: timedOut ? 504 : 502,
      statusMessage: timedOut ? 'Backend request timed out' : 'Backend request failed',
    })
  }

  const text = await res.text()

  setResponseStatus(event, res.status)
  setResponseHeader(event, 'content-type', res.headers.get('content-type') ?? 'application/json')

  // ── Forward Set-Cookie from backend → browser ──────────────────────────────
  // Critical for the refresh-token rotation flow: the backend issues a new
  // httpOnly cookie on every /auth/refresh call. Without this, the browser
  // keeps the old (already-rotated) token and the next refresh returns 401.
  const setCookieHeader = res.headers.get('set-cookie')
  if (setCookieHeader) {
    appendResponseHeader(event, 'set-cookie', setCookieHeader)
  }

  try {
    return JSON.parse(text)
  } catch {
    return text
  }
})

function resolveBackendUrl(configuredBackendUrl: string): string {
  if (
    process.env.NODE_ENV !== 'production'
    && /https:\/\/api\.(vexxa|vallexgroup)\.com|https:\/\/api\.vallexgroup\.com\.br/.test(configuredBackendUrl)
  ) {
    console.warn(`[api proxy] Ignoring production API in dev: ${configuredBackendUrl}`)
    return 'http://localhost:3011'
  }

  return configuredBackendUrl
}
