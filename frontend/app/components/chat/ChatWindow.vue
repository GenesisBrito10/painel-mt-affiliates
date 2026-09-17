<script setup lang="ts">
import type { ChatAttachment, StartConversationPayload } from '~/composables/useChat'
import type { SupportConversation, SupportMessage } from '~/stores/chat'

const props = defineProps<{
  conversation: SupportConversation | null
  messages: SupportMessage[]
  isSupport?: boolean
  isTyping?: boolean
  onStart?: (payload: StartConversationPayload) => Promise<void>
}>()

const emit = defineEmits<{
  send: [payload: { content: string; attachment?: ChatAttachment }]
  close: []
  typing: [started: boolean]
}>()

const statusLabel = computed(() => {
  if (!props.conversation) return 'Pronto para ajudar'
  if (props.conversation.status === 'WAITING') return 'Na fila'
  if (props.conversation.status === 'OPEN') return props.isSupport ? 'Em atendimento' : 'Atendimento aberto'
  if (props.conversation.status === 'WAITING_USER') return props.isSupport ? 'Aguardando afiliado' : 'Atendimento aberto'
  return 'Encerrado'
})

const isSelectingSubject = ref(false)
const selectedTriageTopic = ref<TriageTopic | null>(null)
const triageInput = ref('')
const isStartingHuman = ref(false)
const startError = ref('')
const messagesEl = ref<HTMLElement | null>(null)

const closingMessage = 'Se sua dúvida ainda persistir, me chame aqui novamente que será um prazer te atender! Basta digitar \'Falar com atendente\'.'

interface TriageTopic {
  icon: string
  label: string
  content: string
  humanDirect?: boolean
}

const triageTopics: TriageTopic[] = [
  {
    icon: 'i-lucide-wallet',
    label: '1. Saque / Pagamento',
    content: `1. Saque / Pagamento

Nosso setor financeiro realiza atendimentos e processamentos das 14h às 17h.

✅ As solicitações de saque devem ser feitas diretamente pelo painel, e os pagamentos serão processados dentro do fluxo financeiro nesse período.

⚠️ Importante:
• Valores abaixo do mínimo permitido para saque não poderão ser liberados.
• Afiliados com média de depósito abaixo do mínimo exigido pela plataforma também não estarão aptos para saque.

⏳ O prazo máximo para processamento e pagamento é de até 48 horas.

Caso sua solicitação esteja dentro das regras, basta abrir/acompanhar pelo painel. 🤝`
  },
  {
    icon: 'i-lucide-link',
    label: '2. Link de Afiliado',
    content: `2. Link de Afiliado

As solicitações de links devem ser feitas diretamente pelo seu painel.

📋 Todas as informações relacionadas à acordo, baseline, regras de cada casa, rollover, condições e demais detalhes estão disponíveis na aba Deals, dentro do painel.

⚠️ Importante: para que a aprovação do link aconteça, é necessário que o gerente de rede tenha cadastrado o acordo corretamente. A aprovação dos links acontece de forma automática pelo sistema.

❌ Por esse motivo, não é necessário acionar o suporte para solicitar aprovação manual de links, pois esse processo não é realizado pelo atendimento.`
  },
  {
    icon: 'i-lucide-bar-chart-2',
    label: '3. Comissão / Saldo',
    content: `3. Comissão / Saldo

As informações de comissão e saldo são atualizadas diretamente no painel. Conforme as atualizações do sistema acontecem, os valores vão sendo refletidos gradativamente, e o painel passa por atualizações diárias.

✅ Assim que houver saldo disponível para saque, o afiliado poderá realizar a solicitação diretamente pelo painel.

⚠️ Importante:
• Valores abaixo do mínimo permitido para saque não poderão ser solicitados.
• Afiliados com média de depósito abaixo do mínimo exigido pela plataforma também não conseguirão realizar saques.

Nesses casos, o sistema mantém o saque temporariamente bloqueado até que os critérios sejam atendidos. 🤝`
  },
  {
    icon: 'i-lucide-refresh-cw',
    label: '4. Atualização de Painel',
    content: `4. Atualização de Painel

As atualizações do painel começam a subir após as 14h e acontecem de forma gradativa ao longo do dia.

⏳ Importante: não existe um horário exato para conclusão total das atualizações, pois isso pode variar conforme o volume de processamento do sistema.

⚠️ Por esse motivo, não é necessário acionar o suporte para verificar atualizações antes da conclusão do processo.

📊 Caso alguma métrica como cliques, cadastros ou FTD tenha sido atualizada, mas o CPA qualificado não tenha subido, isso não significa erro de atualização. Nesse caso, significa apenas que as métricas foram contabilizadas, porém o CPA não atendeu aos critérios de qualificação.

🕖 Regra de contabilização de CPA:
• CPAs realizados até às 19h serão refletidos na atualização do dia seguinte.
• CPAs realizados após às 19h serão contabilizados somente na atualização do dia posterior.

Pedimos que acompanhem as atualizações diretamente pelo painel. 🤝`
  },
  {
    icon: 'i-lucide-building-2',
    label: '5. Casa de Apostas',
    content: `5. Casa de Apostas

Qualquer informação relacionada às casas de apostas pode ser consultada diretamente no seu painel, na aba Deals.

📋 Lá você encontrará todas as informações sobre acordo, baseline, regras específicas, métricas e critérios para qualificação de CPA de cada casa.

⚠️ Importante: cada casa de aposta possui regras próprias e critérios específicos, por isso é fundamental verificar atentamente as condições antes de direcionar seus usuários.

📝 O acordo exibido no painel é definido pelo seu gerente de rede. Portanto, não é necessário acionar o suporte para consultar ou validar qual acordo está configurado, pois essa informação já fica disponível diretamente no painel.

✅ Todas essas informações ficam disponíveis para consulta sempre que necessário. 🤝`
  },
  {
    icon: 'i-lucide-lock',
    label: '6. Acesso à Conta',
    content: `6. Acesso à Conta

O acesso ao painel é realizado utilizando seu e-mail cadastrado e sua senha.

Caso suas credenciais estejam inválidas ou você esteja com dificuldade para acessar a conta, basta acionar o suporte para que a verificação e a alteração necessária sejam realizadas.

⚠️ Importante: por segurança, qualquer alteração de dados ou credenciais será realizada exclusivamente mediante solicitação do titular da conta.`
  },
  {
    icon: 'i-lucide-file-bar-chart',
    label: '7. Relatórios / Estatísticas',
    content: `7. Relatórios / Estatísticas

Todas as informações relacionadas ao seu desempenho ficam disponíveis diretamente no seu painel.

📋 Lá você consegue acompanhar dados como:
• Quantidade de cadastros / registros
• Quantidade de depósitos realizados
• Valor depositado
• CPA qualificado
• Desempenho e dados dos seus afiliados

✅ Todas as métricas e estatísticas são atualizadas e disponibilizadas diretamente no sistema para seu acompanhamento.

⚠️ Para consultas relacionadas a relatórios e estatísticas, a orientação é verificar diretamente no painel, pois essas informações já ficam disponíveis de forma detalhada para acompanhamento. 🤝`
  },
  {
    icon: 'i-lucide-help-circle',
    label: '8. Outro Assunto',
    humanDirect: true,
    content: `8. Outro Assunto

Sua solicitação será encaminhada para um atendimento humano para que possamos te auxiliar da melhor forma.

⏰ Horário de atendimento do suporte:
Segunda a sexta-feira
🕘 09h às 12h
🕑 14h às 18h

Pedimos que aguarde, em breve um de nossos atendentes seguirá com seu atendimento.`
  }
]

const selectedTriageContent = computed(() => {
  if (!selectedTriageTopic.value) return ''
  if (selectedTriageTopic.value.humanDirect) return selectedTriageTopic.value.content
  return `${selectedTriageTopic.value.content}\n\n${closingMessage}`
})

async function startHumanSupport(topic: TriageTopic) {
  if (isStartingHuman.value) return
  isStartingHuman.value = true
  startError.value = ''
  const triggerMessage = triageInput.value.trim() || 'falar com atendente'
  try {
    await props.onStart?.({
      subject: topic.label,
      triageTopic: topic.label,
      triageContent: selectedTriageContent.value || topic.content,
      triageTriggerMessage: triggerMessage,
      triageRequestedHuman: true,
    })
  } catch (err) {
    startError.value = (err as Error).message || 'Erro ao iniciar atendimento.'
    isStartingHuman.value = false
  }
}

function selectTriageTopic(topic: TriageTopic) {
  selectedTriageTopic.value = topic
  triageInput.value = ''
  startError.value = ''
  if (topic.humanDirect) {
    startHumanSupport(topic)
  }
}

function backToTopics() {
  selectedTriageTopic.value = null
  triageInput.value = ''
  startError.value = ''
}

const canSubmitTriage = computed(() => {
  const input = triageInput.value.trim().toLocaleLowerCase('pt-BR')
  return input.includes('falar') && input.includes('atendente')
})

function submitTriageInput() {
  if (!selectedTriageTopic.value) return
  if (!canSubmitTriage.value) return
  startHumanSupport(selectedTriageTopic.value)
}

const PREDEFINED_TAGS = [
  { label: 'Saque',    bg: '#dcfce7', color: '#15803d' },
  { label: 'Comissão', bg: '#fef9c3', color: '#a16207' },
  { label: 'Link',     bg: '#ede9fe', color: '#7c3aed' },
  { label: 'Acesso',   bg: '#f3e8ff', color: '#7e22ce' },
  { label: 'Bug',      bg: '#fee2e2', color: '#b91c1c' },
  { label: 'VIP',      bg: '#fff7ed', color: '#c2410c' },
  { label: 'Urgente',  bg: '#fce7f3', color: '#be185d' },
]

function tagStyle(label: string): { bg: string; color: string } {
  return PREDEFINED_TAGS.find(t => t.label === label) ?? { bg: 'var(--vex-surface-strong)', color: 'var(--vex-text-muted)' }
}

const showTagsMenu = ref(false)
const savingTags = ref(false)

const chat = useChat()

async function toggleTag(label: string) {
  if (!props.conversation || !props.isSupport) return
  const current = props.conversation.tags ?? []
  const next = current.includes(label)
    ? current.filter(t => t !== label)
    : [...current, label]
  savingTags.value = true
  try {
    await chat.setConversationTags(props.conversation.id, next)
  } finally {
    savingTags.value = false
  }
}

function onClickOutsideTags(event: MouseEvent) {
  const target = event.target as HTMLElement
  if (!target.closest('[data-tags-container]')) {
    showTagsMenu.value = false
  }
}

watch(showTagsMenu, (open) => {
  if (!import.meta.client) return
  if (open) document.addEventListener('click', onClickOutsideTags)
  else document.removeEventListener('click', onClickOutsideTags)
})

const isCloseModalOpen = ref(false)
const isClosing = ref(false)

function checkBusinessHoursLocal(): boolean {
  if (!import.meta.client) return true
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date())
  const weekday = parts.find(p => p.type === 'weekday')?.value ?? ''
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10) % 24
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10)
  const isWeekday = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].includes(weekday)
  if (!isWeekday) return false
  const m = hour * 60 + minute
  return (m >= 9 * 60 && m < 12 * 60) || (m >= 14 * 60 && m < 18 * 60)
}

const isBusinessHours = ref(checkBusinessHoursLocal())
let businessHoursTimer: ReturnType<typeof setInterval> | null = null

async function refreshBusinessHours() {
  if (!import.meta.client) return
  try {
    const apiBase = useApiBase()
    const { authHeaders } = useAuth()
    const res = await $fetch<{ open: boolean }>(`${apiBase}/v1/support/status`, {
      headers: authHeaders(),
    })
    isBusinessHours.value = res.open
  } catch {
    isBusinessHours.value = checkBusinessHoursLocal()
  }
}

onMounted(() => {
  refreshBusinessHours()
  businessHoursTimer = setInterval(refreshBusinessHours, 60_000)
})

function openCloseModal() {
  isCloseModalOpen.value = true
}

function cancelClose() {
  if (isClosing.value) return
  isCloseModalOpen.value = false
}

async function confirmClose() {
  if (isClosing.value) return
  isClosing.value = true
  try {
    emit('close')
  } finally {
    isClosing.value = false
    isCloseModalOpen.value = false
  }
}

function onGlobalKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && isCloseModalOpen.value) cancelClose()
}

watch(isCloseModalOpen, (open) => {
  if (!import.meta.client) return
  if (open) {
    window.addEventListener('keydown', onGlobalKeydown)
    document.body.style.overflow = 'hidden'
  } else {
    window.removeEventListener('keydown', onGlobalKeydown)
    document.body.style.overflow = ''
  }
})

onUnmounted(() => {
  if (!import.meta.client) return
  window.removeEventListener('keydown', onGlobalKeydown)
  document.removeEventListener('click', onClickOutsideTags)
  document.body.style.overflow = ''
  if (businessHoursTimer) clearInterval(businessHoursTimer)
})

watch(() => props.conversation?.id, (conversationId) => {
  if (!conversationId) return
  isStartingHuman.value = false
  isSelectingSubject.value = false
  selectedTriageTopic.value = null
  triageInput.value = ''
})

watch([() => props.messages.length, () => props.conversation?.id], async () => {
  await nextTick()
  if (!messagesEl.value) return
  messagesEl.value.scrollTop = messagesEl.value.scrollHeight
}, { flush: 'post' })
</script>

<template>
  <section class="flex h-full min-h-0 flex-col overflow-hidden rounded-lg" style="background: var(--vex-surface); border: 1px solid var(--vex-border-subtle)">
    <header class="flex items-center justify-between gap-3 border-b px-4 py-3" style="border-color: var(--vex-border-subtle)">
      <div class="min-w-0">
        <p class="text-[11px] font-bold uppercase tracking-wide" style="color: var(--vex-text-faint)">Suporte online</p>
        <h2 class="truncate text-sm font-extrabold" style="color: var(--vex-text)">
          {{ isSupport ? (conversation?.affiliateName || 'Fila individual') : statusLabel }}
        </h2>
      </div>
      <button
        v-if="conversation && conversation.status !== 'CLOSED'"
        class="rounded-lg px-3 py-2 text-xs font-bold"
        style="color: var(--vex-danger); background: var(--vex-danger-soft-bg)"
        @click="openCloseModal"
      >
        Encerrar
      </button>
    </header>

    <div v-if="!conversation && isSupport" class="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <div class="flex size-12 items-center justify-center rounded-lg" style="background: var(--vex-brand-light); color: var(--vex-brand)">
        <UIcon name="i-lucide-message-circle" class="size-6" />
      </div>
      <div>
        <h3 class="text-base font-extrabold" style="color: var(--vex-text)">
          Nenhum chamado selecionado
        </h3>
        <p class="mt-1 text-sm" style="color: var(--vex-text-muted)">
          Escolha um atendimento na sua fila.
        </p>
      </div>
    </div>

    <div v-else-if="!conversation && !isSelectingSubject" class="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <div class="flex size-12 items-center justify-center rounded-lg" style="background: var(--vex-brand-light); color: var(--vex-brand)">
        <UIcon name="i-lucide-message-circle" class="size-6" />
      </div>
      <template v-if="isBusinessHours">
        <div>
          <h3 class="text-base font-extrabold" style="color: var(--vex-text)">
            Assistente virtual
          </h3>
          <p class="mt-1 text-sm" style="color: var(--vex-text-muted)">
            Escolha um tópico para receber uma orientação rápida antes de falar com o suporte.
          </p>
        </div>
        <button class="rounded-lg px-4 py-2 text-sm font-bold text-white" style="background: var(--vex-brand)" @click="isSelectingSubject = true">
          Iniciar conversa
        </button>
      </template>
      <template v-else>
        <div>
          <h3 class="text-base font-extrabold" style="color: var(--vex-text)">Fora do horário</h3>
          <p class="mt-2 text-sm leading-relaxed" style="color: var(--vex-text-muted)">
            O suporte funciona de<br>
            <strong>segunda a sexta</strong><br>
            <span>🕘 09h às 12h &nbsp;·&nbsp; 🕑 14h às 18h</span>
          </p>
        </div>
      </template>
    </div>

    <div v-else-if="isSelectingSubject && !selectedTriageTopic" class="flex flex-1 flex-col gap-3 overflow-y-auto p-6">
      <h3 class="text-sm font-bold" style="color: var(--vex-text)">Qual o motivo do contato?</h3>
      <div class="grid gap-2">
        <button
          v-for="s in triageTopics"
          :key="s.label"
          class="flex items-center gap-3 rounded-lg border px-4 py-2.5 text-left text-sm transition-colors"
          :style="{ borderColor: 'var(--vex-border-subtle)', color: 'var(--vex-text)' }"
          :disabled="isStartingHuman"
          @click="selectTriageTopic(s)"
        >
          <UIcon :name="s.icon" class="size-4 shrink-0" />
          {{ s.label }}
        </button>
      </div>
      <div class="mt-auto flex gap-2">
        <button class="flex-1 rounded-lg px-4 py-2 text-sm font-bold" style="color: var(--vex-text-muted)" @click="isSelectingSubject = false">Cancelar</button>
      </div>
    </div>

    <div v-else-if="isSelectingSubject && selectedTriageTopic" class="flex flex-1 flex-col min-h-0">
      <div class="flex-1 overflow-y-auto p-4">
        <div class="rounded-lg border px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap" style="border-color: var(--vex-border-subtle); background: var(--vex-surface-strong); color: var(--vex-text)">
          {{ selectedTriageContent }}
        </div>
      </div>
      <form class="border-t p-3" style="border-color: var(--vex-border-subtle)" @submit.prevent="submitTriageInput">
        <div class="flex items-end gap-2">
          <textarea
            v-model="triageInput"
            rows="1"
            maxlength="120"
            class="min-h-10 max-h-20 flex-1 resize-none rounded-lg px-3 py-2 text-sm outline-none"
            style="background: var(--vex-surface-strong); color: var(--vex-text); border: 1px solid var(--vex-border-subtle)"
            placeholder="Digite Falar com atendente"
            :disabled="isStartingHuman"
            @keydown.enter.exact.prevent="submitTriageInput"
          />
          <button
            type="submit"
            class="flex size-10 shrink-0 items-center justify-center rounded-lg transition-all disabled:opacity-40"
            style="background: var(--vex-brand); color: white"
            :disabled="!canSubmitTriage || isStartingHuman"
            aria-label="Enviar solicitação de atendente"
          >
            <UIcon name="i-lucide-send" class="size-4" />
          </button>
        </div>
        <p v-if="startError" class="mt-2 rounded-lg px-3 py-2 text-xs font-semibold" style="background: var(--vex-danger-soft-bg); color: var(--vex-danger)">
          {{ startError }}
        </p>
        <div class="mt-2 flex gap-2">
          <button type="button" class="flex-1 rounded-lg px-3 py-2 text-xs font-bold" style="color: var(--vex-text-muted)" :disabled="isStartingHuman" @click="backToTopics">
            Voltar
          </button>
          <button type="button" class="flex-1 rounded-lg px-3 py-2 text-xs font-bold text-white disabled:opacity-60" style="background: var(--vex-brand)" :disabled="isStartingHuman" @click="startHumanSupport(selectedTriageTopic)">
            {{ isStartingHuman ? 'Encaminhando...' : 'Falar com atendente' }}
          </button>
        </div>
      </form>
    </div>

    <template v-else>
      <div class="border-b px-4 py-2 text-xs font-semibold" style="border-color: var(--vex-border-subtle); color: var(--vex-text-muted)">
        {{ statusLabel }}
        <span v-if="conversation?.agentName">com {{ conversation?.agentName }}</span>
        <div v-if="conversation?.subject" class="mt-1 font-bold" style="color: var(--vex-text)">Assunto: {{ conversation?.subject }}</div>
      </div>

      <!-- Tags (somente para agentes de suporte) -->
      <div
        v-if="isSupport && conversation"
        class="flex min-h-[2.25rem] flex-wrap items-center gap-1.5 border-b px-3 py-1.5"
        style="border-color: var(--vex-border-subtle)"
        data-tags-container
      >
        <!-- Pills das tags ativas -->
        <span
          v-for="tag in (conversation.tags ?? [])"
          :key="tag"
          class="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold leading-none"
          :style="`background: ${tagStyle(tag).bg}; color: ${tagStyle(tag).color}`"
        >
          <span
            class="size-1.5 rounded-full shrink-0"
            :style="`background: ${tagStyle(tag).color}`"
          />
          {{ tag }}
          <button
            class="ml-0.5 rounded-full transition-opacity hover:opacity-100 opacity-50"
            :disabled="savingTags"
            @click.stop="toggleTag(tag)"
            :aria-label="`Remover ${tag}`"
          >
            <UIcon name="i-lucide-x" class="size-2.5" />
          </button>
        </span>

        <!-- Botão adicionar / placeholder -->
        <div class="relative" data-tags-container>
          <button
            class="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold transition-colors"
            :style="showTagsMenu
              ? 'background: var(--vex-brand-light); color: var(--vex-brand)'
              : 'background: var(--vex-surface-strong); color: var(--vex-text-muted)'"
            :disabled="savingTags"
            @click.stop="showTagsMenu = !showTagsMenu"
            aria-label="Adicionar tag"
          >
            <UIcon v-if="savingTags" name="i-lucide-loader-2" class="size-3 animate-spin" />
            <UIcon v-else name="i-lucide-plus" class="size-3" />
            <span v-if="(conversation.tags ?? []).length === 0">Adicionar tag</span>
          </button>

          <!-- Dropdown de seleção -->
          <div
            v-if="showTagsMenu"
            class="absolute left-0 top-8 z-20 w-44 overflow-hidden rounded-xl shadow-xl"
            style="background: var(--vex-surface); border: 1px solid var(--vex-border-subtle)"
          >
            <p class="px-3 pt-2.5 pb-1 text-[10px] font-bold uppercase tracking-wider" style="color: var(--vex-text-faint)">
              Etiquetas
            </p>
            <div class="pb-1.5">
              <button
                v-for="t in PREDEFINED_TAGS"
                :key="t.label"
                class="flex w-full items-center gap-2.5 px-3 py-2 text-[12px] font-semibold transition-colors"
                :style="(conversation.tags ?? []).includes(t.label)
                  ? `background: ${t.bg}; color: ${t.color}`
                  : 'color: var(--vex-text)'"
                :disabled="savingTags"
                @click.stop="toggleTag(t.label)"
              >
                <span
                  class="size-2 shrink-0 rounded-full"
                  :style="`background: ${t.color}`"
                />
                {{ t.label }}
                <UIcon
                  v-if="(conversation.tags ?? []).includes(t.label)"
                  name="i-lucide-check"
                  class="ml-auto size-3.5"
                />
              </button>
            </div>
          </div>
        </div>
      </div>
      <div ref="messagesEl" class="flex-1 space-y-3 overflow-y-auto p-4">
        <ChatMessageBubble
          v-for="message in messages"
          :key="message.id"
          :message="message"
          :mine="isSupport ? message.senderRole === 'AGENT' : message.senderRole === 'AFFILIATE'"
          :closed="conversation?.status === 'CLOSED'"
        />
        <p v-if="isTyping" class="text-xs" style="color: var(--vex-text-faint)">Digitando...</p>
      </div>
      <div
        v-if="conversation?.status === 'CLOSED' && !isSupport"
        class="border-t px-4 py-3"
        style="border-color: var(--vex-border-subtle); background: var(--vex-surface-muted)"
      >
        <button
          class="flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-bold text-white"
          style="background: var(--vex-brand)"
          @click="isSelectingSubject = true"
        >
          <UIcon name="i-lucide-message-circle-plus" class="size-4" />
          Abrir novo chamado
        </button>
      </div>
      <div
        v-if="conversation?.status !== 'CLOSED' && !isSupport && !isBusinessHours"
        class="border-t px-4 py-3 text-center text-xs"
        style="border-color: var(--vex-border-subtle); background: var(--vex-surface-strong); color: var(--vex-text-muted)"
      >
        Atendimento encerrado por hoje.<br>
        Retornamos na próxima janela de atendimento.
      </div>
      <ChatInput
        v-else-if="conversation?.status !== 'CLOSED' && (isSupport || isBusinessHours)"
        @send="emit('send', $event)"
        @typing="emit('typing', $event)"
      />
    </template>

    <Teleport to="body">
      <div
        v-if="isCloseModalOpen"
        class="fixed inset-0 z-[100] flex items-center justify-center p-4"
        style="background: rgba(10, 10, 14, 0.55); backdrop-filter: blur(2px)"
        role="dialog"
        aria-modal="true"
        aria-labelledby="close-chat-title"
        @click.self="cancelClose"
        @keydown.esc="cancelClose"
      >
        <div
          class="w-full max-w-sm overflow-hidden rounded-xl shadow-2xl"
          style="background: var(--vex-surface); border: 1px solid var(--vex-border-subtle)"
        >
          <div class="flex items-start gap-3 p-5">
            <div
              class="grid size-10 shrink-0 place-items-center rounded-lg"
              style="background: var(--vex-danger-soft-bg); color: var(--vex-danger)"
            >
              <UIcon name="i-lucide-alert-triangle" class="size-5" />
            </div>
            <div class="min-w-0 flex-1">
              <h3 id="close-chat-title" class="text-sm font-extrabold" style="color: var(--vex-text)">
                Encerrar atendimento?
              </h3>
              <p class="mt-1 text-xs leading-relaxed" style="color: var(--vex-text-muted)">
                Esta conversa será movida para Encerrados e
                <template v-if="isSupport">o afiliado não poderá responder mais nela.</template>
                <template v-else>você precisará abrir um novo chamado se quiser falar de novo.</template>
              </p>
            </div>
          </div>
          <div
            class="flex justify-end gap-2 px-5 py-3"
            style="background: var(--vex-surface-strong); border-top: 1px solid var(--vex-border-subtle)"
          >
            <button
              type="button"
              class="rounded-lg px-3 py-2 text-xs font-bold disabled:opacity-50"
              style="color: var(--vex-text-muted); background: transparent"
              :disabled="isClosing"
              @click="cancelClose"
            >
              Cancelar
            </button>
            <button
              type="button"
              class="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
              style="background: var(--vex-danger)"
              :disabled="isClosing"
              @click="confirmClose"
            >
              <UIcon
                v-if="isClosing"
                name="i-lucide-loader-2"
                class="size-3.5 animate-spin"
              />
              {{ isClosing ? 'Encerrando...' : 'Encerrar atendimento' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </section>
</template>
