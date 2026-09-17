export function useApiBase(): string {
  const config = useRuntimeConfig()
  const configured = (config.public.apiUrl as string) || '/api'

  if (import.meta.client && import.meta.dev) {
    return '/api'
  }

  return configured
}
