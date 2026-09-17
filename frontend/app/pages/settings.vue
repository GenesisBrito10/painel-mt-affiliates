<script setup lang="ts">
import { z } from 'zod'

definePageMeta({ layout: 'default' })

const { user, updateName, needsOnboarding, needsEmailUpdate, checkEmailAvailability, authHeaders, fetchMe } = useAuth()
const apiBase = useApiBase()
const toast = useToast()
const {
  pushEnabled,
  pushLoading,
  pushSupported,
  pushError,
  initPushState,
  togglePush,
  sendTestPush,
} = useNotifications()

const schema = z.object({
  currentPassword: z.string().min(1, 'A senha atual é obrigatória'),
  newPassword: z.string().min(6, 'A nova senha deve ter no mínimo 6 caracteres'),
  confirmPassword: z.string().min(1, 'A confirmação é obrigatória')
}).refine(data => data.newPassword === data.confirmPassword, {
  message: 'As senhas não coincidem',
  path: ['confirmPassword']
})

const state = reactive({
  currentPassword: '',
  newPassword: '',
  confirmPassword: ''
})

const loading = ref(false)
const activeTab = ref('profile')
const avatarInput = ref<HTMLInputElement | null>(null)
const avatarSaving = ref(false)

// ─── Profile name edit ───────────────────────────────────────────────────────
const editableName = ref(user.value?.name ?? '')
const savingName = ref(false)
const editableEmail = ref(user.value?.email ?? '')
const savingEmail = ref(false)
const emailError = ref('')

watch(() => user.value?.name, (name) => {
  if (name) editableName.value = name
})

watch(() => user.value?.email, (email) => {
  if (email) editableEmail.value = email
})

watch(needsEmailUpdate, (required) => {
  if (required) activeTab.value = 'profile'
}, { immediate: true })

async function saveName() {
  const trimmed = editableName.value.trim()
  if (!trimmed || trimmed === user.value?.name) return
  savingName.value = true
  try {
    await updateName(trimmed)
    toast.add({ title: 'Nome atualizado!', color: 'success', icon: 'i-lucide-check-circle' })
  } catch {
    toast.add({ title: 'Erro ao atualizar nome', color: 'error', icon: 'i-lucide-x-circle' })
  } finally {
    savingName.value = false
  }
}

function hasBlockedEmailDomain(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase()
  return domain === 'mtafiliates.com.br'
}

async function saveEmail() {
  const email = editableEmail.value.trim().toLowerCase()
  emailError.value = ''

  if (!z.string().email().safeParse(email).success) {
    emailError.value = 'Informe um e-mail válido.'
    return
  }

  if (hasBlockedEmailDomain(email)) {
    emailError.value = 'Use um e-mail pessoal ou profissional válido.'
    return
  }

  if (email === user.value?.email) return

  savingEmail.value = true
  try {
    const available = await checkEmailAvailability(email)
    if (!available) {
      emailError.value = 'Este e-mail já está cadastrado.'
      return
    }

    await $fetch(`${apiBase}/v1/users/me`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: { email },
    })
    await fetchMe()
    toast.add({ title: 'E-mail atualizado!', color: 'success', icon: 'i-lucide-check-circle' })
  } catch {
    emailError.value = 'Erro ao atualizar e-mail.'
  } finally {
    savingEmail.value = false
  }
}

function openAvatarPicker() {
  if (avatarSaving.value) return
  avatarInput.value?.click()
}

async function persistAvatar(avatarUrl: string | null) {
  avatarSaving.value = true
  try {
    await $fetch(`${apiBase}/v1/users/me`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: { avatarUrl },
    })
    await fetchMe()
    toast.add({
      title: avatarUrl ? 'Imagem de perfil atualizada!' : 'Imagem de perfil removida!',
      color: 'success',
      icon: 'i-lucide-check-circle'
    })
  } catch {
    toast.add({
      title: avatarUrl ? 'Erro ao atualizar imagem' : 'Erro ao remover imagem',
      color: 'error',
      icon: 'i-lucide-x-circle'
    })
  } finally {
    avatarSaving.value = false
    if (avatarInput.value) avatarInput.value.value = ''
  }
}

async function onAvatarSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  if (!file.type.startsWith('image/')) {
    toast.add({
      title: 'Arquivo inválido',
      description: 'Selecione uma imagem.',
      color: 'warning',
      icon: 'i-lucide-image-off'
    })
    input.value = ''
    return
  }

  const maxSizeInBytes = 2 * 1024 * 1024
  if (file.size > maxSizeInBytes) {
    toast.add({
      title: 'Imagem muito grande',
      description: 'Use uma imagem de até 2 MB.',
      color: 'warning',
      icon: 'i-lucide-image-up'
    })
    input.value = ''
    return
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('avatar_read_failed'))
    reader.readAsDataURL(file)
  }).catch(() => '')

  if (!dataUrl) {
    toast.add({ title: 'Erro ao ler imagem', color: 'error', icon: 'i-lucide-x-circle' })
    input.value = ''
    return
  }

  await persistAvatar(dataUrl)
}

async function removeAvatar() {
  if (!user.value?.avatarUrl || avatarSaving.value) return
  await persistAvatar(null)
}

// ─── KYC Onboarding (inline in profile tab) ─────────────────────────────────
const kycForm = reactive({
  cpf: '',
  birthDate: '',
  whatsapp: '',
  pixKeyType: '',
  pixKey: '',
  accountHolder: '',
})
const kycLoading = ref(false)
const kycError = ref('')

function onCpfInput(e: Event) {
  const raw = (e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 11)
  kycForm.cpf = raw
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1-$2')

  // Reset and debounce remote check
  cpfStatus.value = null
  if (cpfDebounceTimer) clearTimeout(cpfDebounceTimer)

  if (raw.length === 11) {
    if (!validateCpfDigits(raw)) {
      cpfStatus.value = 'invalid'
      return
    }
    // Módulo 11 passed — debounce remote availability check
    cpfDebounceTimer = setTimeout(() => checkCpfRemote(raw), 600)
  }
}

/** Módulo 11 — purely client-side, same algorithm as backend Cpf VO */
function validateCpfDigits(digits: string): boolean {
  if (digits.length !== 11) return false
  if (/^(\d)\1{10}$/.test(digits)) return false
  const calc = (len: number) => {
    let sum = 0
    for (let i = 0; i < len; i++) sum += Number(digits[i]) * (len + 1 - i)
    const rem = (sum * 10) % 11
    return rem === 10 ? 0 : rem
  }
  return calc(9) === Number(digits[9]) && calc(10) === Number(digits[10])
}

type CpfStatus = null | 'invalid' | 'checking' | 'valid' | 'taken'
const cpfStatus = ref<CpfStatus>(null)
let cpfDebounceTimer: ReturnType<typeof setTimeout> | null = null

async function checkCpfRemote(digits: string) {
  cpfStatus.value = 'checking'
  try {
    const res = await $fetch<{ available: boolean; reason?: string }>(
      `${apiBase}/v1/users/me/onboarding/check-cpf?cpf=${digits}`,
      { headers: authHeaders() },
    )
    cpfStatus.value = res.available ? 'valid' : 'taken'
  } catch {
    // Network error — fall back to local valid state so user isn't blocked
    cpfStatus.value = 'valid'
  }
}

function onWhatsappInput(e: Event) {
  const raw = (e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 11)
  kycForm.whatsapp = raw
    .replace(/^(\d{2})(\d)/, '($1) $2')
    .replace(/(\d{5})(\d{1,4})$/, '$1-$2')
}

const ageWarning = computed(() => {
  if (!kycForm.birthDate) return ''
  const birth = new Date(kycForm.birthDate)
  if (isNaN(birth.getTime())) return ''
  const today = new Date()
  const age = today.getFullYear() - birth.getFullYear()
    - (today < new Date(today.getFullYear(), birth.getMonth(), birth.getDate()) ? 1 : 0)
  if (age < 18) return `Você tem ${age} anos. É necessário ter 18+ para usar a plataforma.`
  return ''
})

const kycSchema = z.object({
  cpf: z.string().regex(/^\d{3}\.\d{3}\.\d{3}-\d{2}$/, 'CPF inválido'),
  birthDate: z.string().min(1, 'Informe a data de nascimento'),
  whatsapp: z.string().min(14, 'WhatsApp inválido'),
  pixKeyType: z.string().min(1, 'Selecione o tipo da chave PIX'),
  pixKey: z.string().min(1, 'Informe a chave PIX'),
  accountHolder: z.string().min(2, 'Informe o nome do titular'),
})

const pixKeyTypes = [
  { label: 'CPF', value: 'cpf' },
  { label: 'CNPJ', value: 'cnpj' },
  { label: 'E-mail', value: 'email' },
  { label: 'Telefone', value: 'phone' },
  { label: 'Chave aleatória', value: 'random' },
]

function normalizePixKey(type: string, value: string): string {
  const v = (value ?? '').trim()
  if (type === 'cpf' || type === 'cnpj') return v.replace(/\D/g, '')
  if (type === 'phone') {
    const digits = v.replace(/\D/g, '')
    if (v.startsWith('+')) return '+' + digits
    if (digits.length === 10 || digits.length === 11) return '+55' + digits
    return v
  }
  if (type === 'email') return v.toLowerCase()
  return v.toLowerCase()
}

async function submitKyc() {
  kycError.value = ''
  const parsed = kycSchema.safeParse(kycForm)
  if (!parsed.success) {
    kycError.value = parsed.error.errors[0]?.message ?? 'Verifique os campos.'
    return
  }
  if (ageWarning.value) {
    kycError.value = ageWarning.value
    return
  }

  kycLoading.value = true
  try {
    await $fetch(`${apiBase}/v1/users/me/onboarding`, {
      method: 'POST',
      headers: authHeaders(),
      body: {
        cpf: kycForm.cpf.replace(/\D/g, ''),
        birthDate: kycForm.birthDate,
        whatsapp: kycForm.whatsapp.replace(/\D/g, ''),
        pixKeyType: kycForm.pixKeyType,
        pixKey: normalizePixKey(kycForm.pixKeyType, kycForm.pixKey),
        accountHolder: kycForm.accountHolder,
      },
    })
    toast.add({ title: 'Cadastro concluído!', description: 'Seus dados foram verificados.', color: 'success', icon: 'i-lucide-check-circle' })
    await fetchMe()
    // Redirect para acordo Superbet removido — acordo não é mais obrigatório.
  } catch (err: unknown) {
    const msg = parseApiError(err)
    if (msg.toLowerCase().includes('18 anos') || msg.toLowerCase().includes('underage')) {
      kycError.value = 'Você não tem 18 anos. Sua conta foi bloqueada.'
      const { logout } = useAuth()
      await logout()
      return
    }
    kycError.value = msg
  } finally {
    kycLoading.value = false
  }
}

const tabs = [
  { id: 'profile', label: 'Meu Perfil', icon: 'i-lucide-user', description: 'Informações pessoais e de contato' },
  { id: 'security', label: 'Segurança', icon: 'i-lucide-shield-check', description: 'Senha, 2FA e sessões ativas' },
  { id: 'notifications', label: 'Notificações', icon: 'i-lucide-bell', description: 'Push e alertas do sistema' },
]

const onSubmit = async () => {
  loading.value = true
  setTimeout(() => {
    loading.value = false
    state.currentPassword = ''
    state.newPassword = ''
    state.confirmPassword = ''
    toast.add({ title: 'Senha atualizada com sucesso!', color: 'success', icon: 'i-lucide-check-circle' })
  }, 1000)
}

const testingSend = ref(false)

async function onSendTestPush() {
  testingSend.value = true
  const res = await sendTestPush()
  testingSend.value = false
  if (res.sent > 0) {
    toast.add({ title: 'Notificação enviada!', description: 'Verifique as notificações do seu dispositivo.', color: 'success', icon: 'i-lucide-bell' })
  } else {
    toast.add({ title: 'Nenhum dispositivo encontrado', description: 'Ative as notificações primeiro.', color: 'warning', icon: 'i-lucide-bell-off' })
  }
}

// ─── PIX key edit (type + value, post-onboarding) ───────────────────────────
const editPix = ref(false)
const newPixKeyType = ref('')
const newPixKey = ref('')
const savingPix = ref(false)
const pixKeyError = ref('')

/** Strip all punctuation before sending to gateway */
function stripPunctuation(value: string): string {
  return value.replace(/[.\-/()+\s]/g, '')
}

/** Per-type regex validators (against the raw stripped value) */
const PIX_VALIDATORS: Record<string, { regex: RegExp; hint: string }> = {
  cpf: { regex: /^\d{11}$/, hint: 'CPF deve ter 11 dígitos numéricos' },
  cnpj: { regex: /^\d{14}$/, hint: 'CNPJ deve ter 14 dígitos numéricos' },
  email: { regex: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, hint: 'E-mail inválido' },
  phone: { regex: /^\d{10,11}$/, hint: 'Telefone deve ter 10 ou 11 dígitos (com DDD)' },
  random: { regex: /^[A-Za-z0-9._@+-]{16,140}$/, hint: 'Chave aleatória inválida' },
}

function validatePixKey(type: string, rawValue: string): string {
  const stripped = type === 'email' || type === 'random' ? rawValue.trim() : stripPunctuation(rawValue)
  const validator = PIX_VALIDATORS[type]
  if (!validator) return 'Tipo de chave inválido'
  if (!validator.regex.test(stripped)) return validator.hint
  return ''
}

function startEditPix() {
  newPixKeyType.value = user.value?.pixKeyType?.toLowerCase() ?? 'cpf'
  newPixKey.value = user.value?.pixKey ?? ''
  pixKeyError.value = ''
  editPix.value = true
}

async function savePix() {
  pixKeyError.value = ''
  const type = newPixKeyType.value
  const rawValue = newPixKey.value.trim()

  const error = validatePixKey(type, rawValue)
  if (error) {
    pixKeyError.value = error
    return
  }

  const cleanValue = type === 'email' || type === 'random' ? rawValue : stripPunctuation(rawValue)

  savingPix.value = true
  try {
    await $fetch(`${apiBase}/v1/users/me`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: { pixKeyType: type, pixKey: cleanValue },
    })
    await fetchMe()
    toast.add({ title: 'Chave PIX atualizada!', color: 'success', icon: 'i-lucide-check-circle' })
    editPix.value = false
  } catch (err: unknown) {
    const data = (err as { data?: Record<string, unknown> })?.data
    const msg = (data?.['detail'] as string) ?? (data?.['message'] as string) ?? 'Erro ao atualizar chave PIX'
    toast.add({ title: 'Erro', description: msg, color: 'error', icon: 'i-lucide-x-circle' })
  } finally {
    savingPix.value = false
  }
}

onMounted(() => {
  initPushState()
  // Warn once on mount if KYC is not completed — navigation is locked
  if (needsOnboarding.value) {
    toast.add({
      title: '⚠️ Verificação obrigatória',
      description: 'Preencha seus dados de identidade e PIX. A navegação fica bloqueada até a conclusão.',
      color: 'warning',
      icon: 'i-lucide-shield-alert',
      duration: 8000,
    })
  }
})
</script>

<template>

  <div class="min-h-full flex flex-col">
    <!-- ─── PAGE HEADER ─── -->
    <header class="vex-page-header">
      <div class="flex items-center gap-3">
        <h1 class="text-base font-bold vex-title">Configurações</h1>
      </div>
    </header>

    <!-- ─── CONTENT ─── -->
    <div class="flex-1">
      <div class="py-5 w-full flex flex-col md:flex-row gap-5 md:gap-8">

        <!-- LEFT: Tab navigation -->
        <aside class="w-full md:w-44 shrink-0">
          <div class="mb-4">
            <h2 class="text-sm font-bold vex-title" style="color: var(--vex-text)">Ajustes</h2>
            <p class="text-[11px] mt-0.5" style="color: var(--vex-text-faint)">Conta e sistema.</p>
          </div>

          <nav class="flex flex-row md:flex-col gap-0.5 overflow-x-auto md:overflow-visible pb-2 md:pb-0" style="border-bottom: 1px solid var(--vex-border-subtle)">
            <button
              v-for="tab in tabs"
              :key="tab.id"
              @click="activeTab = tab.id"
              class="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12px] font-semibold transition-all duration-150 text-left whitespace-nowrap"
              :style="{
                color: activeTab === tab.id ? 'var(--vex-text)' : 'var(--vex-text-faint)',
                background: activeTab === tab.id ? 'var(--vex-surface-strong)' : 'transparent',
              }"
              @mouseenter="activeTab !== tab.id ? ($event.currentTarget as HTMLElement).style.background = 'var(--vex-surface-strong)' : null"
              @mouseleave="activeTab !== tab.id ? ($event.currentTarget as HTMLElement).style.background = '' : null"
            >
              <UIcon :name="tab.icon" class="size-3.5" style="opacity: 0.7" />
              {{ tab.label }}
            </button>
          </nav>
        </aside>

        <!-- RIGHT: Content area -->
        <div class="flex-1 pb-8 space-y-5">

          <!-- ═══════════════════════════════════════════
               TAB: PROFILE
               ═══════════════════════════════════════════ -->
          <template v-if="activeTab === 'profile'">
            <div>
              <h3 class="text-sm font-bold vex-title" style="color: var(--vex-text)">Meu Perfil</h3>
              <p class="text-[11px] mt-0.5" style="color: var(--vex-text-faint)">{{ tabs.find(t => t.id === 'profile')?.description }}</p>
            </div>

            <!-- ⚠️ KYC ALERT BANNER — shown when onboarding is incomplete -->
            <div
              v-if="needsOnboarding"
              class="flex items-start gap-3 p-4 rounded-xl"
              style="background: var(--vex-warning-soft-bg); border: 1px solid var(--vex-warning-soft-border)"
            >
              <div class="shrink-0 mt-0.5">
                <UIcon name="i-lucide-shield-alert" class="size-5" style="color: var(--vex-warning-soft-text)" />
              </div>
              <div>
                <p class="text-[13px] font-bold" style="color: var(--vex-text)">Verificação de identidade obrigatória</p>
                <p class="text-[11px] mt-0.5" style="color: var(--vex-text-muted)">
                  Preencha os dados abaixo para acessar a plataforma. CPF e data de nascimento são <strong>imutáveis</strong> após o envio.
                </p>
              </div>
            </div>

            <div
              v-if="needsEmailUpdate"
              class="flex items-start gap-3 p-4 rounded-xl"
              style="background: var(--vex-warning-soft-bg); border: 1px solid var(--vex-warning-soft-border)"
            >
              <div class="shrink-0 mt-0.5">
                <UIcon name="i-lucide-mail-warning" class="size-5" style="color: var(--vex-warning-soft-text)" />
              </div>
              <div>
                <p class="text-[13px] font-bold" style="color: var(--vex-text)">Atualização de e-mail obrigatória</p>
                <p class="text-[11px] mt-0.5" style="color: var(--vex-text-muted)">
                  Troque o e-mail temporário por um endereço válido para acessar a plataforma.
                </p>
              </div>
            </div>

            <!-- Name & Email Card (existing) -->
            <div class="vex-card overflow-hidden">
              <div class="p-5 md:p-6 space-y-6">
                <!-- Avatar -->
                <div>
                  <p class="text-[10px] uppercase tracking-[0.12em] font-bold mb-3" style="color: var(--vex-text-faint)">Avatar</p>
                  <input
                    ref="avatarInput"
                    type="file"
                    accept="image/*"
                    class="hidden"
                    @change="onAvatarSelected"
                  >
                  <div class="flex items-center gap-4">
                    <UAvatar
                      :src="user?.avatarUrl || undefined"
                      :alt="user?.name || 'Afiliado'"
                      size="2xl"
                      class="ring-2 shadow-sm"
                      style="--tw-ring-color: var(--vex-border)"
                    />
                    <div class="flex gap-2">
                      <UButton label="Alterar" color="neutral" variant="outline" size="xs" :loading="avatarSaving" :disabled="avatarSaving" @click="openAvatarPicker" />
                      <UButton label="Remover" color="error" variant="ghost" size="xs" :loading="avatarSaving" :disabled="!user?.avatarUrl || avatarSaving" @click="removeAvatar" />
                    </div>
                  </div>
                  <p class="text-[10px] mt-2" style="color: var(--vex-text-faint)">Esta imagem será exibida nos rankings.</p>
                </div>

                <!-- Divider -->
                <div style="height: 1px; background: var(--vex-border-subtle)" />

                <!-- Fields -->
                <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <UFormField name="fullName" label="Nome Completo">
                    <UInput
                      v-model="editableName"
                      class="w-full"
                      placeholder="Seu nome completo"
                      :disabled="savingName"
                    />
                  </UFormField>
                  <UFormField name="email" label="Endereço de E-mail">
                    <UInput
                      v-model="editableEmail"
                      type="email"
                      class="w-full"
                      :class="needsEmailUpdate ? '' : 'opacity-65 cursor-not-allowed'"
                      :readonly="!needsEmailUpdate"
                      :disabled="savingEmail"
                      placeholder="seu@email.com"
                      @input="emailError = ''"
                    />
                    <p v-if="emailError" class="text-[10px] mt-1 font-semibold" style="color: var(--vex-negative-soft-text)">{{ emailError }}</p>
                    <p v-else-if="needsEmailUpdate" class="text-[10px] mt-1" style="color: var(--vex-text-faint)">Use um e-mail pessoal válido.</p>
                    <p v-else class="text-[10px] mt-1" style="color: var(--vex-text-faint)">O e-mail não pode ser alterado.</p>
                  </UFormField>
                </div>

                <!-- Save name button -->
                <div class="pt-1 flex flex-wrap gap-2">
                  <UButton
                    label="Salvar Nome"
                    color="primary"
                    size="sm"
                    class="font-bold px-5"
                    :loading="savingName"
                    :disabled="!editableName.trim() || editableName.trim() === user?.name"
                    @click="saveName"
                  />
                  <UButton
                    v-if="needsEmailUpdate"
                    label="Salvar E-mail"
                    color="primary"
                    variant="outline"
                    size="sm"
                    class="font-bold px-5"
                    icon="i-lucide-mail-check"
                    :loading="savingEmail"
                    :disabled="!editableEmail.trim() || editableEmail.trim().toLowerCase() === user?.email"
                    @click="saveEmail"
                  />
                </div>
              </div>
            </div>

            <!-- ═══════════════════════════════════════════
                 KYC SECTION — Identity & PIX
                 ═══════════════════════════════════════════ -->

            <!-- STATE A: Onboarding NOT completed — show form -->
            <template v-if="needsOnboarding">
              <div class="vex-card overflow-hidden">
                <div class="p-5 md:p-6 space-y-5">
                  <!-- Section: Identity -->
                  <div class="flex items-center gap-2 pb-2" style="border-bottom: 1px solid var(--vex-border-subtle)">
                    <UIcon name="i-lucide-fingerprint" class="size-4" style="color: var(--vex-text-faint)" />
                    <span class="text-[10px] uppercase tracking-[0.12em] font-bold" style="color: var(--vex-text-faint)">Dados de Identidade</span>
                    <span
                      class="ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1"
                      style="background: var(--vex-warning-soft-bg); color: var(--vex-warning-soft-text)"
                    >
                      <UIcon name="i-lucide-lock" class="size-2.5" />
                      Imutáveis
                    </span>
                  </div>

                  <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <UFormField name="cpf" label="CPF" required>
                      <UInput
                        :model-value="kycForm.cpf"
                        placeholder="000.000.000-00"
                        maxlength="14"
                        inputmode="numeric"
                        autocomplete="off"
                        class="w-full"
                        :style="cpfStatus === 'valid'
                          ? 'border-color: var(--vex-positive); box-shadow: 0 0 0 2px var(--vex-positive-soft-bg)'
                          : cpfStatus === 'invalid' || cpfStatus === 'taken'
                            ? 'border-color: var(--vex-negative); box-shadow: 0 0 0 2px var(--vex-negative-soft-bg)'
                            : cpfStatus === 'checking'
                              ? 'border-color: var(--vex-info); box-shadow: 0 0 0 2px var(--vex-info-soft-bg)'
                              : ''"
                        @input="onCpfInput"
                      />
                      <!-- 5-state feedback -->
                      <p v-if="cpfStatus === 'valid'" class="text-[10px] mt-1 flex items-center gap-1 font-semibold" style="color: var(--vex-positive-soft-text)">
                        <UIcon name="i-lucide-check-circle" class="size-3" />
                        CPF válido e disponível
                      </p>
                      <p v-else-if="cpfStatus === 'taken'" class="text-[10px] mt-1 flex items-center gap-1 font-semibold" style="color: var(--vex-negative-soft-text)">
                        <UIcon name="i-lucide-x-circle" class="size-3" />
                        CPF já cadastrado em outra conta
                      </p>
                      <p v-else-if="cpfStatus === 'invalid'" class="text-[10px] mt-1 flex items-center gap-1 font-semibold" style="color: var(--vex-negative-soft-text)">
                        <UIcon name="i-lucide-x-circle" class="size-3" />
                        CPF inválido
                      </p>
                      <p v-else-if="cpfStatus === 'checking'" class="text-[10px] mt-1 flex items-center gap-1" style="color: var(--vex-info-soft-text)">
                        <UIcon name="i-lucide-loader-circle" class="size-3 animate-spin" />
                        Verificando...
                      </p>
                      <p v-else class="text-[10px] mt-1" style="color: var(--vex-text-faint)">Validado pelo algoritmo da Receita Federal</p>
                    </UFormField>

                    <UFormField name="birthDate" label="Data de Nascimento" required>
                      <UInput
                        v-model="kycForm.birthDate"
                        type="date"
                        class="w-full"
                        :max="new Date(new Date().setFullYear(new Date().getFullYear() - 18)).toISOString().split('T')[0]"
                      />
                      <p v-if="ageWarning" class="text-[10px] mt-1 font-semibold" style="color: var(--vex-negative-soft-text)">{{ ageWarning }}</p>
                      <p v-else class="text-[10px] mt-1" style="color: var(--vex-text-faint)">Mínimo: 18 anos completos</p>
                    </UFormField>
                  </div>

                  <!-- Section: Contact -->
                  <div class="flex items-center gap-2 pb-2 pt-2" style="border-bottom: 1px solid var(--vex-border-subtle)">
                    <UIcon name="i-lucide-smartphone" class="size-4" style="color: var(--vex-text-faint)" />
                    <span class="text-[10px] uppercase tracking-[0.12em] font-bold" style="color: var(--vex-text-faint)">Dados de Contato</span>
                  </div>

                  <UFormField name="whatsapp" label="WhatsApp" required>
                    <UInput
                      :model-value="kycForm.whatsapp"
                      placeholder="(11) 99999-0000"
                      maxlength="15"
                      inputmode="numeric"
                      class="w-full md:max-w-md"
                      @input="onWhatsappInput"
                    />
                    <p class="text-[10px] mt-1" style="color: var(--vex-text-faint)">DDD + número</p>
                  </UFormField>

                  <!-- Section: PIX -->
                  <div class="flex items-center gap-2 pb-2 pt-2" style="border-bottom: 1px solid var(--vex-border-subtle)">
                    <UIcon name="i-lucide-wallet" class="size-4" style="color: var(--vex-text-faint)" />
                    <span class="text-[10px] uppercase tracking-[0.12em] font-bold" style="color: var(--vex-text-faint)">Dados de Pagamento (PIX)</span>
                  </div>

                  <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <UFormField name="pixKeyType" label="Tipo da Chave PIX" required>
                      <USelect
                        v-model="kycForm.pixKeyType"
                        :items="pixKeyTypes"
                        value-key="value"
                        label-key="label"
                        placeholder="Selecione..."
                        class="w-full"
                      />
                    </UFormField>
                    <UFormField name="pixKey" label="Chave PIX" required>
                      <UInput v-model="kycForm.pixKey" placeholder="Sua chave PIX" class="w-full" />
                    </UFormField>
                  </div>

                  <UFormField name="accountHolder" label="Nome do Titular" required>
                    <UInput v-model="kycForm.accountHolder" placeholder="Exatamente como na conta bancária" class="w-full md:max-w-md" />
                    <p class="text-[10px] mt-1" style="color: var(--vex-text-faint)">Deve corresponder ao nome na conta do PIX</p>
                  </UFormField>

                  <!-- Error -->
                  <div
                    v-if="kycError"
                    class="flex items-start gap-2 p-3 rounded-lg text-[12px] font-medium"
                    style="background: var(--vex-negative-soft-bg); border: 1px solid var(--vex-negative-soft-border); color: var(--vex-negative-soft-text)"
                  >
                    <UIcon name="i-lucide-triangle-alert" class="size-4 shrink-0 mt-0.5" />
                    {{ kycError }}
                  </div>

                  <!-- Submit -->
                  <div class="pt-1">
                    <UButton
                      label="Confirmar Dados e Verificar"
                      color="primary"
                      size="sm"
                      class="font-bold px-6"
                      icon="i-lucide-check-circle"
                      :loading="kycLoading"
                      :disabled="kycLoading || !!ageWarning"
                      @click="submitKyc"
                    />
                    <p class="text-[10px] mt-2" style="color: var(--vex-text-faint)">
                      <UIcon name="i-lucide-info" class="size-3 inline-block mr-0.5" />
                      CPF e data de nascimento são <strong>imutáveis</strong>. Para alterações, abra um ticket de suporte.
                    </p>
                  </div>
                </div>
              </div>
            </template>

            <!-- STATE B: Onboarding COMPLETED — show read-only data -->
            <template v-else-if="user?.profileCompleted">
              <div class="vex-card overflow-hidden">
                <div class="p-5 md:p-6 space-y-5">
                  <div class="flex items-center gap-2 pb-2" style="border-bottom: 1px solid var(--vex-border-subtle)">
                    <UIcon name="i-lucide-shield-check" class="size-4" style="color: var(--vex-positive-soft-text)" />
                    <span class="text-[10px] uppercase tracking-[0.12em] font-bold" style="color: var(--vex-text-faint)">Identidade Verificada</span>
                    <span
                      class="ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full"
                      style="background: var(--vex-positive-soft-bg); color: var(--vex-positive-soft-text)"
                    >
                      ✓ Completo
                    </span>
                  </div>

                  <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <UFormField name="cpfDisplay" label="CPF">
                      <UInput :model-value="user.cpf || ''" readonly class="w-full opacity-65 cursor-not-allowed" />
                      <p class="text-[10px] mt-1" style="color: var(--vex-text-faint)">
                        <UIcon name="i-lucide-lock" class="size-2.5 inline-block mr-0.5" />
                        Imutável — entre em contato com o suporte para alterar
                      </p>
                    </UFormField>
                    <UFormField name="birthDateDisplay" label="Data de Nascimento">
                      <UInput
                        :model-value="user.birthDate ? new Date(user.birthDate).toLocaleDateString('pt-BR') : ''"
                        readonly
                        class="w-full opacity-65 cursor-not-allowed"
                      />
                      <p class="text-[10px] mt-1" style="color: var(--vex-text-faint)">
                        <UIcon name="i-lucide-lock" class="size-2.5 inline-block mr-0.5" />
                        Imutável
                      </p>
                    </UFormField>
                  </div>

                  <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <UFormField name="whatsappDisplay" label="WhatsApp">
                      <UInput :model-value="user.whatsapp || ''" readonly class="w-full opacity-65 cursor-not-allowed" />
                    </UFormField>
                  </div>

                  <!-- PIX Key — editable post-onboarding -->
                  <div style="height: 1px; background: var(--vex-border-subtle)" />

                  <!-- VIEW mode -->
                  <div v-if="!editPix" class="flex items-center justify-between gap-4">
                    <div>
                      <p class="text-[10px] uppercase tracking-[0.1em] font-bold mb-1" style="color: var(--vex-text-faint)">Chave PIX</p>
                      <p class="text-[13px] font-semibold" style="color: var(--vex-text)">
                        {{ pixKeyTypes.find(p => p.value === user?.pixKeyType?.toLowerCase())?.label || user?.pixKeyType || '—' }}
                        <span v-if="user?.pixKey" style="color: var(--vex-text-faint)"> · {{ user.pixKey }}</span>
                      </p>
                    </div>
                    <UButton
                      label="Alterar Chave PIX"
                      color="neutral"
                      variant="outline"
                      size="xs"
                      icon="i-lucide-pencil"
                      @click="startEditPix"
                    />
                  </div>

                  <!-- EDIT mode -->
                  <div v-else class="space-y-4">
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <UFormField label="Tipo da Chave">
                        <USelect
                          v-model="newPixKeyType"
                          :items="pixKeyTypes"
                          value-key="value"
                          label-key="label"
                          class="w-full"
                          @update:model-value="pixKeyError = ''"
                        />
                      </UFormField>
                      <UFormField label="Chave PIX">
                        <UInput
                          v-model="newPixKey"
                          class="w-full"
                          :placeholder="newPixKeyType === 'cpf' ? '000.000.000-00'
                            : newPixKeyType === 'email' ? 'email@exemplo.com'
                            : newPixKeyType === 'phone' ? '(11) 99999-0000'
                            : newPixKeyType === 'random' ? 'Chave aleatória PIX'
                            : 'Sua chave PIX'"
                          @input="pixKeyError = ''"
                        />
                      </UFormField>
                    </div>

                    <!-- Validation hint per type -->
                    <p class="text-[10px]" style="color: var(--vex-text-faint)">
                      <template v-if="newPixKeyType === 'cpf'">Somente números (11 dígitos). Pontuação é removida automaticamente.</template>
                      <template v-else-if="newPixKeyType === 'email'">Informe um e-mail válido.</template>
                      <template v-else-if="newPixKeyType === 'phone'">DDD + número (10 ou 11 dígitos). Pontuação é removida automaticamente.</template>
                      <template v-else-if="newPixKeyType === 'random'">Cole a chave aleatória exatamente como foi gerada.</template>
                    </p>

                    <!-- Error message -->
                    <div
                      v-if="pixKeyError"
                      class="flex items-center gap-2 p-2.5 rounded-lg text-[11px] font-semibold"
                      style="background: var(--vex-negative-soft-bg); border: 1px solid var(--vex-negative-soft-border); color: var(--vex-negative-soft-text)"
                    >
                      <UIcon name="i-lucide-triangle-alert" class="size-3.5 shrink-0" />
                      {{ pixKeyError }}
                    </div>

                    <div class="flex gap-2">
                      <UButton
                        label="Salvar Chave PIX"
                        color="primary"
                        size="sm"
                        class="font-bold"
                        icon="i-lucide-check"
                        :loading="savingPix"
                        @click="savePix"
                      />
                      <UButton
                        label="Cancelar"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        :disabled="savingPix"
                        @click="editPix = false"
                      />
                    </div>
                  </div>

                </div>
              </div>
            </template>

          </template>

          <!-- ═══════════════════════════════════════════
               TAB: SECURITY
               ═══════════════════════════════════════════ -->
          <template v-else-if="activeTab === 'security'">
            <div>
              <h3 class="text-sm font-bold vex-title" style="color: var(--vex-text)">Segurança</h3>
              <p class="text-[11px] mt-0.5" style="color: var(--vex-text-faint)">{{ tabs.find(t => t.id === 'security')?.description }}</p>
            </div>

            <div class="vex-card overflow-hidden">
              <div class="p-5 md:p-6 space-y-6">
                <UForm :schema="schema" :state="state" @submit="onSubmit" class="space-y-5">
                  <UFormField name="currentPassword" label="Senha Atual" description="Você deve digitar sua senha atual para definir uma nova.">
                    <UInput v-model="state.currentPassword" type="password" placeholder="••••••••" class="w-full md:max-w-md" />
                  </UFormField>

                  <div style="height: 1px; background: var(--vex-border-subtle); max-width: 28rem" class="my-1" />

                  <div class="grid grid-cols-1 md:grid-cols-2 gap-5 md:max-w-2xl">
                    <UFormField name="newPassword" label="Nova Senha">
                      <UInput v-model="state.newPassword" type="password" placeholder="••••••••" class="w-full" />
                      <PasswordStrength :password="state.newPassword" />
                    </UFormField>
                    <UFormField name="confirmPassword" label="Confirmar Nova Senha">
                      <UInput v-model="state.confirmPassword" type="password" placeholder="••••••••" class="w-full" />
                    </UFormField>
                  </div>

                  <div class="pt-1">
                    <UButton type="submit" :loading="loading" label="Salvar Nova Senha" color="primary" size="sm" class="font-bold px-5" />
                  </div>
                </UForm>


              </div>
            </div>
          </template>

          <!-- ═══════════════════════════════════════════
               TAB: NOTIFICATIONS
               ═══════════════════════════════════════════ -->
          <template v-else-if="activeTab === 'notifications'">
            <div>
              <h3 class="text-sm font-bold vex-title" style="color: var(--vex-text)">Notificações</h3>
              <p class="text-[11px] mt-0.5" style="color: var(--vex-text-faint)">{{ tabs.find(t => t.id === 'notifications')?.description }}</p>
            </div>

            <!-- Not supported / error -->
            <div
              v-if="!pushSupported"
              class="vex-card p-5 flex items-start gap-4"
            >
              <div class="vex-icon-badge shrink-0">
                <UIcon name="i-lucide-bell-off" class="size-4" />
              </div>
              <div>
                <p class="text-[13px] font-bold" style="color: var(--vex-text)">Notificações indisponíveis</p>
                <p class="text-[11px] mt-0.5" style="color: var(--vex-text-faint)">
                  {{ pushError ?? 'Notificações push não estão disponíveis neste navegador ou contexto.' }}
                </p>
              </div>
            </div>

            <!-- Push card -->
            <div v-else class="vex-card overflow-hidden">
              <div class="p-5 md:p-6 space-y-5">

                <div class="flex items-start gap-4">
                  <div class="vex-icon-badge shrink-0">
                    <UIcon name="i-lucide-bell-ring" class="size-4" />
                  </div>
                  <div class="flex-1">
                    <p class="text-[13px] font-bold" style="color: var(--vex-text)">Notificações Push</p>
                    <p class="text-[11px] mt-0.5" style="color: var(--vex-text-faint)">
                      Receba alertas em tempo real sobre novos registros, FTDs, CPAs qualificados e saques.
                    </p>
                  </div>
                </div>

                <div
                  class="flex items-center justify-between gap-4 p-4 rounded-lg"
                  style="background: var(--vex-surface-strong); border: 1px solid var(--vex-border-subtle)"
                >
                  <div class="flex items-center gap-2.5">
                    <div
                      class="size-2.5 rounded-full transition-colors duration-300"
                      :style="{ background: pushEnabled ? 'var(--vex-positive-soft-text)' : 'var(--vex-text-faint)' }"
                    />
                    <div>
                      <p class="text-[12px] font-bold" :style="{ color: pushEnabled ? 'var(--vex-positive-soft-text)' : 'var(--vex-text-muted)' }">
                        {{ pushEnabled ? 'Ativadas' : 'Desativadas' }}
                      </p>
                      <p class="text-[11px]" style="color: var(--vex-text-faint)">
                        {{ pushEnabled ? 'Você está recebendo alertas neste dispositivo' : 'Toque em Ativar para receber alertas' }}
                      </p>
                    </div>
                  </div>

                  <UButton
                    :label="pushEnabled ? 'Desativar' : 'Ativar'"
                    :color="pushEnabled ? 'error' : 'primary'"
                    :variant="pushEnabled ? 'soft' : 'solid'"
                    size="sm"
                    :loading="pushLoading"
                    class="shrink-0 font-bold"
                    @click="togglePush"
                  />
                </div>

                <!-- Test push -->
                <div v-if="pushEnabled" class="flex items-center justify-between">
                  <div>
                    <p class="text-[12px] font-semibold" style="color: var(--vex-text-muted)">Testar notificação</p>
                    <p class="text-[11px]" style="color: var(--vex-text-faint)">Envia uma notificação de teste para este dispositivo.</p>
                  </div>
                  <UButton
                    label="Enviar Teste"
                    variant="outline"
                    color="neutral"
                    icon="i-lucide-send"
                    size="sm"
                    :loading="testingSend"
                    @click="onSendTestPush"
                  />
                </div>

              </div>
            </div>
          </template>

          <!-- ═══════════════════════════════════════════
               TAB: Not Developed
               ═══════════════════════════════════════════ -->
          <div v-else class="py-16 flex flex-col items-center justify-center text-center">
            <div class="vex-icon-badge mb-4" style="width: 3.5rem; height: 3.5rem">
              <UIcon name="i-lucide-hammer" class="size-7" />
            </div>
            <h3 class="text-sm font-bold" style="color: var(--vex-text)">Página em Construção</h3>
            <p class="text-[12px] max-w-sm mt-1 mb-5" style="color: var(--vex-text-faint)">Estas configurações estarão disponíveis na próxima atualização.</p>
            <UButton label="Voltar para Meu Perfil" color="neutral" variant="ghost" size="sm" @click="activeTab = 'profile'" />
          </div>

        </div>
      </div>
    </div>
  </div>
</template>
