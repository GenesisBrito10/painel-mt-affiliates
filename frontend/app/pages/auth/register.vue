<script setup lang="ts">
import { z } from 'zod'

definePageMeta({ layout: 'auth', colorMode: 'dark' })

const { register, checkEmailAvailability } = useAuth()
const colorMode = useColorMode()
const apiBase = useApiBase()

const schema = z.object({
  name: z.string().min(2, 'O nome deve ter no mínimo 2 caracteres'),
  email: z.string().email('E-mail inválido'),
  password: z.string()
    .min(8, 'A senha deve ter no mínimo 8 caracteres')
    .regex(/^(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&]).{8,}$/, 'A senha precisa ter 1 letra maiúscula, 1 número e 1 caractere especial'),
  referralCode: z.string().optional()
})

const state = reactive({
  name: '',
  email: '',
  password: '',
  referralCode: ''
})

const route = useRoute()
const referralCodeLocked = ref(false)
onMounted(() => {
  if (route.query.ref) {
    state.referralCode = String(route.query.ref)
    referralCodeLocked.value = true
  }
})

const loading = ref(false)
const errorMsg = ref('')
const emailChecking = ref(false)
const emailAvailable = ref<boolean | null>(null)
let emailCheckToken = 0

const trimmedEmail = computed(() => state.email.trim().toLowerCase())
const emailFormatError = computed(() => {
  if (!trimmedEmail.value) return ''
  const parsed = z.string().email('E-mail inválido').safeParse(trimmedEmail.value)
  return parsed.success ? '' : 'E-mail inválido'
})

const emailError = computed(() => {
  if (!trimmedEmail.value) return ''
  if (emailFormatError.value) return emailFormatError.value
  if (emailChecking.value) return 'Verificando e-mail...'
  if (emailAvailable.value === false) return 'Este e-mail já está cadastrado.'
  return ''
})

const passwordError = computed(() => {
  if (!state.password) return ''
  if (state.password.length < 8) return 'A senha deve ter no mínimo 8 caracteres'
  if (!/[A-Z]/.test(state.password)) return 'A senha precisa ter pelo menos 1 letra maiúscula'
  if (!/\d/.test(state.password)) return 'A senha precisa ter pelo menos 1 número'
  if (!/[@$!%*?&]/.test(state.password)) return 'A senha precisa ter pelo menos 1 caractere especial'
  return ''
})

watch(trimmedEmail, (email) => {
  errorMsg.value = ''
  emailAvailable.value = null
  emailCheckToken += 1

  if (!email || emailFormatError.value) {
    emailChecking.value = false
    return
  }

  const currentToken = emailCheckToken
  emailChecking.value = true

  setTimeout(async () => {
    if (currentToken !== emailCheckToken) return

    try {
      emailAvailable.value = await checkEmailAvailability(email)
    } catch {
      emailAvailable.value = null
    } finally {
      if (currentToken === emailCheckToken) {
        emailChecking.value = false
      }
    }
  }, 350)
})

async function handleRegister() {
  errorMsg.value = ''

  if (emailError.value || passwordError.value) {
    return
  }

  loading.value = true

  try {
    await register({
      name: state.name,
      email: trimmedEmail.value,
      password: state.password,
      referralCode: state.referralCode || undefined,
    })
    navigateTo('/auth/pending')
  } catch (err: unknown) {
    errorMsg.value = parseApiError(err)
  } finally {
    loading.value = false
  }
}

function toggleTheme() {
  colorMode.preference = colorMode.value === 'dark' ? 'light' : 'dark'
}
</script>

<template>
  <div>
    <div class="mb-6 flex items-start justify-between gap-4">
      <div>
        <h2
          class="text-[1.75rem] font-bold vex-title leading-tight tracking-[-0.03em]"
          style="color: var(--vex-text)"
        >
          Criar Conta
        </h2>
        <p class="mt-1.5 text-sm" style="color: var(--vex-text-muted)">
          Junte-se à maior rede de afiliados
        </p>
      </div>

      <UButton
        :icon="colorMode.value === 'dark' ? 'i-lucide-sun' : 'i-lucide-moon'"
        variant="ghost"
        color="neutral"
        size="sm"
        aria-label="Alternar tema"
        @click="toggleTheme"
      />
    </div>

    <UForm :schema="schema" :state="state" @submit="handleRegister" class="space-y-4">
      <UFormField name="name" label="Nome Completo" required>
        <UInput
          v-model="state.name"
          icon="i-lucide-user"
          placeholder="Seu nome"
          autocomplete="name"
          size="lg"
          class="w-full"
        />
      </UFormField>

      <UFormField name="email" label="E-mail" required :error="emailChecking ? undefined : emailError || undefined">
        <UInput
          v-model="state.email"
          type="email"
          icon="i-lucide-mail"
          placeholder="seu@email.com"
          autocomplete="email"
          size="lg"
          class="w-full"
        />
      </UFormField>

      <UFormField name="password" label="Senha" required :error="passwordError || undefined">
        <UInput
          v-model="state.password"
          type="password"
          icon="i-lucide-lock"
          placeholder="Mínimo 8 caracteres"
          autocomplete="new-password"
          size="lg"
          class="w-full"
        />
        <PasswordStrength :password="state.password" />
      </UFormField>



      <UFormField
        name="referralCode"
        label="Código de Indicação (Opcional)"
        :hint="referralCodeLocked ? 'Pré-preenchido pelo link de indicação — não editável.' : undefined"
      >
        <UInput
          v-model="state.referralCode"
          icon="i-lucide-ticket"
          placeholder="Se houver"
          size="lg"
          class="w-full"
          :readonly="referralCodeLocked"
          :disabled="referralCodeLocked"
        />
      </UFormField>

      <Transition
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="-translate-x-2 opacity-0"
        enter-to-class="translate-x-0 opacity-100"
        leave-active-class="transition duration-150 ease-in"
        leave-from-class="translate-x-0 opacity-100"
        leave-to-class="-translate-x-2 opacity-0"
      >
        <div
          v-if="errorMsg"
          class="flex items-center gap-2 p-3 text-[0.8125rem] rounded-md border-l-2"
          style="color: var(--vex-negative); background: var(--vex-negative-soft-bg); border-color: var(--vex-negative)"
        >
          <UIcon name="i-lucide-alert-circle" class="size-4 shrink-0" />
          <span>{{ errorMsg }}</span>
        </div>
      </Transition>

      <div class="pt-2">
        <UButton
          type="submit"
          block
          size="lg"
          :loading="loading"
          class="font-bold tracking-tight text-[0.875rem]"
        >
          Cadastrar-se
        </UButton>
      </div>
    </UForm>

    <div class="mt-6 flex items-center justify-center gap-4">
      <div class="h-px flex-1" style="background: var(--vex-border-subtle)" />
      <span class="text-[0.75rem] uppercase tracking-[0.08em]" style="color: var(--vex-text-faint)">Ou</span>
      <div class="h-px flex-1" style="background: var(--vex-border-subtle)" />
    </div>

    <p class="mt-6 text-center text-[0.8125rem]" style="color: var(--vex-text-muted)">
      Já tem uma conta?
      <NuxtLink
        to="/auth/login"
        class="font-semibold hover:brightness-90 transition-all"
        style="color: var(--vex-brand)"
      >
        Faça login
      </NuxtLink>
    </p>
  </div>
</template>
