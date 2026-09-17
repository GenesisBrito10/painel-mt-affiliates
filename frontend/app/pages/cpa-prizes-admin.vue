<script setup lang="ts">
import type { CreateRuleInput } from '~/composables/useCpaPrizesAdmin'

definePageMeta({ layout: 'default' })

const {
  rules, redemptions, metrics, logs, loading, busy, isAdmin,
  fetchRules, fetchMetrics, fetchRedemptions, fetchLogs,
  createRule, updateRule, removeRule, recalculate, approve, reject, cancel,
} = useCpaPrizesAdmin()

const tabs = ['Regras', 'Resgates', 'Métricas', 'Logs'] as const
type Tab = typeof tabs[number]
const tab = ref<Tab>('Regras')

onMounted(async () => {
  if (!isAdmin.value) return
  await Promise.all([fetchRules(), fetchMetrics(), fetchRedemptions(), fetchLogs()])
})

// ── Create form ────────────────────────────────────────────────────────────
const form = reactive<CreateRuleInput>({
  name: '',
  description: '',
  bettingHouse: '',
  cpaPerPrize: 10,
  countMode: 'INDIVIDUAL',
  prizeType: 'BALANCE',
  prizeValue: 0,
  prizeLabel: '',
  startDate: new Date().toISOString().slice(0, 10),
  endDate: '',
})

async function submitCreate() {
  if (!form.name || !form.cpaPerPrize) return
  await createRule({
    ...form,
    bettingHouse: form.bettingHouse || undefined,
    endDate: form.endDate || undefined,
  })
  form.name = ''
  form.description = ''
  form.prizeLabel = ''
}

function currentVersion(rule: typeof rules.value[number]) {
  return rule.versions.find((v) => !v.supersededAt) ?? rule.versions[0]
}

function money(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// ── Edit meta (structural → new version) ─────────────────────────────────────
const editingId = ref<string | null>(null)
const editMeta = ref<number>(0)
function startEdit(rule: typeof rules.value[number]) {
  editingId.value = rule.id
  editMeta.value = currentVersion(rule)?.cpaPerPrize ?? 0
}
async function saveEdit(id: string) {
  await updateRule(id, { cpaPerPrize: editMeta.value })
  editingId.value = null
}

// ── Redemption actions ───────────────────────────────────────────────────────
async function doReject(id: string) {
  const reason = window.prompt('Motivo da rejeição:')
  if (reason) await reject(id, reason)
}
async function doCancel(id: string) {
  const reason = window.prompt('Motivo do cancelamento (obrigatório):')
  if (reason) await cancel(id, reason)
}
</script>

<template>
  <div class="admin-page">
    <header class="page-head">
      <h1>Premiações por CPA — Admin</h1>
    </header>

    <div v-if="!isAdmin" class="muted">Acesso restrito a administradores.</div>

    <template v-else>
      <nav class="tabs">
        <button v-for="t in tabs" :key="t" :class="{ active: tab === t }" @click="tab = t">
          {{ t }}
        </button>
      </nav>

      <!-- REGRAS -->
      <section v-show="tab === 'Regras'" class="block">
        <UCard class="create-form">
          <h2>Nova regra</h2>
          <div class="form-grid">
            <UInput v-model="form.name" placeholder="Nome da regra" />
            <UInput v-model="form.bettingHouse" placeholder="Casa (slug) — vazio = todas" />
            <UInput v-model.number="form.cpaPerPrize" type="number" placeholder="CPAs por prêmio" />
            <USelect v-model="form.countMode" :items="['INDIVIDUAL', 'NETWORK']" />
            <USelect v-model="form.prizeType" :items="['BALANCE', 'PHYSICAL', 'OTHER']" />
            <UInput v-model.number="form.prizeValue" type="number" placeholder="Valor do prêmio" />
            <UInput v-model="form.prizeLabel" placeholder="Rótulo do prêmio" />
            <UInput v-model="form.startDate" type="date" />
            <UInput v-model="form.endDate" type="date" placeholder="Fim (opcional)" />
          </div>
          <UButton :loading="busy" @click="submitCreate">Criar regra</UButton>
        </UCard>

        <div v-if="loading" class="muted">Carregando…</div>
        <table v-else class="tbl">
          <thead>
            <tr><th>Nome</th><th>Casa</th><th>Meta</th><th>Tipo</th><th>Contagem</th><th>Ativa</th><th>Ações</th></tr>
          </thead>
          <tbody>
            <tr v-for="r in rules" :key="r.id">
              <td>{{ r.name }}</td>
              <td>{{ currentVersion(r)?.bettingHouse || 'todas' }}</td>
              <td>
                <template v-if="editingId === r.id">
                  <UInput v-model.number="editMeta" type="number" size="xs" class="w-20" />
                </template>
                <template v-else>{{ currentVersion(r)?.cpaPerPrize }}</template>
              </td>
              <td>{{ currentVersion(r)?.prizeType }}</td>
              <td>
                <UBadge size="xs" :color="currentVersion(r)?.countMode === 'NETWORK' ? 'secondary' : 'primary'" variant="subtle">
                  {{ currentVersion(r)?.countMode === 'NETWORK' ? 'Rede' : 'Individual' }}
                </UBadge>
              </td>
              <td>{{ r.active ? 'Sim' : 'Não' }}</td>
              <td class="actions">
                <template v-if="editingId === r.id">
                  <UButton size="xs" :loading="busy" @click="saveEdit(r.id)">Salvar</UButton>
                  <UButton size="xs" variant="ghost" @click="editingId = null">Cancelar</UButton>
                </template>
                <template v-else>
                  <UButton size="xs" variant="soft" @click="startEdit(r)">Editar meta</UButton>
                  <UButton size="xs" variant="soft" color="primary" :loading="busy" @click="recalculate(r.id)">Recalcular</UButton>
                  <UButton size="xs" variant="soft" :color="r.active ? 'warning' : 'success'" :loading="busy" @click="updateRule(r.id, { active: !r.active })">
                    {{ r.active ? 'Inativar' : 'Ativar' }}
                  </UButton>
                  <UButton size="xs" variant="soft" color="error" :loading="busy" @click="removeRule(r.id)">Remover</UButton>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- RESGATES -->
      <section v-show="tab === 'Resgates'" class="block">
        <h2>Fila de resgates</h2>
        <div v-if="!redemptions.length" class="muted">Nenhum resgate pendente.</div>
        <table v-else class="tbl">
          <thead><tr><th>Usuário</th><th>Prêmio</th><th>Valor</th><th>Ações</th></tr></thead>
          <tbody>
            <tr v-for="a in redemptions" :key="a.id">
              <td>{{ a.user?.name || a.userName }}</td>
              <td>{{ a.prizeLabel || '—' }}</td>
              <td>{{ money(a.prizeValue) }}</td>
              <td class="actions">
                <UButton size="xs" color="success" :loading="busy" @click="approve(a.id)">Aprovar</UButton>
                <UButton size="xs" color="error" variant="soft" :loading="busy" @click="doReject(a.id)">Rejeitar</UButton>
                <UButton size="xs" color="neutral" variant="soft" :loading="busy" @click="doCancel(a.id)">Cancelar</UButton>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- MÉTRICAS -->
      <section v-show="tab === 'Métricas'" class="block">
        <h2>Métricas</h2>
        <div v-if="metrics" class="metrics-grid">
          <UCard><div class="metric"><span>Prêmios gerados</span><strong>{{ metrics.awards.total }}</strong></div></UCard>
          <UCard><div class="metric"><span>Disponíveis</span><strong>{{ metrics.awards.available }}</strong></div></UCard>
          <UCard><div class="metric"><span>Resgate solicitado</span><strong>{{ metrics.awards.redemptionRequested }}</strong></div></UCard>
          <UCard><div class="metric"><span>Pagos</span><strong>{{ metrics.awards.paid }}</strong></div></UCard>
          <UCard><div class="metric"><span>Cancelados</span><strong>{{ metrics.awards.cancelled }}</strong></div></UCard>
          <UCard><div class="metric"><span>Rejeitados</span><strong>{{ metrics.awards.rejected }}</strong></div></UCard>
          <UCard><div class="metric"><span>Valor gerado</span><strong>{{ money(metrics.value.totalGenerated) }}</strong></div></UCard>
          <UCard><div class="metric"><span>Valor pago</span><strong>{{ money(metrics.value.paid) }}</strong></div></UCard>
          <UCard><div class="metric"><span>Valor pendente</span><strong>{{ money(metrics.value.pending) }}</strong></div></UCard>
        </div>
        <div v-if="metrics?.topUsers?.length" class="block">
          <h3>Top usuários por prêmios</h3>
          <table class="tbl">
            <thead><tr><th>Usuário</th><th>Prêmios</th></tr></thead>
            <tbody>
              <tr v-for="u in metrics.topUsers" :key="u.userId"><td>{{ u.userName }}</td><td>{{ u.awards }}</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- LOGS -->
      <section v-show="tab === 'Logs'" class="block">
        <h2>Logs</h2>
        <table class="tbl">
          <thead><tr><th>Evento</th><th>Nota</th><th>Data</th></tr></thead>
          <tbody>
            <tr v-for="(l, i) in logs" :key="i">
              <td><code>{{ l.event }}</code></td>
              <td>{{ l.note }}</td>
              <td class="muted">{{ new Date(l.createdAt as string).toLocaleString('pt-BR') }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </div>
</template>

<style scoped>
.admin-page { display: flex; flex-direction: column; gap: 1.25rem; padding: 1rem; }
.page-head h1 { font-size: 1.4rem; font-weight: 700; }
.muted { color: var(--ui-text-muted, #888); }
.tabs { display: flex; gap: .25rem; border-bottom: 1px solid var(--ui-border, #3333); }
.tabs button { padding: .5rem 1rem; background: none; border: none; cursor: pointer; color: var(--ui-text-muted, #888); border-bottom: 2px solid transparent; }
.tabs button.active { color: var(--vex-brand, #f59e0b); border-bottom-color: var(--vex-brand, #f59e0b); font-weight: 600; }
.block { display: flex; flex-direction: column; gap: 1rem; }
.block h2 { font-size: 1.05rem; font-weight: 600; }
.create-form { display: flex; flex-direction: column; gap: .75rem; }
.form-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: .5rem; }
.tbl { width: 100%; border-collapse: collapse; font-size: .85rem; }
.tbl th, .tbl td { text-align: left; padding: .5rem .6rem; border-bottom: 1px solid var(--ui-border, #3333); }
.actions { display: flex; gap: .35rem; flex-wrap: wrap; }
.metrics-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: .75rem; }
.metric { display: flex; flex-direction: column; gap: .25rem; }
.metric span { font-size: .75rem; color: var(--ui-text-muted, #888); }
.metric strong { font-size: 1.3rem; }
.w-20 { width: 5rem; }
</style>
