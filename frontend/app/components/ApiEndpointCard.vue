<script setup lang="ts">
type Param = { name: string, in: 'path' | 'query' | 'body', type: string, required: boolean, desc: string }
type FieldDoc = { name: string, type: string, desc: string }
type ErrDoc = { code: string, label: string, desc: string }
type NoteDoc = { type: string, text: string }

const props = defineProps<{
  anchorId?: string
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  path: string
  summary: string
  authNote?: string
  params?: Param[]
  requestExample?: string
  responseExample?: string
  responseFields?: FieldDoc[]
  errors?: ErrDoc[]
  notes?: NoteDoc[]
  curl?: string
  js?: string
  python?: string
}>()

const slots = useSlots()
const toast = useToast()

const methodStyle = computed(() => {
  switch (props.method) {
    case 'GET': return 'background: var(--vex-positive-soft-bg); color: var(--vex-positive-soft-text)'
    case 'POST': return 'background: var(--vex-info-soft-bg); color: var(--vex-info-soft-text)'
    case 'PATCH': return 'background: var(--vex-warning-soft-bg); color: var(--vex-warning-soft-text)'
    case 'DELETE': return 'background: var(--vex-negative-soft-bg); color: var(--vex-negative-soft-text)'
    default: return 'background: var(--vex-surface-strong); color: var(--vex-text)'
  }
})

const hasReq = computed(() => (props.params && props.params.length > 0) || !!props.requestExample)
const hasExamples = computed(() => !!(props.curl || props.js || props.python))

const tabs = computed(() => {
  const t: { id: string, label: string }[] = []
  if (hasReq.value) t.push({ id: 'req', label: 'Requisição' })
  if (props.responseExample) t.push({ id: 'resp', label: 'Resposta' })
  if (hasExamples.value) t.push({ id: 'examples', label: 'Exemplos' })
  if (slots.testar) t.push({ id: 'testar', label: 'Testar' })
  return t
})

const active = ref<string>('')
watchEffect(() => {
  if (!active.value && tabs.value.length) active.value = tabs.value[0]!.id
})

const langs = computed(() => [
  { id: 'curl', label: 'cURL', code: props.curl },
  { id: 'js', label: 'JavaScript', code: props.js },
  { id: 'python', label: 'Python', code: props.python },
].filter(l => l.code))
const lang = ref<'curl' | 'js' | 'python'>('curl')
const langCode = computed(() => langs.value.find(l => l.id === lang.value)?.code ?? langs.value[0]?.code ?? '')

async function copy(text: string, title = 'Copiado') {
  if (!import.meta.client) return
  await navigator.clipboard.writeText(text)
  toast.add({ title, color: 'success', icon: 'i-lucide-check' })
}

const inLabel: Record<Param['in'], string> = { path: 'path', query: 'query', body: 'body' }
</script>

<template>
  <section :id="anchorId" class="vex-card scroll-mt-24 p-5">
    <!-- Header -->
    <div class="flex flex-wrap items-center gap-2">
      <span class="rounded px-2 py-1 text-[11px] font-black tracking-wide" :style="methodStyle">{{ method }}</span>
      <code class="break-all text-sm font-bold" style="color: var(--vex-text)">{{ path }}</code>
      <UButton
        icon="i-lucide-copy" size="xs" color="neutral" variant="ghost"
        :aria-label="`Copiar ${path}`"
        @click="copy(path, 'Caminho copiado')"
      />
    </div>
    <p class="mt-2 text-sm" style="color: var(--vex-text-muted)">{{ summary }}</p>
    <p v-if="authNote" class="mt-1 flex items-center gap-1.5 text-xs" style="color: var(--vex-text-faint)">
      <UIcon name="i-lucide-lock" class="size-3.5" />{{ authNote }}
    </p>

    <!-- Tabs -->
    <div class="mt-4 flex flex-wrap gap-1 rounded-lg p-1" style="background: var(--vex-surface-strong); border: 1px solid var(--vex-border-subtle)">
      <button
        v-for="t in tabs" :key="t.id" type="button"
        class="rounded-md px-3 py-1.5 text-xs font-semibold transition-colors"
        :style="active === t.id
          ? 'background: var(--vex-surface); color: var(--vex-text); box-shadow: var(--vex-shadow-sm)'
          : 'color: var(--vex-text-faint)'"
        @click="active = t.id"
      >{{ t.label }}</button>
    </div>

    <!-- Requisição -->
    <div v-show="active === 'req'" class="mt-4 flex flex-col gap-4">
      <div v-if="params && params.length" class="overflow-x-auto rounded-lg" style="border: 1px solid var(--vex-border-subtle)">
        <table class="w-full text-xs min-w-[520px]">
          <thead>
            <tr style="background: var(--vex-surface-strong); border-bottom: 1px solid var(--vex-border-subtle)">
              <th class="px-3 py-2 text-left font-bold" style="color: var(--vex-text-faint)">Parâmetro</th>
              <th class="px-3 py-2 text-left font-bold" style="color: var(--vex-text-faint)">Em</th>
              <th class="px-3 py-2 text-left font-bold" style="color: var(--vex-text-faint)">Tipo</th>
              <th class="px-3 py-2 text-left font-bold" style="color: var(--vex-text-faint)">Obrig.</th>
              <th class="px-3 py-2 text-left font-bold" style="color: var(--vex-text-faint)">Descrição</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in params" :key="p.name + p.in" style="border-bottom: 1px solid var(--vex-border-subtle)">
              <td class="px-3 py-2"><code style="color: var(--vex-brand)">{{ p.name }}</code></td>
              <td class="px-3 py-2"><span class="rounded px-1.5 py-0.5 text-[10px] font-semibold" style="background: var(--vex-surface-strong); color: var(--vex-text-muted)">{{ inLabel[p.in] }}</span></td>
              <td class="px-3 py-2 whitespace-nowrap" style="color: var(--vex-text-muted)">{{ p.type }}</td>
              <td class="px-3 py-2">
                <span v-if="p.required" class="text-[11px] font-bold" style="color: var(--vex-negative-soft-text)">sim</span>
                <span v-else class="text-[11px]" style="color: var(--vex-text-faint)">não</span>
              </td>
              <td class="px-3 py-2" style="color: var(--vex-text-muted)">{{ p.desc }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="requestExample">
        <div class="mb-1 flex items-center justify-between">
          <p class="text-xs font-bold uppercase tracking-wide" style="color: var(--vex-text-muted)">Body (JSON)</p>
          <UButton icon="i-lucide-copy" size="xs" color="neutral" variant="ghost" @click="copy(requestExample, 'Body copiado')" />
        </div>
        <pre class="overflow-x-auto rounded-lg p-4 text-xs leading-relaxed" style="background: var(--vex-bg); color: var(--vex-text); border: 1px solid var(--vex-border-subtle)">{{ requestExample }}</pre>
      </div>
    </div>

    <!-- Resposta -->
    <div v-show="active === 'resp'" class="mt-4 flex flex-col gap-4">
      <div>
        <div class="mb-1 flex items-center justify-between">
          <p class="text-xs font-bold uppercase tracking-wide" style="color: var(--vex-text-muted)">Resposta <code>200 OK</code></p>
          <UButton icon="i-lucide-copy" size="xs" color="neutral" variant="ghost" @click="responseExample && copy(responseExample, 'Resposta copiada')" />
        </div>
        <pre class="max-h-[26rem] overflow-auto rounded-lg p-4 text-xs leading-relaxed" style="background: var(--vex-bg); color: var(--vex-text); border: 1px solid var(--vex-border-subtle)">{{ responseExample }}</pre>
      </div>
      <div v-if="responseFields && responseFields.length" class="overflow-x-auto rounded-lg" style="border: 1px solid var(--vex-border-subtle)">
        <table class="w-full text-xs min-w-[420px]">
          <thead>
            <tr style="background: var(--vex-surface-strong); border-bottom: 1px solid var(--vex-border-subtle)">
              <th class="px-3 py-2 text-left font-bold" style="color: var(--vex-text-faint)">Campo</th>
              <th class="px-3 py-2 text-left font-bold" style="color: var(--vex-text-faint)">Tipo</th>
              <th class="px-3 py-2 text-left font-bold" style="color: var(--vex-text-faint)">Descrição</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="f in responseFields" :key="f.name" style="border-bottom: 1px solid var(--vex-border-subtle)">
              <td class="px-3 py-2"><code style="color: var(--vex-brand)">{{ f.name }}</code></td>
              <td class="px-3 py-2 whitespace-nowrap" style="color: var(--vex-text-muted)">{{ f.type }}</td>
              <td class="px-3 py-2" style="color: var(--vex-text-muted)">{{ f.desc }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Exemplos -->
    <div v-show="active === 'examples'" class="mt-4">
      <div class="mb-2 flex items-center justify-between gap-2">
        <div class="flex flex-wrap gap-1 rounded-lg p-1" style="background: var(--vex-surface-strong); border: 1px solid var(--vex-border-subtle)">
          <button
            v-for="l in langs" :key="l.id" type="button"
            class="rounded-md px-3 py-1 text-xs font-semibold transition-colors"
            :style="lang === l.id ? 'background: var(--vex-surface); color: var(--vex-text); box-shadow: var(--vex-shadow-sm)' : 'color: var(--vex-text-faint)'"
            @click="lang = l.id as 'curl' | 'js' | 'python'"
          >{{ l.label }}</button>
        </div>
        <UButton icon="i-lucide-copy" size="xs" label="Copiar" color="neutral" variant="soft" @click="copy(langCode, 'Exemplo copiado')" />
      </div>
      <pre class="overflow-x-auto rounded-lg p-4 text-xs leading-relaxed" style="background: var(--vex-bg); color: var(--vex-text); border: 1px solid var(--vex-border-subtle)">{{ langCode }}</pre>
    </div>

    <!-- Testar -->
    <div v-show="active === 'testar'" class="mt-4">
      <slot name="testar" />
    </div>

    <!-- Notes + errors -->
    <div v-if="notes && notes.length" class="mt-4 flex flex-col gap-2">
      <div
        v-for="(n, i) in notes" :key="i"
        class="flex items-start gap-2 rounded-lg p-3 text-xs"
        :style="n.type === 'warning'
          ? 'background: var(--vex-warning-soft-bg); color: var(--vex-warning-soft-text)'
          : 'background: var(--vex-info-soft-bg); border: 1px solid var(--vex-info-soft-border); color: var(--vex-text-muted)'"
      >
        <UIcon :name="n.type === 'warning' ? 'i-lucide-alert-triangle' : 'i-lucide-info'" class="mt-0.5 size-4 shrink-0" />
        <span>{{ n.text }}</span>
      </div>
    </div>

    <div v-if="errors && errors.length" class="mt-4">
      <p class="mb-2 text-xs font-bold uppercase tracking-wide" style="color: var(--vex-text-muted)">Códigos de erro</p>
      <div class="flex flex-wrap gap-2">
        <div
          v-for="e in errors" :key="e.code"
          class="flex items-start gap-2 rounded-lg p-2.5"
          style="background: var(--vex-surface-strong); border: 1px solid var(--vex-border-subtle); min-width: 220px; flex: 1 1 220px"
        >
          <span class="rounded px-1.5 py-0.5 text-[11px] font-black" style="background: var(--vex-negative-soft-bg); color: var(--vex-negative-soft-text)">{{ e.code }}</span>
          <div class="min-w-0">
            <p class="text-xs font-bold" style="color: var(--vex-text)">{{ e.label }}</p>
            <p class="text-[11px]" style="color: var(--vex-text-muted)">{{ e.desc }}</p>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
