const SUPERADMIN_ONLY_PATHS = ['/sync', '/audit', '/theme', '/maintenance', '/settings']

export default defineNuxtRouteMiddleware(async (to) => {
  const { isAuthenticated, fetchMe, user, isSuperAdmin } = useAuth()
  const isAuthPage = to.path.startsWith('/auth/')

  if (isAuthPage) {
    if (isAuthenticated.value) return navigateTo('/')
    return
  }

  if (!isAuthenticated.value) {
    await fetchMe()
  }

  if (!isAuthenticated.value) {
    return navigateTo('/auth/login')
  }

  // Block regular ADMIN from SUPERADMIN-only routes
  const isSuperAdminOnlyPage = SUPERADMIN_ONLY_PATHS.some(p => to.path === p || to.path.startsWith(p + '/'))
  if (isSuperAdminOnlyPage && !isSuperAdmin.value) {
    return navigateTo('/')
  }
})
