<script setup lang="ts">
// Renderiza dinamicamente o formulário de uma deal kind=FORM a partir do
// `deal.formSchema`. Pré-preenche nome/sobrenome/email/whatsapp do usuário
// logado e envia as respostas para POST /v1/link-requests { dealId, formData }.
// Campos `secret` (senha de terceiro) trafegam via HTTPS e são criptografados
// no backend antes de gravar.

interface FormFieldOption {
  value: string
  label?: string
  cpa?: number
  revshare?: number
}

interface FormField {
  key: string
  label?: string
  type: string
  required?: boolean
  readonly?: boolean
  secret?: boolean
  prefill?: string
  group?: string
  options?: Array<string | FormFieldOption>
  default?: unknown
}

interface DealItem {
  id: string
  name: string
  houseName: string
  logoUrl: string | null
  kind?: 'LINK' | 'FORM'
  // `unknown` para casar com o tipo vindo de deals.vue (JSON do backend).
  formSchema?: unknown
}

const props = defineProps<{ deal: DealItem | null }>()
const emit = defineEmits<{ close: []; submitted: [] }>()

const { user, authHeaders, fetchMe } = useAuth()
const apiBase = useApiBase()
const toast = useToast()

const submitting = ref(false)
const values = reactive<Record<string, unknown>>({})
const errors = reactive<Record<string, string>>({})
// Toggle "ver senha" por campo (key → visível?).
const revealed = reactive<Record<string, boolean>>({})
function toggleReveal(key: string) {
  revealed[key] = !revealed[key]
}

const fields = computed<FormField[]>(() =>
  Array.isArray(props.deal?.formSchema) ? (props.deal!.formSchema as FormField[]) : [],
)

// Agrupa por `group` preservando a ordem de aparição.
const groups = computed(() => {
  const order: string[] = []
  const byGroup: Record<string, FormField[]> = {}
  for (const f of fields.value) {
    const g = f.group || 'Formulário'
    if (!byGroup[g]) { byGroup[g] = []; order.push(g) }
    byGroup[g]!.push(f)
  }
  return order.map(g => ({ name: g, fields: byGroup[g]! }))
})

function normalizeOptions(opts?: Array<string | FormFieldOption>): FormFieldOption[] {
  return (opts ?? []).map(o => (typeof o === 'string' ? { value: o, label: o } : o))
}

function resolvePrefill(prefill?: string): unknown {
  if (!prefill || !user.value) return undefined
  const name = user.value.name ?? ''
  switch (prefill) {
    case 'user.firstName': return name.split(' ')[0] ?? ''
    case 'user.lastName': return name.split(' ').slice(1).join(' ')
    case 'user.email': return user.value.email ?? ''
    case 'user.whatsapp': return user.value.whatsapp ?? ''
    default: return undefined
  }
}

function initValues() {
  for (const k of Object.keys(values)) delete values[k]
  for (const k of Object.keys(errors)) delete errors[k]
  for (const f of fields.value) {
    const pre = resolvePrefill(f.prefill)
    if (pre !== undefined && pre !== '') { values[f.key] = pre; continue }
    if (f.default !== undefined) { values[f.key] = f.default; continue }
    values[f.key] = f.type === 'multiselect' ? [] : ''
  }
}

// Reinicializa quando abre um novo form (garante prefill fresco).
watch(
  () => props.deal?.id,
  async (id) => {
    if (!id) return
    if (!user.value) { try { await fetchMe() } catch { /* segue com o que houver */ } }
    initValues()
  },
  { immediate: true },
)

function toggleMulti(key: string, val: string) {
  const arr = Array.isArray(values[key]) ? [...(values[key] as string[])] : []
  const i = arr.indexOf(val)
  if (i >= 0) arr.splice(i, 1)
  else arr.push(val)
  values[key] = arr
}

// Senha forte: mín. 6 caracteres, 1 minúscula, 1 maiúscula e 1 número.
const STRONG_PASSWORD = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{6,}$/

function validate(): boolean {
  for (const k of Object.keys(errors)) delete errors[k]
  let ok = true
  for (const f of fields.value) {
    const v = values[f.key]
    const empty = v == null || v === '' || (Array.isArray(v) && v.length === 0)
    if (f.required && empty) { errors[f.key] = 'Campo obrigatório'; ok = false; continue }
    if (f.type === 'password' && typeof v === 'string' && v !== '' && !STRONG_PASSWORD.test(v)) {
      errors[f.key] = 'A senha deve ter no mínimo 6 caracteres, uma letra minúscula, uma letra maiúscula e um número.'
      ok = false
    }
  }
  return ok
}

async function submit() {
  if (!props.deal) return
  if (!validate()) {
    toast.add({ title: 'Preencha os campos obrigatórios', color: 'warning', icon: 'i-lucide-alert-triangle' })
    return
  }
  submitting.value = true
  try {
    await $fetch(`${apiBase}/v1/link-requests`, {
      method: 'POST',
      headers: authHeaders(),
      body: { dealId: props.deal.id, formData: { ...values } },
    })
    toast.add({ title: 'Formulário enviado!', description: 'Aguarde a liberação do acesso.', color: 'success', icon: 'i-lucide-check-circle' })
    emit('submitted')
    emit('close')
  }
  catch (err: unknown) {
    const data = (err as { data?: { message?: string; error?: string } })?.data
    toast.add({ title: 'Erro ao enviar', description: data?.message ?? data?.error ?? 'Tente novamente.', color: 'error', icon: 'i-lucide-x-circle' })
  }
  finally { submitting.value = false }
}
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0 translate-x-8"
      enter-to-class="opacity-100 translate-x-0"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100 translate-x-0"
      leave-to-class="opacity-0 translate-x-8"
    >
      <div v-if="deal" class="fixed inset-0 z-[60] flex justify-end">
        <div class="absolute inset-0 bg-black/50 backdrop-blur-[2px]" @click="emit('close')" />

        <div class="relative w-full md:w-[480px] h-full shadow-2xl flex flex-col" style="background: var(--vex-surface)">
          <!-- Header -->
          <div class="p-4 sm:p-6 shrink-0 flex justify-between items-start gap-4" style="background: var(--vex-surface-strong)">
            <div class="flex items-center gap-3 min-w-0">
              <div class="size-12 rounded-xl overflow-hidden shrink-0 flex items-center justify-center font-bold text-xl" style="background: var(--vex-surface); color: var(--vex-brand); border: 1px solid var(--vex-border-subtle)">
                <img v-if="deal.logoUrl" :src="deal.logoUrl" :alt="deal.houseName" class="size-full object-cover">
                <span v-else>{{ deal.houseName.charAt(0).toUpperCase() }}</span>
              </div>
              <div class="min-w-0">
                <h2 class="text-lg font-bold truncate vex-title" style="color: var(--vex-text)">{{ deal.houseName }}</h2>
                <p class="text-[13px] mt-0.5 truncate" style="color: var(--vex-text-faint)">Solicitar acesso</p>
              </div>
            </div>
            <button class="p-1.5 rounded-lg shrink-0" style="background: var(--vex-surface); border: 1px solid var(--vex-border-subtle); color: var(--vex-text-faint)" @click="emit('close')">
              <UIcon name="i-lucide-x" class="size-5" />
            </button>
          </div>

          <!-- Body -->
          <div class="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
            <div v-for="group in groups" :key="group.name" class="space-y-4">
              <h3 class="font-bold text-[13px] uppercase tracking-wider" style="color: var(--vex-text-faint)">{{ group.name }}</h3>

              <div v-for="f in group.fields" :key="f.key" class="space-y-1.5">
                <label class="block text-[13px] font-semibold" style="color: var(--vex-text)">
                  {{ f.label ?? f.key }}
                  <span v-if="f.required" style="color: var(--vex-negative, #e5484d)">*</span>
                </label>

                <!-- textarea -->
                <textarea
                  v-if="f.type === 'textarea'"
                  v-model="values[f.key] as string"
                  :readonly="f.readonly"
                  rows="3"
                  class="w-full rounded-lg px-3 py-2 text-[13px]"
                  style="background: var(--vex-surface-strong); border: 1px solid var(--vex-border-subtle); color: var(--vex-text)"
                />

                <!-- select -->
                <select
                  v-else-if="f.type === 'select'"
                  v-model="values[f.key] as string"
                  :disabled="f.readonly"
                  class="w-full rounded-lg px-3 py-2 text-[13px]"
                  style="background: var(--vex-surface-strong); border: 1px solid var(--vex-border-subtle); color: var(--vex-text)"
                >
                  <option value="" disabled>Selecione…</option>
                  <option v-for="o in normalizeOptions(f.options)" :key="o.value" :value="o.value">{{ o.label ?? o.value }}</option>
                </select>

                <!-- multiselect -->
                <div v-else-if="f.type === 'multiselect'" class="flex flex-col gap-2">
                  <label
                    v-for="o in normalizeOptions(f.options)"
                    :key="o.value"
                    class="flex items-center gap-2.5 rounded-lg px-3 py-2 cursor-pointer text-[13px]"
                    style="background: var(--vex-surface-strong); border: 1px solid var(--vex-border-subtle); color: var(--vex-text)"
                  >
                    <input
                      type="checkbox"
                      :checked="Array.isArray(values[f.key]) && (values[f.key] as string[]).includes(o.value)"
                      @change="toggleMulti(f.key, o.value)"
                    >
                    {{ o.label ?? o.value }}
                  </label>
                </div>

                <!-- password (com botão ver/ocultar) -->
                <div v-else-if="f.type === 'password'" class="relative">
                  <input
                    v-model="values[f.key] as string"
                    :type="revealed[f.key] ? 'text' : 'password'"
                    :readonly="f.readonly"
                    autocomplete="new-password"
                    class="w-full rounded-lg px-3 py-2 pr-10 text-[13px]"
                    :style="`background: var(--vex-surface-strong); border: 1px solid var(--vex-border-subtle); color: var(--vex-text); ${f.readonly ? 'opacity:0.7' : ''}`"
                  >
                  <button
                    type="button"
                    class="absolute inset-y-0 right-0 flex items-center px-3"
                    style="color: var(--vex-text-faint)"
                    :aria-label="revealed[f.key] ? 'Ocultar senha' : 'Ver senha'"
                    @click="toggleReveal(f.key)"
                  >
                    <UIcon :name="revealed[f.key] ? 'i-lucide-eye-off' : 'i-lucide-eye'" class="size-4" />
                  </button>
                </div>
                <p v-if="f.type === 'password' && !errors[f.key]" class="text-[11px]" style="color: var(--vex-text-faint)">
                  Mín. 6 caracteres, com maiúscula, minúscula e número.
                </p>

                <!-- text | email | tel -->
                <input
                  v-else
                  v-model="values[f.key] as string"
                  :type="f.type === 'email' ? 'email' : f.type === 'tel' ? 'tel' : 'text'"
                  :readonly="f.readonly"
                  autocomplete="off"
                  class="w-full rounded-lg px-3 py-2 text-[13px]"
                  :style="`background: var(--vex-surface-strong); border: 1px solid var(--vex-border-subtle); color: var(--vex-text); ${f.readonly ? 'opacity:0.7' : ''}`"
                >

                <p v-if="errors[f.key]" class="text-[11px]" style="color: var(--vex-negative, #e5484d)">{{ errors[f.key] }}</p>
              </div>
            </div>
          </div>

          <!-- Footer -->
          <div class="p-5 sm:p-6 shrink-0" style="background: var(--vex-surface); border-top: 1px solid var(--vex-border-subtle)">
            <button
              class="vex-cta-primary w-full !h-12 !text-[14px] uppercase tracking-wide"
              :disabled="submitting"
              @click="submit"
            >
              <UIcon v-if="submitting" name="i-lucide-loader-2" class="size-5 animate-spin" />
              <UIcon v-else name="i-lucide-send" class="size-5" />
              {{ submitting ? 'Enviando…' : 'Enviar solicitação' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
