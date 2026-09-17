<script setup lang="ts">
definePageMeta({ layout: 'default' })

interface ThemePalette {
  brand: string
  accent: string
  info: string
  positive: string
  negative: string
  warning: string
  sidebarBg: string
  sidebarText: string
  sidebarActive: string
}

const DEFAULTS: ThemePalette = {
  brand: '#39FF14',
  accent: '#39FF14',
  info: '#39FF14',
  positive: '#39FF14',
  negative: '#EF4444',
  warning: '#F59E0B',
  sidebarBg: '#080A08',
  sidebarText: '#B8C2B8',
  sidebarActive: '#FFFFFF'
}

const FIELDS: Array<{ key: keyof ThemePalette, label: string, hint: string }> = [
  { key: 'brand', label: 'Brand', hint: 'Cor primária — botões, links, destaques principais.' },
  { key: 'accent', label: 'Accent', hint: 'CTA secundário — chamadas para ação.' },
  { key: 'info', label: 'Info', hint: 'Estados informativos — banners e badges neutros.' },
  { key: 'positive', label: 'Positivo', hint: 'Sucesso, ganhos, valores aprovados.' },
  { key: 'negative', label: 'Negativo', hint: 'Erros, cancelamentos, perdas.' },
  { key: 'warning', label: 'Aviso', hint: 'Alertas, pendências, ações de atenção.' },
  { key: 'sidebarBg', label: 'Sidebar · Fundo', hint: 'Fundo da barra lateral do frontend.' },
  { key: 'sidebarText', label: 'Sidebar · Texto', hint: 'Texto inativo da barra lateral.' },
  { key: 'sidebarActive', label: 'Sidebar · Ativo', hint: 'Texto/destaque do item ativo.' }
]

const { authHeaders } = useAuth()
const apiBase = useApiBase()
const toast = useToast()

const palette = ref<ThemePalette>({ ...DEFAULTS })
const original = ref<ThemePalette>({ ...DEFAULTS })
const loading = ref(false)
const saving = ref(false)

const dirty = computed(() =>
  (Object.keys(palette.value) as Array<keyof ThemePalette>).some(
    k => palette.value[k].toLowerCase() !== original.value[k].toLowerCase()
  )
)

async function load() {
  loading.value = true
  try {
    const data = await $fetch<ThemePalette>(`${apiBase}/v1/admin/theme`, {
      headers: authHeaders()
    })
    palette.value = { ...DEFAULTS, ...data }
    original.value = { ...palette.value }
  } catch {
    toast.add({ title: 'Erro ao carregar tema', color: 'error' })
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  try {
    const data = await $fetch<ThemePalette>(`${apiBase}/v1/admin/theme`, {
      method: 'PUT',
      headers: authHeaders(),
      body: palette.value
    })
    palette.value = { ...DEFAULTS, ...data }
    original.value = { ...palette.value }
    toast.add({
      title: 'Tema atualizado',
      description: 'O frontend aplica as novas cores no próximo carregamento.',
      color: 'success',
      icon: 'i-lucide-check'
    })
  } catch {
    toast.add({ title: 'Erro ao salvar tema', color: 'error' })
  } finally {
    saving.value = false
  }
}

function reset() {
  palette.value = { ...original.value }
}

function restoreDefaults() {
  palette.value = { ...DEFAULTS }
}

function normalizeHex(value: string): string {
  const v = value.trim()
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase()
  if (/^#[0-9a-f]{3}$/i.test(v)) {
    const r = v[1], g = v[2], b = v[3]
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
  }
  return v
}

function onHexInput(field: keyof ThemePalette, value: string) {
  palette.value[field] = value
}

function onHexBlur(field: keyof ThemePalette) {
  palette.value[field] = normalizeHex(palette.value[field])
}

onMounted(() => load())
</script>

<template>
  <div
    class="fade-up"
    :style="{ padding: '4px 0 28px' }"
  >
    <!-- Header -->
    <div class="flex items-start justify-between gap-3 mb-6">
      <div>
        <div style="font-size: 19px; font-weight: 800; letter-spacing: -0.01em">
          Tema do sistema
        </div>
        <div
          style="font-size: 12px; margin-top: 4px; color: var(--color-text-muted); max-width: 640px; line-height: 1.55"
        >
          Define as cores de destaque aplicadas no painel do afiliado.
          As alterações são salvas no banco e carregadas pelo frontend a cada reload.
        </div>
      </div>
      <div class="flex gap-2 shrink-0">
        <button
          class="btn btn-ghost btn-sm"
          :disabled="loading"
          @click="load()"
        >
          <UIcon
            name="i-lucide-refresh-cw"
            class="size-3.5"
          />
          Recarregar
        </button>
        <button
          class="btn btn-ghost btn-sm"
          :disabled="saving"
          @click="restoreDefaults"
        >
          <UIcon
            name="i-lucide-rotate-ccw"
            class="size-3.5"
          />
          Padrão
        </button>
        <button
          class="btn btn-ghost btn-sm"
          :disabled="!dirty || saving"
          @click="reset"
        >
          Desfazer
        </button>
        <button
          class="btn btn-gold btn-sm"
          :disabled="!dirty || saving"
          @click="save"
        >
          <UIcon
            :name="saving ? 'i-lucide-loader-2' : 'i-lucide-save'"
            class="size-3.5"
            :class="saving ? 'animate-spin' : ''"
          />
          Salvar tema
        </button>
      </div>
    </div>

    <!-- Color grid -->
    <div
      class="card-vex"
      style="padding: 24px"
    >
      <div
        v-if="loading"
        style="text-align: center; padding: 56px; color: var(--color-text-muted); font-size: 13px"
      >
        Carregando paleta…
      </div>
      <div
        v-else
        class="grid gap-3"
        style="grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))"
      >
        <div
          v-for="field in FIELDS"
          :key="field.key"
          class="flex items-center gap-3"
          :style="{
            padding: '12px 14px',
            borderRadius: '10px',
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border)'
          }"
        >
          <!-- Swatch + native picker -->
          <label
            class="relative shrink-0 cursor-pointer"
            :style="{
              width: '44px',
              height: '44px',
              borderRadius: '10px',
              background: palette[field.key],
              border: '1px solid var(--color-border)',
              boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06)'
            }"
          >
            <input
              type="color"
              :value="palette[field.key]"
              class="absolute inset-0 opacity-0 cursor-pointer"
              @input="(e) => onHexInput(field.key, (e.target as HTMLInputElement).value)"
            >
          </label>

          <div class="flex-1 min-w-0">
            <div style="font-size: 12.5px; font-weight: 700; letter-spacing: -0.005em">
              {{ field.label }}
            </div>
            <div
              style="font-size: 10.5px; color: var(--color-text-muted); line-height: 1.4; margin-top: 1px"
            >
              {{ field.hint }}
            </div>
          </div>

          <input
            class="mono"
            :value="palette[field.key]"
            spellcheck="false"
            :style="{
              width: '92px',
              padding: '6px 8px',
              borderRadius: '6px',
              background: 'var(--color-surface-elevated)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text)',
              fontSize: '11.5px',
              textAlign: 'center',
              letterSpacing: '0.02em'
            }"
            @input="(e) => onHexInput(field.key, (e.target as HTMLInputElement).value)"
            @blur="onHexBlur(field.key)"
          >
        </div>
      </div>
    </div>

    <!-- Live preview -->
    <div
      class="card-vex"
      style="padding: 20px; margin-top: 16px"
    >
      <div
        style="font-size: 13px; font-weight: 700; margin-bottom: 12px"
      >
        Pré-visualização
      </div>
      <div class="flex flex-wrap gap-2">
        <span
          v-for="field in FIELDS"
          :key="`p-${field.key}`"
          :style="{
            padding: '6px 12px',
            borderRadius: '999px',
            background: palette[field.key],
            color: '#fff',
            fontSize: '11px',
            fontWeight: 700,
            letterSpacing: '0.02em',
            textShadow: '0 1px 2px rgba(0,0,0,0.35)'
          }"
        >
          {{ field.label }}
        </span>
      </div>
    </div>
  </div>
</template>
