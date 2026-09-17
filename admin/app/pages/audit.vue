<script setup lang="ts">
definePageMeta({ layout: 'default' })

interface AuditLog {
  id: string
  userId: string
  userName: string
  userEmail: string
  action: string
  resource: string
  method: string
  path: string
  ip: string
  userAgent: string
  statusCode: number
  details: Record<string, unknown> | null
  createdAt: string
}

const { authHeaders } = useAuth()
const apiBase = useApiBase()

const loading = ref(false)
const logs = ref<AuditLog[]>([])
const total = ref(0)
const page = ref(1)
const limit = ref(30)
const search = ref('')
const methodFilter = ref('all')
const expandedId = ref<string | null>(null)
let searchTimer: ReturnType<typeof setTimeout> | null = null

const methodOptions = [
  { label: 'Todos', value: 'all' },
  { label: 'GET', value: 'GET' },
  { label: 'POST', value: 'POST' },
  { label: 'PUT', value: 'PUT' },
  { label: 'PATCH', value: 'PATCH' },
  { label: 'DELETE', value: 'DELETE' }
]

const fmtDate = (value: string) =>
  new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

function methodColor(method: string): string {
  switch (method) {
    case 'GET': return 'info'
    case 'POST': return 'success'
    case 'PUT': return 'warning'
    case 'PATCH': return 'warning'
    case 'DELETE': return 'error'
    default: return 'neutral'
  }
}

function statusColor(code: number): string {
  if (code >= 200 && code < 300) return 'text-green-500'
  if (code >= 400 && code < 500) return 'text-yellow-500'
  if (code >= 500) return 'text-red-500'
  return 'text-muted'
}

watch(search, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => load(1), 350)
})

watch(methodFilter, () => load(1))

async function load(nextPage = page.value) {
  loading.value = true
  page.value = nextPage
  expandedId.value = null
  try {
    const res = await $fetch<{ data: AuditLog[], total: number }>(`${apiBase}/admin/audit-logs`, {
      headers: authHeaders(),
      query: {
        page: page.value,
        limit: limit.value,
        search: search.value || undefined,
        method: methodFilter.value === 'all' ? undefined : methodFilter.value
      }
    })
    logs.value = res.data
    total.value = res.total
  } finally {
    loading.value = false
  }
}

function toggleExpand(log: AuditLog) {
  expandedId.value = expandedId.value === log.id ? null : log.id
}

const expandedLog = computed(() =>
  logs.value.find(l => l.id === expandedId.value) || null
)

onMounted(() => load())
</script>

<template>
  <div class="admin-page space-y-5">
    <div class="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <h1 class="text-2xl font-black text-highlighted">
          Auditoria
        </h1>
        <p class="text-sm text-muted">
          Consulta de ações sensíveis, aprovações, bloqueios e visualizações de CPF.
        </p>
      </div>
      <div class="flex flex-col gap-2 sm:flex-row">
        <UInput
          v-model="search"
          icon="i-lucide-search"
          placeholder="Buscar por ação, e-mail ou recurso"
          class="w-full sm:w-72"
        />
        <USelect
          v-model="methodFilter"
          :items="methodOptions"
          value-key="value"
          class="w-full sm:w-36"
        />
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="soft"
          :loading="loading"
          @click="load()"
        >
          Atualizar
        </UButton>
      </div>
    </div>

    <section class="admin-section overflow-hidden">
      <!-- Desktop table -->
      <div class="table-scroll desk-only">
        <table class="admin-table">
          <thead>
            <tr>
              <th>Data</th>
              <th>Usuário</th>
              <th>Ação</th>
              <th>Recurso</th>
              <th>Método</th>
              <th>Status Code</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td
                colspan="6"
                class="text-muted"
              >
                Carregando logs...
              </td>
            </tr>
            <tr v-else-if="!logs.length">
              <td
                colspan="6"
                class="text-muted"
              >
                Nenhum registro encontrado.
              </td>
            </tr>
            <tr
              v-for="log in logs"
              v-else
              :key="log.id"
              class="cursor-pointer transition-colors hover:bg-[var(--ui-bg-muted)]"
              :class="{ 'bg-[var(--ui-bg-muted)]': expandedId === log.id }"
              @click="toggleExpand(log)"
            >
              <td class="text-muted whitespace-nowrap">
                {{ fmtDate(log.createdAt) }}
              </td>
              <td>
                <p class="font-bold text-highlighted">
                  {{ log.userName }}
                </p>
                <p class="text-xs text-muted">
                  {{ log.userEmail }}
                </p>
              </td>
              <td class="font-mono text-xs">
                {{ log.action }}
              </td>
              <td class="text-muted">
                {{ log.resource }}
              </td>
              <td>
                <UBadge
                  :color="methodColor(log.method)"
                  variant="soft"
                >
                  {{ log.method }}
                </UBadge>
              </td>
              <td>
                <span
                  class="font-mono font-bold"
                  :class="statusColor(log.statusCode)"
                >
                  {{ log.statusCode }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Mobile card list -->
      <div class="mob-only">
        <div
          v-if="loading"
          style="text-align: center; padding: 24px; color: var(--color-text-muted); font-size: 13px"
        >
          Carregando logs...
        </div>
        <div
          v-else-if="!logs.length"
          style="text-align: center; padding: 32px; color: var(--color-text-muted); font-size: 13px"
        >
          Nenhum registro encontrado.
        </div>
        <div
          v-for="log in logs"
          v-else
          :key="log.id + '-mob'"
          class="mob-card cursor-pointer"
          :style="expandedId === log.id ? 'background: var(--color-surface-elevated)' : ''"
          @click="toggleExpand(log)"
        >
          <div class="mob-card-row mb-1">
            <div class="flex items-center gap-2 min-w-0">
              <UBadge
                :color="methodColor(log.method)"
                variant="soft"
              >
                {{ log.method }}
              </UBadge>
              <span
                class="font-mono text-xs truncate"
                style="color: var(--color-text-secondary)"
              >
                {{ log.action }}
              </span>
            </div>
            <span
              class="font-mono font-bold shrink-0"
              :class="statusColor(log.statusCode)"
            >
              {{ log.statusCode }}
            </span>
          </div>
          <div style="font-size: 12px; font-weight: 600">
            {{ log.userName }}
          </div>
          <div style="font-size: 10.5px; color: var(--color-text-muted)">
            {{ log.userEmail }} · {{ fmtDate(log.createdAt) }}
          </div>
        </div>
      </div>
    </section>

    <div class="flex items-center justify-between">
      <p class="text-xs text-muted">
        {{ total }} registros
      </p>
      <UPagination
        v-model:page="page"
        :total="total"
        :items-per-page="limit"
        @update:page="load($event)"
      />
    </div>

    <UCard v-if="expandedLog">
      <template #header>
        <div class="flex items-center justify-between">
          <h2 class="font-bold text-highlighted">
            Detalhes do Log
          </h2>
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            @click="expandedId = null"
          />
        </div>
      </template>
      <div class="space-y-3">
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p class="text-xs font-semibold text-muted uppercase">
              Usuário
            </p>
            <p class="text-sm text-highlighted">
              {{ expandedLog.userName }}
            </p>
            <p class="text-xs text-muted">
              {{ expandedLog.userEmail }}
            </p>
          </div>
          <div>
            <p class="text-xs font-semibold text-muted uppercase">
              Path
            </p>
            <p class="text-sm font-mono">
              {{ expandedLog.path }}
            </p>
          </div>
          <div>
            <p class="text-xs font-semibold text-muted uppercase">
              IP
            </p>
            <p class="text-sm font-mono">
              {{ expandedLog.ip }}
            </p>
          </div>
          <div>
            <p class="text-xs font-semibold text-muted uppercase">
              User Agent
            </p>
            <p class="text-sm text-muted truncate max-w-xs">
              {{ expandedLog.userAgent }}
            </p>
          </div>
        </div>
        <div v-if="expandedLog.details">
          <p class="text-xs font-semibold text-muted uppercase mb-1">
            Detalhes (JSON)
          </p>
          <pre class="rounded-lg bg-[var(--ui-bg-muted)] p-3 text-xs overflow-x-auto">{{ JSON.stringify(expandedLog.details, null, 2) }}</pre>
        </div>
        <p
          v-else
          class="text-sm text-muted"
        >
          Sem detalhes adicionais.
        </p>
      </div>
    </UCard>
  </div>
</template>
