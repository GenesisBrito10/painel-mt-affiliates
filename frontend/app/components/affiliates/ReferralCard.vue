<script setup lang="ts">
/**
 * ReferralCard — Compact, read-only referral link card.
 * No "generate new code" button — link is immutable.
 * Mobile-responsive: no excess whitespace.
 */

const props = defineProps<{
  referralCode: string
  referralLink: string
  copied: boolean
}>()

const emit = defineEmits<{
  copy: []
}>()
</script>

<template>
  <div class="vex-card p-3 md:p-5">
    <div class="flex items-start justify-between gap-2 mb-2 md:mb-3">
      <div>
        <p class="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em]" style="color: var(--vex-brand)">
          <UIcon name="i-lucide-link" class="size-3" /> Link de Convite
        </p>
        <p class="mt-0.5 md:mt-1 text-[11px]" style="color: var(--vex-text-faint)">
          Compartilhe para expandir sua rede.
        </p>
      </div>
      <div
        class="hidden sm:inline-flex items-center gap-1.5 px-2 py-1 rounded-md shrink-0"
        style="background: var(--vex-brand-muted); border: 1px solid var(--vex-brand-soft-border)"
      >
        <UIcon name="i-lucide-fingerprint" class="size-3" style="color: var(--vex-brand)" />
        <span class="text-[10px] font-semibold" style="color: var(--vex-text-muted)">{{ referralCode }}</span>
      </div>
    </div>

    <div
      class="rounded-lg p-2.5 md:p-3 flex flex-col sm:flex-row gap-2 sm:items-center"
      style="background: var(--vex-surface-strong); border: 1px solid var(--vex-border-subtle)"
    >
      <code class="text-[10px] md:text-[11px] font-mono break-all flex-1 leading-snug" style="color: var(--vex-text-muted)">{{ referralLink }}</code>
      <UButton
        :label="copied ? 'Copiado!' : 'Copiar'"
        :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
        :color="copied ? 'success' : 'neutral'"
        :variant="copied ? 'solid' : 'outline'"
        size="xs"
        class="shrink-0 w-full sm:w-auto"
        @click="emit('copy')"
      />
    </div>
  </div>
</template>
