const devHttps = process.env.NUXT_DEV_HTTPS === 'true'
const vitePlugins = []

if (devHttps) {
  const { default: mkcert } = await import('vite-plugin-mkcert')
  vitePlugins.push(mkcert())
}

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: process.env.NODE_ENV !== 'production' },
  ssr: false,

  modules: ['@nuxt/ui', '@pinia/nuxt'],

  colorMode: {
    preference: 'dark',
    fallback: 'dark',
  },

  css: ['~/assets/css/main.css'],

  runtimeConfig: {
    internalApiUrl: process.env.NUXT_INTERNAL_API_URL || process.env.NUXT_PUBLIC_API_URL || 'http://localhost:3011',
    public: {
      apiUrl: '/api',
      socketUrl: process.env.NUXT_PUBLIC_SOCKET_URL || '',
    },
  },

  devServer: {
    port: parseInt(process.env.PORT || '3013'),
    https: devHttps,
  },

  vite: {
    plugins: vitePlugins,
    build: {
      target: ['es2020', 'safari15'],
    },
  },

  app: {
    layoutTransition: false,
    pageTransition: { name: 'page', mode: 'out-in' },
    head: {
      htmlAttrs: { lang: 'pt-BR' },
      charset: 'utf-8',
      viewport: 'width=device-width, initial-scale=1, viewport-fit=cover',
      title: 'MT Affiliates',
      meta: [
        { name: 'description', content: 'Painel de gestão de afiliados e comissões' },
        { name: 'theme-color', content: '#39FF14' },
      ],
      link: [
        { key: 'icon', rel: 'icon', type: 'image/x-icon', href: '/mt-affiliates-favicon.ico' },
        { key: 'shortcut-icon', rel: 'shortcut icon', type: 'image/x-icon', href: '/mt-affiliates-favicon.ico' },
        { key: 'apple-touch-icon', rel: 'apple-touch-icon', type: 'image/png', sizes: '180x180', href: '/mt-affiliates-apple-touch-icon.png' },
        { key: 'apple-touch-icon-precomposed', rel: 'apple-touch-icon-precomposed', type: 'image/png', sizes: '180x180', href: '/mt-affiliates-apple-touch-icon.png' },
        { key: 'manifest', rel: 'manifest', href: '/manifest.webmanifest' },
      ],
    },
  },
})
