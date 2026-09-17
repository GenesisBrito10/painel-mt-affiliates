<script setup lang="ts">
definePageMeta({ layout: 'auth', colorMode: 'dark' })

const { logout, user, fetchMe, isPending } = useAuth()
const colorMode = useColorMode()

const checking = ref(false)

async function checkStatus() {
  checking.value = true
  try {
    await fetchMe()
    if (!isPending.value) {
      navigateTo('/')
    }
  } finally {
    checking.value = false
  }
}

function toggleTheme() {
  colorMode.preference = colorMode.value === 'dark' ? 'light' : 'dark'
}
</script>

<template>
  <div class="text-center">
    <div class="mb-5 flex justify-end">
      <UButton
        :icon="colorMode.value === 'dark' ? 'i-lucide-sun' : 'i-lucide-moon'"
        variant="ghost"
        color="neutral"
        size="sm"
        aria-label="Alternar tema"
        @click="toggleTheme"
      />
    </div>

    <div
      class="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full"
      style="background: var(--vex-warning-soft-bg); border: 1px solid var(--vex-warning-soft-border)"
    >
      <UIcon name="i-lucide-clock" class="size-8" style="color: var(--vex-warning)" />
    </div>

    <h2 class="text-[1.75rem] font-bold vex-title leading-tight tracking-[-0.03em]" style="color: var(--vex-text)">
      Aguardando Aprovação
    </h2>

    <p class="mt-3 text-sm max-w-sm mx-auto" style="color: var(--vex-text-muted)">
      Sua conta foi criada com sucesso! Agora é necessário aguardar a aprovação do administrador ou do seu convidante para acessar o painel.
    </p>

    <p v-if="user" class="mt-4 text-xs" style="color: var(--vex-text-faint)">
      Cadastrado como <strong style="color: var(--vex-text-muted)">{{ user.email }}</strong>
    </p>

    <div class="mt-8 space-y-3">
      <UButton
        block
        size="lg"
        color="primary"
        variant="soft"
        icon="i-lucide-refresh-cw"
        :loading="checking"
        class="font-semibold"
        @click="checkStatus"
      >
        Verificar status
      </UButton>

      <UButton
        block
        size="lg"
        color="neutral"
        variant="ghost"
        icon="i-lucide-log-out"
        class="font-semibold"
        @click="logout"
      >
        Sair
      </UButton>
    </div>
  </div>
</template>
