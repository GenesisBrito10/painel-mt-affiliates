<script setup lang="ts">
definePageMeta({ layout: 'default' })

interface SettingItem {
  id: string
  key: string
  value: string
  label: string
  updatedAt: string
}

const { authHeaders } = useAuth()
const apiBase = useApiBase()
const toast = useToast()

const loading = ref(false)
const settings = ref<SettingItem[]>([])

// Modal state
const showModal = ref(false)
const modalMode = ref<'create' | 'edit'>('create')
const formKey = ref('')
const formValue = ref('')
const formLabel = ref('')
const saving = ref(false)

// Delete confirm
const showDeleteConfirm = ref(false)
const deleteTarget = ref<SettingItem | null>(null)
const deleting = ref(false)

// Sync pause toggle (global kill-switch — setting key `sync_paused`)
const syncTogglePending = ref(false)
const syncPaused = computed(
  () => settings.value.find((s) => s.key === 'sync_paused')?.value === 'true'
)

async function toggleSync() {
  const pausing = !syncPaused.value
  syncTogglePending.value = true
  try {
    await $fetch(`${apiBase}/admin/settings/sync_paused`, {
      method: 'PUT',
      headers: authHeaders(),
      body: {
        value: pausing ? 'true' : 'false',
        label: 'Pausa global da sincronização de dados (CPA/casas)'
      }
    })
    toast.add({
      title: pausing ? 'Sincronização pausada' : 'Sincronização reativada',
      color: 'success',
      icon: 'i-lucide-check'
    })
    await load()
  } catch {
    toast.add({ title: 'Erro ao alterar sincronização', color: 'error' })
  } finally {
    syncTogglePending.value = false
  }
}

const fmtDate = (value: string) =>
  new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

async function load() {
  loading.value = true
  try {
    settings.value = await $fetch<SettingItem[]>(`${apiBase}/admin/settings`, {
      headers: authHeaders()
    })
  } finally {
    loading.value = false
  }
}

function openCreate() {
  modalMode.value = 'create'
  formKey.value = ''
  formValue.value = ''
  formLabel.value = ''
  showModal.value = true
}

function openEdit(item: SettingItem) {
  modalMode.value = 'edit'
  formKey.value = item.key
  formValue.value = item.value
  formLabel.value = item.label
  showModal.value = true
}

async function saveSetting() {
  if (!formKey.value.trim() || !formValue.value.trim()) {
    toast.add({ title: 'Preencha a chave e o valor', color: 'warning' })
    return
  }
  saving.value = true
  try {
    await $fetch(`${apiBase}/admin/settings/${formKey.value.trim()}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: {
        value: formValue.value.trim(),
        label: formLabel.value.trim() || undefined
      }
    })
    toast.add({
      title: modalMode.value === 'create' ? 'Configuração criada' : 'Configuração atualizada',
      color: 'success',
      icon: 'i-lucide-check'
    })
    showModal.value = false
    await load()
  } catch {
    toast.add({ title: 'Erro ao salvar configuração', color: 'error' })
  } finally {
    saving.value = false
  }
}

function confirmDelete(item: SettingItem) {
  deleteTarget.value = item
  showDeleteConfirm.value = true
}

async function deleteSetting() {
  if (!deleteTarget.value) return
  deleting.value = true
  try {
    await $fetch(`${apiBase}/admin/settings/${deleteTarget.value.key}`, {
      method: 'DELETE',
      headers: authHeaders()
    })
    toast.add({ title: 'Configuração removida', color: 'success', icon: 'i-lucide-trash-2' })
    showDeleteConfirm.value = false
    deleteTarget.value = null
    await load()
  } catch {
    toast.add({ title: 'Erro ao remover configuração', color: 'error' })
  } finally {
    deleting.value = false
  }
}

onMounted(() => load())
</script>

<template>
  <div class="page-wrap fade-up">
    <!-- Sync pause toggle -->
    <div
      class="card-vex mb-4 flex items-center justify-between gap-4"
      style="padding: 18px 20px"
    >
      <div class="flex items-center gap-3">
        <span
          class="inline-block rounded-full"
          :style="{
            width: '10px',
            height: '10px',
            background: syncPaused ? 'var(--color-danger, #ef4444)' : 'var(--color-success, #22c55e)'
          }"
        />
        <div>
          <div style="font-size: 14px; font-weight: 700; letter-spacing: -0.01em">
            Sincronização de dados
          </div>
          <div style="font-size: 12px; margin-top: 2px; color: var(--color-text-muted)">
            {{ syncPaused
              ? 'PAUSADA — nenhuma casa está sincronizando CPA/métricas.'
              : 'ATIVA — todas as casas sincronizando normalmente.' }}
          </div>
        </div>
      </div>
      <button
        class="btn btn-sm"
        :class="syncPaused ? 'btn-gold' : 'btn-ghost'"
        :disabled="syncTogglePending || loading"
        @click="toggleSync"
      >
        <UIcon
          :name="syncPaused ? 'i-lucide-play' : 'i-lucide-pause'"
          class="size-3.5"
        />
        {{ syncPaused ? 'Ativar sincronização' : 'Pausar sincronização' }}
      </button>
    </div>

    <div class="grid gap-4 settings-grid">
      <!-- Sidebar sections -->
      <div>
        <div
          class="label-kicker"
          style="margin-bottom: 10px"
        >
          Configurações do sistema
        </div>
        <button
          class="w-full text-left transition-colors"
          :style="{
            padding: '11px 14px',
            borderRadius: '8px',
            marginBottom: '4px',
            background: 'var(--color-surface-elevated)',
            borderLeft: '2px solid var(--color-gold)',
            color: 'var(--color-gold)'
          }"
        >
          <div style="font-size: 13px; font-weight: 600">
            Operacionais
          </div>
          <div
            style="font-size: 11px; margin-top: 2px; color: var(--color-text-muted)"
          >
            Chave/valor · saque, compliance, bloqueios
          </div>
        </button>
        <div
          class="px-3.5 py-3 mt-2"
          style="font-size: 11px; color: var(--color-text-muted); line-height: 1.55"
        >
          <p>
            Outras categorias (comissões, integrações, notificações) chegam em próximas versões.
          </p>
        </div>
      </div>

      <!-- Content card -->
      <div
        class="card-vex"
        style="padding: 24px"
      >
        <div class="flex items-start justify-between gap-3 mb-5">
          <div>
            <div style="font-size: 17px; font-weight: 800; letter-spacing: -0.01em">
              Operacionais
            </div>
            <div
              style="font-size: 12px; margin-top: 2px; color: var(--color-text-muted)"
            >
              Parâmetros globais de saque, compliance e bloqueios operacionais.
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
              Atualizar
            </button>
            <button
              class="btn btn-gold btn-sm"
              @click="openCreate"
            >
              <UIcon
                name="i-lucide-plus"
                class="size-3.5"
              />
              Nova
            </button>
          </div>
        </div>

        <div
          class="card-vex"
          style="overflow: hidden; background: var(--color-surface-2)"
        >
          <div class="table-scroll">
            <table class="tbl">
            <thead>
              <tr>
                <th>Chave</th>
                <th>Valor</th>
                <th>Descrição</th>
                <th>Atualizado</th>
                <th style="text-align: right">
                  Ações
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="loading && !settings.length">
                <td
                  colspan="5"
                  style="text-align: center; padding: 32px; color: var(--color-text-muted)"
                >
                  Carregando configurações...
                </td>
              </tr>
              <tr v-else-if="!settings.length">
                <td
                  colspan="5"
                  style="text-align: center; padding: 56px"
                >
                  <div class="flex flex-col items-center gap-2">
                    <UIcon
                      name="i-lucide-settings"
                      class="size-10"
                      style="color: var(--color-text-muted); opacity: 0.4"
                    />
                    <p style="color: var(--color-text-secondary); font-size: 13px; font-weight: 600">
                      Nenhuma configuração cadastrada
                    </p>
                    <p style="color: var(--color-text-muted); font-size: 12px">
                      Crie um item operacional para começar.
                    </p>
                  </div>
                </td>
              </tr>
              <tr
                v-for="item in settings"
                v-else
                :key="item.id"
              >
                <td>
                  <code
                    class="mono"
                    style="font-size: 11.5px; padding: 2px 8px; background: var(--color-surface-elevated); border-radius: 6px; color: var(--color-gold); font-weight: 700"
                  >{{ item.key }}</code>
                </td>
                <td
                  class="mono"
                  style="font-size: 12.5px"
                >
                  {{ item.value }}
                </td>
                <td style="font-size: 12px; color: var(--color-text-secondary)">
                  {{ item.label || '—' }}
                </td>
                <td
                  class="mono"
                  style="font-size: 11.5px; color: var(--color-text-muted); white-space: nowrap"
                >
                  {{ fmtDate(item.updatedAt) }}
                </td>
                <td style="text-align: right">
                  <div
                    class="inline-flex"
                    style="gap: 4px"
                  >
                    <IconBtn
                      title="Editar"
                      color="purple"
                      icon="i-lucide-pencil"
                      @click="openEdit(item)"
                    />
                    <IconBtn
                      title="Excluir"
                      color="red"
                      icon="i-lucide-trash-2"
                      @click="confirmDelete(item)"
                    />
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
          </div><!-- /.table-scroll -->
        </div>
      </div>
    </div>

    <!-- Create / Edit Modal -->
    <UModal
      v-model:open="showModal"
      :title="modalMode === 'create' ? 'Nova Configuração' : 'Editar Configuração'"
    >
      <template #body>
        <div class="space-y-4">
          <UFormField label="Chave">
            <UInput
              v-model="formKey"
              placeholder="ex: min_withdrawal"
              :disabled="modalMode === 'edit'"
              :maxlength="100"
              class="font-mono"
            />
          </UFormField>
          <UFormField label="Valor">
            <UInput
              v-model="formValue"
              placeholder="Valor da configuração"
              :maxlength="1000"
            />
          </UFormField>
          <UFormField label="Descrição">
            <UInput
              v-model="formLabel"
              placeholder="Descrição opcional"
              :maxlength="500"
            />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            @click="showModal = false"
          >
            Cancelar
          </UButton>
          <UButton
            :loading="saving"
            :disabled="!formKey.trim() || !formValue.trim()"
            @click="saveSetting"
          >
            {{ modalMode === 'create' ? 'Criar' : 'Salvar' }}
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- Delete Confirmation Modal -->
    <UModal
      v-model:open="showDeleteConfirm"
      title="Confirmar Exclusão"
    >
      <template #body>
        <div class="space-y-3">
          <p class="text-sm text-muted">
            Tem certeza que deseja excluir esta configuração?
          </p>
          <div class="rounded-lg border border-muted p-3">
            <p class="font-mono font-bold text-highlighted">
              {{ deleteTarget?.key }}
            </p>
            <p class="text-sm text-muted">
              {{ deleteTarget?.label || 'Sem descrição' }}
            </p>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            @click="showDeleteConfirm = false"
          >
            Cancelar
          </UButton>
          <UButton
            color="error"
            :loading="deleting"
            @click="deleteSetting"
          >
            Excluir
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
