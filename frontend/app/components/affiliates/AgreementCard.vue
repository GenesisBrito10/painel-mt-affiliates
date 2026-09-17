<script setup lang="ts">
/**
 * AgreementCard — Shows the affiliate's active houses and CPA totals.
 */
import type { AffiliateLink } from '~/composables/useAffiliates'

const props = defineProps<{
  affiliateLinks: AffiliateLink[]
  summary: { totalLinks: number; totalCpa: number; avgRevshare: number }
  formatCurrency: (v: number) => string
  formatHouseLabel: (v: string) => string
}>()
</script>

<template>
  <div class="vex-card p-3 md:p-5 flex flex-col">
    <div class="mb-2 md:mb-3">
      <p class="text-[10px] uppercase tracking-[0.14em] font-bold flex items-center gap-1" style="color: var(--vex-text-faint)">
        <UIcon name="i-lucide-briefcase" class="text-[12px]" /> 
        Meus Acordos
      </p>
      <h3 class="mt-1 text-base md:text-lg font-bold vex-amount" style="color: var(--vex-text)">
        {{ summary.totalLinks }} casa{{ summary.totalLinks === 1 ? '' : 's' }} ativa{{ summary.totalLinks === 1 ? '' : 's' }}
      </h3>
    </div>

    <div class="mb-2 md:mb-3">
      <div class="vex-stat-cell vex-stat-cell--highlight">
        <p class="vex-stat-label" style="color: var(--vex-positive)">CPA Total</p>
        <p class="vex-stat-value vex-amount" style="color: var(--vex-positive)">{{ formatCurrency(summary.totalCpa) }}</p>
      </div>
    </div>

    <div class="space-y-1.5 flex-1 overflow-y-auto max-h-36 pr-1">
      <!-- Empty state -->
      <div
        v-if="affiliateLinks.length === 0"
        class="flex flex-col items-center justify-center py-4 text-center"
      >
        <UIcon name="i-lucide-link-2-off" class="text-[20px] mb-1" style="color: var(--vex-text-faint)" />
        <p class="text-[11px]" style="color: var(--vex-text-faint)">Nenhum acordo ativo ainda</p>
      </div>

      <div
        v-for="link in affiliateLinks"
        :key="`${link.bettingHouse}-${link.affiliateId}`"
        class="rounded-lg p-2 md:p-2.5 flex items-center justify-between gap-2"
        style="background: var(--vex-surface-strong); border: 1px solid var(--vex-border-subtle)"
      >
        <div class="min-w-[0]">
          <p class="font-semibold text-[11px] md:text-[12px] truncate" style="color: var(--vex-text)">
            <HouseBadge :slug="link.bettingHouse" size="xs" />
          </p>
        </div>
        <div class="text-right shrink-0">
          <p class="text-[10px] font-money" style="color: var(--vex-text-muted)">CPA {{ link.cpa ? formatCurrency(link.cpa) : '—' }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
