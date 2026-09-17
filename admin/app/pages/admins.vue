<script setup lang="ts">
definePageMeta({ layout: 'default' })

interface Admin {
  id: string
  name: string
  email: string
  role: 'SUPPORT' | 'ADMIN' | 'SUPERADMIN'
  active: boolean
  createdAt: string
  updatedAt: string
}

interface ListResponse {
  data: Admin[]
  total: number
  page: number
  limit: number
}

const { authHeaders, user } = useAuth()
const apiBase = useApiBase()
const toast = useToast()

const loading = ref(false)
const admins = ref<Admin[]>([])
const total = ref(0)
const page = ref(1)
const limit = ref(50)
const search = ref('')
const roleFilter = ref<'ALL' | 'SUPPORT' | 'ADMIN' | 'SUPERADMIN'>('ALL')

const showFormModal = ref(false)
const showPasswordModal = ref(false)
const showDeleteModal = ref(false)
const editing = ref<Admin | null>(null)
const targetPwd = ref<Admin | null>(null)
const deleting = ref<Admin | null>(null)
const submitting = ref(false)

const form = reactive({
  name: '',
  email: '',
  password: '',
  role: 'ADMIN' as 'SUPPORT' | 'ADMIN' | 'SUPERADMIN'
})

const pwdForm = reactive({ password: '' })

const PASSWORD_REGEX = /^(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&]).{8,}$/
const PASSWORD_HINT = 'Mín. 8 caracteres, 1 maiúscula, 1 número, 1 especial (@$!%*?&).'

function validatePassword(p: string): string | null {
  if (!p) return 'Informe a senha.'
  if (p.length < 8) return 'Senha precisa de no mínimo 8 caracteres.'
  if (!/[A-Z]/.test(p)) return 'Senha precisa de ao menos 1 letra maiúscula.'
  if (!/\d/.test(p)) return 'Senha precisa de ao menos 1 número.'
  if (!/[@$!%*?&]/.test(p)) return 'Senha precisa de ao menos 1 caractere especial (@$!%*?&).'
  if (!PASSWORD_REGEX.test(p)) return 'Senha em formato inválido.'
  return null
}

const formPasswordError = computed(() =>
  !editing.value && form.password ? validatePassword(form.password) : null
)
const pwdFormError = computed(() =>
  pwdForm.password ? validatePassword(pwdForm.password) : null
)

const roleOptions = [
  { label: 'Suporte', value: 'SUPPORT' as const },
  { label: 'Admin', value: 'ADMIN' as const },
  { label: 'Super Admin', value: 'SUPERADMIN' as const }
]

const filterRoleOptions = [
  { label: 'Todos', value: 'ALL' as const },
  ...roleOptions
]

const fmtDate = (v: string) =>
  new Date(v).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

const roleLabel = (r: Admin['role']) => {
  if (r === 'SUPERADMIN') return 'Super Admin'
  if (r === 'SUPPORT') return 'Suporte'
  return 'Admin'
}

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / limit.value)))

function errorMessage(err: unknown): string {
  const e = err as {
    data?: { detail?: string, message?: string | string[] }
    message?: string
  }
  if (e?.data?.detail) return e.data.detail
  const m = e?.data?.message
  if (Array.isArray(m)) return m.join('; ')
  return m || e?.message || 'Erro inesperado'
}

async function fetchAdmins() {
  loading.value = true
  try {
    const params = new URLSearchParams()
    params.set('page', String(page.value))
    params.set('limit', String(limit.value))
    if (search.value.trim()) params.set('search', search.value.trim())
    if (roleFilter.value !== 'ALL') params.set('role', roleFilter.value)

    const res = await $fetch<ListResponse>(
      `${apiBase}/v1/admin/admins?${params.toString()}`,
      { headers: authHeaders(), credentials: 'include' }
    )
    admins.value = res.data
    total.value = res.total
  } catch (err: unknown) {
    toast.add({ title: 'Erro ao carregar admins', description: errorMessage(err), color: 'error' })
  } finally {
    loading.value = false
  }
}

function resetForm() {
  form.name = ''
  form.email = ''
  form.password = ''
  form.role = 'ADMIN'
}

function openCreate() {
  editing.value = null
  resetForm()
  showFormModal.value = true
}

function openEdit(a: Admin) {
  editing.value = a
  form.name = a.name
  form.email = a.email
  form.password = ''
  form.role = a.role
  showFormModal.value = true
}

function openPassword(a: Admin) {
  targetPwd.value = a
  pwdForm.password = ''
  showPasswordModal.value = true
}

function openDelete(a: Admin) {
  deleting.value = a
  showDeleteModal.value = true
}

async function submitForm() {
  if (!form.name.trim() || !form.email.trim()) {
    toast.add({ title: 'Preencha nome e email', color: 'warning' })
    return
  }
  if (!editing.value) {
    const err = validatePassword(form.password)
    if (err) {
      toast.add({ title: err, color: 'warning' })
      return
    }
  }
  submitting.value = true
  try {
    if (editing.value) {
      await $fetch(`${apiBase}/v1/admin/admins/${editing.value.id}`, {
        method: 'PATCH',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: { name: form.name, email: form.email, role: form.role }
      })
      toast.add({ title: 'Admin atualizado', color: 'success' })
    } else {
      await $fetch(`${apiBase}/v1/admin/admins`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: form
      })
      toast.add({ title: 'Admin criado', color: 'success' })
    }
    showFormModal.value = false
    await fetchAdmins()
  } catch (err: unknown) {
    toast.add({ title: 'Erro ao salvar', description: errorMessage(err), color: 'error' })
  } finally {
    submitting.value = false
  }
}

async function submitPassword() {
  if (!targetPwd.value) return
  const err = validatePassword(pwdForm.password)
  if (err) {
    toast.add({ title: err, color: 'warning' })
    return
  }
  submitting.value = true
  try {
    await $fetch(`${apiBase}/v1/admin/admins/${targetPwd.value.id}/password`, {
      method: 'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      credentials: 'include',
      body: pwdForm
    })
    toast.add({ title: 'Senha alterada', color: 'success' })
    showPasswordModal.value = false
  } catch (err: unknown) {
    toast.add({ title: 'Erro ao trocar senha', description: errorMessage(err), color: 'error' })
  } finally {
    submitting.value = false
  }
}

async function confirmDelete() {
  if (!deleting.value) return
  submitting.value = true
  try {
    await $fetch(`${apiBase}/v1/admin/admins/${deleting.value.id}`, {
      method: 'DELETE',
      headers: authHeaders(),
      credentials: 'include'
    })
    toast.add({ title: 'Admin removido', color: 'success' })
    showDeleteModal.value = false
    await fetchAdmins()
  } catch (err: unknown) {
    toast.add({ title: 'Erro ao remover', description: errorMessage(err), color: 'error' })
  } finally {
    submitting.value = false
  }
}

watch([search, roleFilter], () => {
  page.value = 1
  fetchAdmins()
})

onMounted(() => {
  fetchAdmins()
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div class="flex flex-col sm:flex-row gap-2 flex-1">
        <UInput
          v-model="search"
          placeholder="Buscar por nome ou email"
          icon="i-lucide-search"
          class="sm:max-w-xs"
        />
        <USelect
          v-model="roleFilter"
          :items="filterRoleOptions"
          class="sm:max-w-[160px]"
        />
      </div>
      <UButton
        icon="i-lucide-plus"
        color="primary"
        @click="openCreate"
      >
        Novo admin
      </UButton>
    </div>

    <div
      class="rounded-xl overflow-hidden"
      :style="{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }"
    >
      <div v-if="loading" class="p-8 text-center text-sm" style="color: var(--color-text-muted)">
        Carregando…
      </div>
      <div v-else-if="admins.length === 0" class="p-8 text-center text-sm" style="color: var(--color-text-muted)">
        Nenhum admin encontrado.
      </div>
      <table v-else class="w-full text-sm">
        <thead>
          <tr :style="{ background: 'var(--color-surface-elevated)', borderBottom: '1px solid var(--color-border)' }">
            <th class="text-left px-4 py-3 font-semibold">Nome</th>
            <th class="text-left px-4 py-3 font-semibold">Email</th>
            <th class="text-left px-4 py-3 font-semibold">Nível</th>
            <th class="text-left px-4 py-3 font-semibold">Criado</th>
            <th class="text-right px-4 py-3 font-semibold">Ações</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="a in admins"
            :key="a.id"
            :style="{ borderBottom: '1px solid var(--color-border)' }"
          >
            <td class="px-4 py-3">
              {{ a.name }}
              <span
                v-if="a.id === user?.id"
                class="ml-2 text-[11px] px-1.5 py-0.5 rounded"
                :style="{ background: 'var(--color-gold)', color: '#FFFFFF' }"
              >você</span>
            </td>
            <td class="px-4 py-3" style="color: var(--color-text-secondary)">
              {{ a.email }}
            </td>
            <td class="px-4 py-3">
              <span
                class="text-[11px] px-2 py-0.5 rounded font-semibold"
                :style="a.role === 'SUPERADMIN'
                  ? { background: 'var(--color-gold)', color: '#FFFFFF' }
                  : { background: 'var(--color-surface-elevated)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }"
              >
                {{ roleLabel(a.role) }}
              </span>
            </td>
            <td class="px-4 py-3" style="color: var(--color-text-muted)">
              {{ fmtDate(a.createdAt) }}
            </td>
            <td class="px-4 py-3">
              <div class="flex items-center justify-end gap-2">
                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-pencil"
                  title="Editar"
                  @click="openEdit(a)"
                />
                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-key"
                  title="Trocar senha"
                  @click="openPassword(a)"
                />
                <UButton
                  size="xs"
                  color="error"
                  variant="ghost"
                  icon="i-lucide-trash-2"
                  title="Remover"
                  :disabled="a.id === user?.id"
                  @click="openDelete(a)"
                />
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div
      v-if="total > limit"
      class="flex items-center justify-between text-sm"
      style="color: var(--color-text-muted)"
    >
      <span>{{ total }} resultado{{ total === 1 ? '' : 's' }}</span>
      <div class="flex items-center gap-2">
        <UButton
          size="xs"
          color="neutral"
          variant="ghost"
          icon="i-lucide-chevron-left"
          :disabled="page === 1"
          @click="page--; fetchAdmins()"
        />
        <span>{{ page }} / {{ totalPages }}</span>
        <UButton
          size="xs"
          color="neutral"
          variant="ghost"
          icon="i-lucide-chevron-right"
          :disabled="page === totalPages"
          @click="page++; fetchAdmins()"
        />
      </div>
    </div>

    <UModal v-model:open="showFormModal" :title="editing ? 'Editar admin' : 'Novo admin'">
      <template #body>
        <div class="flex flex-col gap-3">
          <UFormField label="Nome" required>
            <UInput v-model="form.name" maxlength="100" />
          </UFormField>
          <UFormField label="Email" required>
            <UInput v-model="form.email" type="email" />
          </UFormField>
          <UFormField label="Nível" required>
            <USelect v-model="form.role" :items="roleOptions" />
          </UFormField>
          <UFormField
            v-if="!editing"
            label="Senha"
            :hint="PASSWORD_HINT"
            :error="formPasswordError ?? undefined"
            required
          >
            <UInput v-model="form.password" type="password" />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton color="neutral" variant="ghost" @click="showFormModal = false">Cancelar</UButton>
          <UButton
            color="primary"
            :loading="submitting"
            :disabled="!editing && !!formPasswordError"
            @click="submitForm"
          >
            {{ editing ? 'Salvar' : 'Criar' }}
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal v-model:open="showPasswordModal" title="Alterar senha">
      <template #body>
        <div class="flex flex-col gap-3">
          <p class="text-sm" style="color: var(--color-text-muted)">
            Alterando senha de <strong>{{ targetPwd?.email }}</strong>.
          </p>
          <UFormField
            label="Nova senha"
            :hint="PASSWORD_HINT"
            :error="pwdFormError ?? undefined"
            required
          >
            <UInput v-model="pwdForm.password" type="password" />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton color="neutral" variant="ghost" @click="showPasswordModal = false">Cancelar</UButton>
          <UButton
            color="primary"
            :loading="submitting"
            :disabled="!!pwdFormError || !pwdForm.password"
            @click="submitPassword"
          >
            Alterar senha
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal v-model:open="showDeleteModal" title="Remover admin">
      <template #body>
        <p class="text-sm">
          Confirma remover <strong>{{ deleting?.email }}</strong>? Essa ação faz soft-delete.
        </p>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton color="neutral" variant="ghost" @click="showDeleteModal = false">Cancelar</UButton>
          <UButton color="error" :loading="submitting" @click="confirmDelete">Remover</UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
