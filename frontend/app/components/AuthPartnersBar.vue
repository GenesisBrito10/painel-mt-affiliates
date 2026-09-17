<script setup lang="ts">
const { houses, refresh } = usePublicBettingHouses()

onMounted(refresh)

// Logos only — houses without a logo uploaded don't render (nothing to show
// as an image). Dedupes by the logo URL itself, not the name: houses like
// "Betano Diário" / "Betano Mensal" are separate rows with different names
// but share the same artwork, and should only show up once.
const logos = computed(() => {
  const seen = new Set<string>()
  const result: typeof houses.value = []
  for (const house of houses.value) {
    if (!house.logoUrl) continue
    const key = house.logoUrl.trim().toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(house)
  }
  return result
})

function hideBrokenLogo(e: Event) {
  (e.target as HTMLImageElement).style.display = 'none'
}
</script>

<template>
  <div
    v-if="logos.length"
    class="flex flex-col gap-3 rounded-2xl border px-5 py-4 sm:flex-row sm:items-center sm:gap-6 sm:px-6"
    style="background: rgba(255, 255, 255, 0.03); border-color: rgba(255, 255, 255, 0.08)"
  >
    <p
      class="shrink-0 text-[11px] font-bold uppercase leading-tight tracking-[0.08em]"
      style="color: var(--vex-shell-dark-subtle)"
    >
      Nossas casas<br class="hidden sm:block">
      parceiras
    </p>

    <div class="hidden h-8 w-px shrink-0 sm:block" style="background: rgba(255, 255, 255, 0.08)" />

    <div class="vex-marquee-mask min-w-0 flex-1 overflow-hidden">
      <div class="vex-marquee-track flex w-max items-center gap-x-10">
        <img
          v-for="(house, i) in [...logos, ...logos]"
          :key="`${house.id}-${i}`"
          :src="house.logoUrl"
          :alt="house.name"
          class="h-5 w-auto max-w-[7rem] shrink-0 object-contain object-left"
          @error="hideBrokenLogo"
        >
      </div>
    </div>
  </div>
</template>
