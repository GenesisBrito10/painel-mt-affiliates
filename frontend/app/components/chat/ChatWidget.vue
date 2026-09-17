<script setup lang="ts">
const { user } = useAuth()
const chat = useChat()
const { store } = chat

const visible = computed(() => user.value?.role === 'affiliate')
let offVisibilityRefresh: (() => void) | null = null

async function refreshChatState() {
  if (!visible.value) return
  if (store.conversation?.id) {
    await chat.refreshActiveConversation().catch(() => {})
    return
  }
  await chat.loadMyActiveConversation().catch(() => {})
}

function startVisibilityRefresh() {
  stopVisibilityRefresh()
  const refreshWhenVisible = () => {
    if (document.visibilityState === 'visible') {
      refreshChatState().catch(() => {})
    }
  }
  document.addEventListener('visibilitychange', refreshWhenVisible)
  window.addEventListener('focus', refreshWhenVisible)
  offVisibilityRefresh = () => {
    document.removeEventListener('visibilitychange', refreshWhenVisible)
    window.removeEventListener('focus', refreshWhenVisible)
  }
}

function stopVisibilityRefresh() {
  offVisibilityRefresh?.()
  offVisibilityRefresh = null
}

onMounted(async () => {
  if (visible.value) {
    chat.connect()
    await refreshChatState()
    startVisibilityRefresh()
  }
})

onUnmounted(() => {
  stopVisibilityRefresh()
})

watch(visible, async (next) => {
  if (next) {
    chat.connect()
    await refreshChatState()
    startVisibilityRefresh()
  } else {
    stopVisibilityRefresh()
    chat.disconnect()
  }
})

watch(() => store.isChatOpen, (open) => {
  if (open) refreshChatState().catch(() => {})
})

async function start(payload: Parameters<typeof chat.startConversation>[0]) {
  try {
    await chat.startConversation(payload)
  } catch (err) {
    const message = (err as { data?: { message?: string }; message?: string })?.data?.message
      || (err as { message?: string })?.message
      || 'Erro ao iniciar atendimento.'
    throw new Error(typeof message === 'string' ? message : String(message))
  }
}
</script>

<template>
  <div v-if="visible" class="fixed bottom-24 right-5 z-50 sm:bottom-5">
    <div
      v-if="store.isChatOpen"
      class="mb-3 h-[min(34rem,calc(100vh-7rem))] w-[min(24rem,calc(100vw-2rem))] shadow-2xl"
    >
      <ChatWindow
        :conversation="store.conversation"
        :messages="store.messages"
        :is-typing="chat.isTyping.value"
        :on-start="start"
        @send="(payload) => chat.sendMessage(payload.content, payload.attachment)"
        @close="chat.closeConversation"
        @typing="chat.typing"
      />
    </div>

    <button
      class="relative flex size-14 items-center justify-center rounded-full text-white shadow-xl transition-transform hover:scale-105"
      style="background: var(--vex-brand)"
      aria-label="Abrir suporte"
      @click="store.toggleChat"
    >
      <UIcon :name="store.isChatOpen ? 'i-lucide-x' : 'i-lucide-message-circle'" class="size-6" />
    </button>
  </div>
</template>
