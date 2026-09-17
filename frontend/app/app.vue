<script setup lang="ts">
const { state: maintenance } = useMaintenance()
const colorMode = useColorMode()

const faviconHref = computed(() =>
  colorMode.value === 'dark' ? '/vallex-favicon.ico' : '/vallex-favicon.ico'
)

useHead({
  link: [
    {
      key: 'icon',
      rel: 'icon',
      type: 'image/x-icon',
      href: faviconHref,
    },
    {
      key: 'shortcut-icon',
      rel: 'shortcut icon',
      type: 'image/x-icon',
      href: faviconHref,
    },
    {
      key: 'apple-touch-icon',
      rel: 'apple-touch-icon',
      type: 'image/png',
      sizes: '512x512',
      href: '/vallex-apple-touch-icon.png',
    },
    {
      key: 'apple-touch-icon-precomposed',
      rel: 'apple-touch-icon-precomposed',
      type: 'image/png',
      sizes: '512x512',
      href: '/vallex-apple-touch-icon.png',
    },
    {
      key: 'manifest',
      rel: 'manifest',
      href: '/manifest.webmanifest',
    },
  ],
})
</script>

<template>
  <UApp>
    <MaintenanceScreen v-if="maintenance.enabled" />
    <NuxtLayout v-else>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
