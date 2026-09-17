interface AdminUser {
  id: string
  name: string
  email: string
  role: 'admin' | 'superadmin'
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
  role: 'ADMIN' | 'AFFILIATE' | 'SUPERADMIN'
}

let refreshPromise: Promise<boolean> | null = null
const AUTH_FETCH_TIMEOUT_MS = 10000
const AUTH_REFRESH_TIMEOUT_MS = 3000

export function useAuth() {
  const apiBase = useApiBase()
  const user = useState<AdminUser | null>('admin-auth-user', () => null)
  const token = useState<string | null>('admin-auth-token', () => null)

  const isAuthenticated = computed(() => !!token.value && !!user.value)
  const isSuperAdmin = computed(() => user.value?.role === 'superadmin')

  function authHeaders(): Record<string, string> {
    return token.value ? { Authorization: `Bearer ${token.value}` } : {}
  }

  async function login(email: string, password: string): Promise<void> {
    const res = await $fetch<LoginApiResponse>(`${apiBase}/v1/auth/login`, {
      method: 'POST',
      credentials: 'include',
      timeout: AUTH_FETCH_TIMEOUT_MS,
      body: { email, password }
    })
    token.value = res.accessToken
    const me = await fetchMe()
    if (!me || (me.role !== 'admin' && me.role !== 'superadmin')) {
      token.value = null
      user.value = null
      throw new Error('Acesso restrito a administradores.')
    }
  }

  async function refreshAccessToken(): Promise<boolean> {
    try {
      const res = await $fetch<LoginApiResponse>(`${apiBase}/v1/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        timeout: AUTH_REFRESH_TIMEOUT_MS
      })
      token.value = res.accessToken
      return true
    } catch {
      token.value = null
      user.value = null
      return false
    }
  }

  async function tryRefresh(): Promise<boolean> {
    if (refreshPromise) return refreshPromise
    refreshPromise = refreshAccessToken().finally(() => {
      refreshPromise = null
    })
    return refreshPromise
  }

  async function fetchMe(): Promise<AdminUser | null> {
    if (!token.value) {
      const refreshed = await tryRefresh()
      if (!refreshed) return null
    }

    try {
      const res = await $fetch<MeApiResponse>(`${apiBase}/v1/users/me`, {
        headers: authHeaders(),
        credentials: 'include',
        timeout: AUTH_FETCH_TIMEOUT_MS
      })
      if (res.role !== 'ADMIN' && res.role !== 'SUPERADMIN') {
        token.value = null
        user.value = null
        return null
      }
      const role: 'admin' | 'superadmin' = res.role === 'SUPERADMIN' ? 'superadmin' : 'admin'
      user.value = { id: res.id, name: res.name, email: res.email, role }
      return user.value
    } catch {
      token.value = null
      user.value = null
      return null
    }
  }

  async function logout(): Promise<void> {
    try {
      await $fetch(`${apiBase}/v1/auth/logout`, {
        method: 'POST',
        credentials: 'include',
        timeout: AUTH_FETCH_TIMEOUT_MS
      })
    } catch {
      // best effort
    }
    token.value = null
    user.value = null
    await navigateTo('/auth/login')
  }

  return { user, token, isAuthenticated, isSuperAdmin, authHeaders, login, logout, fetchMe, tryRefresh }
}
