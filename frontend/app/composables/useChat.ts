import { io, type Socket } from 'socket.io-client'
import type { SupportConversation, SupportMessage } from '~/stores/chat'

interface ConversationListResponse {
  data: SupportConversation[]
  total: number
  page: number
  limit: number
}

export interface SupportDailyReportClosedConversation {
  id: string
  affiliateName: string
  affiliateEmail: string
  subject: string | null
  tags: string[]
  closedAt: string | null
  closedByRole: string | null
  firstMessagePreview: string | null
  lastMessagePreview: string | null
}

export interface SupportDailyReport {
  date: string
  totalCreated: number
  totalClosed: number
  closedConversations: SupportDailyReportClosedConversation[]
}

export interface StartConversationPayload {
  subject?: string
  triageTopic?: string
  triageContent?: string
  triageTriggerMessage?: string
  triageRequestedHuman?: boolean
}

export interface ChatAttachment {
  url: string
  mimeType: string
  name: string
  size: number
}

export const ALLOWED_ATTACHMENT_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
] as const

export const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024

interface UploadResponse {
  url: string
  key: string
  mimeType: string
  size: number
  name: string
}

function resolveSocketUrl() {
  if (!import.meta.client) return undefined
  const config = useRuntimeConfig()
  const explicit = config.public.socketUrl as string | undefined
  if (explicit) return explicit
  
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

export function useChat() {
  const apiBase = useApiBase()
  const { token, authHeaders, user } = useAuth()
  const store = useChatStore()
  const socket = useState<Socket | null>('support-chat-socket', () => null)
  const isConnected = useState('support-chat-connected', () => false)
  const isTyping = useState('support-chat-typing', () => false)

  function connect() {
    if (!import.meta.client || socket.value?.connected || !token.value) return

    socket.value = io(`${resolveSocketUrl()}/support`, {
      auth: { token: token.value },
      path: '/api/socket.io',
      transports: ['websocket', 'polling'],
    })

    socket.value.on('connect', () => {
      isConnected.value = true
      if (user.value?.role === 'support') {
        socket.value?.emit('agent:set-available', { available: true })
      }
      if (store.conversation?.id) {
        socket.value?.emit('conversation:join', { conversationId: store.conversation.id })
      }
    })
    socket.value.on('disconnect', () => {
      isConnected.value = false
    })
    socket.value.on('message:new', (message: SupportMessage) => {
      if (message.conversationId === store.conversation?.id) {
        store.addMessage(message)
      }
    })
    socket.value.on('message:updated', (message: SupportMessage) => {
      if (message.conversationId === store.conversation?.id) {
        store.updateMessage(message)
      }
    })
    socket.value.on('conversation:closed', (conversation: SupportConversation) => {
      if (conversation.id === store.conversation?.id) {
        store.setConversation({ ...conversation, messages: store.messages })
      }
    })
    socket.value.on('conversation:assigned', (conversation: SupportConversation) => {
      if (conversation.id === store.conversation?.id) {
        store.setConversation({ ...conversation, messages: store.messages })
      }
    })
    socket.value.on('conversation:updated', (conversation: SupportConversation) => {
      if (conversation.id === store.conversation?.id) {
        store.updateConversationMeta(conversation)
      }
    })
    socket.value.on('conversation:reopened', (conversation: SupportConversation) => {
      if (conversation.id === store.conversation?.id) {
        store.updateConversationMeta(conversation)
      }
    })
    socket.value.on('typing:started', () => {
      isTyping.value = true
    })
    socket.value.on('typing:stopped', () => {
      isTyping.value = false
    })
  }

  function disconnect() {
    socket.value?.disconnect()
    socket.value = null
    isConnected.value = false
  }

  async function startConversation(payload?: string | StartConversationPayload) {
    const body = typeof payload === 'string' ? { subject: payload } : (payload ?? {})
    const conversation = await $fetch<SupportConversation>(`${apiBase}/v1/support/conversations`, {
      method: 'POST',
      headers: authHeaders(),
      body,
    })
    store.setConversation(conversation)
    socket.value?.emit('conversation:join', { conversationId: conversation.id })
    store.openChat()
    return conversation
  }

  async function loadMyActiveConversation() {
    const statuses: Array<'OPEN' | 'WAITING_USER' | 'WAITING'> = ['OPEN', 'WAITING_USER', 'WAITING']
    for (const status of statuses) {
      const result = await $fetch<ConversationListResponse>(`${apiBase}/v1/support/conversations`, {
        headers: authHeaders(),
        query: { status, page: 1, limit: 1 },
      })
      const found = result.data[0]
      if (found) return loadMyConversation(found.id)
    }
    return null
  }

  async function loadMyConversation(id: string) {
    const previousId = store.conversation?.id
    if (previousId && previousId !== id) {
      socket.value?.emit('conversation:leave', { conversationId: previousId })
    }
    const conversation = await $fetch<SupportConversation>(`${apiBase}/v1/support/conversations/${id}`, {
      headers: authHeaders(),
      query: { messagesPage: 1, messagesLimit: 100 },
    })
    store.setConversation(conversation)
    socket.value?.emit('conversation:join', { conversationId: conversation.id })
    return conversation
  }

  async function loadSupportConversation(id: string) {
    const previousId = store.conversation?.id
    if (previousId && previousId !== id) {
      socket.value?.emit('conversation:leave', { conversationId: previousId })
    }
    const conversation = await $fetch<SupportConversation>(`${apiBase}/v1/support/agent/conversations/${id}`, {
      headers: authHeaders(),
      query: { messagesPage: 1, messagesLimit: 100 },
    })
    store.setConversation(conversation)
    socket.value?.emit('conversation:join', { conversationId: conversation.id })
    return conversation
  }

  async function listSupportQueue(status?: 'OPEN' | 'WAITING_USER' | 'CLOSED') {
    return $fetch<ConversationListResponse>(`${apiBase}/v1/support/agent/conversations`, {
      headers: authHeaders(),
      query: { status, page: 1, limit: 50 },
    })
  }

  async function setAgentAvailability(isOnline: boolean) {
    return $fetch(`${apiBase}/v1/support/agent/availability`, {
      method: 'POST',
      headers: authHeaders(),
      body: { isOnline },
    })
  }

  async function refreshActiveConversation() {
    if (!store.conversation) return
    const id = store.conversation.id
    const isSupport = user.value?.role === 'support'
    const endpoint = isSupport
      ? `${apiBase}/v1/support/agent/conversations/${id}`
      : `${apiBase}/v1/support/conversations/${id}`

    const conversation = await $fetch<SupportConversation>(endpoint, {
      headers: authHeaders(),
      query: { messagesPage: 1, messagesLimit: 100 },
    })

    if (store.conversation?.id !== id) return
    for (const message of conversation.messages ?? []) {
      store.addMessage(message)
    }
    store.updateConversationMeta(conversation)
  }

  async function sendMessage(content: string, attachment?: ChatAttachment) {
    if (!store.conversation) return
    const trimmed = content.trim()
    if (!trimmed && !attachment) return

    const isSupport = user.value?.role === 'support'
    const endpoint = isSupport
      ? `${apiBase}/v1/support/agent/conversations/${store.conversation.id}/messages`
      : `${apiBase}/v1/support/conversations/${store.conversation.id}/messages`

    const message = await $fetch<SupportMessage>(endpoint, {
      method: 'POST',
      headers: authHeaders(),
      body: {
        content: trimmed,
        ...(attachment ? {
          attachmentUrl: attachment.url,
          attachmentMimeType: attachment.mimeType,
          attachmentName: attachment.name,
          attachmentSize: attachment.size,
        } : {}),
      },
    })

    store.addMessage(message)
  }

  async function editMessage(messageId: string, content: string) {
    if (!store.conversation) return
    const trimmed = content.trim()
    if (!trimmed) return

    const isSupport = user.value?.role === 'support'
    const endpoint = isSupport
      ? `${apiBase}/v1/support/agent/conversations/${store.conversation.id}/messages/${messageId}`
      : `${apiBase}/v1/support/conversations/${store.conversation.id}/messages/${messageId}`

    const message = await $fetch<SupportMessage>(endpoint, {
      method: 'PATCH',
      headers: authHeaders(),
      body: { content: trimmed },
    })

    store.updateMessage(message)
  }

  async function uploadAttachment(file: File): Promise<ChatAttachment> {
    if (!store.conversation) throw new Error('Nenhuma conversa ativa.')
    if (!ALLOWED_ATTACHMENT_MIME_TYPES.includes(file.type as never)) {
      throw new Error('Tipo de arquivo não suportado. Envie imagem ou PDF.')
    }
    if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
      throw new Error('Arquivo excede 10 MB.')
    }

    const isSupport = user.value?.role === 'support'
    const conversationId = store.conversation.id
    const endpoint = isSupport
      ? `${apiBase}/v1/support/agent/conversations/${conversationId}/attachments`
      : `${apiBase}/v1/support/conversations/${conversationId}/attachments`

    const formData = new FormData()
    formData.append('file', file, file.name)

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: authHeaders(),
      body: formData,
    })
    if (!response.ok) {
      let message = `Falha no upload (${response.status}).`
      try {
        const err = await response.json() as { message?: string }
        if (err.message) message = err.message
      } catch {}
      throw new Error(message)
    }
    const result = await response.json() as UploadResponse

    return {
      url: result.url,
      mimeType: result.mimeType,
      name: result.name,
      size: result.size,
    }
  }

  async function closeAllConversations(): Promise<{ closed: number }> {
    return $fetch<{ closed: number }>(`${apiBase}/v1/support/agent/conversations/close-all`, {
      method: 'POST',
      headers: authHeaders(),
    })
  }

  async function setConversationTags(conversationId: string, tags: string[]): Promise<SupportConversation> {
    const conversation = await $fetch<SupportConversation>(
      `${apiBase}/v1/support/agent/conversations/${conversationId}/tags`,
      {
        method: 'PATCH',
        headers: authHeaders(),
        body: { tags },
      },
    )
    if (store.conversation?.id === conversationId) {
      store.updateConversationMeta(conversation)
    }
    return conversation
  }

  async function getDailyReport(): Promise<SupportDailyReport> {
    return $fetch(`${apiBase}/v1/support/agent/report/daily`, {
      headers: authHeaders(),
    })
  }

  async function closeConversation() {
    if (!store.conversation) return
    const isSupport = user.value?.role === 'support'
    const endpoint = isSupport
      ? `${apiBase}/v1/support/agent/conversations/${store.conversation.id}/close`
      : `${apiBase}/v1/support/conversations/${store.conversation.id}/close`
      
    const updated = await $fetch<SupportConversation>(endpoint, {
      method: 'POST',
      headers: authHeaders(),
    })
    store.setConversation({ ...updated, messages: store.messages })
  }

  function typing(started: boolean) {
    if (!store.conversation) return
    socket.value?.emit(started ? 'typing:start' : 'typing:stop', {
      conversationId: store.conversation.id,
    })
  }

  return {
    socket,
    isConnected,
    isTyping,
    store,
    connect,
    disconnect,
    startConversation,
    loadMyActiveConversation,
    loadMyConversation,
    loadSupportConversation,
    listSupportQueue,
    setAgentAvailability,
    refreshActiveConversation,
    sendMessage,
    editMessage,
    uploadAttachment,
    closeConversation,
    closeAllConversations,
    getDailyReport,
    setConversationTags,
    typing,
  }
}
