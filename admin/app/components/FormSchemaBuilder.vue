<script setup lang="ts">
// Construtor visual do formSchema de uma deal kind=FORM. Edita a lista de campos
// (add/remove/reordenar) e as propriedades de cada um. v-model = FormField[].
// Mantém tudo dinâmico — novos tipos de campo bastam ser adicionados aqui.

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

const props = defineProps<{ modelValue: FormField[] }>()
const emit = defineEmits<{ 'update:modelValue': [FormField[]] }>()

const TYPES = ['text', 'email', 'tel', 'password', 'select', 'multiselect', 'textarea']

const fields = computed<FormField[]>(() => (Array.isArray(props.modelValue) ? props.modelValue : []))

function update(next: FormField[]) {
  emit('update:modelValue', [...next])
}

function addField() {
  update([
    ...fields.value,
    { key: `campo_${fields.value.length + 1}`, label: '', type: 'text', required: false },
  ])
}

function removeField(i: number) {
  const next = [...fields.value]
  next.splice(i, 1)
  update(next)
}

function move(i: number, dir: -1 | 1) {
  const next = [...fields.value]
  const j = i + dir
  if (j < 0 || j >= next.length) return
  ;[next[i], next[j]] = [next[j]!, next[i]!]
  update(next)
}

function patch(i: number, key: keyof FormField, value: unknown) {
  const next = [...fields.value]
  next[i] = { ...next[i]!, [key]: value }
  update(next)
}

function normalizeOptions(f: FormField): FormFieldOption[] {
  return (f.options ?? []).map(o => (typeof o === 'string' ? { value: o, label: o } : { ...o }))
}

function patchOptions(i: number, opts: FormFieldOption[]) {
  const next = [...fields.value]
  next[i] = { ...next[i]!, options: opts }
  update(next)
}

function addOption(i: number) {
  patchOptions(i, [...normalizeOptions(fields.value[i]!), { value: '', label: '' }])
}
function removeOption(i: number, oi: number) {
  const opts = normalizeOptions(fields.value[i]!)
  opts.splice(oi, 1)
  patchOptions(i, opts)
}
function patchOption(i: number, oi: number, key: keyof FormFieldOption, value: unknown) {
  const opts = normalizeOptions(fields.value[i]!)
  const parsed = (key === 'cpa' || key === 'revshare')
    ? (value === '' || value == null ? undefined : Number(value))
    : value
  opts[oi] = { ...opts[oi]!, [key]: parsed }
  patchOptions(i, opts)
}

function hasOptions(type: string) {
  return type === 'select' || type === 'multiselect'
}
</script>

<template>
  <div class="rounded-lg border border-muted p-3 space-y-3">
    <div class="flex items-center justify-between">
      <p class="text-xs font-semibold text-muted uppercase tracking-wide">Campos do formulário</p>
      <UButton icon="i-lucide-plus" size="xs" color="primary" variant="soft" @click="addField">Adicionar campo</UButton>
    </div>

    <p v-if="!fields.length" class="text-sm text-muted italic">
      Nenhum campo ainda. Clique em "Adicionar campo".
    </p>

    <div
      v-for="(f, i) in fields"
      :key="i"
      class="rounded-lg border border-muted p-3 space-y-2"
    >
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs font-semibold text-highlighted">#{{ i + 1 }} — {{ f.label || f.key || 'campo' }}</span>
        <div class="flex items-center gap-1">
          <UButton icon="i-lucide-chevron-up" size="xs" color="neutral" variant="ghost" :disabled="i === 0" @click="move(i, -1)" />
          <UButton icon="i-lucide-chevron-down" size="xs" color="neutral" variant="ghost" :disabled="i === fields.length - 1" @click="move(i, 1)" />
          <UButton icon="i-lucide-trash-2" size="xs" color="error" variant="ghost" @click="removeField(i)" />
        </div>
      </div>

      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <UFormField label="Key (identificador)" size="xs">
          <UInput :model-value="f.key" placeholder="ex: credUsername" size="xs" @update:model-value="patch(i, 'key', $event)" />
        </UFormField>
        <UFormField label="Label (título visível)" size="xs">
          <UInput :model-value="f.label ?? ''" placeholder="ex: Usuário desejado" size="xs" @update:model-value="patch(i, 'label', $event)" />
        </UFormField>
        <UFormField label="Tipo" size="xs">
          <USelect
            :model-value="f.type"
            :items="TYPES.map(t => ({ label: t, value: t }))"
            label-key="label"
            value-key="value"
            size="xs"
            @update:model-value="patch(i, 'type', $event)"
          />
        </UFormField>
        <UFormField label="Grupo (seção)" size="xs">
          <UInput :model-value="f.group ?? ''" placeholder="ex: Credenciais de Acesso" size="xs" @update:model-value="patch(i, 'group', $event)" />
        </UFormField>
        <UFormField label="Prefill (do usuário)" size="xs" help="user.firstName | user.lastName | user.email | user.whatsapp">
          <UInput :model-value="f.prefill ?? ''" placeholder="opcional" size="xs" @update:model-value="patch(i, 'prefill', $event)" />
        </UFormField>
      </div>

      <div class="flex flex-wrap items-center gap-4">
        <label class="flex items-center gap-1.5 text-xs text-highlighted">
          <UCheckbox :model-value="!!f.required" @update:model-value="patch(i, 'required', $event)" /> Obrigatório
        </label>
        <label class="flex items-center gap-1.5 text-xs text-highlighted">
          <UCheckbox :model-value="!!f.readonly" @update:model-value="patch(i, 'readonly', $event)" /> Somente leitura
        </label>
        <label class="flex items-center gap-1.5 text-xs text-highlighted">
          <UCheckbox :model-value="!!f.secret" @update:model-value="patch(i, 'secret', $event)" /> Secreto (criptografar)
        </label>
      </div>

      <!-- Opções (select / multiselect) -->
      <div v-if="hasOptions(f.type)" class="space-y-2 rounded-md border border-dashed border-muted p-2">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold text-muted">Opções</span>
          <UButton icon="i-lucide-plus" size="xs" color="neutral" variant="ghost" @click="addOption(i)">Opção</UButton>
        </div>
        <div
          v-for="(o, oi) in normalizeOptions(f)"
          :key="oi"
          class="grid grid-cols-2 gap-2 sm:grid-cols-5 items-center"
        >
          <UInput :model-value="o.value" placeholder="value" size="xs" @update:model-value="patchOption(i, oi, 'value', $event)" />
          <UInput :model-value="o.label ?? ''" placeholder="label" size="xs" @update:model-value="patchOption(i, oi, 'label', $event)" />
          <UInput :model-value="o.cpa != null ? String(o.cpa) : ''" type="number" placeholder="CPA" size="xs" @update:model-value="patchOption(i, oi, 'cpa', $event)" />
          <UInput :model-value="o.revshare != null ? String(o.revshare) : ''" type="number" placeholder="REV%" size="xs" @update:model-value="patchOption(i, oi, 'revshare', $event)" />
          <UButton icon="i-lucide-x" size="xs" color="error" variant="ghost" @click="removeOption(i, oi)" />
        </div>
        <p class="text-[11px] text-muted">CPA/REV são usados só no campo de acordo — o valor escolhido pré-preenche a liberação.</p>
      </div>
    </div>
  </div>
</template>
