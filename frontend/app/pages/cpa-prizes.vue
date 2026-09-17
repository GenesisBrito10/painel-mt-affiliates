<script setup lang="ts">
definePageMeta({ layout: 'default' })

const { progress, awards, rankingAwards, loading, redeeming, fetchAll, requestRedemption } = useCpaPrizes()

onMounted(() => fetchAll())

const availableAwards = computed(() => awards.value.filter((a) => a.status === 'AVAILABLE'))
const historyAwards = computed(() =>
  awards.value.filter((a) => a.status !== 'AVAILABLE'),
)

// Premiações do ranking (sistema /v1/prizes) — resgatadas e a resgatar.
const rankingPending = computed(() => rankingAwards.value.filter((r) => !r.redeemed))
const rankingRedeemed = computed(() => rankingAwards.value.filter((r) => r.redeemed))

function fmtDate(d: string | null): string {
  return d ? new Date(d).toLocaleDateString('pt-BR') : ''
}

type BadgeColor = 'success' | 'warning' | 'primary' | 'neutral' | 'error'
const STATUS_META: Record<string, { label: string; color: BadgeColor }> = {
  AVAILABLE: { label: 'Disponível', color: 'success' },
  REDEMPTION_REQUESTED: { label: 'Resgate solicitado', color: 'warning' },
  PAID: { label: 'Pago', color: 'primary' },
  CANCELLED: { label: 'Cancelado', color: 'neutral' },
  REJECTED: { label: 'Recusado', color: 'error' },
}

function pct(p: { remainder: number; meta: number }): number {
  if (p.meta <= 0) return 0
  return Math.min(100, Math.round((p.remainder / p.meta) * 100))
}

function money(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
</script>

<template>
  <div class="cpa-prizes-page">
    <header class="page-head">
      <h1>Premiações por CPA</h1>
      <p>Acompanhe seu progresso, prêmios disponíveis e histórico de resgates.</p>
    </header>

    <div v-if="loading" class="muted">Carregando…</div>

    <template v-else>
      <!-- Progresso por regra -->
      <section v-if="progress.length" class="grid">
        <UCard v-for="p in progress" :key="p.ruleVersionId" class="prog-card">
          <div class="prog-head">
            <span class="prog-icon">{{ p.icon || '🎯' }}</span>
            <div>
              <strong>{{ p.name }}</strong>
              <div class="badges">
                <UBadge size="xs" :color="p.countMode === 'NETWORK' ? 'secondary' : 'primary'" variant="subtle">
                  {{ p.countMode === 'NETWORK' ? 'Por rede' : 'Individual' }}
                </UBadge>
                <UBadge v-if="p.bettingHouse" size="xs" color="neutral" variant="subtle">
                  {{ p.bettingHouse }}
                </UBadge>
              </div>
            </div>
          </div>

          <div class="prog-bar">
            <div class="prog-fill" :style="{ width: pct(p) + '%' }" />
          </div>
          <div class="prog-stats">
            <span>{{ p.remainder }} / {{ p.meta }} CPAs no ciclo</span>
            <span>Faltam <strong>{{ p.faltam }}</strong></span>
          </div>

          <p class="prog-msg">{{ p.message }}</p>

          <div class="prog-footer">
            <span>Prêmio: <strong>{{ p.prizeLabel || money(p.prizeValue) }}</strong></span>
            <span>Ganhos: <strong>{{ p.prizesWon }}</strong></span>
          </div>
        </UCard>
      </section>
      <div v-else class="muted">Nenhuma regra de premiação ativa no momento.</div>

      <!-- Prêmios disponíveis -->
      <section v-if="availableAwards.length" class="block">
        <h2>Prêmios disponíveis para resgate</h2>
        <div class="award-list">
          <div v-for="a in availableAwards" :key="a.id" class="award-row">
            <div>
              <strong>{{ a.prizeLabel || money(a.prizeValue) }}</strong>
              <span class="muted"> · {{ a.ruleName }} (ciclo {{ a.cycleIndex }})</span>
            </div>
            <UButton
              size="sm"
              :loading="redeeming === a.id"
              @click="requestRedemption(a.id)"
            >
              Solicitar resgate
            </UButton>
          </div>
        </div>
      </section>

      <!-- Premiações do ranking (campanhas/metas) -->
      <section v-if="rankingAwards.length" class="block">
        <h2>Premiações do Ranking</h2>
        <div class="award-list">
          <div v-for="r in rankingPending" :key="`rk-p-${r.prizeId}-${r.rank}`" class="award-row">
            <div>
              <strong>{{ r.prizeLabel || money(r.prizeValue) }}</strong>
              <span class="muted"> · {{ r.title }} · {{ r.rank }}º lugar · {{ r.cpaAchieved }} CPAs</span>
            </div>
            <UButton size="sm" color="primary" icon="i-lucide-external-link" @click="navigateTo('/ranking')">
              Resgatar no Ranking
            </UButton>
          </div>
          <div v-for="r in rankingRedeemed" :key="`rk-r-${r.prizeId}-${r.rank}`" class="award-row">
            <div>
              <strong>{{ r.prizeLabel || money(r.prizeValue) }}</strong>
              <span class="muted"> · {{ r.title }} · {{ r.rank }}º lugar</span>
            </div>
            <span class="redeemed-tag">✓ Resgatado {{ fmtDate(r.redeemedAt) }}</span>
          </div>
        </div>
      </section>

      <!-- Histórico -->
      <section class="block">
        <h2>Histórico</h2>
        <div v-if="!historyAwards.length" class="muted">Sem histórico ainda.</div>
        <table v-else class="hist-table">
          <thead>
            <tr>
              <th>Prêmio</th>
              <th>Regra</th>
              <th>Status</th>
              <th>Motivo</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in historyAwards" :key="a.id">
              <td>{{ a.prizeLabel || money(a.prizeValue) }}</td>
              <td>{{ a.ruleName }}</td>
              <td>
                <UBadge size="xs" :color="STATUS_META[a.status]?.color || 'neutral'" variant="subtle">
                  {{ STATUS_META[a.status]?.label || a.status }}
                </UBadge>
              </td>
              <td class="muted">{{ a.rejectionReason || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </div>
</template>

<style scoped>
.cpa-prizes-page { display: flex; flex-direction: column; gap: 1.5rem; padding: 1rem; }
.page-head h1 { font-size: 1.4rem; font-weight: 700; }
.page-head p { color: var(--ui-text-muted, #888); }
.muted { color: var(--ui-text-muted, #888); }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem; }
.prog-head { display: flex; gap: .75rem; align-items: center; margin-bottom: .75rem; }
.prog-icon { font-size: 1.6rem; }
.badges { display: flex; gap: .35rem; margin-top: .25rem; }
.prog-bar { height: 8px; border-radius: 99px; background: var(--ui-bg-muted, #2222); overflow: hidden; }
.prog-fill { height: 100%; background: var(--vex-brand, #f59e0b); transition: width .3s; }
.prog-stats { display: flex; justify-content: space-between; font-size: .8rem; margin-top: .4rem; }
.prog-msg { font-size: .8rem; color: var(--ui-text-muted, #888); margin: .6rem 0; }
.prog-footer { display: flex; justify-content: space-between; font-size: .85rem; border-top: 1px solid var(--ui-border, #3333); padding-top: .5rem; }
.block h2 { font-size: 1.05rem; font-weight: 600; margin-bottom: .75rem; }
.award-list { display: flex; flex-direction: column; gap: .5rem; }
.award-row { display: flex; justify-content: space-between; align-items: center; padding: .65rem .9rem; border: 1px solid var(--ui-border, #3333); border-radius: .6rem; }
.redeemed-tag { font-size: .8rem; font-weight: 600; color: var(--vex-positive, #16a34a); white-space: nowrap; }
.hist-table { width: 100%; border-collapse: collapse; font-size: .875rem; }
.hist-table th, .hist-table td { text-align: left; padding: .5rem .6rem; border-bottom: 1px solid var(--ui-border, #3333); }
</style>
