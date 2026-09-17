import { defineStore } from 'pinia'

export type ChatStatus = 'WAITING' | 'OPEN' | 'WAITING_USER' | 'CLOSED'
export type ChatSenderRole = 'AFFILIATE' | 'AGENT'

export interface SupportMessage {
  id: string
  conversationId: string
  senderId: string
  senderRole: ChatSenderRole
  senderName: string
  content: string
  attachmentUrl?: string | null
  attachmentMimeType?: string | null
  attachmentName?: string | null
  attachmentSize?: number | null
  readAt: string | null
  createdAt: string
  editedAt?: string | null
}

export interface SupportConversation {
  id: string
  affiliateId: string
  affiliateName: string
  affiliateEmail: string
  agentId: string | null
  agentName: string | null
  agentEmail: string | null
  status: ChatStatus
  subject: string | null
  tags: string[]
  closedAt: string | null
  closedByRole: string | null
  createdAt: string
  updatedAt: string
  lastMessage?: SupportMessage | null
  unreadCount?: number
  messages?: SupportMessage[]
  messagesTotal?: number
  messagesPage?: number
  messagesLimit?: number
}

export const useChatStore = defineStore('chat', () => {
  const isChatOpen = ref(false)
  const conversation = ref<SupportConversation | null>(null)
  const messages = ref<SupportMessage[]>([])
  const selectedConversationId = ref<string | null>(null)

  function openChat() {
    isChatOpen.value = true
  }

  function closeChat() {
    isChatOpen.value = false
  }

  function toggleChat() {
    if (isChatOpen.value) closeChat()
    else openChat()
  }

  function setConversation(next: SupportConversation) {
    conversation.value = next
    messages.value = next.messages ?? []
    selectedConversationId.value = next.id
  }

  function updateConversationMeta(next: SupportConversation) {
    conversation.value = { ...next, messages: messages.value }
  }

  function addMessage(message: SupportMessage) {
    if (message.conversationId !== conversation.value?.id) return
    if (!messages.value.some((item) => item.id === message.id)) {
      messages.value.push(message)
    }
  }

  function updateMessage(message: SupportMessage) {
    if (message.conversationId !== conversation.value?.id) return
    const index = messages.value.findIndex((item) => item.id === message.id)
    if (index !== -1) messages.value[index] = message
  }

  function reset() {
    isChatOpen.value = false
    conversation.value = null
    messages.value = []
    selectedConversationId.value = null
  }

  return {
    isChatOpen,
    conversation,
    messages,
    selectedConversationId,
    openChat,
    closeChat,
    toggleChat,
    setConversation,
    updateConversationMeta,
    addMessage,
    updateMessage,
    reset,
  }
})
