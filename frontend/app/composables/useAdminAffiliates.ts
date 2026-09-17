import type {
  AdminAffiliateEntry,
  AdminAffiliateMembership,
  AdminAffiliateFilters,
  AdminAffiliateProfile,
  ApprovalFormState,
  ReferrerLink,
} from '~/types/affiliates'

import { watchDebounced } from '@vueuse/core'

const PAGE_SIZE = 20


export function useAdminAffiliates() {
  const { authHeaders, user } = useAuth()
  const apiBase = useApiBase()
  const toast = useToast()

  // ─── State ───────────────────────────────────────────────
  const affiliates = ref<AdminAffiliateEntry[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const totalPages = ref(1)
  const total = ref(0)

  const filters = reactive<AdminAffiliateFilters>({
    search: '',
    role: 'all',
    status: 'all',
    bettingHouseId: 'all',
    noLink: false,
    panel: 'all',
    page: 1,
    limit: PAGE_SIZE,
  })

  // ─── Modal state ─────────────────────────────────────────
  const approvalModalOpen = ref(false)
  const approvalTarget = ref<AdminAffiliateEntry | null>(null)
  const approvalForm = reactive<ApprovalFormState>({
    membershipId: '',
    bettingHouse: '',
    cpa: null,
    revshare: null,
    note: '',
    maxCpa: 0,
    maxRevshare: 0,
  })

  // Referrer links fetched for the approval dropdown
  const referrerLinks = ref<ReferrerLink[]>([])
  const loadingReferrerLinks = ref(false)

  const deleteModalOpen = ref(false)
  const deleteTarget = ref<AdminAffiliateEntry | null>(null)

  const userModalOpen = ref(false)
  const userModalMode = ref<'create' | 'edit'>('create')
  const userForm = reactive({
    name: '',
    email: '',
    password: '',
    role: 'affiliate' as 'affiliate' | 'admin',
    withdrawalBlocked: false,
    originalWithdrawalBlocked: false,
    balanceBlockReason: '',
    memberships: [] as AdminAffiliateMembership[],
  })
  const userProfileLoading = ref(false)
  const editingUserId = ref<string | null>(null)

  // ─── Computed: admin KPIs ─────────────────────────────────
  const adminKpis = ref({
    total: 0,
    approved: 0,
    pending: 0,
    noLink: 0,
  })

  async function fetchKpis() {
    if (user.value?.role !== 'admin') return
    try {
      const res = await $fetch<{ data: typeof adminKpis.value }>(
        `${apiBase}/v1/admin/affiliates/kpis`,
        { headers: authHeaders() },
      )
      adminKpis.value = { ...adminKpis.value, ...(res.data ?? res) }
    } catch {
      // silent
    }
  }

  // ─── Data fetching ────────────────────────────────────────
  async function fetchAffiliates() {
    if (user.value?.role !== 'admin') return
    loading.value = true
    error.value = null
    try {
      const query: Record<string, unknown> = {
        page: filters.page,
        limit: filters.limit,
      }
      if (filters.search) query.search = filters.search
      if (filters.role !== 'all') query.role = filters.role
      if (filters.status !== 'all') query.status = filters.status
      if (filters.bettingHouseId !== 'all') query.bettingHouseId = filters.bettingHouseId
      if (filters.noLink) query.noLink = true

      const res = await $fetch<ApiWrapper<AdminAffiliateEntry[]>>(
        `${apiBase}/v1/admin/affiliates`,
        { headers: authHeaders(), query },
      )

      affiliates.value = res.data
      if (res.meta) {
        totalPages.value = res.meta.totalPages
        total.value = res.meta.total
      }
    } catch (err: unknown) {
      error.value = parseApiError(err)
    } finally {
      loading.value = false
    }
  }

  watchDebounced(
    () => filters.search,
    () => {
      if (user.value?.role !== 'admin') return
      filters.page = 1
      fetchAffiliates()
    },
    { debounce: 300 },
  )

  watch(
    [
      () => filters.role,
      () => filters.status,
      () => filters.bettingHouseId,
      () => filters.noLink,
      () => filters.page,
    ],
    () => {
      if (user.value?.role !== 'admin') return
      fetchAffiliates()
    },
  )

  onMounted(() => {
    if (user.value?.role !== 'admin') return
    fetchAffiliates()
    fetchKpis()
  })

  // ─── Fetch referrer links for approval dropdown ───────────
  async function fetchReferrerLinks(userId: string) {
    loadingReferrerLinks.value = true
    try {
      const res = await $fetch<{ data: ReferrerLink[] }>(
        `${apiBase}/v1/admin/users/${userId}/referrer-links`,
        { headers: authHeaders() },
      )
      referrerLinks.value = res.data ?? []
      const superbetLink = referrerLinks.value.find(link => link.bettingHouse === 'superbet')
      if (superbetLink) selectReferrerLink(superbetLink)
    } catch {
      referrerLinks.value = []
    } finally {
      loadingReferrerLinks.value = false
    }
  }

  // ─── Approval flow ────────────────────────────────────────
  function openApprovalModal(entry: AdminAffiliateEntry) {
    approvalTarget.value = entry
    approvalForm.membershipId = entry.id
    approvalForm.bettingHouse = ''
    approvalForm.cpa = null
    approvalForm.revshare = null
    approvalForm.note = ''
    approvalForm.maxCpa = 0
    approvalForm.maxRevshare = 0
    referrerLinks.value = []
    approvalModalOpen.value = true

    // Fetch referrer links for the dropdown
    fetchReferrerLinks(entry.id)
  }

  function selectReferrerLink(link: ReferrerLink) {
    approvalForm.bettingHouse = link.bettingHouse
    approvalForm.cpa = link.cpa
    approvalForm.revshare = link.revshare
    approvalForm.maxCpa = link.cpa
    approvalForm.maxRevshare = link.revshare
  }

  async function submitApproval() {
    if (!approvalTarget.value) return
    // Aprovação = só status. Sem acordo/comissão (definido depois, à parte).
    try {
      await $fetch(`${apiBase}/v1/admin/users/${approvalTarget.value.id}/status`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: { status: 'APPROVED' },
      })
      toast.add({ title: 'Afiliado aprovado', color: 'success', icon: 'i-lucide-check-circle' })
      approvalModalOpen.value = false
      approvalTarget.value = null
      await Promise.all([fetchAffiliates(), fetchKpis()])
    } catch (err: unknown) {
      toast.add({ title: 'Erro ao aprovar', description: parseApiError(err), color: 'error', icon: 'i-lucide-alert-circle' })
    }
  }

  async function rejectUser(entry: AdminAffiliateEntry) {
    try {
      await $fetch(`${apiBase}/v1/admin/users/${entry.id}/status`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: { status: 'REJECTED' },
      })
      toast.add({ title: 'Afiliado recusado', color: 'warning', icon: 'i-lucide-ban' })
      await Promise.all([fetchAffiliates(), fetchKpis()])
    } catch (err: unknown) {
      toast.add({ title: 'Erro ao rejeitar', description: parseApiError(err), color: 'error', icon: 'i-lucide-alert-circle' })
    }
  }

  // ─── User CRUD ────────────────────────────────────────────
  function openCreateUserModal() {
    userModalMode.value = 'create'
    editingUserId.value = null
    Object.assign(userForm, {
      name: '',
      email: '',
      password: '',
      role: 'affiliate',
      withdrawalBlocked: false,
      originalWithdrawalBlocked: false,
      balanceBlockReason: '',
      memberships: [],
    })
    userModalOpen.value = true
  }

  function openEditUserModal(entry: AdminAffiliateEntry) {
    userModalMode.value = 'edit'
    editingUserId.value = entry.id
    Object.assign(userForm, {
      name: entry.name,
      email: entry.email,
      password: '',
      role: entry.role,
      withdrawalBlocked: Boolean(entry.withdrawalBlocked),
      originalWithdrawalBlocked: Boolean(entry.withdrawalBlocked),
      balanceBlockReason: '',
      memberships: [...entry.memberships],
    })
    userModalOpen.value = true
    fetchUserProfile(entry.id)
  }

  async function fetchUserProfile(id: string) {
    userProfileLoading.value = true
    try {
      const profile = await $fetch<AdminAffiliateProfile>(`${apiBase}/v1/admin/affiliates/${id}/profile`, {
        headers: authHeaders(),
      })
      if (editingUserId.value !== id) return

      const memberships = (profile.affiliateLinks ?? []).map((link) => ({
        id: link.id,
        bettingHouse: link.bettingHouse,
        campaignId: link.campaignId,
        commissionCpa: Number(link.cpa ?? 0),
        commissionRevshare: Number(link.revshare ?? 0),
        status: 'approved' as const,
      }))

      userForm.withdrawalBlocked = Boolean(profile.withdrawalBlocked)
      userForm.originalWithdrawalBlocked = Boolean(profile.withdrawalBlocked)
      userForm.memberships = memberships.length ? memberships : userForm.memberships
    } catch (err: unknown) {
      toast.add({
        title: 'Perfil parcial',
        description: parseApiError(err),
        color: 'warning',
        icon: 'i-lucide-alert-triangle',
      })
    } finally {
      userProfileLoading.value = false
    }
  }

  async function saveUser() {
    if (!userForm.name.trim() || !userForm.email.trim()) {
      toast.add({ title: 'Dados incompletos', description: 'Preencha nome e e-mail.', color: 'warning' })
      return
    }
    try {
      if (userModalMode.value === 'create') {
        if (!userForm.password) {
          toast.add({ title: 'Senha obrigatória', description: 'Informe uma senha para o novo usuário.', color: 'warning' })
          return
        }
        await $fetch(`${apiBase}/v1/auth/register`, {
          method: 'POST',
          body: { name: userForm.name, email: userForm.email, password: userForm.password },
        })
        toast.add({ title: 'Usuário criado', color: 'success', icon: 'i-lucide-user-plus' })
      } else if (editingUserId.value) {
        await $fetch(`${apiBase}/v1/admin/users/${editingUserId.value}`, {
          method: 'PATCH',
          headers: authHeaders(),
          body: { name: userForm.name, active: true },
        })

        if (userForm.withdrawalBlocked !== userForm.originalWithdrawalBlocked) {
          await $fetch(`${apiBase}/v1/admin/affiliates/${editingUserId.value}/balance-block`, {
            method: 'PATCH',
            headers: authHeaders(),
            body: {
              blocked: userForm.withdrawalBlocked,
              reason: userForm.balanceBlockReason.trim() || undefined,
            },
          })
        }
        toast.add({ title: 'Usuário atualizado', color: 'success', icon: 'i-lucide-check' })
      }
      userModalOpen.value = false
      await Promise.all([fetchAffiliates(), fetchKpis()])
    } catch (err: unknown) {
      toast.add({ title: 'Erro ao salvar', description: parseApiError(err), color: 'error', icon: 'i-lucide-alert-circle' })
    }
  }

  function confirmDeleteUser(entry: AdminAffiliateEntry) {
    deleteTarget.value = entry
    deleteModalOpen.value = true
  }

  async function deleteUser() {
    if (!deleteTarget.value) return
    try {
      await $fetch(`${apiBase}/v1/users/${deleteTarget.value.id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      })
      toast.add({ title: 'Usuário removido', color: 'warning', icon: 'i-lucide-trash-2' })
      deleteModalOpen.value = false
      deleteTarget.value = null
      await Promise.all([fetchAffiliates(), fetchKpis()])
    } catch (err: unknown) {
      toast.add({ title: 'Erro ao remover', description: parseApiError(err), color: 'error', icon: 'i-lucide-alert-circle' })
    }
  }

  // ─── Filters ─────────────────────────────────────────────
  function clearFilters() {
    filters.search = ''
    filters.role = 'all'
    filters.status = 'all'
    filters.bettingHouseId = 'all'
    filters.noLink = false
    filters.panel = 'all'
    filters.page = 1
  }

  // ─── Helpers ─────────────────────────────────────────────
  function getMembershipStatus(entry: AdminAffiliateEntry): 'pending' | 'approved' | 'rejected' {
    if (entry.status) {
      return entry.status.toLowerCase() as 'pending' | 'approved' | 'rejected'
    }

    if (entry.memberships.some((m: AdminAffiliateMembership) => m.status === 'approved')) return 'approved'
    if (entry.memberships.some((m: AdminAffiliateMembership) => m.status === 'pending')) return 'pending'
    return 'rejected'
  }

  return {
    // State
    affiliates,
    loading,
    error,
    filters,
    totalPages,
    total,
    adminKpis,

    // Approval
    approvalModalOpen,
    approvalTarget,
    approvalForm,
    referrerLinks,
    loadingReferrerLinks,
    openApprovalModal,
    selectReferrerLink,
    submitApproval,
    rejectUser,

    // User CRUD
    userModalOpen,
    userModalMode,
    userForm,
    userProfileLoading,
    editingUserId,
    deleteModalOpen,
    deleteTarget,
    openCreateUserModal,
    openEditUserModal,
    saveUser,
    confirmDeleteUser,
    deleteUser,

    // Filters
    clearFilters,

    // Helpers
    getMembershipStatus,
    refresh: fetchAffiliates,
  }
}
