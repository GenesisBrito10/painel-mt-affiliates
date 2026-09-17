<script setup lang="ts">
import { z } from 'zod'

definePageMeta({ layout: 'auth', colorMode: 'dark' })

const apiBase = useApiBase()
const loading = ref(false)
const errorMsg = ref('')
const success = ref(false)

const schema = z.object({
  email: z.string().email('E-mail inválido'),
})

const form = reactive({
  email: '',
})

async function handleSubmit() {
  errorMsg.value = ''
  success.value = false
  loading.value = true

  try {
    await $fetch(`${apiBase}/v1/auth/forgot-password`, {
      method: 'POST',
      body: { email: form.email },
    })
    success.value = true
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
        Recuperar senha
      </h2>
      <p class="mt-1.5 text-sm" style="color: var(--vex-text-muted)">
        Informe seu e-mail para receber as instruções de redefinição.
      </p>
    </div>

    <UForm :schema="schema" :state="form" class="space-y-4" @submit="handleSubmit">
      <UFormField name="email">
        <template #label>
          <span class="text-[0.8125rem] font-semibold" style="color: var(--vex-text)">
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
          <span>Se esse e-mail estiver cadastrado, enviaremos as instruções.</span>
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
        class="mt-2 text-[0.875rem] font-semibold tracking-tight"
      >
        Enviar instruções
      </UButton>
    </UForm>

    <p class="mt-6 text-center text-[0.8125rem]" style="color: var(--vex-text-muted)">
      Lembrou a senha?
      <NuxtLink
        to="/auth/login"
        class="font-semibold transition-all hover:brightness-90"
        style="color: var(--vex-brand)"
      >
        Entrar
      </NuxtLink>
    </p>
  </div>
</template>
