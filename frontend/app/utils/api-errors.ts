export interface ApiWrapper<T> {
  data: T
  meta?: { page: number; limit: number; total: number; totalPages: number }
  timestamp?: string
}

/** RFC 7807 error translations — maps backend messages to PT-BR */
const ERROR_TRANSLATIONS: Record<string, string> = {
  'Invalid credentials': 'E-mail ou senha incorretos.',
  'Account is inactive or rejected': 'Conta desativada ou recusada. Contate o suporte.',
  'Account deactivated': 'Conta desativada. Contate o suporte.',
  'Account is pending approval': '⏳ Sua conta ainda não foi aprovada. Aguarde a aprovação do admin ou do seu convidante.',
  'Email already registered': 'Este e-mail já está cadastrado.',
  'Unauthorized': 'Sessão expirada. Faça login novamente.',
  'email must be an email': 'E-mail inválido.',
  'password should not be empty': 'A senha é obrigatória.',
  'password must be longer than or equal to 6 characters': 'A senha deve ter no mínimo 6 caracteres.',
  'password must be longer than or equal to 8 characters': 'A senha deve ter no mínimo 8 caracteres.',
  'password must contain at least 1 uppercase, 1 number, and 1 special character': 'A senha precisa ter pelo menos 1 letra maiúscula, 1 número e 1 caractere especial.',
  'name should not be empty': 'O nome é obrigatório.',
}

/** Friendly messages by HTTP status code */
const STATUS_MESSAGES: Record<number, string> = {
  400: 'Requisição inválida. Verifique os dados e tente novamente.',
  401: 'E-mail ou senha incorretos.',
  403: 'Você não tem permissão para realizar esta ação.',
  404: 'Recurso não encontrado.',
  409: 'Conflito: este dado já existe.',
  422: 'Dados inválidos. Verifique o formulário.',
  429: 'Muitas tentativas. Aguarde alguns segundos e tente novamente.',
  500: 'Erro interno do servidor. Tente novamente em instantes.',
  502: 'Serviço temporariamente indisponível. Tente novamente em breve.',
  503: 'Serviço em manutenção. Tente novamente em breve.',
}

/** Regex to detect raw fetch error strings like: [POST] "/api/...": 500 Internal Server Error */
const RAW_FETCH_ERROR_RE = /^\[(GET|POST|PUT|PATCH|DELETE)\]\s+"[^"]+"\s*:\s*(\d{3})/

/**
 * Parse RFC 7807 error response into a user-friendly PT-BR message.
 * Handles both string and string[] detail formats from ValidationPipe.
 */
export function parseApiError(err: unknown): string {
  const errObj = err as {
    data?: { detail?: string | string[]; title?: string; message?: string }
    statusCode?: number
    status?: number
    message?: string
  }

  // 1. Try structured body: detail (array or string)
  const detail = errObj?.data?.detail
  if (Array.isArray(detail)) return detail.map(d => translateMsg(d)).join('. ')
  if (typeof detail === 'string') return translateMsg(detail)

  // 2. Try structured body: title or message
  const title = errObj?.data?.title
  if (title) return translateMsg(title)

  const bodyMsg = errObj?.data?.message
  if (bodyMsg) return translateMsg(bodyMsg)

  // 3. Map by HTTP status code
  const statusCode = errObj?.statusCode ?? errObj?.status
  if (statusCode && STATUS_MESSAGES[statusCode]) return STATUS_MESSAGES[statusCode]

  // 4. Sanitize raw fetch error strings (e.g. "[POST] "/api/...": 500 Internal Server Error")
  const rawMsg = errObj?.message ?? ''
  const match = RAW_FETCH_ERROR_RE.exec(rawMsg)
  if (match) {
    const code = Number(match[2])
    return STATUS_MESSAGES[code] ?? 'Erro inesperado. Tente novamente.'
  }

  // 5. Fallback: translate whatever message we have
  if (rawMsg) return translateMsg(rawMsg)

  return 'Erro inesperado. Tente novamente.'
}

/**
 * Translates a message: exact match first, then prefix match for long domain messages.
 */
function translateMsg(msg: string): string {
  if (ERROR_TRANSLATIONS[msg]) return ERROR_TRANSLATIONS[msg]
  // Prefix match — domain exceptions can carry long detail strings
  for (const [key, value] of Object.entries(ERROR_TRANSLATIONS)) {
    if (msg.startsWith(key)) return value
  }
  return msg
}
