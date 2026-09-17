<script setup lang="ts">
import type { SupportMessage } from '~/stores/chat'

const props = defineProps<{
  message: SupportMessage
  mine: boolean
  closed?: boolean
}>()

const { editMessage } = useChat()

const time = computed(() =>
  new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' })
    .format(new Date(props.message.createdAt)),
)

const canEdit = computed(() => props.mine && !props.closed)
const isEditing = ref(false)
const isSaving = ref(false)
const editError = ref('')
const editDraft = ref('')
const textareaEl = ref<HTMLTextAreaElement | null>(null)

function startEdit() {
  if (!canEdit.value) return
  editDraft.value = props.message.content
  editError.value = ''
  isEditing.value = true
  nextTick(() => textareaEl.value?.focus())
}

function cancelEdit() {
  isEditing.value = false
  editError.value = ''
}

async function saveEdit() {
  const trimmed = editDraft.value.trim()
  if (!trimmed || trimmed === props.message.content) {
    isEditing.value = false
    return
  }
  isSaving.value = true
  editError.value = ''
  try {
    await editMessage(props.message.id, trimmed)
    isEditing.value = false
  } catch (err) {
    editError.value = (err as { data?: { message?: string } })?.data?.message
      || 'Não foi possível salvar a edição.'
  } finally {
    isSaving.value = false
  }
}

function onEditKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    saveEdit()
  } else if (e.key === 'Escape') {
    cancelEdit()
  }
}

const isTriageContext = computed(() =>
  props.message.content.startsWith('Contexto da triagem automática'),
)

const triageBody = computed(() =>
  props.message.content.replace(/^Contexto da triagem automática\s*/u, '').trim(),
)

const hasAttachment = computed(() => Boolean(props.message.attachmentUrl))
const isImageAttachment = computed(() =>
  Boolean(props.message.attachmentMimeType?.startsWith('image/')),
)
const formattedAttachmentSize = computed(() => {
  const size = props.message.attachmentSize
  if (!size) return ''
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  if (size >= 1024) return `${Math.round(size / 1024)} KB`
  return `${size} B`
})
</script>

<template>
  <div v-if="isTriageContext" class="flex justify-center">
    <div
      class="w-full max-w-[94%] rounded-lg border px-3 py-2 text-xs leading-relaxed"
      style="background: var(--vex-surface-strong); color: var(--vex-text); border-color: var(--vex-border-subtle)"
    >
      <div class="mb-2 flex items-center gap-2 font-extrabold" style="color: var(--vex-brand)">
        <UIcon name="i-lucide-clipboard-list" class="size-4" />
        Resumo da triagem
      </div>
      <p class="whitespace-pre-wrap break-words">{{ triageBody }}</p>
      <p class="mt-2 text-[10px] opacity-70">{{ time }}</p>
    </div>
  </div>
  <div v-else class="group flex items-center gap-1.5" :class="mine ? 'justify-end' : 'justify-start'">
    <button
      v-if="canEdit && !isEditing"
      class="shrink-0 rounded-full p-1.5 opacity-60 transition-opacity hover:opacity-100"
      style="color: var(--vex-text-faint); background: var(--vex-surface-strong)"
      title="Editar mensagem"
      aria-label="Editar mensagem"
      @click="startEdit"
    >
      <UIcon name="i-lucide-pencil" class="size-3.5" />
    </button>
    <div
      class="max-w-[82%] rounded-lg px-3 py-2 text-sm leading-relaxed"
      :class="isEditing ? 'w-full' : ''"
      :style="mine
        ? 'background: var(--vex-brand); color: white'
        : 'background: var(--vex-surface-strong); color: var(--vex-text); border: 1px solid var(--vex-border-subtle)'"
    >
      <a
        v-if="hasAttachment && isImageAttachment"
        :href="message.attachmentUrl ?? undefined"
        target="_blank"
        rel="noopener"
        class="mb-2 block"
      >
        <img
          :src="message.attachmentUrl ?? undefined"
          :alt="message.attachmentName ?? 'Anexo'"
          class="max-h-64 w-full rounded-md object-cover"
          loading="lazy"
        />
      </a>
      <a
        v-else-if="hasAttachment"
        :href="message.attachmentUrl ?? undefined"
        target="_blank"
        rel="noopener"
        class="mb-2 flex items-center gap-3 rounded-md px-2 py-2"
        :style="mine
          ? 'background: rgba(255,255,255,0.18); color: white'
          : 'background: var(--vex-surface); color: var(--vex-text); border: 1px solid var(--vex-border-subtle)'"
      >
        <UIcon name="i-lucide-file-text" class="size-5 shrink-0" />
        <div class="min-w-0 flex-1">
          <p class="truncate text-xs font-bold">{{ message.attachmentName || 'Anexo' }}</p>
          <p class="text-[10px] opacity-80">{{ formattedAttachmentSize }}</p>
        </div>
        <UIcon name="i-lucide-external-link" class="size-4 shrink-0 opacity-80" />
      </a>
      <div v-if="isEditing" class="flex flex-col gap-1.5">
        <textarea
          ref="textareaEl"
          v-model="editDraft"
          rows="2"
          class="w-full resize-none rounded-md px-2 py-1.5 text-sm outline-none"
          :style="mine
            ? 'background: rgba(255,255,255,0.16); color: white'
            : 'background: var(--vex-surface); color: var(--vex-text); border: 1px solid var(--vex-border-subtle)'"
          :disabled="isSaving"
          @keydown="onEditKeydown"
        />
        <p v-if="editError" class="text-[11px]" style="color: var(--vex-negative)">{{ editError }}</p>
        <div class="flex items-center justify-end gap-2">
          <button
            class="text-[11px] font-semibold opacity-80 hover:opacity-100"
            :disabled="isSaving"
            @click="cancelEdit"
          >
            Cancelar
          </button>
          <button
            class="flex items-center gap-1 text-[11px] font-semibold opacity-80 hover:opacity-100"
            :disabled="isSaving"
            @click="saveEdit"
          >
            <UIcon v-if="isSaving" name="i-lucide-loader-2" class="size-3 animate-spin" />
            Salvar
          </button>
        </div>
      </div>
      <template v-else>
        <p v-if="message.content" class="whitespace-pre-wrap break-words">{{ message.content }}</p>
        <p class="mt-1 text-[10px] opacity-70">
          {{ time }}
          <span v-if="message.editedAt"> · editado</span>
        </p>
      </template>
    </div>
  </div>
</template>
