<script setup lang="ts">
import type { DashboardSummary } from '~/types/dashboard'

const FINAL_GOAL = 20_000

const milestones = [
  { cpa: 100, reward: 'R$ 100', image: 'ELEMENTO BRONZE 100 CPA.png' },
  { cpa: 300, reward: 'R$ 400', image: 'ELEMENTO PRATA 300 CPA.png' },
  { cpa: 500, reward: 'R$ 600', image: 'ELEMENTO OURO 500 CPA.png' },
  { cpa: 1_000, reward: 'R$ 2.000', image: 'ELEMENTO DIAMANTE 1.000 CPA.png' },
  { cpa: 2_000, reward: 'R$ 5.000', image: 'ELEMENTO TROFÉU ROXO 2.000 CPA.png' },
  { cpa: 5_000, reward: 'R$ 15.000', image: 'ELEMENTO COROA DOURADA 5.000 CPA.png' },
  { cpa: FINAL_GOAL, reward: 'BMW 320i M SPORT 0KM', image: 'ELEMENTO icone BMW.png' },
]

function assetUrl(file: string) {
  return `/${encodeURI(file)}`
}

const { authHeaders } = useAuth()
const apiBase = useApiBase()

const loading = ref(true)
const currentCpa = ref(0)

const fmtInt = (n: number) => new Intl.NumberFormat('pt-BR').format(n)
const fmtPct = (n: number) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

const progressPct = computed(() => Math.min(100, (currentCpa.value / FINAL_GOAL) * 100))
const pctOfTotal = computed(() => (currentCpa.value / FINAL_GOAL) * 100)
const remainingToBmw = computed(() => Math.max(0, FINAL_GOAL - currentCpa.value))

const nextMilestone = computed(() => {
  const next = milestones.find(m => m.cpa > currentCpa.value)
  return next ?? milestones[milestones.length - 1]!
})

const remainingToNext = computed(() => Math.max(0, nextMilestone.value.cpa - currentCpa.value))

const timelineProgressPct = computed(() => {
  if (currentCpa.value >= FINAL_GOAL) return 100
  const idx = milestones.findIndex(m => m.cpa > currentCpa.value)
  if (idx <= 0) return (currentCpa.value / milestones[0]!.cpa) * (100 / (milestones.length - 1))
  const prev = milestones[idx - 1]!
  const next = milestones[idx]!
  const segmentStart = ((idx - 1) / (milestones.length - 1)) * 100
  const segmentWidth = 100 / (milestones.length - 1)
  const inSegment = (currentCpa.value - prev.cpa) / (next.cpa - prev.cpa)
  return segmentStart + inSegment * segmentWidth
})

function milestoneReached(cpa: number) {
  return currentCpa.value >= cpa
}

onMounted(async () => {
  try {
    const today = new Date().toISOString().slice(0, 10)
    const res = await $fetch<DashboardSummary>(`${apiBase}/v1/dashboard/summary`, {
      headers: authHeaders(),
      query: { startDate: '2020-01-01', endDate: today, scope: 'all' },
    })
    currentCpa.value = res.cpaQualified ?? 0
  } catch {
    currentCpa.value = 0
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <section class="giants-race">
    <!-- Hero: título + carro + badge -->
    <div class="giants-race__hero relative overflow-hidden px-4 pb-3 pt-4 md:px-7 md:pb-4 md:pt-6">
      <div class="giants-race__glow pointer-events-none absolute right-0 top-0 h-full w-[62%]" />

      <div class="relative z-[2] flex max-w-[52%] flex-col gap-2.5 md:max-w-[48%] md:gap-3">
        <div class="flex items-start gap-2.5 md:gap-3">
          <div class="giants-race__trophy-box flex size-9 shrink-0 items-center justify-center rounded-lg md:size-10">
            <UIcon name="i-lucide-trophy" class="size-4 md:size-5" style="color: #f5c842" />
          </div>
          <div>
            <p class="text-[10px] font-bold uppercase tracking-[0.12em] text-white/90 md:text-[11px] md:tracking-[0.14em]">Corrida dos</p>
            <h2 class="giants-race__title text-[1.5rem] font-black uppercase leading-none tracking-wide md:text-[2rem]">Gigantes</h2>
          </div>
        </div>
        <p class="max-w-[16rem] text-[11px] leading-relaxed text-white/55 md:max-w-md md:text-[12px]">
          Complete metas, resgate recompensas e alcance sua BMW 320i 0KM.
        </p>
      </div>

      <img
        :src="assetUrl('ELEMENTO - CARRO BMW.png')"
        alt="BMW 320i M Sport"
        class="giants-race__car pointer-events-none absolute bottom-0 right-0 z-[1] w-auto object-contain object-right-bottom"
        loading="lazy"
      >

      <div class="giants-race__prize-box absolute right-3 top-3 z-[3] rounded-lg px-2.5 py-2 md:right-6 md:top-5 md:rounded-xl md:px-4 md:py-3">
        <p class="text-[7px] font-bold uppercase tracking-wider text-white/45 md:text-[9px] md:tracking-[0.14em]">Prêmio final</p>
        <div class="mt-0.5 flex items-center gap-1.5 md:mt-1 md:gap-2.5">
          <div>
            <p class="text-[11px] font-black leading-tight md:text-[15px]" style="color: #f5c842">BMW 320i</p>
            <p class="text-[8px] font-bold uppercase tracking-wide text-white/80 md:text-[11px]">M Sport 0KM</p>
          </div>
          <img :src="assetUrl('ELEMENTO icone BMW.png')" alt="BMW" class="size-7 shrink-0 object-contain md:size-11" loading="lazy">
        </div>
      </div>
    </div>

    <!-- Progresso -->
    <div class="relative z-[2] grid grid-cols-[auto_minmax(0,1fr)_auto] items-end gap-3 px-4 py-4 md:grid-cols-[minmax(0,9rem)_1fr_minmax(0,9rem)] md:gap-6 md:px-7 md:py-5">
      <div>
        <p class="text-[8px] font-bold uppercase tracking-wider text-white/40 md:text-[9px] md:tracking-[0.14em]">CPA atual</p>
        <USkeleton v-if="loading" class="mt-1.5 h-7 w-20 bg-white/10 md:h-8 md:w-28" />
        <template v-else>
          <p class="mt-1 text-[1.15rem] font-black leading-none tabular-nums md:text-[1.6rem]" style="color: #b57bff">{{ fmtInt(currentCpa) }} CPA</p>
          <p class="mt-1 text-[9px] font-semibold uppercase tracking-wide text-white/35 md:text-[10px]">{{ fmtPct(pctOfTotal) }}% do total</p>
        </template>
      </div>
      <div class="w-full pb-0.5">
        <div class="giants-race__bar-track h-[6px] overflow-hidden rounded-full md:h-[7px]">
          <div class="giants-race__bar-fill h-full rounded-full transition-all duration-700" :style="{ width: `${progressPct}%` }" />
        </div>
        <div class="mt-1.5 flex justify-between text-[9px] font-bold tabular-nums md:text-[10px]">
          <span style="color: #b57bff">{{ fmtInt(currentCpa) }} CPA</span>
          <span class="text-white/35">{{ fmtInt(FINAL_GOAL) }} CPA</span>
        </div>
      </div>
      <div class="text-right">
        <p class="text-[8px] font-bold uppercase tracking-wider text-white/40 md:text-[9px] md:tracking-[0.14em]">Faltam</p>
        <USkeleton v-if="loading" class="ml-auto mt-1.5 h-7 w-24 bg-white/10 md:h-8 md:w-28" />
        <template v-else>
          <p class="mt-1 text-[1.15rem] font-black leading-none tabular-nums md:text-[1.6rem]" style="color: #f5c842">{{ fmtInt(remainingToBmw) }} CPA</p>
          <p class="mt-1 text-[9px] text-white/35 md:text-[10px]">para a BMW 320i 0KM</p>
        </template>
      </div>
    </div>

    <!-- Trilha de recompensas -->
    <div class="border-t border-white/[0.06] px-3 py-4 md:px-6 md:py-5">
      <div class="giants-race__milestones-scroll overflow-x-auto pb-1">
        <div class="relative min-w-[600px] px-1 md:min-w-0">
          <div class="giants-race__dash-track absolute left-[3.5%] right-[3.5%] top-[1.6rem] md:top-[1.75rem]" />
          <div
            class="giants-race__dash-fill absolute left-[3.5%] top-[1.6rem] transition-all duration-700 md:top-[1.75rem]"
            :style="{ width: `calc(${timelineProgressPct}% * 0.93)` }"
          />
          <div class="relative flex justify-between">
            <div v-for="m in milestones" :key="m.cpa" class="flex w-[13.5%] flex-col items-center text-center">
              <div
                class="relative z-[1] flex size-[3.6rem] items-center justify-center md:size-[3.5rem]"
                :class="[
                  m.cpa === FINAL_GOAL && milestoneReached(m.cpa) ? 'giants-race__bmw-glow' : '',
                  !milestoneReached(m.cpa) ? 'opacity-80' : '',
                ]"
              >
                <img :src="assetUrl(m.image)" :alt="`${m.cpa} CPA`" class="size-full object-contain drop-shadow-[0_4px_12px_rgba(0,0,0,0.45)]" loading="lazy">
              </div>
              <p class="mt-2 text-[10px] font-bold tabular-nums text-white/85 md:text-[11px]">{{ fmtInt(m.cpa) }} CPA</p>
              <p class="mt-0.5 max-w-[5rem] text-[9px] font-bold leading-tight md:max-w-[5.5rem] md:text-[10px]" :style="{ color: m.cpa === FINAL_GOAL ? '#f5c842' : '#3dff8a' }">{{ m.reward }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div class="giants-race__footer grid grid-cols-3 divide-x divide-white/[0.08] border-t border-white/[0.06]">
      <div class="flex items-center gap-2 px-3 py-3.5 md:gap-3 md:px-6 md:py-4">
        <div class="hidden size-8 shrink-0 items-center justify-center rounded-full sm:flex" style="background: color-mix(in srgb, #b57bff 18%, transparent)">
          <UIcon name="i-lucide-target" class="size-4" style="color: #b57bff" />
        </div>
        <div class="min-w-0">
          <p class="text-[8px] font-bold uppercase tracking-wide text-white/40 md:text-[9px] md:tracking-[0.12em]">Próxima recompensa</p>
          <p class="mt-0.5 text-[0.95rem] font-black tabular-nums md:text-[1.05rem]" style="color: #b57bff">{{ fmtInt(nextMilestone.cpa) }} CPA</p>
        </div>
      </div>
      <div class="px-3 py-3.5 md:px-6 md:py-4">
        <p class="text-[8px] font-bold uppercase tracking-wide text-white/40 md:text-[9px] md:tracking-[0.12em]">Recompensa</p>
        <p class="mt-0.5 text-[0.95rem] font-black leading-tight md:text-[1.05rem]" style="color: #3dff8a">{{ nextMilestone.reward }}</p>
      </div>
      <div class="px-3 py-3.5 md:px-6 md:py-4">
        <p class="text-[8px] font-bold uppercase tracking-wide text-white/40 md:text-[9px] md:tracking-[0.12em]">Faltam apenas</p>
        <p class="mt-0.5 text-[0.95rem] font-black tabular-nums md:text-[1.05rem]" style="color: #b57bff">{{ fmtInt(remainingToNext) }} CPA</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.giants-race {
  position: relative;
  border-radius: 1rem;
  background: linear-gradient(180deg, #0c0c10 0%, #08080b 100%);
  isolation: isolate;
  overflow: hidden;
}

.giants-race::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: 1px;
  background: linear-gradient(135deg, #7c3aed 0%, #8b5cf6 35%, #a855f7 55%, #f59e0b 100%);
  -webkit-mask:
    linear-gradient(#fff 0 0) content-box,
    linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  pointer-events: none;
}

.giants-race__milestones-scroll {
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}

.giants-race__milestones-scroll::-webkit-scrollbar {
  display: none;
}

.giants-race__hero {
  min-height: 12.5rem;
}

@media (min-width: 768px) {
  .giants-race__hero {
    min-height: 14rem;
  }
}

@media (min-width: 1024px) {
  .giants-race__hero {
    min-height: 15.5rem;
  }
}

.giants-race__glow {
  background: radial-gradient(ellipse 75% 85% at 88% 50%, rgba(124, 58, 237, 0.42) 0%, transparent 70%);
}

.giants-race__trophy-box {
  background: linear-gradient(145deg, rgba(245, 200, 66, 0.18), rgba(245, 200, 66, 0.06));
  border: 1px solid rgba(245, 200, 66, 0.28);
}

.giants-race__title {
  background: linear-gradient(180deg, #fff4c2 0%, #f5c842 45%, #d4a017 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  font-style: italic;
}

.giants-race__prize-box {
  background: rgba(0, 0, 0, 0.72);
  border: 1px solid rgba(197, 160, 89, 0.55);
  backdrop-filter: blur(8px);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.35);
}

.giants-race__car {
  height: 13rem;
  max-width: min(72vw, 26rem);
  filter: drop-shadow(0 10px 32px rgba(124, 58, 237, 0.4));
}

@media (min-width: 640px) {
  .giants-race__car {
    height: 14rem;
    max-width: min(60vw, 28rem);
  }
}

@media (min-width: 768px) {
  .giants-race__car {
    height: 14.5rem;
    max-width: min(48vw, 30rem);
  }
}

@media (min-width: 1024px) {
  .giants-race__car {
    height: 16.5rem;
    max-width: min(44vw, 34rem);
  }
}

.giants-race__bar-track {
  background: rgba(255, 255, 255, 0.08);
}

.giants-race__bar-fill {
  background: linear-gradient(90deg, #7c3aed, #b57bff);
  box-shadow: 0 0 14px rgba(181, 123, 255, 0.45);
}

.giants-race__dash-track {
  height: 2px;
  background: repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.14) 0, rgba(255, 255, 255, 0.14) 5px, transparent 5px, transparent 10px);
}

.giants-race__dash-fill {
  height: 2px;
  background: repeating-linear-gradient(90deg, #b57bff 0, #b57bff 5px, transparent 5px, transparent 10px);
}

.giants-race__bmw-glow {
  filter: drop-shadow(0 0 16px rgba(245, 200, 66, 0.65));
}

.giants-race__footer {
  background: rgba(255, 255, 255, 0.02);
}
</style>
