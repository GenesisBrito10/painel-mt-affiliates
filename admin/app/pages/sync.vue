<script setup lang="ts">
definePageMeta({ layout: 'default' })
const { authHeaders } = useAuth()
const apiBase = useApiBase()
const toast = useToast()
const loading = ref(false)

async function trigger() {
  loading.value = true
  try {
    await $fetch(`${apiBase}/admin/sync/trigger`, { method: 'POST', headers: authHeaders(), body: {} })
    toast.add({ title: 'Sync disparado', color: 'success' })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="admin-page">
    <UCard>
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 class="text-2xl font-black text-highlighted">
            Sync
          </h1>
          <p class="text-sm text-muted">
            Dispare a sincronização manual de todas as casas.
          </p>
        </div>
        <UButton
          icon="i-lucide-refresh-cw"
          :loading="loading"
          @click="trigger"
        >
          Disparar sync
        </UButton>
      </div>
    </UCard>
  </div>
</template>
