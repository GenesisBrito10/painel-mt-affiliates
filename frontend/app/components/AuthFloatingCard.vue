<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    icon: string
    tone?: 'positive' | 'info' | 'warning' | 'brand'
    title: string
    subtitle: string
    time?: string
  }>(),
  { tone: 'positive', time: undefined },
)

// Uses the same admin-configurable --vex-* tokens as the rest of the app
// (set at runtime by plugins/theme.client.ts) instead of static Tailwind
// colors, so these icons follow the registered "cor principal" palette.
const toneStyle: Record<string, string> = {
  positive: 'background: var(--vex-positive-light); color: var(--vex-positive)',
  info: 'background: var(--vex-info-light); color: var(--vex-info)',
  warning: 'background: var(--vex-warning-light); color: var(--vex-warning)',
  brand: 'background: var(--vex-brand-light); color: var(--vex-brand)',
}

const iconStyle = computed(() => toneStyle[props.tone])
</script>

<template>
  <div
    class="vex-auth-float flex w-[13.5rem] items-start gap-2.5 rounded-xl border px-3.5 py-3 backdrop-blur-md"
    style="background: rgba(22, 25, 29, 0.72); border-color: rgba(255, 255, 255, 0.08); box-shadow: 0 20px 44px -20px rgba(0, 0, 0, 0.7)"
  >
    <span
      class="flex size-8 shrink-0 items-center justify-center rounded-full"
      :style="iconStyle"
    >
      <UIcon :name="icon" class="size-4" />
    </span>
    <div class="min-w-0 pt-0.5">
      <p class="truncate text-[12.5px] font-semibold leading-tight text-white">{{ title }}</p>
      <p class="mt-0.5 truncate text-[11px] leading-snug" style="color: var(--vex-shell-dark-label)">
        {{ subtitle }}
      </p>
      <p v-if="time" class="mt-1 text-[10px]" style="color: var(--vex-shell-dark-faint)">{{ time }}</p>
    </div>
  </div>
</template>
