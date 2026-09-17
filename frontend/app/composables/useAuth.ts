interface User {
  id: string
  name: string
  email: string
  avatarUrl: string | null
  role: 'affiliate' | 'admin' | 'support'
  status: 'PENDING' | 'APPROVED' | 'BLOCKED' | 'REJECTED'
  active: boolean
  profileCompleted: boolean
  cpf: string | null           // masked: ***.***.XXX-XX
  birthDate: string | null     // ISO date string
  whatsapp: string | null
  pixKeyType: string
  pixKey: string
  accountHolder: string
  referralCode: string | null
  requiresSuperbetAgreementRequest: boolean
  hasReferrals: boolean
  apiAccessEnabled: boolean
}

interface LoginApiResponse {
  accessToken: string
  userId: string
  email: string
  role: string
}

interface MeApiResponse {
  id: string
  name: string
  email: string
  avatarUrl: string | null
  role: 'AFFILIATE' | 'ADMIN' | 'SUPPORT' | 'SUPERADMIN'
  status: string
  profileCompleted: boolean
  cpf: string | null
  birthDate: string | null
  whatsapp: string | null
  pixKeyType: string
  pixKey: string
  accountHolder: string
  referralCode: string | null
  requiresSuperbetAgreementRequest: boolean
  hasReferrals: boolean
  apiAccessEnabled: boolean
}

interface RegisterPayload {
  name: string
  email: string
  password: string
  referralCode?: string
}

interface EmailAvailabilityResponse {
  available: boolean
}

// Shared across all useAuth() callers in the same tab. Refresh tokens rotate on
// every call, so concurrent refreshes with the same cookie can revoke the session.
let refreshPromise: Promise<boolean> | null = null
const AUTH_FETCH_TIMEOUT_MS = 10000
const AUTH_REFRESH_TIMEOUT_MS = 3000

/**
 * Auth composable — VeXXa API v1.
 *
 * Phase 2: Access token in memory (useState) only.
 * Refresh token is httpOnly cookie (set by backend, never accessible from JS).
 * On 401: auto-refresh via POST /api/v1/auth/refresh (cookie sent automatically).
 */
export function useAuth() {
  const apiBase = useApiBase()

  const user = useState<User | null>('auth-user', () => null)

  // Access token lives in memory only — NOT persisted in localStorage.
  // On page reload or new tab: auto-refresh via httpOnly cookie.
  const token = useState<string | null>('auth-token', () => {
    // Migration: if old token exists in localStorage, use it one last time
    // then clear it (will be replaced by refresh token flow)
    if (import.meta.client) {
      try {
        const legacy = localStorage.getItem('vexxa_token')
        if (legacy) {
          localStorage.removeItem('vexxa_token')
          return legacy
        }
      } catch {
        // Safari private/restricted storage can throw during app bootstrap.
      }
    }
    return null
  })

  const isAuthenticated = computed(() => !!token.value && !!user.value)

  function authHeaders(): Record<string, string> {
    if (!token.value) return {}
    return { Authorization: `Bearer ${token.value}` }
  }

  // ─── Login ──────────────────────────────────────────────────────────────

  async function login(email: string, password: string): Promise<void> {
    const res = await $fetch<LoginApiResponse>(`${apiBase}/v1/auth/login`, {
      method: 'POST',
      credentials: 'include',
      timeout: AUTH_FETCH_TIMEOUT_MS,
      body: { email, password },
    })
    token.value = res.accessToken
    await fetchMe()
  }

  // ─── Register ───────────────────────────────────────────────────────────

  async function register(payload: RegisterPayload): Promise<void> {
    const body: Record<string, string> = {
      name: payload.name,
      email: payload.email,
      password: payload.password,
    }
    if (payload.referralCode) {
      body.referralCode = payload.referralCode
    }

    const res = await $fetch<LoginApiResponse>(`${apiBase}/v1/auth/register`, {
      method: 'POST',
      credentials: 'include',
      timeout: AUTH_FETCH_TIMEOUT_MS,
      body,
    })
    token.value = res.accessToken
    await fetchMe()
  }

  async function checkEmailAvailability(email: string): Promise<boolean> {
    const res = await $fetch<EmailAvailabilityResponse>(`${apiBase}/v1/auth/email-availability`, {
      query: { email },
      timeout: AUTH_FETCH_TIMEOUT_MS,
    })

    return res.available
  }

  // ─── Logout ─────────────────────────────────────────────────────────────

  async function logout(): Promise<void> {
    // Call backend to revoke refresh token family (cookie is sent automatically)
    try {
      await $fetch(`${apiBase}/v1/auth/logout`, {
        method: 'POST',
        credentials: 'include',
        timeout: AUTH_FETCH_TIMEOUT_MS,
      })
    } catch {
      // Best-effort: even if backend is down, clear local state
    }
    token.value = null
    user.value = null
    // Clear house filter cache so next user gets their own approved houses
    useHouseFilter().reset()
    navigateTo('/auth/login')
  }

  // ─── Refresh ────────────────────────────────────────────────────────────

  async function refreshAccessToken(): Promise<boolean> {
    try {
      const res = await $fetch<LoginApiResponse>(`${apiBase}/v1/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        timeout: AUTH_REFRESH_TIMEOUT_MS,
      })
      token.value = res.accessToken
      return true
    } catch {
      token.value = null
      user.value = null
      return false
    }
  }

  /**
   * Attempt to refresh the access token (deduped — only one inflight at a time).
   * Returns true if refresh succeeded, false if user needs to re-login.
   */
  async function tryRefresh(): Promise<boolean> {
    if (refreshPromise) return refreshPromise
    refreshPromise = refreshAccessToken().finally(() => { refreshPromise = null })
    return refreshPromise
  }

  // ─── Update Name ────────────────────────────────────────────────────────

  async function updateName(name: string): Promise<void> {
    if (!token.value) return
    await $fetch(`${apiBase}/v1/users/me`, {
      method: 'PATCH',
      headers: authHeaders(),
      timeout: AUTH_FETCH_TIMEOUT_MS,
      body: { name },
    })
    if (user.value) user.value = { ...user.value, name }
  }

  // ─── Fetch Me (with auto-refresh on 401) ────────────────────────────────

  async function fetchMe(): Promise<User | null> {
    if (!token.value) {
      // No access token — try a refresh (covers page reload / new tab)
      const refreshed = await tryRefresh()
      if (!refreshed) return null
    }

    try {
      const res = await $fetch<MeApiResponse>(`${apiBase}/v1/users/me`, {
        headers: authHeaders(),
        timeout: AUTH_FETCH_TIMEOUT_MS,
      })
      user.value = {
        id: res.id,
        name: res.name,
        email: res.email,
        avatarUrl: res.avatarUrl ?? null,
        role: res.role === 'ADMIN' || res.role === 'SUPERADMIN' ? 'admin' : res.role === 'SUPPORT' ? 'support' : 'affiliate',
        status: (res.status as User['status']) ?? 'PENDING',
        active: res.status === 'APPROVED',
        profileCompleted: res.profileCompleted ?? false,
        cpf: res.cpf ?? null,
        birthDate: res.birthDate ?? null,
        whatsapp: res.whatsapp ?? null,
        pixKeyType: res.pixKeyType ?? '',
        pixKey: res.pixKey ?? '',
        accountHolder: res.accountHolder ?? '',
        referralCode: res.referralCode ?? null,
        requiresSuperbetAgreementRequest: res.requiresSuperbetAgreementRequest ?? false,
        hasReferrals: res.hasReferrals ?? false,
        apiAccessEnabled: res.apiAccessEnabled ?? false,
      }
      return user.value
    } catch (err: unknown) {
      // If 401: try refresh once, then retry fetchMe
      const status = (err as { statusCode?: number })?.statusCode
      if (status === 401) {
        const refreshed = await tryRefresh()
        if (refreshed) {
          // Retry with new token (non-recursive: if this also 401s, we give up)
          try {
            const res = await $fetch<MeApiResponse>(`${apiBase}/v1/users/me`, {
              headers: authHeaders(),
              timeout: AUTH_FETCH_TIMEOUT_MS,
            })
            user.value = {
              id: res.id,
              name: res.name,
              email: res.email,
              avatarUrl: res.avatarUrl ?? null,
              role: res.role === 'ADMIN' || res.role === 'SUPERADMIN' ? 'admin' : res.role === 'SUPPORT' ? 'support' : 'affiliate',
              status: (res.status as User['status']) ?? 'PENDING',
              active: res.status === 'APPROVED',
              profileCompleted: res.profileCompleted ?? false,
              cpf: res.cpf ?? null,
              birthDate: res.birthDate ?? null,
              whatsapp: res.whatsapp ?? null,
              pixKeyType: res.pixKeyType ?? '',
              pixKey: res.pixKey ?? '',
              accountHolder: res.accountHolder ?? '',
              referralCode: res.referralCode ?? null,
              requiresSuperbetAgreementRequest: res.requiresSuperbetAgreementRequest ?? false,
              hasReferrals: res.hasReferrals ?? false,
              apiAccessEnabled: res.apiAccessEnabled ?? false,
            }
            return user.value
          } catch {
            // Second attempt failed — session is truly expired
          }
        }
      }
      token.value = null
      user.value = null
      return null
    }
  }

  const isPending = computed(() =>
    !!user.value && user.value.status === 'PENDING',
  )

  // Computed: affiliates without completed onboarding must fill KYC before accessing the app
  const needsOnboarding = computed(() =>
    !!user.value && user.value.role !== 'admin' && user.value.role !== 'support' && !user.value.profileCompleted,
  )

  const needsEmailUpdate = computed(() => {
    const domain = user.value?.email.split('@')[1]?.toLowerCase()
    return domain === 'mtafiliates.com.br'
  })

  const needsSuperbetAgreementRequest = computed(() =>
    !!user.value && user.value.role !== 'admin' && user.value.role !== 'support' && user.value.requiresSuperbetAgreementRequest,
  )

  return { user, token, isAuthenticated, isPending, needsOnboarding, needsEmailUpdate, needsSuperbetAgreementRequest, authHeaders, login, register, checkEmailAvailability, logout, fetchMe, updateName, tryRefresh }
}
