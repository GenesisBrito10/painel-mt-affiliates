<script setup lang="ts">
definePageMeta({ layout: 'default' })

type LoginModalAudience = 'ALL' | 'AFFILIATE' | 'HEAD_AFFILIATE' | 'SUPPORT' | 'ADMIN' | 'SUPERADMIN'

interface LoginModalItem {
  id: string
  key: string
  enabled: boolean
  audience: LoginModalAudience
  priority: number
  kind: string
  title: string
  eyebrow: string
  description: string
  icon: string
  actionLabel: string
  secondaryActionLabel: string
  actionUrl: string | null
  accent: string
  storageKey: string
  dismissScope: string
  imageUrl: string | null
  imageLayout: string
  lockSeconds: number
  payload: unknown
  updatedAt: string
}

interface LoginModalForm {
  enabled: boolean
  audience: LoginModalAudience
  priority: number
  kind: string
  title: string
  eyebrow: string
  description: string
  icon: string
  actionLabel: string
  secondaryActionLabel: string
  actionUrl: string
  accent: string
  storageKey: string
  dismissScope: string
  imageUrl: string
  imageLayout: string
  lockSeconds: number
  paragraphs: string[]
  blocks: Array<{ title: string, body: string, tone: string, audience: string }>
  steps: Array<{ label: string, text: string, tone: string }>
  footer: string
  actionIcon: string
}

const { authHeaders } = useAuth()
const apiBase = useApiBase()
const toast = useToast()

const loading = ref(false)
const saving = ref(false)
const creating = ref(false)
const uploadingImage = ref(false)
const deletingKey = ref('')
const orderingKey = ref('')
const modals = ref<LoginModalItem[]>([])
const selectedKey = ref('')
const form = ref<LoginModalForm | null>(null)
const advancedOpen = ref(false)

const audienceOptions: LoginModalAudience[] = ['ALL', 'AFFILIATE', 'HEAD_AFFILIATE', 'SUPPORT', 'ADMIN', 'SUPERADMIN']
const accentOptions = ['brand', 'warning', 'positive']
const scopeOptions = ['session', 'local']
const imageLayoutOptions = ['none', 'top', 'full']
const imageLayoutLabels: Record<string, string> = {
  none: 'Sem imagem',
  top: 'Imagem no topo (com texto)',
  full: 'Imagem cheia (só imagem)'
}
const toneOptions = ['default', 'warning', 'danger']
const iconOptions = [
  { label: 'Aviso', value: 'i-lucide-megaphone' },
  { label: 'Atenção', value: 'i-lucide-triangle-alert' },
  { label: 'Email', value: 'i-lucide-mail-warning' },
  { label: 'WhatsApp', value: 'i-simple-icons-whatsapp' },
  { label: 'Instagram', value: 'i-lucide-instagram' },
  { label: 'Presente', value: 'i-lucide-gift' },
  { label: 'Troféu', value: 'i-lucide-trophy' },
  { label: 'Check', value: 'i-lucide-check-circle' },
  { label: 'Info', value: 'i-lucide-info' },
  { label: 'Estrela', value: 'i-lucide-star' }
]
const buttonIconOptions = [
  { label: 'Check', value: 'i-lucide-check-circle' },
  { label: 'Abrir link', value: 'i-lucide-external-link' },
  { label: 'WhatsApp', value: 'i-simple-icons-whatsapp' },
  { label: 'Instagram', value: 'i-lucide-instagram' },
  { label: 'Troféu', value: 'i-lucide-trophy' },
  { label: 'Presente', value: 'i-lucide-gift' },
  { label: 'Entrar', value: 'i-lucide-log-in' },
  { label: 'Enviar', value: 'i-lucide-send' },
  { label: 'Salvar', value: 'i-lucide-save' },
  { label: 'Info', value: 'i-lucide-info' }
]
const audienceLabels: Record<LoginModalAudience, string> = {
  ALL: 'Todos',
  AFFILIATE: 'Afiliados',
  HEAD_AFFILIATE: 'Afiliados com rede',
  SUPPORT: 'Suporte',
  ADMIN: 'Admins',
  SUPERADMIN: 'Super admins'
}
const accentLabels: Record<string, string> = {
  brand: 'Marca',
  warning: 'Atenção',
  positive: 'Positivo'
}
const scopeLabels: Record<string, string> = {
  session: 'Mostrar uma vez por sessão',
  local: 'Mostrar uma vez até mudar a chave'
}
const toneLabels: Record<string, string> = {
  default: 'Normal',
  warning: 'Atenção',
  danger: 'Crítico'
}

const selected = computed(() => modals.value.find(item => item.key === selectedKey.value) ?? null)
const orderedModals = computed(() => modals.value.slice().sort((a, b) => a.priority - b.priority))
const previewPayload = computed(() => form.value
  ? buildPayload(form.value)
  : { paragraphs: [], blocks: [], steps: [], footer: '' }
)
const dirty = computed(() => {
  if (!selected.value || !form.value) return false
  // Compara o formulário atual com o "formulário pristino" derivado do item
  // salvo, ambos pela MESMA pipeline (toForm). Comparar contra o payload cru
  // gerava falsos positivos (defaults de actionIcon, audience vazio) que
  // deixavam `dirty` sempre true e travavam os botões Salvar/Novo/trocar.
  return JSON.stringify(toForm(selected.value)) !== JSON.stringify(form.value)
})

function asPayloadObject(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {}
}

function normalizePayload(payload: unknown) {
  const object = asPayloadObject(payload)
  const paragraphs = Array.isArray(object.paragraphs)
    ? object.paragraphs.filter((item): item is string => typeof item === 'string')
    : []
  const rawBlocks = Array.isArray(object.blocks) ? object.blocks : []
  const blocks = rawBlocks
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    .map(item => ({
      title: typeof item.title === 'string' ? item.title : '',
      body: typeof item.body === 'string' ? item.body : '',
      tone: typeof item.tone === 'string' ? item.tone : 'default',
      audience: typeof item.audience === 'string' ? item.audience : ''
    }))

  if (!blocks.length && (typeof object.sectionTitle === 'string' || typeof object.sectionBody === 'string')) {
    blocks.push({
      title: typeof object.sectionTitle === 'string' ? object.sectionTitle : '',
      body: typeof object.sectionBody === 'string' ? object.sectionBody : '',
      tone: 'default',
      audience: ''
    })
  }

  const steps = Array.isArray(object.steps)
    ? object.steps
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
      .map(item => ({
        label: typeof item.label === 'string' ? item.label : '',
        text: typeof item.text === 'string' ? item.text : '',
        tone: typeof item.tone === 'string' ? item.tone : 'default'
      }))
    : []

  return {
    paragraphs,
    blocks,
    steps,
    footer: typeof object.footer === 'string' ? object.footer : '',
    actionIcon: typeof object.actionIcon === 'string' ? object.actionIcon : ''
  }
}

function buildPayload(value: LoginModalForm) {
  return {
    paragraphs: value.paragraphs.map(item => item.trim()).filter(Boolean),
    blocks: value.blocks
      .map(block => ({
        title: block.title.trim(),
        body: block.body.trim(),
        tone: block.tone || 'default',
        ...(block.audience ? { audience: block.audience } : {})
      }))
      .filter(block => block.title || block.body),
    steps: value.steps
      .map(step => ({
        label: step.label.trim(),
        text: step.text.trim(),
        tone: step.tone || 'default'
      }))
      .filter(step => step.label || step.text),
    footer: value.footer.trim(),
    actionIcon: value.actionIcon.trim()
  }
}

function toForm(item: LoginModalItem): LoginModalForm {
  const payload = normalizePayload(item.payload)
  return {
    enabled: item.enabled,
    audience: item.audience,
    priority: item.priority,
    kind: item.kind,
    title: item.title,
    eyebrow: item.eyebrow,
    description: item.description,
    icon: item.icon,
    actionLabel: item.actionLabel,
    secondaryActionLabel: item.secondaryActionLabel,
    actionUrl: item.actionUrl ?? '',
    accent: item.accent,
    storageKey: item.storageKey,
    dismissScope: item.dismissScope,
    imageUrl: item.imageUrl ?? '',
    imageLayout: item.imageLayout || 'none',
    lockSeconds: Number(item.lockSeconds ?? 0),
    paragraphs: payload.paragraphs.length ? payload.paragraphs : [''],
    blocks: payload.blocks,
    steps: payload.steps,
    footer: payload.footer,
    actionIcon: payload.actionIcon || (item.actionUrl ? 'i-lucide-external-link' : 'i-lucide-check-circle')
  }
}

function selectModal(item: LoginModalItem) {
  if (selectedKey.value && selectedKey.value !== item.key && dirty.value) {
    toast.add({ title: 'Salve ou desfaça antes de trocar de aviso', color: 'warning', icon: 'i-lucide-alert-circle' })
    return
  }
  selectedKey.value = item.key
  form.value = toForm(item)
  advancedOpen.value = false
}

function nextPriority() {
  return orderedModals.value.reduce((max, item) => Math.max(max, item.priority), 0) + 10
}

async function load() {
  loading.value = true
  try {
    const data = await $fetch<LoginModalItem[]>(`${apiBase}/v1/admin/login-modals`, {
      headers: authHeaders()
    })
    modals.value = data
    const current = orderedModals.value.find(item => item.key === selectedKey.value) ?? orderedModals.value[0] ?? null
    if (current) selectModal(current)
  } catch {
    toast.add({ title: 'Erro ao carregar modais', color: 'error' })
  } finally {
    loading.value = false
  }
}

async function createModal() {
  if (dirty.value) {
    toast.add({ title: 'Salve ou desfaça antes de criar outro modal', color: 'warning', icon: 'i-lucide-alert-circle' })
    return
  }
  creating.value = true
  try {
    const created = await $fetch<LoginModalItem>(`${apiBase}/v1/admin/login-modals`, {
      method: 'POST',
      headers: authHeaders(),
      body: {
        title: 'Novo aviso',
        audience: 'AFFILIATE',
        priority: nextPriority()
      }
    })
    modals.value = [...modals.value, created]
    selectModal(created)
    toast.add({ title: 'Novo modal criado', description: 'Ele começa desativado para você editar antes de publicar.', color: 'success', icon: 'i-lucide-plus' })
  } catch {
    toast.add({ title: 'Erro ao criar modal', color: 'error' })
  } finally {
    creating.value = false
  }
}

async function moveModal(item: LoginModalItem, direction: -1 | 1) {
  if (dirty.value) {
    toast.add({ title: 'Salve ou desfaça antes de mudar a ordem', color: 'warning', icon: 'i-lucide-alert-circle' })
    return
  }
  const current = orderedModals.value
  const index = current.findIndex(modal => modal.key === item.key)
  const targetIndex = index + direction
  if (index < 0 || targetIndex < 0 || targetIndex >= current.length) return

  const reordered = current.slice()
  const [moved] = reordered.splice(index, 1)
  reordered.splice(targetIndex, 0, moved)
  const items = reordered.map((modal, orderIndex) => ({
    key: modal.key,
    priority: (orderIndex + 1) * 10
  }))

  orderingKey.value = item.key
  try {
    const data = await $fetch<LoginModalItem[]>(`${apiBase}/v1/admin/login-modals/reorder`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: { items }
    })
    modals.value = data
    const currentSelected = orderedModals.value.find(modal => modal.key === selectedKey.value)
    if (currentSelected) selectModal(currentSelected)
    toast.add({ title: 'Ordem atualizada', color: 'success', icon: 'i-lucide-arrow-up-down' })
  } catch {
    toast.add({ title: 'Erro ao mudar ordem', color: 'error' })
  } finally {
    orderingKey.value = ''
  }
}

async function save() {
  if (!selected.value || !form.value) return

  const payload = buildPayload(form.value)

  saving.value = true
  try {
    const updated = await $fetch<LoginModalItem>(`${apiBase}/v1/admin/login-modals/${selected.value.key}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: {
        enabled: form.value.enabled,
        audience: form.value.audience,
        priority: Number(form.value.priority),
        kind: form.value.kind.trim(),
        title: form.value.title.trim(),
        eyebrow: form.value.eyebrow.trim(),
        description: form.value.description.trim(),
        icon: form.value.icon.trim(),
        actionLabel: form.value.actionLabel.trim(),
        secondaryActionLabel: form.value.secondaryActionLabel.trim(),
        actionUrl: form.value.actionUrl.trim() || null,
        accent: form.value.accent.trim(),
        storageKey: form.value.storageKey.trim(),
        dismissScope: form.value.dismissScope.trim(),
        imageUrl: form.value.imageUrl.trim() || null,
        imageLayout: form.value.imageLayout || 'none',
        lockSeconds: Number(form.value.lockSeconds) || 0,
        payload
      }
    })
    const index = modals.value.findIndex(item => item.key === updated.key)
    if (index >= 0) modals.value[index] = updated
    selectModal(updated)
    toast.add({ title: 'Modal atualizado', color: 'success', icon: 'i-lucide-check' })
  } catch {
    toast.add({ title: 'Erro ao salvar modal', color: 'error' })
  } finally {
    saving.value = false
  }
}

function reset() {
  if (selected.value) form.value = toForm(selected.value)
}

async function onImageSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || !form.value) return
  uploadingImage.value = true
  try {
    const body = new FormData()
    body.append('file', file)
    const res = await $fetch<{ url: string }>(`${apiBase}/v1/admin/login-modals/upload-image`, {
      method: 'POST',
      headers: authHeaders(),
      body
    })
    form.value.imageUrl = res.url
    if (form.value.imageLayout === 'none') form.value.imageLayout = 'top'
    toast.add({ title: 'Imagem enviada', color: 'success', icon: 'i-lucide-image' })
  } catch {
    toast.add({ title: 'Erro ao enviar imagem', color: 'error' })
  } finally {
    uploadingImage.value = false
    input.value = ''
  }
}

function removeImage() {
  if (!form.value) return
  form.value.imageUrl = ''
  form.value.imageLayout = 'none'
}

async function removeModal(item: LoginModalItem) {
  if (!window.confirm(`Excluir o modal "${item.title}"? Esta ação não pode ser desfeita.`)) return
  deletingKey.value = item.key
  try {
    await $fetch(`${apiBase}/v1/admin/login-modals/${item.key}`, {
      method: 'DELETE',
      headers: authHeaders()
    })
    modals.value = modals.value.filter(modal => modal.key !== item.key)
    if (selectedKey.value === item.key) {
      selectedKey.value = ''
      form.value = null
      const next = orderedModals.value[0]
      if (next) selectModal(next)
    }
    toast.add({ title: 'Modal excluído', color: 'success', icon: 'i-lucide-trash-2' })
  } catch {
    toast.add({ title: 'Erro ao excluir modal', color: 'error' })
  } finally {
    deletingKey.value = ''
  }
}

function addParagraph() {
  form.value?.paragraphs.push('')
}

function removeParagraph(index: number) {
  if (!form.value) return
  form.value.paragraphs.splice(index, 1)
  if (!form.value.paragraphs.length) form.value.paragraphs.push('')
}

function addBlock() {
  form.value?.blocks.push({ title: '', body: '', tone: 'default', audience: '' })
}

function removeBlock(index: number) {
  form.value?.blocks.splice(index, 1)
}

function addStep() {
  form.value?.steps.push({ label: '', text: '', tone: 'default' })
}

function removeStep(index: number) {
  form.value?.steps.splice(index, 1)
}

function modalCardClass(item: LoginModalItem) {
  if (selectedKey.value === item.key) return 'border-amber-400/60 bg-amber-400/10'
  if (!item.enabled) return 'border-zinc-800 bg-zinc-950/25 opacity-60 hover:border-zinc-700'
  return 'border-zinc-800 bg-zinc-950/40 hover:border-zinc-700'
}

function previewAccentClass(accent: string) {
  if (accent === 'warning') return 'border-amber-400/40 bg-amber-400/10 text-amber-200'
  if (accent === 'positive') return 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200'
  return 'border-violet-400/40 bg-violet-400/10 text-violet-200'
}

function previewToneClass(tone: string) {
  if (tone === 'warning') return 'border-amber-400/35 bg-amber-400/10'
  if (tone === 'danger') return 'border-red-400/35 bg-red-500/10'
  return 'border-zinc-800 bg-zinc-950/50'
}

function selectIcon(value: string) {
  if (!form.value) return
  form.value.icon = value
}

function selectActionIcon(value: string) {
  if (!form.value) return
  form.value.actionIcon = value
}

const fmtDate = (value: string) =>
  new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

onMounted(load)
</script>

<template>
  <div class="mx-auto grid w-full max-w-7xl gap-4 xl:grid-cols-[20rem_minmax(0,1fr)]">
    <UCard class="min-w-0 self-start xl:sticky xl:top-4">
      <template #header>
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="text-sm font-semibold text-zinc-100">
              Avisos
            </div>
            <div class="mt-0.5 text-xs text-zinc-400">
              O primeiro ativo aparece primeiro.
            </div>
          </div>
          <div class="flex items-center gap-1">
            <UButton icon="i-lucide-plus" color="primary" variant="soft" :disabled="dirty" :loading="creating" @click="createModal">
              Novo
            </UButton>
            <UButton icon="i-lucide-refresh-cw" color="neutral" variant="ghost" :loading="loading" @click="load" />
          </div>
        </div>
      </template>

      <div class="space-y-2">
        <div
          v-for="(item, index) in orderedModals"
          :key="item.key"
          class="rounded-lg border p-2 transition"
          :class="modalCardClass(item)"
        >
          <div class="flex items-start gap-2">
            <button type="button" class="min-w-0 flex-1 text-left" @click="selectModal(item)">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0 flex-1">
                  <div class="text-sm font-semibold leading-snug text-zinc-100 break-words">
                    {{ item.title }}
                  </div>
                  <div class="mt-1 text-[11px] leading-snug text-zinc-500 break-words">
                    {{ item.eyebrow || audienceLabels[item.audience] }}
                  </div>
                </div>
                <UBadge class="shrink-0" :color="item.enabled ? 'success' : 'neutral'" variant="subtle">
                  {{ item.enabled ? 'Ativo' : 'Off' }}
                </UBadge>
              </div>
              <div class="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
                <span>Posição {{ index + 1 }}</span>
                <span>{{ audienceLabels[item.audience] }}</span>
              </div>
            </button>

            <div class="grid shrink-0 gap-1">
              <UButton
                icon="i-lucide-chevron-up"
                color="neutral"
                variant="ghost"
                size="xs"
                :disabled="dirty || index === 0 || Boolean(orderingKey)"
                :loading="orderingKey === item.key"
                @click="moveModal(item, -1)"
              />
              <UButton
                icon="i-lucide-chevron-down"
                color="neutral"
                variant="ghost"
                size="xs"
                :disabled="dirty || index === orderedModals.length - 1 || Boolean(orderingKey)"
                :loading="orderingKey === item.key"
                @click="moveModal(item, 1)"
              />
              <UButton
                icon="i-lucide-trash-2"
                color="error"
                variant="ghost"
                size="xs"
                :disabled="Boolean(orderingKey) || Boolean(deletingKey)"
                :loading="deletingKey === item.key"
                @click="removeModal(item)"
              />
            </div>
          </div>
        </div>

        <div v-if="loading && !modals.length" class="py-10 text-center text-sm text-zinc-500">
          Carregando...
        </div>
      </div>
    </UCard>

    <UCard v-if="form && selected" class="min-w-0">
      <template #header>
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div class="min-w-0">
            <div class="text-sm font-semibold leading-snug text-zinc-100 break-words">
              {{ selected.title }}
            </div>
            <div class="mt-0.5 text-xs text-zinc-400">
              Atualizado em {{ fmtDate(selected.updatedAt) }}
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <USwitch v-model="form.enabled" />
            <span class="text-xs font-medium text-zinc-300">{{ form.enabled ? 'Ativo' : 'Desativado' }}</span>
          </div>
        </div>
      </template>

      <div class="grid gap-6">
        <section class="grid gap-3">
          <div class="text-xs font-bold uppercase tracking-wider text-zinc-500">
            Prévia
          </div>
          <div class="mx-auto w-full max-w-xl rounded-xl border border-zinc-800 bg-zinc-950">
            <div class="bg-zinc-900 px-5 py-5 text-center">
              <div
                class="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl border"
                :class="previewAccentClass(form.accent)"
              >
                <UIcon :name="form.icon || 'i-lucide-megaphone'" class="size-6" />
              </div>
              <div class="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">
                {{ form.eyebrow || 'Texto acima do título' }}
              </div>
              <div class="mt-1 text-base font-extrabold leading-tight text-white break-words">
                {{ form.title || 'Título do aviso' }}
              </div>
              <div v-if="form.description" class="mx-auto mt-2 max-w-lg whitespace-pre-wrap text-xs leading-5 text-zinc-400 break-words">
                {{ form.description }}
              </div>
            </div>
            <div class="space-y-3 p-4 text-sm leading-6 text-zinc-300">
              <p v-for="text in previewPayload.paragraphs" :key="text" class="whitespace-pre-wrap break-words">
                {{ text }}
              </p>
              <div
                v-for="block in previewPayload.blocks"
                :key="`${block.title}:${block.body}`"
                class="rounded-lg border p-3"
                :class="previewToneClass(block.tone)"
              >
                <div v-if="block.title" class="text-sm font-semibold text-zinc-100 break-words">
                  {{ block.title }}
                </div>
                <div v-if="block.body" class="mt-1 whitespace-pre-wrap text-xs leading-5 text-zinc-300 break-words">
                  {{ block.body }}
                </div>
              </div>
              <div v-if="previewPayload.steps.length" class="grid gap-2 sm:grid-cols-3">
                <div
                  v-for="step in previewPayload.steps"
                  :key="`${step.label}:${step.text}`"
                  class="rounded-lg border p-2 text-center"
                  :class="previewToneClass(step.tone)"
                >
                  <div class="text-[10px] font-bold uppercase leading-tight text-zinc-400 break-words">
                    {{ step.label }}
                  </div>
                  <div class="mt-1 text-xs font-semibold leading-tight text-zinc-100 break-words">
                    {{ step.text }}
                  </div>
                </div>
              </div>
              <p v-if="previewPayload.footer" class="whitespace-pre-wrap text-xs text-zinc-500 break-words">
                {{ previewPayload.footer }}
              </p>
              <div class="grid gap-2 pt-1">
                <div class="rounded-lg bg-amber-400 px-3 py-2 text-center text-sm font-semibold leading-snug text-zinc-950">
                  <span class="inline-flex max-w-full items-center justify-center gap-2 break-words">
                    <UIcon :name="form.actionIcon || 'i-lucide-check-circle'" class="size-4" />
                    <span class="min-w-0 break-words">{{ form.actionLabel || 'Entendi' }}</span>
                  </span>
                </div>
                <div v-if="form.actionUrl" class="text-center text-xs leading-snug text-zinc-500 break-words">
                  {{ form.secondaryActionLabel || 'Agora não' }}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class="grid gap-4">
          <div>
            <div class="text-xs font-bold uppercase tracking-wider text-zinc-500">
              Visibilidade
            </div>
            <div class="mt-1 text-xs text-zinc-400">
              Status, público e posição na fila de avisos.
            </div>
          </div>

          <div class="grid gap-4 md:grid-cols-3">
            <UFormField label="Ordem de exibição">
              <UInput v-model.number="form.priority" type="number" min="0" />
            </UFormField>
            <UFormField label="Quem vê">
              <select v-model="form.audience" class="h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100">
                <option v-for="option in audienceOptions" :key="option" :value="option">
                  {{ audienceLabels[option] }}
                </option>
              </select>
            </UFormField>
            <UFormField label="Cor do aviso">
              <select v-model="form.accent" class="h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100">
                <option v-for="option in accentOptions" :key="option" :value="option">
                  {{ accentLabels[option] }}
                </option>
              </select>
            </UFormField>
          </div>
        </section>

        <section class="grid gap-4 border-t border-zinc-800 pt-5">
          <div>
            <div class="text-xs font-bold uppercase tracking-wider text-zinc-500">
              Imagem e trava
            </div>
            <div class="mt-1 text-xs text-zinc-400">
              Suba uma imagem (ou cole uma URL) e defina por quantos segundos o modal fica travado sem o usuário poder fechar.
            </div>
          </div>

          <div class="grid gap-4 md:grid-cols-2">
            <UFormField label="Layout da imagem">
              <select v-model="form.imageLayout" class="h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100">
                <option v-for="option in imageLayoutOptions" :key="option" :value="option">
                  {{ imageLayoutLabels[option] }}
                </option>
              </select>
            </UFormField>
            <UFormField label="Trava (segundos sem poder fechar)">
              <UInput v-model.number="form.lockSeconds" type="number" min="0" max="120" />
            </UFormField>
          </div>

          <UFormField label="URL da imagem (R2 ou link externo)">
            <UInput v-model="form.imageUrl" class="w-full" placeholder="https://..." maxlength="500" />
          </UFormField>

          <div class="flex flex-wrap items-center gap-3">
            <label class="inline-flex cursor-pointer items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 hover:border-zinc-700">
              <UIcon :name="uploadingImage ? 'i-lucide-loader-circle' : 'i-lucide-upload'" :class="uploadingImage ? 'size-4 animate-spin' : 'size-4'" />
              <span>{{ uploadingImage ? 'Enviando...' : 'Enviar imagem' }}</span>
              <input type="file" accept="image/*" class="hidden" :disabled="uploadingImage" @change="onImageSelected">
            </label>
            <UButton
              v-if="form.imageUrl"
              icon="i-lucide-x"
              color="error"
              variant="ghost"
              size="sm"
              @click="removeImage"
            >
              Remover imagem
            </UButton>
          </div>

          <div v-if="form.imageUrl" class="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
            <img :src="form.imageUrl" alt="Prévia da imagem" class="max-h-64 w-full object-contain">
          </div>
        </section>

        <section class="grid gap-4 border-t border-zinc-800 pt-5">
          <div>
            <div class="text-xs font-bold uppercase tracking-wider text-zinc-500">
              Cabeçalho
            </div>
            <div class="mt-1 text-xs text-zinc-400">
              Título e resumo que aparecem no topo do modal.
            </div>
          </div>

          <div class="grid gap-4 md:grid-cols-2">
            <UFormField label="Título">
              <UInput v-model="form.title" class="w-full" maxlength="160" />
            </UFormField>
            <UFormField label="Etiqueta">
              <UInput v-model="form.eyebrow" class="w-full" maxlength="80" />
            </UFormField>
          </div>

          <UFormField label="Resumo">
            <UTextarea v-model="form.description" class="w-full" :rows="4" autoresize maxlength="2000" />
          </UFormField>

          <div class="grid gap-3">
            <div>
              <div class="text-sm font-medium text-zinc-200">
                Ícone
              </div>
              <div class="mt-0.5 text-xs text-zinc-500">
                Escolha o símbolo que aparece no topo do modal.
              </div>
            </div>
            <div class="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <button
                v-for="option in iconOptions"
                :key="option.value"
                type="button"
                class="flex min-h-20 flex-col items-center justify-center gap-2 rounded-lg border px-2 py-3 text-center transition"
                :class="form.icon === option.value ? 'border-amber-400/70 bg-amber-400/10 text-amber-200' : 'border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'"
                @click="selectIcon(option.value)"
              >
                <UIcon :name="option.value" class="size-6" />
                <span class="text-[11px] font-medium leading-tight">{{ option.label }}</span>
              </button>
            </div>
          </div>
        </section>

        <section class="grid gap-4 border-t border-zinc-800 pt-5">
          <div class="flex items-center justify-between gap-3">
            <div>
              <div class="text-xs font-bold uppercase tracking-wider text-zinc-500">
                Textos
              </div>
              <div class="mt-1 text-xs text-zinc-400">
                Linhas principais do corpo do aviso.
              </div>
            </div>
            <UButton size="sm" color="neutral" variant="soft" icon="i-lucide-plus" @click="addParagraph">
              Adicionar texto
            </UButton>
          </div>

          <div class="grid gap-3">
            <div v-for="(_, index) in form.paragraphs" :key="index" class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_2.5rem]">
              <UTextarea v-model="form.paragraphs[index]" class="min-w-0 w-full" :rows="3" autoresize />
              <UButton class="self-start sm:mt-0" icon="i-lucide-trash-2" color="error" variant="ghost" :disabled="form.paragraphs.length === 1 && !form.paragraphs[index]" @click="removeParagraph(index)" />
            </div>
          </div>
        </section>

        <section class="grid gap-4 border-t border-zinc-800 pt-5">
          <div class="flex items-center justify-between gap-3">
            <div>
              <div class="text-xs font-bold uppercase tracking-wider text-zinc-500">
                Destaques
              </div>
              <div class="mt-1 text-xs text-zinc-400">
                Caixas para regras, alertas ou observações.
              </div>
            </div>
            <UButton size="sm" color="neutral" variant="soft" icon="i-lucide-plus" @click="addBlock">
              Adicionar caixa
            </UButton>
          </div>

          <div v-if="form.blocks.length" class="grid gap-3">
            <div v-for="(block, index) in form.blocks" :key="index" class="min-w-0 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
              <div class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_10rem_12rem_2.5rem]">
                <UFormField label="Título da caixa" class="min-w-0">
                  <UInput v-model="block.title" class="w-full" />
                </UFormField>
                <UFormField label="Tom">
                  <select v-model="block.tone" class="h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100">
                    <option v-for="option in toneOptions" :key="option" :value="option">
                      {{ toneLabels[option] }}
                    </option>
                  </select>
                </UFormField>
                <UFormField label="Só para">
                  <select v-model="block.audience" class="h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100">
                    <option value="">Mesmo público</option>
                    <option value="HEAD_AFFILIATE">Afiliados com rede</option>
                  </select>
                </UFormField>
                <div class="flex items-end">
                  <UButton icon="i-lucide-trash-2" color="error" variant="ghost" @click="removeBlock(index)" />
                </div>
              </div>
              <UFormField class="mt-3" label="Texto da caixa">
                <UTextarea v-model="block.body" class="w-full" :rows="4" autoresize />
              </UFormField>
            </div>
          </div>
          <div v-else class="rounded-lg border border-dashed border-zinc-800 py-6 text-center text-sm text-zinc-500">
            Nenhuma caixa de destaque.
          </div>
        </section>

        <section class="grid gap-4 border-t border-zinc-800 pt-5">
          <div class="flex items-center justify-between gap-3">
            <div>
              <div class="text-xs font-bold uppercase tracking-wider text-zinc-500">
                Etapas
              </div>
              <div class="mt-1 text-xs text-zinc-400">
                Blocos curtos como Dia 1, Dia 2, Dia 3.
              </div>
            </div>
            <UButton size="sm" color="neutral" variant="soft" icon="i-lucide-plus" @click="addStep">
              Adicionar etapa
            </UButton>
          </div>

          <div v-if="form.steps.length" class="grid gap-3 lg:grid-cols-3">
            <div v-for="(step, index) in form.steps" :key="index" class="min-w-0 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
              <div class="flex items-start justify-between gap-2">
                <UFormField label="Rótulo" class="flex-1">
                  <UInput v-model="step.label" class="w-full" placeholder="Dia 1" />
                </UFormField>
                <UButton class="mt-6" icon="i-lucide-trash-2" color="error" variant="ghost" @click="removeStep(index)" />
              </div>
              <UFormField class="mt-3" label="Texto">
                <UInput v-model="step.text" class="w-full" placeholder="Aviso" />
              </UFormField>
              <UFormField class="mt-3" label="Tom">
                <select v-model="step.tone" class="h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100">
                  <option v-for="option in toneOptions" :key="option" :value="option">
                    {{ toneLabels[option] }}
                  </option>
                </select>
              </UFormField>
            </div>
          </div>
          <div v-else class="rounded-lg border border-dashed border-zinc-800 py-6 text-center text-sm text-zinc-500">
            Nenhuma etapa cadastrada.
          </div>
        </section>

        <section class="grid gap-4 border-t border-zinc-800 pt-5">
          <UFormField label="Texto final">
            <UTextarea v-model="form.footer" class="w-full" :rows="3" autoresize />
          </UFormField>

          <div class="grid gap-4 md:grid-cols-2">
            <UFormField label="Texto do botão principal">
              <UInput v-model="form.actionLabel" class="w-full" maxlength="80" />
            </UFormField>
            <UFormField label="Link do botão principal">
              <UInput v-model="form.actionUrl" class="w-full" placeholder="https://..." maxlength="500" />
            </UFormField>
          </div>

          <div class="grid gap-3">
            <div>
              <div class="text-sm font-medium text-zinc-200">
                Ícone do botão
              </div>
              <div class="mt-0.5 text-xs text-zinc-500">
                Escolha o símbolo que aparece dentro do botão principal.
              </div>
            </div>
            <div class="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <button
                v-for="option in buttonIconOptions"
                :key="option.value"
                type="button"
                class="flex min-h-20 flex-col items-center justify-center gap-2 rounded-lg border px-2 py-3 text-center transition"
                :class="form.actionIcon === option.value ? 'border-amber-400/70 bg-amber-400/10 text-amber-200' : 'border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'"
                @click="selectActionIcon(option.value)"
              >
                <UIcon :name="option.value" class="size-6" />
                <span class="text-[11px] font-medium leading-tight">{{ option.label }}</span>
              </button>
            </div>
          </div>
        </section>

        <section class="border-t border-zinc-800 pt-5">
          <button
            type="button"
            class="flex w-full items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-left"
            @click="advancedOpen = !advancedOpen"
          >
            <span>
              <span class="block text-sm font-semibold text-zinc-200">Avançado</span>
              <span class="block text-xs text-zinc-500">Tipo interno, ícone e regra de reaparecimento.</span>
            </span>
            <UIcon name="i-lucide-chevron-down" class="size-4 transition-transform" :class="advancedOpen ? 'rotate-180' : ''" />
          </button>

          <div v-if="advancedOpen" class="mt-4 grid gap-4 md:grid-cols-2">
            <UFormField label="Tipo interno">
              <UInput v-model="form.kind" />
            </UFormField>
            <UFormField label="Ícone customizado">
              <UInput v-model="form.icon" placeholder="i-lucide-megaphone" />
              <template #hint>
                Use só se precisar de um ícone que não esteja na lista.
              </template>
            </UFormField>
            <UFormField label="Quando reaparece">
              <select v-model="form.dismissScope" class="h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100">
                <option v-for="option in scopeOptions" :key="option" :value="option">
                  {{ scopeLabels[option] }}
                </option>
              </select>
            </UFormField>
            <UFormField label="Chave de controle">
              <UInput v-model="form.storageKey" maxlength="120" />
              <template #hint>
                Altere essa chave quando quiser que o aviso apareça de novo para quem já fechou.
              </template>
            </UFormField>
            <UFormField label="Botão secundário">
              <UInput v-model="form.secondaryActionLabel" maxlength="80" />
            </UFormField>
            <UFormField label="Ícone customizado do botão">
              <UInput v-model="form.actionIcon" placeholder="i-lucide-check-circle" />
            </UFormField>
          </div>
        </section>

        <div class="flex flex-wrap items-center justify-end gap-2">
          <UButton color="neutral" variant="ghost" :disabled="!dirty || saving" @click="reset">
            Desfazer
          </UButton>
          <UButton color="primary" icon="i-lucide-save" :disabled="!dirty" :loading="saving" @click="save">
            Salvar modal
          </UButton>
        </div>
      </div>
    </UCard>

    <UCard v-else>
      <div class="py-16 text-center text-sm text-zinc-500">
        Nenhum modal cadastrado.
      </div>
    </UCard>
  </div>
</template>
