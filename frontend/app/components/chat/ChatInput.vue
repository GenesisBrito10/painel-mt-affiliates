<script setup lang="ts">
import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENT_SIZE_BYTES,
  type ChatAttachment,
} from '~/composables/useChat'

const emit = defineEmits<{
  send: [payload: { content: string; attachment?: ChatAttachment }]
  typing: [started: boolean]
}>()

const chat = useChat()

const content = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const pendingFile = ref<File | null>(null)
const pendingPreview = ref<string | null>(null)
const isUploading = ref(false)
const uploadError = ref('')
let typingTimer: ReturnType<typeof setTimeout> | null = null

const acceptAttr = ALLOWED_ATTACHMENT_MIME_TYPES.join(',')
const hasAttachment = computed(() => Boolean(pendingFile.value))
const canSubmit = computed(
  () => !isUploading.value && (content.value.trim().length > 0 || hasAttachment.value),
)
const previewIsImage = computed(() => pendingFile.value?.type.startsWith('image/') ?? false)

async function submit() {
  if (!canSubmit.value) return
  const text = content.value.trim()
  let attachment: ChatAttachment | undefined

  if (pendingFile.value) {
    isUploading.value = true
    uploadError.value = ''
    try {
      attachment = await chat.uploadAttachment(pendingFile.value)
    } catch (err) {
      uploadError.value = (err as Error).message || 'Falha ao enviar anexo.'
      isUploading.value = false
      return
    }
    isUploading.value = false
  }

  emit('send', { content: text, attachment })
  content.value = ''
  clearPendingFile()
  emit('typing', false)
}

function onInput() {
  emit('typing', true)
  if (typingTimer) clearTimeout(typingTimer)
  typingTimer = setTimeout(() => emit('typing', false), 900)
}

function onPickFile() {
  fileInput.value?.click()
}

function onFileSelected(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  target.value = ''
  if (!file) return
  setPendingFile(file)
}

function onPaste(event: ClipboardEvent) {
  const item = Array.from(event.clipboardData?.items ?? []).find((entry) => entry.kind === 'file')
  if (!item) return
  const file = item.getAsFile()
  if (!file) return
  setPendingFile(file)
}

function setPendingFile(file: File) {
  uploadError.value = ''
  if (!ALLOWED_ATTACHMENT_MIME_TYPES.includes(file.type as never)) {
    uploadError.value = 'Tipo de arquivo não suportado. Envie imagem ou PDF.'
    return
  }
  if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
    uploadError.value = 'Arquivo excede 10 MB.'
    return
  }
  if (pendingPreview.value) URL.revokeObjectURL(pendingPreview.value)
  pendingFile.value = file
  pendingPreview.value = file.type.startsWith('image/') ? URL.createObjectURL(file) : null
}

function clearPendingFile() {
  if (pendingPreview.value) URL.revokeObjectURL(pendingPreview.value)
  pendingFile.value = null
  pendingPreview.value = null
}

function formatBytes(size: number) {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  if (size >= 1024) return `${Math.round(size / 1024)} KB`
  return `${size} B`
}

onBeforeUnmount(() => {
  if (pendingPreview.value) URL.revokeObjectURL(pendingPreview.value)
})
</script>

<template>
  <form class="flex flex-col gap-2 border-t p-3" style="border-color: var(--vex-border-subtle)" @submit.prevent="submit">
    <div
      v-if="pendingFile"
      class="flex items-center gap-3 rounded-lg p-2"
      style="background: var(--vex-surface-strong); border: 1px solid var(--vex-border-subtle)"
    >
      <img
        v-if="previewIsImage && pendingPreview"
        :src="pendingPreview"
        alt="Pré-visualização"
        class="size-12 rounded object-cover"
      />
      <div
        v-else
        class="grid size-12 place-items-center rounded"
        style="background: var(--vex-brand-light); color: var(--vex-brand)"
      >
        <UIcon name="i-lucide-file-text" class="size-5" />
      </div>
      <div class="min-w-0 flex-1">
        <p class="truncate text-xs font-bold" style="color: var(--vex-text)">{{ pendingFile.name }}</p>
        <p class="text-[10px]" style="color: var(--vex-text-muted)">{{ formatBytes(pendingFile.size) }}</p>
      </div>
      <button
        type="button"
        class="flex size-7 items-center justify-center rounded"
        style="color: var(--vex-text-muted)"
        :disabled="isUploading"
        aria-label="Remover anexo"
        @click="clearPendingFile"
      >
        <UIcon name="i-lucide-x" class="size-4" />
      </button>
    </div>

    <p v-if="uploadError" class="text-xs" style="color: var(--vex-danger)">{{ uploadError }}</p>

    <div class="flex items-end gap-2">
      <input
        ref="fileInput"
        type="file"
        :accept="acceptAttr"
        class="hidden"
        @change="onFileSelected"
      />
      <button
        type="button"
        class="flex size-10 shrink-0 items-center justify-center rounded-lg transition-all disabled:opacity-40"
        style="background: var(--vex-surface-strong); color: var(--vex-text)"
        :disabled="isUploading"
        aria-label="Anexar imagem ou PDF"
        @click="onPickFile"
      >
        <UIcon name="i-lucide-paperclip" class="size-4" />
      </button>
      <textarea
        v-model="content"
        rows="1"
        maxlength="2000"
        class="min-h-10 max-h-28 flex-1 resize-none rounded-lg px-3 py-2 text-sm outline-none"
        style="background: var(--vex-surface-strong); color: var(--vex-text); border: 1px solid var(--vex-border-subtle)"
        :placeholder="hasAttachment ? 'Mensagem (opcional)' : 'Escreva sua mensagem'"
        :disabled="isUploading"
        @input="onInput"
        @paste="onPaste"
        @keydown.enter.exact.prevent="submit"
      />
      <button
        type="submit"
        class="flex size-10 shrink-0 items-center justify-center rounded-lg transition-all disabled:opacity-40"
        style="background: var(--vex-brand); color: white"
        :disabled="!canSubmit"
        aria-label="Enviar mensagem"
      >
        <UIcon v-if="isUploading" name="i-lucide-loader-2" class="size-4 animate-spin" />
        <UIcon v-else name="i-lucide-send" class="size-4" />
      </button>
    </div>
  </form>
</template>
