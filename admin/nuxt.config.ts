// https://nuxt.com/docs/api/configuration/nuxt-config
const env = ((globalThis as typeof globalThis & {
  process?: { env?: Record<string, string | undefined> }
}).process?.env ?? {})

export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/ui'
  ],

  ssr: false,

  devtools: {
    enabled: process.env.NODE_ENV !== 'production'
  },

  app: {
    head: {
      htmlAttrs: { lang: 'pt-BR' },
      title: 'MT Affiliates - Admin',
      meta: [
        { name: 'theme-color', content: '#39FF14' }
      ],
      link: [
        { key: 'icon', rel: 'icon', type: 'image/x-icon', href: '/mt-affiliates-favicon.ico' },
        { key: 'shortcut-icon', rel: 'shortcut icon', type: 'image/x-icon', href: '/mt-affiliates-favicon.ico' },
        { key: 'apple-touch-icon', rel: 'apple-touch-icon', type: 'image/png', sizes: '180x180', href: '/mt-affiliates-apple-touch-icon.png' },
        { key: 'manifest', rel: 'manifest', href: '/manifest.webmanifest' }
      ]
    }
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

  compatibilityDate: '2025-01-15',

  vite: {
    build: {
      target: ['es2020', 'safari15']
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
