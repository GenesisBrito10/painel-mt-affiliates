<script setup lang="ts">
definePageMeta({ layout: 'default' })

interface Affiliate {
  id: string
  name: string
  email: string
  status: string
  role: string
  withdrawalBlocked?: boolean
  createdAt: string
  referralDepth?: number | null
  referralOriginLabel?: string
  referredBy?: { id: string, name: string, email: string } | null
  memberships: Array<{ id: string, bettingHouse: string, campaignId: string, commissionCpa: number, commissionRevshare: number }>
}

const { authHeaders } = useAuth()
const apiBase = useApiBase()
const toast = useToast()
const { exportAffiliates } = useAffiliateExport()

const loading = ref(false)
const affiliates = ref<Affiliate[]>([])
const total = ref(0)
const page = ref(1)
const limit = ref(20)
const search = ref('')
const statusFilter = ref('all')
const originFilter = ref('all')
let searchTimer: ReturnType<typeof setTimeout> | null = null

const statusOptions = [
  { label: 'Todos', value: 'all' },
  { label: 'Pendentes', value: 'PENDING' },
  { label: 'Aprovados', value: 'APPROVED' },
  { label: 'Rejeitados', value: 'REJECTED' },
  { label: 'Bloqueados', value: 'BLOCKED' }
]

const originOptions = [
  { label: 'Todas origens', value: 'all' },
  { label: 'Direto ao painel', value: 'direct' },
  { label: 'Nível 1', value: '1' },
  { label: 'Nível 2', value: '2' },
  { label: 'Nível 3', value: '3' },
  { label: 'Nível 4+', value: '4plus' }
]

function originBadgeColor(label?: string) {
  if (!label || label === 'Indefinido') return 'neutral'
  if (label === 'Direto ao painel') return 'primary'
  return 'warning'
}

const fmtDate = (value: string) => new Date(value).toLocaleDateString('pt-BR')

// Approval modal
const showApprovalModal = ref(false)
const approvalTarget = ref<Affiliate | null>(null)
const approvalSaving = ref(false)

// Reject modal
const showRejectModal = ref(false)
const rejectTarget = ref<Affiliate | null>(null)
const rejectSaving = ref(false)

// Password modal
const showPasswordModal = ref(false)
const passwordTarget = ref<Affiliate | null>(null)
const passwordSaving = ref(false)
const showPassword = ref(false)
const passwordForm = reactive({
  password: '',
  confirmPassword: ''
})

const passwordError = computed(() => {
  if (!passwordForm.password) return ''
  if (passwordForm.password.length < 8) return 'A senha deve ter no mínimo 8 caracteres.'
  if (!/[A-Z]/.test(passwordForm.password)) return 'A senha precisa ter pelo menos 1 letra maiúscula.'
  if (!/\d/.test(passwordForm.password)) return 'A senha precisa ter pelo menos 1 número.'
  if (!/[@$!%*?&]/.test(passwordForm.password)) return 'A senha precisa ter pelo menos 1 caractere especial.'
  if (passwordForm.confirmPassword && passwordForm.password !== passwordForm.confirmPassword) return 'As senhas não conferem.'
  return ''
})

watch(search, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => load(1), 350)
})

watch(statusFilter, () => load(1))
watch(originFilter, () => load(1))

async function load(nextPage = page.value) {
  loading.value = true
  page.value = nextPage
  try {
    const res = await $fetch<{ data: Affiliate[], meta: { total: number } }>(`${apiBase}/v1/admin/affiliates`, {
      headers: authHeaders(),
      query: {
        page: page.value,
        limit: limit.value,
        search: search.value || undefined,
        status: statusFilter.value,
        role: 'AFFILIATE',
        referralDepth: originFilter.value !== 'all' ? originFilter.value : undefined
      }
    })
    affiliates.value = res.data
    total.value = res.meta.total
  } finally {
    loading.value = false
  }
}

const exporting = ref(false)

async function handleExport(format: 'csv' | 'pdf') {
  if (exporting.value) return
  exporting.value = true
  try {
    await exportAffiliates({
      search: search.value || undefined,
      status: statusFilter.value,
      role: 'AFFILIATE',
      referralDepth: originFilter.value !== 'all' ? originFilter.value : undefined
    }, format)
  } catch (err: unknown) {
    const e = err as { data?: { detail?: string, message?: string }, message?: string }
    toast.add({
      title: 'Erro ao exportar',
      description: e.data?.detail || e.data?.message || e.message || '',
      color: 'error'
    })
  } finally {
    exporting.value = false
  }
}

const exportItems = [
  [
    { label: 'Exportar CSV', icon: 'i-lucide-file-text', onSelect: () => handleExport('csv') },
    { label: 'Exportar PDF', icon: 'i-lucide-file-down', onSelect: () => handleExport('pdf') }
  ]
]

function openApprovalModal(affiliate: Affiliate) {
  approvalTarget.value = affiliate
  showApprovalModal.value = true
}

async function submitApproval() {
  if (!approvalTarget.value) return
  approvalSaving.value = true
  try {
    await $fetch(`${apiBase}/v1/admin/users/${approvalTarget.value.id}/status`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: { status: 'APPROVED' }
    })
    toast.add({ title: `${approvalTarget.value.name} aprovado com sucesso.`, color: 'success' })
    showApprovalModal.value = false
    approvalTarget.value = null
    await load()
  } catch (err: unknown) {
    const e = err as { data?: { detail?: string, message?: string }, message?: string }
    toast.add({
      title: 'Erro ao aprovar',
      description: e.data?.detail || e.data?.message || e.message || '',
      color: 'error'
    })
  } finally {
    approvalSaving.value = false
  }
}

function openRejectModal(affiliate: Affiliate) {
  rejectTarget.value = affiliate
  showRejectModal.value = true
}

async function submitReject() {
  if (!rejectTarget.value) return
  rejectSaving.value = true
  try {
    await $fetch(`${apiBase}/v1/admin/users/${rejectTarget.value.id}/status`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: { status: 'REJECTED' }
    })
    toast.add({ title: `${rejectTarget.value.name} rejeitado.`, color: 'error' })
    showRejectModal.value = false
    rejectTarget.value = null
    await load()
  } catch (err: unknown) {
    const e = err as { data?: { detail?: string, message?: string }, message?: string }
    toast.add({
      title: 'Erro ao rejeitar',
      description: e.data?.detail || e.data?.message || e.message || '',
      color: 'error'
    })
  } finally {
    rejectSaving.value = false
  }
}

function openPasswordModal(affiliate: Affiliate) {
  passwordTarget.value = affiliate
  passwordForm.password = ''
  passwordForm.confirmPassword = ''
  showPassword.value = false
  showPasswordModal.value = true
}

async function submitPasswordChange() {
  if (!passwordTarget.value) return
  if (!passwordForm.password || !passwordForm.confirmPassword || passwordError.value) {
    toast.add({
      title: 'Revise a nova senha',
      description: passwordError.value || 'Informe e confirme a nova senha.',
      color: 'warning'
    })
    return
  }

  passwordSaving.value = true
  try {
    await $fetch(`${apiBase}/v1/admin/users/${passwordTarget.value.id}/password`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: { password: passwordForm.password }
    })
    toast.add({ title: 'Senha alterada com sucesso.', color: 'success' })
    showPasswordModal.value = false
    passwordTarget.value = null
  } catch (err: unknown) {
    const e = err as { data?: { detail?: string, message?: string }, message?: string }
    toast.add({
      title: 'Erro ao alterar senha',
      description: e.data?.detail || e.data?.message || e.message || '',
      color: 'error'
    })
  } finally {
    passwordSaving.value = false
  }
}

async function toggleBalanceBlock(affiliate: Affiliate) {
  const profile = await $fetch<{ withdrawalBlocked: boolean }>(`${apiBase}/v1/admin/affiliates/${affiliate.id}/profile`, {
    headers: authHeaders()
  })
  const blocked = !profile.withdrawalBlocked
  await $fetch(`${apiBase}/v1/admin/affiliates/${affiliate.id}/balance-block`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: {
      blocked,
      reason: blocked ? 'Bloqueio manual pelo painel admin.' : 'Desbloqueio manual pelo painel admin.'
    }
  })
  toast.add({
    title: blocked ? 'Saldo bloqueado' : 'Saldo liberado',
    color: blocked ? 'warning' : 'success'
  })
  await load()
}

onMounted(() => load())
</script>

<template>
  <div class="page-wrap fade-up">
    <!-- Filter card -->
    <div
      class="card-vex mb-3.5 flex flex-wrap items-center gap-2.5"
      style="padding: 14px"
    >
      <div
        class="relative"
        style="flex: 1; min-width: 0"
      >
        <UIcon
          name="i-lucide-search"
          class="absolute size-3.5"
          style="left: 12px; top: 50%; transform: translateY(-50%); color: var(--color-text-muted)"
        />
        <input
          v-model="search"
          class="vex-input"
          placeholder="Buscar por nome ou e-mail..."
          style="padding-left: 36px"
        >
      </div>
      <div
        class="flex gap-1"
        style="background: var(--color-surface-2); border: 1px solid var(--color-border); padding: 3px; border-radius: 10px; overflow-x: auto; flex-shrink: 0; max-width: 100%"
      >
        <button
          v-for="opt in statusOptions"
          :key="opt.value"
          class="font-semibold transition-colors shrink-0"
          :style="{
            padding: '6px 12px',
            fontSize: '12px',
            borderRadius: '7px',
            background: statusFilter === opt.value ? 'var(--color-surface-elevated)' : 'transparent',
            color: statusFilter === opt.value ? '#fff' : 'var(--color-text-secondary)'
          }"
          @click="statusFilter = opt.value"
        >
          {{ opt.label }}
        </button>
      </div>
      <USelect
        v-model="originFilter"
        :items="originOptions"
        value-key="value"
        class="min-w-[10rem]"
        size="sm"
        icon="i-lucide-git-branch"
      />
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
      <UDropdownMenu
        :items="exportItems"
        :content="{ align: 'end' }"
      >
        <button
          class="btn btn-ghost btn-sm"
          :disabled="exporting"
        >
          <UIcon
            :name="exporting ? 'i-lucide-loader-circle' : 'i-lucide-download'"
            class="size-3.5"
            :class="{ 'animate-spin': exporting }"
          />
          Exportar
        </button>
      </UDropdownMenu>
    </div>

    <!-- Table -->
    <div
      class="card-vex"
      style="overflow: hidden"
    >
      <!-- Desktop table (md+) -->
      <div class="table-scroll desk-only">
        <table class="tbl">
        <thead>
          <tr>
            <th>Afiliado</th>
            <th>Status</th>
            <th>Origem</th>
            <th>Indicador</th>
            <th>Casas</th>
            <th>Entrada</th>
            <th style="text-align: right">
              Ações
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading && !affiliates.length">
            <td
              colspan="7"
              style="text-align: center; padding: 32px; color: var(--color-text-muted)"
            >
              Carregando afiliados...
            </td>
          </tr>
          <tr v-else-if="!affiliates.length">
            <td
              colspan="7"
              style="text-align: center; padding: 56px"
            >
              <div class="flex flex-col items-center gap-2">
                <UIcon
                  name="i-lucide-users"
                  class="size-10"
                  style="color: var(--color-text-muted); opacity: 0.4"
                />
                <p style="color: var(--color-text-secondary); font-size: 13px; font-weight: 600">
                  Nenhum afiliado encontrado
                </p>
                <p style="color: var(--color-text-muted); font-size: 12px">
                  Ajuste os filtros ou aguarde novos cadastros.
                </p>
              </div>
            </td>
          </tr>
          <tr
            v-for="affiliate in affiliates"
            v-else
            :key="affiliate.id"
          >
            <td>
              <div class="flex items-center gap-2.5">
                <Avatar
                  :name="affiliate.name"
                  :size="32"
                />
                <div>
                  <div style="font-weight: 700; font-size: 13px">
                    {{ affiliate.name }}
                  </div>
                  <div style="font-size: 11px; color: var(--color-text-muted)">
                    {{ affiliate.email }}
                  </div>
                </div>
              </div>
            </td>
            <td>
              <StatusBadge :status="affiliate.status" />
            </td>
            <td>
              <UBadge
                :color="originBadgeColor(affiliate.referralOriginLabel)"
                variant="soft"
                size="sm"
              >
                {{ affiliate.referralOriginLabel || '—' }}
              </UBadge>
            </td>
            <td style="font-size: 12px; color: var(--color-text-secondary)">
              <NuxtLink
                v-if="affiliate.referredBy"
                :to="`/affiliates/${affiliate.referredBy.id}?tab=origin`"
                class="hover:underline"
                style="color: var(--color-text-secondary)"
              >
                {{ affiliate.referredBy.name }}
              </NuxtLink>
              <span v-else>—</span>
            </td>
            <td>
              <div
                v-if="!affiliate.memberships.length"
                style="color: var(--color-text-muted); font-size: 12px"
              >
                —
              </div>
              <div
                v-else
                class="flex items-center gap-1"
              >
                <HouseBadge
                  v-for="m in affiliate.memberships.slice(0, 2)"
                  :key="m.id"
                  :slug="m.bettingHouse"
                  :show-name="false"
                />
                <span
                  v-if="affiliate.memberships.length > 2"
                  style="font-size: 11px; color: var(--color-text-muted); padding: 4px 6px; background: var(--color-surface-elevated); border-radius: 999px"
                >
                  +{{ affiliate.memberships.length - 2 }}
                </span>
              </div>
            </td>
            <td
              class="mono"
              style="color: var(--color-text-secondary); font-size: 12px"
            >
              {{ fmtDate(affiliate.createdAt) }}
            </td>
            <td style="text-align: right">
              <div
                class="inline-flex"
                style="gap: 4px"
              >
                <IconBtn
                  v-if="affiliate.status === 'PENDING'"
                  title="Aprovar"
                  color="green"
                  icon="i-lucide-check"
                  @click="openApprovalModal(affiliate)"
                />
                <IconBtn
                  v-if="affiliate.status === 'PENDING'"
                  title="Rejeitar"
                  color="red"
                  icon="i-lucide-x"
                  @click="openRejectModal(affiliate)"
                />
                <IconBtn
                  v-if="affiliate.status === 'APPROVED'"
                  title="Editar"
                  color="purple"
                  icon="i-lucide-pencil"
                  :to="`/affiliates/${affiliate.id}?tab=profile&edit=true`"
                />
                <IconBtn
                  v-if="affiliate.status === 'APPROVED'"
                  title="Ver painel"
                  color="purple"
                  icon="i-lucide-eye"
                  :to="`/affiliates/${affiliate.id}`"
                />
                <IconBtn
                  title="Alterar senha"
                  color="purple"
                  icon="i-lucide-key-round"
                  @click="openPasswordModal(affiliate)"
                />
                <IconBtn
                  title="Bloquear saldo"
                  color="amber"
                  icon="i-lucide-lock"
                  @click="toggleBalanceBlock(affiliate)"
                />
              </div>
            </td>
          </tr>
          </tbody>
        </table>
      </div>

      <!-- Mobile card list -->
      <div class="mob-only">
        <div
          v-if="loading && !affiliates.length"
          style="text-align: center; padding: 32px; color: var(--color-text-muted); font-size: 13px"
        >
          Carregando afiliados...
        </div>
        <div
          v-else-if="!affiliates.length"
          class="flex flex-col items-center gap-2"
          style="padding: 40px 16px"
        >
          <UIcon
            name="i-lucide-users"
            class="size-10"
            style="color: var(--color-text-muted); opacity: 0.4"
          />
          <p style="color: var(--color-text-secondary); font-size: 13px; font-weight: 600">
            Nenhum afiliado encontrado
          </p>
        </div>
        <div
          v-for="affiliate in affiliates"
          v-else
          :key="affiliate.id + '-mob'"
          class="mob-card"
        >
          <div class="mob-card-row mb-2">
            <div class="flex items-center gap-2.5 min-w-0">
              <Avatar
                :name="affiliate.name"
                :size="28"
              />
              <div class="min-w-0">
                <div style="font-weight: 700; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">
                  {{ affiliate.name }}
                </div>
                <div style="font-size: 11px; color: var(--color-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap">
                  {{ affiliate.email }}
                </div>
              </div>
            </div>
            <StatusBadge :status="affiliate.status" />
          </div>
          <div class="mob-card-row mb-2">
            <div>
              <div class="mob-card-label">Origem</div>
              <UBadge
                :color="originBadgeColor(affiliate.referralOriginLabel)"
                variant="soft"
                size="sm"
              >
                {{ affiliate.referralOriginLabel || '—' }}
              </UBadge>
            </div>
            <div style="text-align: right">
              <div class="mob-card-label">Indicador</div>
              <div style="font-size: 12px; color: var(--color-text-secondary)">
                {{ affiliate.referredBy?.name || '—' }}
              </div>
            </div>
          </div>
          <div
            v-if="affiliate.memberships.length"
            class="mob-card-row mb-2"
          >
            <div>
              <div class="mob-card-label">Casas</div>
              <div class="flex items-center gap-1 flex-wrap">
                <HouseBadge
                  v-for="m in affiliate.memberships.slice(0, 2)"
                  :key="m.id"
                  :slug="m.bettingHouse"
                  :show-name="false"
                />
                <span
                  v-if="affiliate.memberships.length > 2"
                  style="font-size: 11px; color: var(--color-text-muted); padding: 2px 6px; background: var(--color-surface-elevated); border-radius: 999px"
                >
                  +{{ affiliate.memberships.length - 2 }}
                </span>
              </div>
            </div>
            <div style="text-align: right; font-size: 11px; color: var(--color-text-muted)">
              {{ fmtDate(affiliate.createdAt) }}
            </div>
          </div>
          <div class="mob-card-actions">
            <IconBtn
              v-if="affiliate.status === 'PENDING'"
              title="Aprovar"
              color="green"
              icon="i-lucide-check"
              @click="openApprovalModal(affiliate)"
            />
            <IconBtn
              v-if="affiliate.status === 'PENDING'"
              title="Rejeitar"
              color="red"
              icon="i-lucide-x"
              @click="openRejectModal(affiliate)"
            />
            <IconBtn
              v-if="affiliate.status === 'APPROVED'"
              title="Editar"
              color="purple"
              icon="i-lucide-pencil"
              :to="`/affiliates/${affiliate.id}?tab=profile&edit=true`"
            />
            <IconBtn
              v-if="affiliate.status === 'APPROVED'"
              title="Ver painel"
              color="purple"
              icon="i-lucide-eye"
              :to="`/affiliates/${affiliate.id}`"
            />
            <IconBtn
              title="Alterar senha"
              color="purple"
              icon="i-lucide-key-round"
              @click="openPasswordModal(affiliate)"
            />
            <IconBtn
              title="Bloquear saldo"
              color="amber"
              icon="i-lucide-lock"
              @click="toggleBalanceBlock(affiliate)"
            />
          </div>
        </div>
      </div>

      <div
        class="flex items-center justify-between flex-wrap gap-2"
        style="padding: 14px 18px; border-top: 1px solid var(--color-border); font-size: 12px; color: var(--color-text-muted)"
      >
        <div>Mostrando {{ affiliates.length }} de {{ total }} afiliados</div>
        <UPagination
          v-model:page="page"
          :total="total"
          :items-per-page="limit"
          @update:page="load($event)"
        />
      </div>
    </div>

    <!-- Approval Modal -->
    <UModal
      v-model:open="showApprovalModal"
      title="Aprovar Afiliado"
    >
      <template #body>
        <div class="space-y-4">
          <div class="rounded-lg border border-muted p-3">
            <p class="font-bold text-highlighted">
              {{ approvalTarget?.name }}
            </p>
            <p class="text-sm text-muted">
              {{ approvalTarget?.email }}
            </p>
            <p
              v-if="approvalTarget?.referredBy"
              class="mt-1 text-xs text-muted"
            >
              Indicado por: <strong>{{ approvalTarget.referredBy.name }}</strong>
            </p>
          </div>

          <div
            class="rounded-lg p-3"
            style="background: var(--color-surface-2); border: 1px solid var(--color-border)"
          >
            <div class="flex items-center gap-2 mb-1">
              <UIcon
                name="i-lucide-info"
                class="size-3.5"
                style="color: var(--color-text-muted)"
              />
              <span
                class="text-xs font-semibold"
                style="color: var(--color-text-secondary)"
              >Como funciona</span>
            </div>
            <p class="text-xs" style="color: var(--color-text-muted)">
              O afiliado será aprovado e poderá solicitar deals no Marketplace. A definição de CPA, RevShare e link será feita na aprovação do deal (página Links).
            </p>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            @click="showApprovalModal = false"
          >
            Cancelar
          </UButton>
          <UButton
            color="success"
            :loading="approvalSaving"
            @click="submitApproval"
          >
            Aprovar
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- Password Change -->
    <UModal
      v-model:open="showPasswordModal"
      title="Alterar senha"
    >
      <template #body>
        <div class="space-y-4">
          <div class="rounded-lg border border-muted p-3">
            <p class="font-bold text-highlighted">
              {{ passwordTarget?.name }}
            </p>
            <p class="text-sm text-muted">
              {{ passwordTarget?.email }}
            </p>
          </div>

          <UFormField
            label="Nova senha"
            :error="passwordError || undefined"
          >
            <UInput
              v-model="passwordForm.password"
              :type="showPassword ? 'text' : 'password'"
              autocomplete="new-password"
              placeholder="Nova senha"
            >
              <template #trailing>
                <UButton
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  :icon="showPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                  @click="showPassword = !showPassword"
                />
              </template>
            </UInput>
          </UFormField>

          <UFormField label="Confirmar senha">
            <UInput
              v-model="passwordForm.confirmPassword"
              :type="showPassword ? 'text' : 'password'"
              autocomplete="new-password"
              placeholder="Repita a nova senha"
            />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            @click="showPasswordModal = false"
          >
            Cancelar
          </UButton>
          <UButton
            color="primary"
            :loading="passwordSaving"
            :disabled="!passwordForm.password || !passwordForm.confirmPassword || !!passwordError"
            icon="i-lucide-key-round"
            @click="submitPasswordChange"
          >
            Alterar senha
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- Reject Confirmation -->
    <UModal
      v-model:open="showRejectModal"
      title="Rejeitar Afiliado"
    >
      <template #body>
        <p class="text-sm">
          Tem certeza que deseja rejeitar
          <strong class="text-highlighted">{{ rejectTarget?.name }}</strong>
          ({{ rejectTarget?.email }})?
        </p>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            @click="showRejectModal = false"
          >
            Cancelar
          </UButton>
          <UButton
            color="error"
            :loading="rejectSaving"
            @click="submitReject"
          >
            Rejeitar
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
