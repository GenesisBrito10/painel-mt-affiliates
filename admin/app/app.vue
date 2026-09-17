<script setup lang="ts">
const colorMode = useColorMode()

const faviconHref = computed(() =>
  colorMode.value === 'dark' ? '/vallex-favicon-black.ico' : '/vallex-favicon-white.ico'
)

useHead({
  title: 'Vallex Group - Admin',
  link: [
    {
      key: 'icon',
      rel: 'icon',
      type: 'image/x-icon',
      href: faviconHref
    },
    {
      key: 'shortcut-icon',
      rel: 'shortcut icon',
      type: 'image/x-icon',
      href: faviconHref
    },
    {
      key: 'apple-touch-icon',
      rel: 'apple-touch-icon',
      type: 'image/png',
      sizes: '180x180',
      href: '/vallex-apple-touch-icon.png'
    },
    {
      key: 'manifest',
      rel: 'manifest',
      href: '/manifest.webmanifest'
    }
  ]
})
</script>

<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
