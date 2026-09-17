<script setup lang="ts">
definePageMeta({ layout: 'auth' })

const { login } = useAuth()
const toast = useToast()
const email = ref('')
const password = ref('')
const loading = ref(false)

async function submit() {
  loading.value = true
  try {
    await login(email.value, password.value)
    await navigateTo('/')
  } catch (err) {
    toast.add({
      title: 'Não foi possível entrar',
      description: err instanceof Error ? err.message : 'Confira as credenciais.',
      color: 'error',
      icon: 'i-lucide-alert-circle'
    })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="space-y-8">
    <div class="lg:hidden">
      <AppLogo size="lg" />
    </div>

    <div class="space-y-2">
      <p
        class="text-[10px] font-black uppercase tracking-[0.22em]"
        style="color: var(--color-gold-bright)"
      >
        Sign in
      </p>
      <h1 class="text-3xl font-black tracking-tight text-white leading-[1.05]">
        Bem-vindo
        <span
          class="italic"
          style="color: var(--color-gold-bright)"
        >de volta</span>
      </h1>
      <p
        class="text-sm"
        style="color: var(--color-text-secondary)"
      >
        Acesso restrito a administradores da Vallex Group.
      </p>
    </div>

    <form
      class="space-y-4"
      @submit.prevent="submit"
    >
      <UFormField
        label="E-mail"
        required
      >
        <UInput
          v-model="email"
          type="email"
          icon="i-lucide-mail"
          placeholder="admin@vallexgroup.com.br"
          class="w-full"
          autocomplete="email"
          size="lg"
        />
      </UFormField>
      <UFormField
        label="Senha"
        required
      >
        <UInput
          v-model="password"
          type="password"
          icon="i-lucide-lock"
          placeholder="••••••••"
          class="w-full"
          autocomplete="current-password"
          size="lg"
        />
      </UFormField>

      <UButton
        type="submit"
        block
        color="primary"
        icon="i-lucide-log-in"
        size="lg"
        class="font-bold"
        :loading="loading"
      >
        Entrar
      </UButton>
    </form>

    <p
      class="text-xs text-center"
      style="color: var(--color-text-muted)"
    >
      Sessão protegida com autenticação por token.
    </p>
  </div>
</template>
