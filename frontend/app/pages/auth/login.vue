<script setup lang="ts">
import { z } from 'zod'

definePageMeta({ layout: 'auth', colorMode: 'dark' })

const { login } = useAuth()

const showPassword = ref(false)
const loading = ref(false)
const errorMsg = ref('')

const schema = z.object({
  email: z.string().email('E-mail inválido'),
  password: z.string().min(1, 'A senha é obrigatória'),
})

const form = reactive({
  email: '',
  password: '',
})

async function handleLogin() {
  errorMsg.value = ''
  loading.value = true

  try {
    await login(form.email, form.password)
    navigateTo('/')
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
        Acesse sua conta
      </h2>
      <p class="mt-1.5 text-sm" style="color: var(--vex-text-muted)">
        Entre para continuar
      </p>
    </div>

    <UForm :schema="schema" :state="form" @submit="handleLogin" class="space-y-4">
      <!-- E-mail -->
      <UFormField name="email">
        <template #label>
          <span
            class="text-[0.8125rem] font-semibold"
            style="color: var(--vex-text)"
          >
            E-mail
          </span>
        </template>
        <UInput
          v-model="form.email"
          type="email"
          icon="i-lucide-mail"
          placeholder="seu@email.com"
          autocomplete="email"
          size="lg"
          class="w-full"
        />
      </UFormField>

      <!-- Senha -->
      <UFormField name="password">
        <template #label>
          <span class="text-[0.8125rem] font-semibold" style="color: var(--vex-text)">
            Senha
          </span>
        </template>
        <UInput
          v-model="form.password"
          :type="showPassword ? 'text' : 'password'"
          icon="i-lucide-lock"
          placeholder="••••••••"
          autocomplete="current-password"
          size="lg"
          class="w-full mb-1.5"
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
        <div class="flex justify-end w-full">
          <NuxtLink
            to="/auth/forgot-password"
            class="text-[0.8125rem] font-medium hover:brightness-90 transition-all"
            style="color: var(--vex-brand)"
          >
            Esqueci a senha?
          </NuxtLink>
        </div>
      </UFormField>

      <!-- Erro inline (RFC 7807 detail) -->
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

      <!-- Submit -->
      <UButton
        type="submit"
        block
        size="lg"
        trailing-icon="i-lucide-log-in"
        :loading="loading"
        class="mt-2 font-semibold tracking-tight text-[0.875rem]"
      >
        Acessar painel
      </UButton>
    </UForm>

    <p class="mt-6 text-center text-[0.8125rem]" style="color: var(--vex-text-muted)">
      Não tem conta?
      <NuxtLink
        to="/auth/register"
        class="font-semibold hover:brightness-90 transition-all"
        style="color: var(--vex-brand)"
      >
        Criar conta
      </NuxtLink>
    </p>
  </div>
</template>
