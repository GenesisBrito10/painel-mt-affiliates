export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const backendUrl = (config.internalApiUrl as string) || 'http://localhost:3011'
  const timeoutMs = Number(process.env.NUXT_API_PROXY_TIMEOUT_MS || 15000)
  const path = event.context.params?.path ?? ''
  const query = getQuery(event)
  const qs = new URLSearchParams(query as Record<string, string>).toString()
  const targetUrl = `${backendUrl}/api/${path}${qs ? `?${qs}` : ''}`

  const headers: Record<string, string> = {}
  const authorization = getHeader(event, 'authorization')
  const contentType = getHeader(event, 'content-type')
  const cookie = getHeader(event, 'cookie')
  if (authorization) headers.authorization = authorization
  if (contentType) headers['content-type'] = contentType
  if (cookie) headers.cookie = cookie

  const init: RequestInit = {
    method: event.method,
    headers,
    signal: AbortSignal.timeout(timeoutMs)
  }
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(event.method)) {
    const body = await readBody(event).catch(() => undefined)
    if (body !== undefined) {
      init.body = JSON.stringify(body)
      headers['content-type'] = 'application/json'
    }
  }

  let response: Response
  try {
    response = await fetch(targetUrl, init)
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'TimeoutError'
    throw createError({
      statusCode: timedOut ? 504 : 502,
      statusMessage: timedOut ? 'Backend request timed out' : 'Backend request failed'
    })
  }

  const resContentType = response.headers.get('content-type') ?? 'application/json'
  setResponseStatus(event, response.status)
  setResponseHeader(event, 'content-type', resContentType)
  const setCookie = response.headers.get('set-cookie')
  if (setCookie) appendResponseHeader(event, 'set-cookie', setCookie)
  // Forward the download filename for file exports (CSV/PDF).
  const disposition = response.headers.get('content-disposition')
  if (disposition) setResponseHeader(event, 'content-disposition', disposition)

  // JSON responses are parsed and returned as objects (default API behavior).
  // Everything else (CSV, PDF, other binaries) is forwarded as raw bytes so
  // file downloads are not corrupted by text decoding.
  if (resContentType.includes('application/json')) {
    const text = await response.text()
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }

  return Buffer.from(await response.arrayBuffer())
})
