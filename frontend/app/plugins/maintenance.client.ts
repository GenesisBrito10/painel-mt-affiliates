export default defineNuxtPlugin(() => {
  if (typeof window === 'undefined') return
  const { startPolling } = useMaintenance()
  const stopPolling = startPolling()

  window.addEventListener('beforeunload', stopPolling)

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      window.removeEventListener('beforeunload', stopPolling)
      stopPolling()
    })
  }
})
