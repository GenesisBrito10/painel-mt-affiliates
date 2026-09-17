export default defineNuxtRouteMiddleware(async (to) => {

  const { user, isAuthenticated, isPending, needsOnboarding, needsEmailUpdate, fetchMe } = useAuth()

  const isAuthPage = to.path.startsWith('/auth/')

  if (to.path === '/auth/pending') return

  if (isAuthPage) {
    if (isAuthenticated.value && !isPending.value) return navigateTo('/')
    return
  }

  if (!isAuthenticated.value) {
    await fetchMe()
  }

  if (!isAuthenticated.value) {
    return navigateTo('/auth/login')
  }

  if (isPending.value) {
    return navigateTo('/auth/pending')
  }

  if (user.value?.role === 'support' && to.path !== '/support' && to.path !== '/settings') {
    return navigateTo('/support')
  }

  if (needsOnboarding.value && to.path !== '/settings') {
    return navigateTo('/settings')
  }

  if (needsEmailUpdate.value && to.path !== '/settings') {
    return navigateTo('/settings')
  }

  // Gate de acordo Superbet REMOVIDO: ter acordo (Superbet ou qualquer casa) não é
  // mais obrigatório para o afiliado aprovado usar o painel.
})
