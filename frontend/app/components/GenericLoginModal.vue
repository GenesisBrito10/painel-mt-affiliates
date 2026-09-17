<script setup lang="ts">
import type { LoginModalConfig } from '~/composables/useLoginModals'

const props = defineProps<{
  modal: LoginModalConfig | null
}>()

const emit = defineEmits<{
  close: []
  action: []
}>()

const open = defineModel<boolean>('open', { default: false })

const imageUrl = computed(() => props.modal?.imageUrl || '')
const imageLayout = computed(() => props.modal?.imageLayout || 'none')
const hasImage = computed(() => !!imageUrl.value && imageLayout.value !== 'none')
const isFullImage = computed(() => hasImage.value && imageLayout.value === 'full')

// Countdown de trava: enquanto remaining > 0 o usuário não pode fechar/pular.
const remaining = ref(0)
let lockTimer: ReturnType<typeof setInterval> | null = null
const locked = computed(() => remaining.value > 0)

function clearLockTimer() {
  if (lockTimer) {
    clearInterval(lockTimer)
    lockTimer = null
  }
}

function startLock() {
  clearLockTimer()
  const seconds = Number(props.modal?.lockSeconds ?? 0)
  remaining.value = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  if (remaining.value <= 0) return
  lockTimer = setInterval(() => {
    remaining.value -= 1
    if (remaining.value <= 0) clearLockTimer()
  }, 1000)
}

watch(open, (isOpen) => {
  if (isOpen) startLock()
  else clearLockTimer()
}, { immediate: true })

onUnmounted(clearLockTimer)

function onClose() {
  if (locked.value) return
  emit('close')
}

// CTA configurado é liberado mesmo durante a trava — só o fechar/pular fica travado.
function onAction() {
  emit('action')
}

const payload = computed(() => props.modal?.payload ?? {})
const paragraphs = computed(() => {
  const value = payload.value?.paragraphs
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
})
const blocks = computed(() => {
  const value = payload.value?.blocks
  const normalized = Array.isArray(value)
    ? value.filter((item): item is { title?: string, body?: string, tone?: string } => typeof item === 'object' && item !== null)
    : []

  const sectionTitle = payload.value?.sectionTitle
  const sectionBody = payload.value?.sectionBody
  if ((typeof sectionTitle === 'string' && sectionTitle) || (typeof sectionBody === 'string' && sectionBody)) {
    normalized.push({
      title: typeof sectionTitle === 'string' ? sectionTitle : '',
      body: typeof sectionBody === 'string' ? sectionBody : '',
      tone: 'default',
    })
  }

  return normalized
})
const steps = computed(() => {
  const value = payload.value?.steps
  return Array.isArray(value)
    ? value.filter((item): item is { label?: string, text?: string, tone?: string } => typeof item === 'object' && item !== null)
    : []
})
const footer = computed(() => typeof payload.value?.footer === 'string' ? payload.value.footer : '')
const actionIcon = computed(() => {
  const value = payload.value?.actionIcon
  if (typeof value === 'string' && value) return value
  return props.modal?.actionUrl
    ? (props.modal.icon || 'i-lucide-external-link')
    : 'i-lucide-check-circle'
})

const accentStyle = computed(() => {
  if (props.modal?.accent === 'warning') return {
    color: 'var(--vex-warning)',
    soft: 'var(--vex-warning-soft-bg)',
    border: 'var(--vex-warning-soft-border)',
  }
  if (props.modal?.accent === 'positive') return {
    color: 'var(--vex-positive)',
    soft: 'var(--vex-positive-soft-bg)',
    border: 'var(--vex-positive)',
  }
  return {
    color: 'var(--vex-brand)',
    soft: 'var(--vex-brand-soft-bg)',
    border: 'var(--vex-brand-soft-border)',
  }
})

function blockStyle(tone?: string) {
  if (tone === 'danger') {
    return 'background: rgba(220, 38, 38, 0.14); border: 1px solid rgba(248, 113, 113, 0.65)'
  }
  if (tone === 'warning') {
    return 'background: var(--vex-warning-soft-bg); border: 1px solid var(--vex-warning-soft-border)'
  }
  return 'background: var(--vex-surface-strong); border: 1px solid var(--vex-border-subtle)'
}
</script>

<template>
  <UModal
    v-model:open="open"
    :dismissible="false"
    :ui="{ content: 'max-w-md max-h-[90dvh] overflow-y-auto overscroll-contain p-0' }"
  >
    <template #content>
      <div v-if="modal">
        <!-- Imagem: topo (layout 'top') ou imagem cheia (layout 'full', sem hero/texto) -->
        <img
          v-if="hasImage"
          :src="imageUrl"
          alt=""
          class="block w-full h-auto"
        >
        <div
          v-if="!isFullImage"
          class="relative overflow-hidden px-6 pt-8 pb-7 text-center vex-shell-hero-panel"
        >
          <div
            class="relative z-10 mx-auto mb-3 flex size-16 items-center justify-center rounded-2xl"
            :style="{ background: accentStyle.soft, border: `1px solid ${accentStyle.border}` }"
          >
            <UIcon :name="modal.icon || 'i-lucide-megaphone'" class="size-8" :style="{ color: accentStyle.color }" />
          </div>
          <p class="relative z-10 text-[10px] font-bold uppercase tracking-[0.14em]" style="color: var(--vex-shell-dark-label)">
            {{ modal.eyebrow }}
          </p>
          <h2 class="relative z-10 mt-1 text-[18px] font-extrabold vex-title text-white leading-tight">
            {{ modal.title }}
          </h2>
          <p
            v-if="modal.description"
            class="relative z-10 mt-2 text-[12px] leading-relaxed"
            style="color: var(--vex-shell-dark-subtle)"
          >
            {{ modal.description }}
          </p>
        </div>

        <div class="p-5 space-y-3 text-[13px] leading-relaxed" style="background: var(--vex-surface); color: var(--vex-text)">
          <template v-if="!isFullImage">
          <p v-for="text in paragraphs" :key="text">
            {{ text }}
          </p>

          <div
            v-for="block in blocks"
            :key="`${block.title ?? ''}:${block.body ?? ''}`"
            class="rounded-lg p-3"
            :style="blockStyle(block.tone)"
          >
            <p v-if="block.title" class="font-semibold" :style="{ color: block.tone === 'warning' ? 'var(--vex-warning)' : 'var(--vex-text)' }">
              {{ block.title }}
            </p>
            <p v-if="block.body" class="mt-1">
              {{ block.body }}
            </p>
          </div>

          <div v-if="steps.length" class="grid gap-2" :class="steps.length === 3 ? 'grid-cols-3' : 'grid-cols-2'">
            <div
              v-for="step in steps"
              :key="`${step.label ?? ''}:${step.text ?? ''}`"
              class="rounded-lg px-2 py-2 text-center"
              :style="blockStyle(step.tone)"
            >
              <p class="text-[10px] font-bold uppercase" :style="{ color: step.tone === 'danger' ? '#fca5a5' : accentStyle.color }">
                {{ step.label }}
              </p>
              <p class="mt-0.5 text-[11px] font-semibold leading-tight" style="color: var(--vex-text)">
                {{ step.text }}
              </p>
            </div>
          </div>

          <p v-if="footer" style="color: var(--vex-text-subtle)">
            {{ footer }}
          </p>
          </template>

          <!-- CTA configurado (com link): aparece sempre, inclusive durante a trava -->
          <UButton
            v-if="modal.actionUrl"
            block
            size="lg"
            color="primary"
            :icon="actionIcon"
            @click="onAction"
          >
            {{ modal.actionLabel || 'Abrir' }}
          </UButton>
          <!-- Sem link: o botão só fecha → só aparece depois da trava -->
          <UButton
            v-else-if="!locked"
            block
            size="lg"
            color="primary"
            :icon="actionIcon"
            @click="onClose"
          >
            {{ modal.actionLabel || 'Entendi' }}
          </UButton>

          <!-- Fechar/pular: só liberado quando a trava acaba -->
          <UButton
            v-if="modal.actionUrl && !locked"
            block
            color="neutral"
            variant="ghost"
            size="sm"
            @click="onClose"
          >
            {{ modal.secondaryActionLabel || 'Agora não' }}
          </UButton>

          <!-- Contador enquanto o fechar está travado -->
          <div
            v-if="locked"
            class="flex items-center justify-center gap-2 py-1 text-[12px] font-semibold"
            style="color: var(--vex-text-subtle)"
          >
            <UIcon name="i-lucide-clock" class="size-4" />
            <span>Aguarde {{ remaining }}s para fechar</span>
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>
