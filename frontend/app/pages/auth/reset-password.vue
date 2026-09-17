<script setup lang="ts">
import { z } from 'zod'

definePageMeta({ layout: 'auth', colorMode: 'dark' })

const route = useRoute()
const apiBase = useApiBase()
const showPassword = ref(false)
const showConfirmPassword = ref(false)
const loading = ref(false)
const errorMsg = ref('')
const success = ref(false)

const token = computed(() => {
  const value = route.query.token
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
})

const schema = z.object({
  password: z
    .string()
    .min(8, 'A senha deve ter no mínimo 8 caracteres.')
    .regex(/[A-Z]/, 'A senha precisa ter pelo menos 1 letra maiúscula.')
    .regex(/\d/, 'A senha precisa ter pelo menos 1 número.')
    .regex(/[@$!%*?&]/, 'A senha precisa ter pelo menos 1 caractere especial.'),
  confirmPassword: z.string().min(1, 'Confirme a nova senha.'),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'As senhas não conferem.',
  path: ['confirmPassword'],
})

const form = reactive({
  password: '',
  confirmPassword: '',
})

async function handleSubmit() {
  errorMsg.value = ''
  success.value = false

  if (!token.value) {
    errorMsg.value = 'Link de recuperação inválido.'
    return
  }

  loading.value = true

  try {
    await $fetch(`${apiBase}/v1/auth/reset-password`, {
      method: 'POST',
      body: {
        token: token.value,
        password: form.password,
      },
    })
    success.value = true
    setTimeout(() => navigateTo('/auth/login'), 1200)
  } catch (err: unknown) {
    errorMsg.value = parseApiError(err)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div>
    <div class="mb-6">
      <h2
        class="text-[1.75rem] font-bold vex-title leading-tight tracking-[-0.03em]"
        style="color: var(--vex-text)"
      >
        Nova senha
      </h2>
      <p class="mt-1.5 text-sm" style="color: var(--vex-text-muted)">
        Crie uma senha forte para voltar a acessar o painel.
      </p>
    </div>

    <div
      v-if="!token"
      class="mb-4 flex items-center gap-2 rounded-md border-l-2 p-3 text-[0.8125rem]"
      style="color: var(--vex-negative); background: var(--vex-negative-soft-bg); border-color: var(--vex-negative)"
    >
      <UIcon name="i-lucide-alert-circle" class="size-4 shrink-0" />
      <span>Link de recuperação inválido.</span>
    </div>

    <UForm :schema="schema" :state="form" class="space-y-4" @submit="handleSubmit">
      <UFormField name="password">
        <template #label>
          <span class="text-[0.8125rem] font-semibold" style="color: var(--vex-text)">
            Nova senha
          </span>
        </template>
        <UInput
          v-model="form.password"
          :type="showPassword ? 'text' : 'password'"
          icon="i-lucide-lock"
          placeholder="••••••••"
          autocomplete="new-password"
          size="lg"
          class="w-full"
          :ui="{ trailing: 'pe-1' }"
        >
          <template #trailing>
            <UButton
              :icon="showPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
              variant="link"
              color="neutral"
              size="sm"
              :padded="false"
              @click="showPassword = !showPassword"
            />
          </template>
        </UInput>
        <PasswordStrength :password="form.password" />
      </UFormField>

      <UFormField name="confirmPassword">
        <template #label>
          <span class="text-[0.8125rem] font-semibold" style="color: var(--vex-text)">
            Confirmar nova senha
          </span>
        </template>
        <UInput
          v-model="form.confirmPassword"
          :type="showConfirmPassword ? 'text' : 'password'"
          icon="i-lucide-lock-keyhole"
          placeholder="••••••••"
          autocomplete="new-password"
          size="lg"
          class="w-full"
          :ui="{ trailing: 'pe-1' }"
        >
          <template #trailing>
            <UButton
              :icon="showConfirmPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
              variant="link"
              color="neutral"
              size="sm"
              :padded="false"
              @click="showConfirmPassword = !showConfirmPassword"
            />
          </template>
        </UInput>
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
          v-if="success"
          class="flex items-start gap-2 rounded-md border-l-2 p-3 text-[0.8125rem]"
          style="color: var(--vex-positive); background: var(--vex-positive-soft-bg); border-color: var(--vex-positive)"
        >
          <UIcon name="i-lucide-check-circle" class="mt-0.5 size-4 shrink-0" />
          <span>Senha alterada com sucesso. Redirecionando para o login...</span>
        </div>
      </Transition>

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
          class="flex items-center gap-2 rounded-md border-l-2 p-3 text-[0.8125rem]"
          style="color: var(--vex-negative); background: var(--vex-negative-soft-bg); border-color: var(--vex-negative)"
        >
          <UIcon name="i-lucide-alert-circle" class="size-4 shrink-0" />
          <span>{{ errorMsg }}</span>
        </div>
      </Transition>

      <UButton
        type="submit"
        block
        size="lg"
        :loading="loading"
        :disabled="!token"
        class="mt-2 text-[0.875rem] font-semibold tracking-tight"
      >
        Alterar senha
      </UButton>
    </UForm>

    <p class="mt-6 text-center text-[0.8125rem]" style="color: var(--vex-text-muted)">
      Voltar para
      <NuxtLink
        to="/auth/login"
        class="font-semibold transition-all hover:brightness-90"
        style="color: var(--vex-brand)"
      >
        login
      </NuxtLink>
    </p>
  </div>
</template>
