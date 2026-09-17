<script setup lang="ts">
defineProps<{ title: string, description: string, icon: string }>()
</script>

<template>
  <div class="admin-page">
    <UCard>
      <div class="flex items-start gap-4">
        <div class="grid size-11 place-items-center rounded-lg bg-muted">
          <UIcon
            :name="icon"
            class="size-5 text-muted"
          />
        </div>
        <div>
          <h1 class="text-2xl font-black text-highlighted">
            {{ title }}
          </h1>
          <p class="mt-1 text-sm text-muted">
            {{ description }}
          </p>
        </div>
      </div>
    </UCard>
  </div>
</template>
