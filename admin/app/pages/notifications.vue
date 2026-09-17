<script setup lang="ts">
definePageMeta({ layout: 'default' })

interface AffiliateOption {
  id: string
  name: string
  email: string
}

interface SentBroadcast {
  id: string
  segment: string
  title: string
  message: string
  recipients: number
  sentAt: string
}

const { authHeaders } = useAuth()
const apiBase = useApiBase()
const toast = useToast()

const affiliates = ref<AffiliateOption[]>([])
const affiliatesLoading = ref(false)

const segment = ref<'all' | 'direct'>('all')
const selectedUserId = ref('')
const title = ref('')
const message = ref('')
const sending = ref(false)
const showConfirm = ref(false)

const sentHistory = ref<SentBroadcast[]>([])

// Client-side search over session history
const historySearch = ref('')
const filteredHistory = computed(() => {
  const q = historySearch.value.trim().toLowerCase()
  if (!q) return sentHistory.value
  return sentHistory.value.filter(h =>
    h.title.toLowerCase().includes(q)
    || h.message.toLowerCase().includes(q)
    || h.segment.toLowerCase().includes(q)
  )
})

const affiliateItems = computed(() =>
  affiliates.value.map(a => ({
    label: `${a.name} (${a.email})`,
    value: a.id
  }))
)

const recipientsCount = computed(() => {
  if (segment.value === 'direct') return selectedUserId.value ? 1 : 0
  return affiliates.value.length
})

const segmentLabel = computed(() => {
  if (segment.value === 'direct') {
    const aff = affiliates.value.find(a => a.id === selectedUserId.value)
    return aff ? aff.name : 'Afiliado específico'
  }
  return 'Todos os afiliados ativos'
})

const canSend = computed(() => {
  if (!title.value.trim() || !message.value.trim()) return false
  if (segment.value === 'direct') return !!selectedUserId.value
  return true
})

async function loadAffiliates() {
  affiliatesLoading.value = true
  try {
    const res = await $fetch<{ data: AffiliateOption[] }>(`${apiBase}/v1/admin/affiliates`, {
      headers: authHeaders(),
      query: { page: 1, limit: 100, role: 'AFFILIATE' }
    })
    affiliates.value = res.data
  } catch {
    toast.add({ title: 'Erro ao carregar afiliados', color: 'error' })
  } finally {
    affiliatesLoading.value = false
  }
}

function openConfirm() {
  if (!canSend.value) {
    toast.add({ title: 'Preencha todos os campos', color: 'warning' })
    return
  }
  showConfirm.value = true
}

async function send() {
  sending.value = true
  try {
    if (segment.value === 'direct') {
      await $fetch(`${apiBase}/v1/admin/notifications`, {
        method: 'POST',
        headers: authHeaders(),
        body: {
          userId: selectedUserId.value,
          type: 'GENERAL',
          title: title.value.trim(),
          message: message.value.trim()
        }
      })
    } else {
      await $fetch(`${apiBase}/v1/admin/notifications/broadcast`, {
        method: 'POST',
        headers: authHeaders(),
        body: {
          type: 'GENERAL',
          title: title.value.trim(),
          message: message.value.trim()
        }
      })
    }
    sentHistory.value.unshift({
      id: Math.random().toString(36).slice(2, 9),
      segment: segmentLabel.value,
      title: title.value.trim(),
      message: message.value.trim(),
      recipients: recipientsCount.value,
      sentAt: new Date().toISOString()
    })
    toast.add({
      title: segment.value === 'direct' ? 'Notificação enviada' : 'Broadcast enviado para todos os afiliados',
      color: 'success',
      icon: 'i-lucide-check'
    })
    title.value = ''
    message.value = ''
    selectedUserId.value = ''
    showConfirm.value = false
  } catch {
    toast.add({ title: 'Erro ao enviar', color: 'error' })
  } finally {
    sending.value = false
  }
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

onMounted(() => loadAffiliates())
</script>

<template>
  <div class="page-wrap fade-up">
    <div class="notifications-grid grid gap-4">
      <!-- COMPOSE -->
      <section
        class="card-vex"
        style="padding: 24px"
      >
        <div style="font-size: 17px; font-weight: 800; margin-bottom: 4px">
          Novo broadcast
        </div>
        <div
          style="font-size: 12px; margin-bottom: 18px; color: var(--color-text-muted)"
        >
          Envie notificação push e e-mail para os afiliados.
        </div>

        <label
          class="label-kicker"
          style="display: block; margin-bottom: 6px"
        >
          Segmento
        </label>
        <div
          class="flex gap-1 mb-3"
          style="background: var(--color-surface-2); border: 1px solid var(--color-border); padding: 3px; border-radius: 10px"
        >
          <button
            class="font-semibold transition-colors"
            :style="{
              flex: 1,
              padding: '8px 12px',
              fontSize: '12px',
              borderRadius: '7px',
              background: segment === 'all' ? 'var(--color-surface-elevated)' : 'transparent',
              color: segment === 'all' ? '#fff' : 'var(--color-text-secondary)'
            }"
            @click="segment = 'all'"
          >
            Todos os afiliados
          </button>
          <button
            class="font-semibold transition-colors"
            :style="{
              flex: 1,
              padding: '8px 12px',
              fontSize: '12px',
              borderRadius: '7px',
              background: segment === 'direct' ? 'var(--color-surface-elevated)' : 'transparent',
              color: segment === 'direct' ? '#fff' : 'var(--color-text-secondary)'
            }"
            @click="segment = 'direct'"
          >
            Afiliado específico
          </button>
        </div>

        <template v-if="segment === 'direct'">
          <label
            class="label-kicker"
            style="display: block; margin-bottom: 6px"
          >
            Afiliado
          </label>
          <USelect
            v-model="selectedUserId"
            :items="affiliateItems"
            value-key="value"
            placeholder="Selecione um afiliado..."
            :loading="affiliatesLoading"
            class="w-full mb-3"
          />
        </template>

        <label
          class="label-kicker"
          style="display: block; margin-bottom: 6px"
        >
          Título
        </label>
        <input
          v-model="title"
          class="vex-input"
          placeholder="Ex: Novo deal disponível"
          :maxlength="200"
          style="margin-bottom: 12px"
        >

        <label
          class="label-kicker"
          style="display: block; margin-bottom: 6px"
        >
          Mensagem
        </label>
        <textarea
          v-model="message"
          class="vex-textarea"
          placeholder="Conteúdo da notificação..."
          :rows="5"
          :maxlength="2000"
          style="margin-bottom: 18px"
        />

        <div
          class="flex items-center gap-2.5"
          style="padding: 12px; background: rgba(124,58,237,0.06); border: 1px solid var(--color-purple-border); border-radius: 8px; margin-bottom: 16px"
        >
          <UIcon
            name="i-lucide-radio-tower"
            class="size-4"
            style="color: #A78BFA"
          />
          <div
            style="font-size: 12px; color: var(--color-text-secondary)"
          >
            <strong style="color: #fff">{{ recipientsCount }} {{ recipientsCount === 1 ? 'afiliado receberá' : 'afiliados receberão' }}</strong>
            · {{ segmentLabel }}
          </div>
        </div>

        <div class="flex gap-2">
          <button
            class="btn btn-ghost btn-sm"
            style="flex: 1"
            :disabled="!title && !message"
            @click="title = ''; message = ''; selectedUserId = ''"
          >
            Limpar
          </button>
          <button
            class="btn btn-gold btn-sm"
            style="flex: 1"
            :disabled="!canSend"
            @click="openConfirm"
          >
            <UIcon
              name="i-lucide-radio-tower"
              class="size-3.5"
            />
            Enviar broadcast
          </button>
        </div>
      </section>

      <!-- HISTORY -->
      <section
        class="card-vex"
        style="overflow: hidden"
      >
        <div
          class="flex items-center justify-between"
          style="padding: 14px 18px; border-bottom: 1px solid var(--color-border)"
        >
          <div>
            <div style="font-size: 14px; font-weight: 700">
              Histórico de broadcasts
            </div>
            <div
              style="font-size: 11px; margin-top: 2px; color: var(--color-text-muted)"
            >
              Envios desta sessão
            </div>
          </div>
          <span class="badge badge-purple">{{ filteredHistory.length }} / {{ sentHistory.length }}</span>
        </div>

        <!-- Search filter -->
        <div
          v-if="sentHistory.length"
          style="padding: 12px 18px; border-bottom: 1px solid var(--color-border)"
        >
          <div class="relative">
            <UIcon
              name="i-lucide-search"
              class="absolute size-3.5"
              style="left: 12px; top: 50%; transform: translateY(-50%); color: var(--color-text-muted)"
            />
            <input
              v-model="historySearch"
              class="vex-input"
              placeholder="Buscar por título, mensagem ou segmento..."
              style="padding-left: 36px; padding-right: 36px"
            >
            <button
              v-if="historySearch"
              class="absolute"
              style="right: 8px; top: 50%; transform: translateY(-50%); width: 22px; height: 22px; border-radius: 6px; display: grid; place-items: center; color: var(--color-text-muted)"
              title="Limpar"
              @click="historySearch = ''"
            >
              <UIcon
                name="i-lucide-x"
                class="size-3.5"
              />
            </button>
          </div>
        </div>

        <div
          v-if="!sentHistory.length"
          class="text-center"
          style="padding: 56px 24px"
        >
          <UIcon
            name="i-lucide-radio-tower"
            class="size-12 mx-auto"
            style="color: var(--color-text-muted); opacity: 0.4"
          />
          <p
            style="font-size: 13px; font-weight: 600; margin-top: 12px; color: var(--color-text-secondary)"
          >
            Nenhum broadcast enviado ainda
          </p>
          <p
            style="font-size: 12px; margin-top: 4px; color: var(--color-text-muted)"
          >
            Os envios desta sessão aparecerão aqui.
          </p>
        </div>
        <div v-else>
          <div
            v-if="!filteredHistory.length"
            class="text-center"
            style="padding: 40px 24px"
          >
            <p style="font-size: 12.5px; color: var(--color-text-muted)">
              Nenhum envio bate com "{{ historySearch }}".
            </p>
            <button
              class="btn btn-ghost btn-sm mt-3 mx-auto"
              @click="historySearch = ''"
            >
              Limpar filtro
            </button>
          </div>
          <div
            v-for="(h, idx) in filteredHistory"
            v-else
            :key="h.id"
            :style="{
              padding: '14px 18px',
              borderBottom: idx < filteredHistory.length - 1 ? '1px solid var(--color-border)' : 0
            }"
          >
            <div class="flex justify-between mb-1.5">
              <div style="font-size: 13px; font-weight: 700">
                {{ h.title }}
              </div>
              <span
                class="mono"
                style="font-size: 11px; color: var(--color-text-muted)"
              >{{ fmtDate(h.sentAt) }}</span>
            </div>
            <div
              class="flex gap-3 items-center mb-1"
              style="font-size: 11.5px; color: var(--color-text-secondary)"
            >
              <span>
                <UIcon
                  name="i-lucide-users"
                  class="size-3 inline"
                />
                {{ h.segment }}
              </span>
              <span
                style="font-weight: 600; color: var(--color-gold)"
              >
                {{ h.recipients }} destinatários
              </span>
            </div>
            <p
              class="line-clamp-2"
              style="font-size: 12px; color: var(--color-text-muted); white-space: pre-line"
            >
              {{ h.message }}
            </p>
          </div>
        </div>
      </section>
    </div>

    <UModal
      v-model:open="showConfirm"
      :title="segment === 'direct' ? 'Enviar notificação' : 'Confirmar broadcast'"
    >
      <template #body>
        <div class="space-y-4">
          <p style="font-size: 13px; color: var(--color-text-secondary)">
            <template v-if="segment === 'direct'">
              Enviar para <strong>{{ segmentLabel }}</strong>?
            </template>
            <template v-else>
              Tem certeza que deseja enviar esta notificação para <strong>todos os {{ recipientsCount }} afiliados</strong>?
            </template>
          </p>
          <div
            class="card-vex"
            style="padding: 14px; background: var(--color-surface-2)"
          >
            <p style="font-weight: 700; font-size: 13px; margin-bottom: 4px">
              {{ title }}
            </p>
            <p
              style="font-size: 12px; white-space: pre-line; color: var(--color-text-muted)"
            >
              {{ message }}
            </p>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <button
            class="btn btn-ghost btn-sm"
            @click="showConfirm = false"
          >
            Cancelar
          </button>
          <button
            class="btn btn-gold btn-sm"
            :disabled="sending"
            @click="send"
          >
            {{ sending ? 'Enviando...' : 'Confirmar envio' }}
          </button>
        </div>
      </template>
    </UModal>
  </div>
</template>
