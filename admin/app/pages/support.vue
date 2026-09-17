<script setup lang="ts">
import { io, type Socket } from 'socket.io-client'

definePageMeta({ layout: 'default' })

type ConversationStatus = 'WAITING' | 'OPEN' | 'WAITING_USER' | 'CLOSED'
type SenderRole = 'AFFILIATE' | 'AGENT'
const SUPPORT_AGENT_MAX_CAPACITY = 50

interface SupportMessage {
  id: string
  conversationId: string
  senderId: string
  senderRole: SenderRole
  senderName: string
  content: string
  readAt: string | null
  createdAt: string
}

interface SupportAssignment {
  id: string
  conversationId: string
  agentId: string
  agentName: string
  agentEmail: string
  assignedAt: string
  releasedAt: string | null
}

interface SupportConversation {
  id: string
  affiliateId: string
  affiliateName: string
  affiliateEmail: string
  agentId: string | null
  agentName: string | null
  agentEmail: string | null
  status: ConversationStatus
  subject: string | null
  closedAt: string | null
  closedByRole: string | null
  createdAt: string
  updatedAt: string
  messages?: SupportMessage[]
  messagesTotal?: number
  messagesPage?: number
  messagesLimit?: number
  assignments?: SupportAssignment[]
}

interface ConversationListResponse {
  data: SupportConversation[]
  total: number
  page: number
  limit: number
}

interface AgentAvailability {
  agentId: string
  agentName: string
  agentEmail: string
  isOnline: boolean
  activeConversations: number
}

const { authHeaders, token } = useAuth()
const apiBase = useApiBase()
const config = useRuntimeConfig()
const toast = useToast()

const businessHoursBypass = ref(false)
const loading = ref(false)
const detailLoading = ref(false)
const conversations = ref<SupportConversation[]>([])
const selected = ref<SupportConversation | null>(null)
const agents = ref<AgentAvailability[]>([])
const total = ref(0)
const page = ref(1)
const limit = ref(50)
const messagesPage = ref(1)
const messagesLimit = ref(100)
const statusFilter = ref<'ALL' | ConversationStatus>('ALL')
const agentFilter = ref('ALL')
const affiliateFilter = ref('')
const manualAgentId = ref('')
const assigning = ref(false)
const socket = shallowRef<Socket | null>(null)
let socketRefreshTimer: ReturnType<typeof setTimeout> | null = null
let affiliateFilterTimer: ReturnType<typeof setTimeout> | null = null
let pendingConversationRefreshId: string | null = null

const statusOptions = [
  { label: 'Todos', value: 'ALL' },
  { label: 'Na fila', value: 'WAITING' },
  { label: 'Em atendimento', value: 'OPEN' },
  { label: 'Aguardando afiliado', value: 'WAITING_USER' },
  { label: 'Encerrados', value: 'CLOSED' }
]

const agentOptions = computed(() => [
  { label: 'Todos os suportes', value: 'ALL' },
  ...agents.value.map(agent => ({
    label: agent.agentName,
    value: agent.agentId
  }))
])

const manualAgentOptions = computed(() => agents.value.map(agent => ({
  label: `${agent.agentName} · ${agent.activeConversations}/${SUPPORT_AGENT_MAX_CAPACITY} atendimento(s)${agent.isOnline ? ' · online' : ' · offline'}`,
  value: agent.agentId,
  disabled: agent.activeConversations >= SUPPORT_AGENT_MAX_CAPACITY && agent.agentId !== selected.value?.agentId
})))

const selectedMessages = computed(() => selected.value?.messages ?? [])
const selectedAssignments = computed(() => selected.value?.assignments ?? [])
const messagesTotal = computed(() => selected.value?.messagesTotal ?? selectedMessages.value.length)
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / limit.value)))
const messageTotalPages = computed(() => Math.max(1, Math.ceil(messagesTotal.value / messagesLimit.value)))

const fmtDate = (value: string | null) =>
  value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '-'

const statusLabel = (status: ConversationStatus) => {
  if (status === 'WAITING') return 'Na fila'
  if (status === 'OPEN') return 'Em atendimento'
  if (status === 'WAITING_USER') return 'Aguardando afiliado'
  return 'Encerrado'
}

function statusColor(status: ConversationStatus) {
  if (status === 'OPEN') return 'success'
  if (status === 'WAITING') return 'warning'
  if (status === 'WAITING_USER') return 'info'
  return 'neutral'
}

function messageLabel(role: SenderRole) {
  return role === 'AFFILIATE' ? 'Afiliado' : 'Suporte'
}

function clearAffiliateFilter() {
  affiliateFilter.value = ''
}

function errorMessage(err: unknown): string {
  const e = err as {
    data?: { detail?: string, message?: string | string[] }
    message?: string
  }
  if (e?.data?.detail) return e.data.detail
  const m = e?.data?.message
  if (Array.isArray(m)) return m.join('; ')
  return m || e?.message || 'Erro inesperado'
}

async function loadAgents() {
  agents.value = await $fetch<AgentAvailability[]>(`${apiBase}/v1/admin/support/agents/availability`, {
    headers: authHeaders(),
    credentials: 'include'
  })
}

async function loadConversations(nextPage = page.value) {
  loading.value = true
  page.value = nextPage
  try {
    const res = await $fetch<ConversationListResponse>(`${apiBase}/v1/admin/support/conversations`, {
      headers: authHeaders(),
      credentials: 'include',
      query: {
        page: page.value,
        limit: limit.value,
        status: statusFilter.value === 'ALL' ? undefined : statusFilter.value,
        agentId: agentFilter.value === 'ALL' ? undefined : agentFilter.value,
        affiliateSearch: affiliateFilter.value.trim() || undefined
      }
    })
    conversations.value = res.data
    total.value = res.total
    if (selected.value && !res.data.some(item => item.id === selected.value?.id)) {
      selected.value = null
    }
    if (!selected.value && res.data[0]) await selectConversation(res.data[0])
  } catch (err: unknown) {
    toast.add({ title: 'Erro ao carregar conversas', description: errorMessage(err), color: 'error' })
  } finally {
    loading.value = false
  }
}

async function selectConversation(conversation: SupportConversation, nextMessagesPage = 1) {
  detailLoading.value = true
  messagesPage.value = nextMessagesPage
  try {
    selected.value = await $fetch<SupportConversation>(`${apiBase}/v1/admin/support/conversations/${conversation.id}`, {
      headers: authHeaders(),
      credentials: 'include',
      query: {
        messagesPage: messagesPage.value,
        messagesLimit: messagesLimit.value
      }
    })
    manualAgentId.value = selected.value.agentId ?? agents.value[0]?.agentId ?? ''
  } catch (err: unknown) {
    toast.add({ title: 'Erro ao abrir conversa', description: errorMessage(err), color: 'error' })
  } finally {
    detailLoading.value = false
  }
}

async function assignSelectedConversation() {
  if (!selected.value || !manualAgentId.value) return

  assigning.value = true
  try {
    const updated = await $fetch<SupportConversation>(`${apiBase}/v1/admin/support/conversations/${selected.value.id}/assign`, {
      method: 'PATCH',
      headers: authHeaders(),
      credentials: 'include',
      body: { agentId: manualAgentId.value }
    })
    selected.value = updated
    manualAgentId.value = updated.agentId ?? manualAgentId.value
    toast.add({
      title: 'Atendimento atribuído',
      description: updated.agentName ? `Agora com ${updated.agentName}.` : undefined,
      color: 'success'
    })
    await Promise.all([loadAgents(), loadConversations(page.value)])
    await selectConversation(updated, messagesPage.value)
  } catch (err: unknown) {
    toast.add({ title: 'Erro ao atribuir suporte', description: errorMessage(err), color: 'error' })
  } finally {
    assigning.value = false
  }
}

async function loadBusinessHoursBypass() {
  try {
    const res = await $fetch<{ bypassEnabled: boolean }>(`${apiBase}/v1/admin/support/business-hours`, {
      headers: authHeaders(),
      credentials: 'include'
    })
    businessHoursBypass.value = res.bypassEnabled
  } catch {}
}

async function toggleBusinessHoursBypass() {
  const next = !businessHoursBypass.value
  try {
    const res = await $fetch<{ bypassEnabled: boolean }>(`${apiBase}/v1/admin/support/business-hours/bypass`, {
      method: 'POST',
      headers: authHeaders(),
      credentials: 'include',
      body: { enabled: next }
    })
    businessHoursBypass.value = res.bypassEnabled
    toast.add({
      title: res.bypassEnabled ? 'Horário comercial desativado' : 'Horário comercial ativado',
      description: res.bypassEnabled
        ? 'Afiliados podem abrir chamados a qualquer hora.'
        : 'Restrição de horário restaurada.',
      color: 'success'
    })
  } catch (err: unknown) {
    toast.add({ title: 'Erro ao alterar horário comercial', description: errorMessage(err), color: 'error' })
  }
}

async function refresh() {
  await Promise.all([loadAgents(), loadConversations(), loadBusinessHoursBypass()])
}

function resolveSocketUrl() {
  const explicit = config.public.socketUrl as string | undefined
  if (explicit) return explicit
  if (typeof window === 'undefined') return undefined
  
  const apiUrl = (config.public.apiUrl as string) || ''
  if (apiUrl.startsWith('http')) {
    try {
      return new URL(apiUrl).origin
    } catch {}
  }
  
  if (import.meta.dev) {
    return `${window.location.protocol}//${window.location.hostname}:3011`
  }
  
  return window.location.origin
}

function connectSocket() {
  if (!token.value || socket.value?.connected) return

  socket.value = io(`${resolveSocketUrl()}/support`, {
    auth: { token: token.value },
    path: '/api/socket.io',
    transports: ['websocket', 'polling']
  })

  const scheduleRefresh = (conversationId?: string) => {
    if (conversationId && selected.value?.id === conversationId) {
      pendingConversationRefreshId = conversationId
    }
    if (socketRefreshTimer) return
    socketRefreshTimer = setTimeout(() => {
      socketRefreshTimer = null
      const selectedConversation = selected.value
      const shouldRefreshSelected =
        Boolean(pendingConversationRefreshId)
        && selectedConversation?.id === pendingConversationRefreshId
      pendingConversationRefreshId = null

      void loadConversations(page.value)
      if (shouldRefreshSelected && selectedConversation) {
        void selectConversation(selectedConversation, messagesPage.value)
      }
    }, 250)
  }
  const reloadList = () => scheduleRefresh()
  const reloadConversation = (conversation: SupportConversation) => {
    scheduleRefresh(conversation.id)
  }
  socket.value.on('conversation:created', reloadList)
  socket.value.on('conversation:assigned', reloadConversation)
  socket.value.on('conversation:updated', reloadConversation)
  socket.value.on('conversation:closed', reloadConversation)
  socket.value.on('message:new', (message: SupportMessage) => {
    scheduleRefresh(message.conversationId)
  })
  socket.value.on('agent:status-changed', () => {
    void loadAgents()
  })
}

function disconnectSocket() {
  if (socketRefreshTimer) {
    clearTimeout(socketRefreshTimer)
    socketRefreshTimer = null
  }
  if (affiliateFilterTimer) {
    clearTimeout(affiliateFilterTimer)
    affiliateFilterTimer = null
  }
  pendingConversationRefreshId = null
  socket.value?.disconnect()
  socket.value = null
}

watch([statusFilter, agentFilter], () => loadConversations(1))

watch(affiliateFilter, () => {
  if (affiliateFilterTimer) clearTimeout(affiliateFilterTimer)
  affiliateFilterTimer = setTimeout(() => {
    void loadConversations(1)
  }, 350)
})

watch(agents, () => {
  if (!manualAgentId.value && agents.value[0]) {
    manualAgentId.value = agents.value[0].agentId
  }
})

onMounted(async () => {
  connectSocket()
  await refresh()
})

onUnmounted(disconnectSocket)
</script>

<template>
  <div class="admin-page space-y-5">
    <div class="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <h1 class="text-2xl font-black text-highlighted">
          Suporte
        </h1>
        <p class="text-sm text-muted">
          Conversas registradas, histórico de mensagens e identificação do suporte responsável.
        </p>
      </div>
      <div class="grid gap-2 sm:grid-cols-2 lg:flex lg:items-center">
        <UInput
          v-model="affiliateFilter"
          icon="i-lucide-search"
          placeholder="Filtrar afiliado"
          class="w-full sm:col-span-2 lg:w-64"
        >
          <template v-if="affiliateFilter" #trailing>
            <UButton
              icon="i-lucide-x"
              color="neutral"
              variant="ghost"
              size="xs"
              @click="clearAffiliateFilter"
            />
          </template>
        </UInput>
        <USelect
          v-model="statusFilter"
          :items="statusOptions"
          value-key="value"
          class="w-full lg:w-44"
        />
        <USelect
          v-model="agentFilter"
          :items="agentOptions"
          value-key="value"
          class="w-full lg:w-56"
        />
        <UButton
          :icon="businessHoursBypass ? 'i-lucide-clock-off' : 'i-lucide-clock'"
          :color="businessHoursBypass ? 'warning' : 'neutral'"
          variant="soft"
          @click="toggleBusinessHoursBypass"
        >
          {{ businessHoursBypass ? 'Horário: OFF' : 'Horário: ON' }}
        </UButton>
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="soft"
          :loading="loading"
          @click="refresh"
        >
          Atualizar
        </UButton>
      </div>
    </div>

    <div class="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
      <section class="admin-section overflow-hidden">
        <div class="border-b px-4 py-3" style="border-color: var(--color-border)">
          <div class="flex items-center justify-between gap-3">
            <div>
              <h2 class="text-sm font-bold text-highlighted">
                Todas as conversas
              </h2>
              <p class="text-xs text-muted">
                {{ total }} atendimento(s) encontrado(s)
              </p>
            </div>
          </div>
        </div>

        <div class="table-scroll desk-only">
          <table class="admin-table">
            <thead>
              <tr>
                <th>Atualizado</th>
                <th>Afiliado</th>
                <th>Suporte</th>
                <th>Status</th>
                <th>Assunto</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="loading">
                <td colspan="5" class="text-muted">
                  Carregando conversas...
                </td>
              </tr>
              <tr v-else-if="!conversations.length">
                <td colspan="5" class="text-muted">
                  Nenhuma conversa encontrada.
                </td>
              </tr>
              <tr
                v-for="conversation in conversations"
                v-else
                :key="conversation.id"
                class="cursor-pointer transition-colors hover:bg-[var(--ui-bg-muted)]"
                :class="{ 'bg-[var(--ui-bg-muted)]': selected?.id === conversation.id }"
                @click="selectConversation(conversation)"
              >
                <td class="text-muted whitespace-nowrap">
                  {{ fmtDate(conversation.updatedAt) }}
                </td>
                <td>
                  <p class="font-bold text-highlighted">
                    {{ conversation.affiliateName }}
                  </p>
                  <p class="text-xs text-muted">
                    {{ conversation.affiliateEmail }}
                  </p>
                </td>
                <td>
                  <p class="font-bold text-highlighted">
                    {{ conversation.agentName || 'Sem suporte' }}
                  </p>
                  <p class="text-xs text-muted">
                    {{ conversation.agentEmail || 'Aguardando atribuição' }}
                  </p>
                </td>
                <td>
                  <UBadge :color="statusColor(conversation.status)" variant="soft">
                    {{ statusLabel(conversation.status) }}
                  </UBadge>
                </td>
                <td class="text-muted">
                  {{ conversation.subject || 'Suporte pelo painel' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="mob-only">
          <div v-if="loading" class="p-6 text-center text-sm text-muted">
            Carregando conversas...
          </div>
          <div v-else-if="!conversations.length" class="p-8 text-center text-sm text-muted">
            Nenhuma conversa encontrada.
          </div>
          <button
            v-for="conversation in conversations"
            v-else
            :key="conversation.id + '-mobile'"
            class="mob-card w-full text-left"
            :style="selected?.id === conversation.id ? 'background: var(--color-surface-elevated)' : ''"
            @click="selectConversation(conversation)"
          >
            <div class="mob-card-row mb-2">
              <div class="min-w-0">
                <p class="truncate font-bold text-highlighted">
                  {{ conversation.affiliateName }}
                </p>
                <p class="truncate text-xs text-muted">
                  {{ conversation.affiliateEmail }}
                </p>
              </div>
              <UBadge :color="statusColor(conversation.status)" variant="soft">
                {{ statusLabel(conversation.status) }}
              </UBadge>
            </div>
            <div class="text-xs text-muted">
              Suporte: {{ conversation.agentName || 'Sem suporte' }}
            </div>
          </button>
        </div>
        <div class="flex items-center justify-between border-t px-4 py-3" style="border-color: var(--color-border)">
          <p class="text-xs text-muted">
            Página {{ page }} / {{ totalPages }}
          </p>
          <UPagination
            v-model:page="page"
            :total="total"
            :items-per-page="limit"
            @update:page="loadConversations($event)"
          />
        </div>
      </section>

      <section class="admin-section min-h-[520px] overflow-hidden">
        <div class="border-b px-4 py-3" style="border-color: var(--color-border)">
          <h2 class="text-sm font-bold text-highlighted">
            Detalhes do atendimento
          </h2>
          <p class="text-xs text-muted">
            Histórico salvo da conversa selecionada.
          </p>
        </div>

        <div v-if="detailLoading" class="p-6 text-center text-sm text-muted">
          Carregando atendimento...
        </div>
        <div v-else-if="!selected" class="flex min-h-[420px] items-center justify-center p-8 text-center text-sm text-muted">
          Selecione uma conversa para ver mensagens e suporte responsável.
        </div>
        <div v-else class="flex max-h-[calc(100vh-12rem)] min-h-[520px] flex-col">
          <div class="space-y-3 border-b p-4" style="border-color: var(--color-border)">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="truncate text-base font-black text-highlighted">
                  {{ selected.affiliateName }}
                </p>
                <p class="truncate text-xs text-muted">
                  {{ selected.affiliateEmail }}
                </p>
              </div>
              <UBadge :color="statusColor(selected.status)" variant="soft">
                {{ statusLabel(selected.status) }}
              </UBadge>
            </div>
            <div
              v-if="selected.status !== 'CLOSED'"
              class="rounded-lg border p-3"
              style="border-color: var(--color-border); background: var(--color-surface-elevated)"
            >
              <p class="mb-2 text-xs font-bold uppercase text-muted">
                Escolher suporte responsável
              </p>
              <div class="flex flex-col gap-2 sm:flex-row">
                <USelect
                  v-model="manualAgentId"
                  :items="manualAgentOptions"
                  value-key="value"
                  class="min-w-0 flex-1"
                  placeholder="Selecione um suporte"
                />
                <UButton
                  icon="i-lucide-user-check"
                  color="primary"
                  :loading="assigning"
                  :disabled="!manualAgentId || manualAgentId === selected.agentId"
                  @click="assignSelectedConversation"
                >
                  Atribuir
                </UButton>
              </div>
            </div>
            <div class="grid gap-2 text-xs sm:grid-cols-2">
              <div>
                <p class="mob-card-label">Suporte atual</p>
                <p class="font-bold text-highlighted">
                  {{ selected.agentName || 'Sem suporte atribuído' }}
                </p>
                <p class="text-muted">
                  {{ selected.agentEmail || '-' }}
                </p>
              </div>
              <div>
                <p class="mob-card-label">Encerramento</p>
                <p class="font-bold text-highlighted">
                  {{ selected.closedAt ? fmtDate(selected.closedAt) : 'Aberto' }}
                </p>
                <p class="text-muted">
                  {{ selected.closedByRole ? `por ${selected.closedByRole}` : '-' }}
                </p>
              </div>
            </div>
          </div>

          <div class="border-b p-4" style="border-color: var(--color-border)">
            <h3 class="mb-2 text-xs font-bold uppercase text-muted">
              Histórico de suporte
            </h3>
            <div v-if="!selectedAssignments.length" class="text-xs text-muted">
              Nenhuma atribuição registrada.
            </div>
            <div v-else class="space-y-2">
              <div
                v-for="assignment in selectedAssignments"
                :key="assignment.id"
                class="rounded-lg border p-3 text-xs"
                style="border-color: var(--color-border); background: var(--color-surface-elevated)"
              >
                <p class="font-bold text-highlighted">
                  {{ assignment.agentName }}
                </p>
                <p class="text-muted">
                  {{ assignment.agentEmail }}
                </p>
                <p class="mt-1 text-muted">
                  {{ fmtDate(assignment.assignedAt) }} até {{ assignment.releasedAt ? fmtDate(assignment.releasedAt) : 'agora' }}
                </p>
              </div>
            </div>
          </div>

          <div class="flex-1 space-y-3 overflow-y-auto p-4">
            <div v-if="!selectedMessages.length" class="py-8 text-center text-sm text-muted">
              Nenhuma mensagem registrada.
            </div>
            <div
              v-for="message in selectedMessages"
              :key="message.id"
              class="rounded-lg border p-3"
              :style="{
                borderColor: 'var(--color-border)',
                background: message.senderRole === 'AGENT' ? 'var(--color-surface-elevated)' : 'transparent'
              }"
            >
              <div class="mb-2 flex items-center justify-between gap-3">
                <div class="min-w-0">
                  <p class="truncate text-sm font-bold text-highlighted">
                    {{ message.senderName }}
                  </p>
                  <p class="text-xs text-muted">
                    {{ messageLabel(message.senderRole) }}
                  </p>
                </div>
                <span class="shrink-0 text-xs text-muted">
                  {{ fmtDate(message.createdAt) }}
                </span>
              </div>
              <p class="whitespace-pre-wrap text-sm leading-relaxed text-highlighted">
                {{ message.content }}
              </p>
            </div>
          </div>
          <div
            class="flex items-center justify-between border-t px-4 py-3"
            style="border-color: var(--color-border)"
          >
            <p class="text-xs text-muted">
              {{ messagesTotal }} mensagem(ns) · página {{ messagesPage }} / {{ messageTotalPages }}
            </p>
            <UPagination
              v-model:page="messagesPage"
              :total="messagesTotal"
              :items-per-page="messagesLimit"
              @update:page="selected && selectConversation(selected, $event)"
            />
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
