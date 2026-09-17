// https://nuxt.com/docs/api/configuration/nuxt-config
const env = ((globalThis as typeof globalThis & {
  process?: { env?: Record<string, string | undefined> }
}).process?.env ?? {})

export default defineNuxtConfig({
  ssr: false,

  modules: [
    '@nuxt/eslint',
    '@nuxt/ui'
  ],

  devtools: {
    enabled: process.env.NODE_ENV !== 'production'
  },

  css: ['~/assets/css/main.css'],

  runtimeConfig: {
    internalApiUrl: env.INTERNAL_API_URL || env.NUXT_INTERNAL_API_URL || 'http://localhost:3011',
    public: {
      apiUrl: env.NUXT_PUBLIC_API_URL || '/api',
      socketUrl: env.NUXT_PUBLIC_SOCKET_URL || ''
    }
  },

  devServer: {
    port: Number(env.PORT || 3012)
  },

  vite: {
    build: {
      target: ['es2020', 'safari15']
    }
  },

  compatibilityDate: '2025-01-15',

  app: {
    head: {
      htmlAttrs: { lang: 'pt-BR' },
      title: 'Vallex Group - Admin',
      link: [
        { key: 'icon', rel: 'icon', type: 'image/x-icon', href: '/vallex-favicon-white.ico' },
        { key: 'shortcut-icon', rel: 'shortcut icon', type: 'image/x-icon', href: '/vallex-favicon-white.ico' },
        { key: 'apple-touch-icon', rel: 'apple-touch-icon', type: 'image/png', sizes: '180x180', href: '/vallex-apple-touch-icon.png' },
        { key: 'manifest', rel: 'manifest', href: '/manifest.webmanifest' }
      ]
    }
  },

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  }
})
