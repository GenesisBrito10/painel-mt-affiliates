<script setup lang="ts">
definePageMeta({ layout: 'default' })

interface MaintenanceState {
  enabled: boolean
  title: string
  message: string
  bannerEnabled: boolean
  bannerTitle: string
  bannerMessage: string
}

const DEFAULTS: MaintenanceState = {
  enabled: false,
  title: 'Sistema em manutenção',
  message: 'Estamos realizando uma manutenção programada. Voltamos em instantes.',
  bannerEnabled: false,
  bannerTitle: 'Instabilidade temporária',
  bannerMessage: 'Estamos passando por uma instabilidade no painel. Tudo deve voltar ao normal em breve.'
}

const { authHeaders } = useAuth()
const apiBase = useApiBase()
const toast = useToast()

const state = ref<MaintenanceState>({ ...DEFAULTS })
const original = ref<MaintenanceState>({ ...DEFAULTS })
const loading = ref(false)
const saving = ref(false)

const dirty = computed(() =>
  state.value.enabled !== original.value.enabled
  || state.value.title !== original.value.title
  || state.value.message !== original.value.message
  || state.value.bannerEnabled !== original.value.bannerEnabled
  || state.value.bannerTitle !== original.value.bannerTitle
  || state.value.bannerMessage !== original.value.bannerMessage
)

async function load() {
  loading.value = true
  try {
    const data = await $fetch<MaintenanceState>(`${apiBase}/v1/admin/maintenance`, {
      headers: authHeaders()
    })
    state.value = { ...DEFAULTS, ...data }
    original.value = { ...state.value }
  } catch {
    toast.add({ title: 'Erro ao carregar', color: 'error' })
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  try {
    const data = await $fetch<MaintenanceState>(`${apiBase}/v1/admin/maintenance`, {
      method: 'PUT',
      headers: authHeaders(),
      body: state.value
    })
    state.value = { ...DEFAULTS, ...data }
    original.value = { ...state.value }
    toast.add({
      title: state.value.enabled ? 'Manutenção ATIVADA' : 'Manutenção desativada',
      description: state.value.enabled
        ? 'O frontend está bloqueado para todos os afiliados.'
        : 'O frontend voltou a ficar acessível.',
      color: state.value.enabled ? 'warning' : 'success',
      icon: state.value.enabled ? 'i-lucide-shield-alert' : 'i-lucide-check'
    })
  } catch {
    toast.add({ title: 'Erro ao salvar', color: 'error' })
  } finally {
    saving.value = false
  }
}

function reset() {
  state.value = { ...original.value }
}

async function toggleQuick() {
  state.value.enabled = !state.value.enabled
  await save()
}

onMounted(load)
</script>

<template>
  <div class="w-full">
    <UCard>
      <div class="divide-y divide-zinc-800">
        <div class="flex flex-col gap-4 pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex items-start gap-3">
            <UIcon
              :name="state.enabled ? 'i-lucide-shield-alert' : 'i-lucide-shield-check'"
              class="mt-0.5 size-5 shrink-0"
              :class="state.enabled ? 'text-amber-400' : 'text-emerald-400'"
            />
            <div>
              <div class="text-sm font-semibold text-zinc-100">
                {{ state.enabled ? 'Sistema em manutenção' : 'Sistema online' }}
              </div>
              <div class="mt-0.5 text-xs leading-5 text-zinc-400">
                {{ state.enabled
                  ? 'O frontend está bloqueado para todos os afiliados.'
                  : 'O frontend está liberado para todos os afiliados.' }}
              </div>
            </div>
          </div>
          <USwitch v-model="state.enabled" size="lg" />
        </div>

        <div class="space-y-5 py-5">
          <UFormField label="Título" hint="Mostrado em destaque na tela.">
            <UInput v-model="state.title" placeholder="Sistema em manutenção" maxlength="120" />
          </UFormField>

          <UFormField label="Mensagem" hint="Texto explicativo abaixo do título.">
            <UTextarea v-model="state.message" :rows="4" maxlength="500" />
          </UFormField>
        </div>

        <div class="space-y-5 py-5">
          <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div class="flex items-start gap-3">
              <UIcon
                :name="state.bannerEnabled ? 'i-lucide-megaphone' : 'i-lucide-message-square-off'"
                class="mt-0.5 size-5 shrink-0"
                :class="state.bannerEnabled ? 'text-amber-400' : 'text-zinc-500'"
              />
              <div>
                <div class="text-sm font-semibold text-zinc-100">
                  Banner de aviso
                </div>
                <div class="mt-0.5 text-xs leading-5 text-zinc-400">
                  Aviso não bloqueante exibido no topo do painel dos afiliados.
                </div>
              </div>
            </div>
            <USwitch v-model="state.bannerEnabled" size="lg" />
          </div>

          <UFormField label="Título do banner" hint="Mostrado em destaque no aviso.">
            <UInput v-model="state.bannerTitle" placeholder="Instabilidade temporária" maxlength="120" />
          </UFormField>

          <UFormField label="Mensagem do banner" hint="Texto curto exibido abaixo do título.">
            <UTextarea v-model="state.bannerMessage" :rows="3" maxlength="500" />
          </UFormField>
        </div>

        <div class="flex flex-wrap items-center justify-end gap-2 pt-5">
          <UButton variant="ghost" :disabled="!dirty || saving" @click="reset">Desfazer</UButton>
          <UButton variant="ghost" :loading="loading" icon="i-lucide-refresh-cw" @click="load">Recarregar</UButton>
          <UButton color="primary" :disabled="!dirty" :loading="saving" icon="i-lucide-save" @click="save">
            Salvar
          </UButton>
        </div>
      </div>
    </UCard>
  </div>
</template>
