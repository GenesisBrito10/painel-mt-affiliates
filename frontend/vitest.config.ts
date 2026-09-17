import { defineConfig } from 'vitest/config'

// Lean unit-test setup for pure composables/helpers. Nuxt auto-imports
// ($fetch, useApiBase, useAuth) are stubbed per-test on globalThis.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    globals: true,
  },
})
