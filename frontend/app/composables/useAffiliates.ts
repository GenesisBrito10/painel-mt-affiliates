/**
 * useAffiliates — Orchestrator composable for the Affiliates page.
 * Routes to either affiliate view (useAffiliateProfile + useAffiliateNetwork + useAffiliateReferrals)
 * or admin view (useAdminAffiliates) based on the current user role.
 *
 * The `panel` field is UI-only (not in backend) and kept for the admin filter UI only.
 */

export type UserRole = 'affiliate' | 'admin'
export type UserStatus = 'pending' | 'approved' | 'rejected'

/** Shape of an affiliate link for UI display (mapped from EnrichedMembership) */
export type AffiliateLink = {
  bettingHouse: string
  bettingHouseName: string
  affiliateId: string
  affiliateName: string
  cpa: number
  revshare: number
}

/** Flat network member for table display (all levels visible) */
export type NetworkFlatMember = {
  id: string
  name: string
  email: string
  status: UserStatus
  level: number
  parentName: string
  joinedAt: string
  houses: string[]
  cpa: number
  revshare: number
}

/** Rendered tree node shape (mapped from NetworkMemberView) */
export type NetworkNode = {
  id: string
  name: string
  email: string
  status: UserStatus
  active: boolean
  createdAt: string
  affiliateLinks: AffiliateLink[]
  children: NetworkNode[]
}

// Re-export panel options for admin filter UI (UI-only, not in backend)
export const panelOptions = [
  { label: 'Core Vexxa', value: 'core-vexxa' },
  { label: 'Performance Lab', value: 'performance-lab' },
  { label: 'Casino Prime', value: 'casino-prime' },
]

const PAGE_SIZE = 20

export function useAffiliates() {
  const { user, authHeaders } = useAuth()
  const toast = useToast()
  const apiBase = useApiBase()

  const isAdmin = computed(() => user.value?.role === 'admin')
  const activeTab = ref<'rede' | 'convidados'>('rede')

  // ─── Affiliate View ───────────────────────────────────────
  const profile = useAffiliateProfile()
  const houses = useBettingHouses()

  // The selected house slug drives the referrals view (per-house commissions)
  const selectedHouseSlug = computed<string | null>(
    () => profile.memberships.value[0]?.bettingHouse ?? null,
  )

  // ─── Affiliate filters state ─────────────────────────────
  const networkSearch = ref('')
  const networkStatusFilter = ref<'all' | UserStatus>('all')
  const networkHouseFilter = ref('all')
  const convidadosSearch = ref('')
  const convidadosStatusFilter = ref<'all' | UserStatus>('all')
  const convidadosHouseFilter = ref('all')
  const convidadosExternalFilter = ref<'all' | 'external' | 'internal'>('all')
  const convidadosLevelFilter = ref<'all' | number>('all')

  // Network slugs drive house filter (server-side)
  const networkHouseSlug = ref<string | null>(null)
  const referralsHouseSlug = ref<string | null>(null)

  // All filtering is server-side — search/status passed directly to useAffiliateNetwork
  const network = useAffiliateNetwork(networkHouseSlug, networkSearch, networkStatusFilter)
  const referrals = useAffiliateReferrals(referralsHouseSlug)

  // ─── Formatted data for affiliate view ───────────────────
  const houseSlugMap = computed(() =>
    houses.houses.value.reduce<Record<string, string>>(
      (acc, h) => { acc[h.id] = h.slug; return acc },
      {},
    ),
  )

  const myProfile = computed(() => ({
    name: user.value?.name ?? '',
    email: user.value?.email ?? '',
    affiliateLinks: profile.memberships.value.map((m) => ({
      bettingHouse: m.bettingHouse,
      bettingHouseName: m.bettingHouseName ?? m.bettingHouse,
      affiliateId: m.campaignId ?? '',
      affiliateName: m.campaignId ?? '',
      cpa: m.commissionCpa,
      revshare: m.commissionRevshare,
    })),
  }))

  const referralCode = computed(
    () => user.value?.referralCode ?? profile.referralCode.value ?? '',
  )
  const referralLink = computed(
    () => `https://affiliates.mtafiliates.com.br/auth/register?ref=${referralCode.value}`,
  )

  const copied = ref(false)
  async function copyReferralLink() {
    if (!import.meta.client) return
    try {
      await navigator.clipboard.writeText(referralLink.value)
      copied.value = true
      toast.add({
        title: 'Link copiado',
        description: 'O link foi copiado para a área de transferência.',
        color: 'success',
        icon: 'i-lucide-copy-check',
      })
      setTimeout(() => { copied.value = false }, 1800)
    } catch {
      toast.add({
        title: 'Não foi possível copiar',
        description: 'Copie manualmente o link exibido.',
        color: 'warning',
        icon: 'i-lucide-alert-triangle',
      })
    }
  }

  // Sync networkHouseFilter → networkHouseSlug (drives the backend request)
  watch(networkHouseFilter, (val) => {
    networkHouseSlug.value = val === 'all' ? null : val
  })
  // Sync convidadosHouseFilter → referralsHouseSlug (drives the backend request)
  watch(convidadosHouseFilter, (val) => {
    referralsHouseSlug.value = val === 'all' ? null : val
  })

  // Network flat list — backend already filtered, just map to UI shape
  const filteredNetworkTree = computed((): NetworkFlatMember[] => {
    const treeData = network.treeData.value
    if (!treeData) return []

    return treeData.network
      .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
      .map((m) => ({
        id: m.userId,
        name: m.name,
        email: m.email,
        status: (m.status?.toLowerCase() ?? 'pending') as UserStatus,
        level: m.level,
        parentName: m.parentName,
        joinedAt: m.joinedAt,
        houses: m.houses,
        cpa: m.cpa,
        revshare: m.revshare,
      }))
  })


  const networkSummary = computed(() => network.networkSummary.value)

  const agreementSummary = computed(() => profile.agreementSummary.value)

  // Referrals for invited tab
  const invitedUsers = computed(() =>
    referrals.referrals.value.map((r) => ({
      id: r.userId,
      name: r.userName,
      email: r.userEmail,
      role: 'affiliate' as UserRole,
      status: r.status,
      active: r.status === 'approved',
      panel: '',
      createdAt: r.createdAt,
      isExternal: r.isExternal ?? false,
      externalId: r.externalId ?? null,
      level: r.level ?? 1,
      affiliateLinks: (r.affiliateLinks ?? []).map((l) => ({
        bettingHouse: l.bettingHouse,
        affiliateId: '',
        affiliateName: l.bettingHouse,
        cpa: l.cpa,
        revshare: l.revshare,
      })),
    })),
  )

  // (filter refs declared above before filteredNetworkTree)

  // Níveis presentes nos convidados (para popular o select de filtro de nível).
  const convidadosLevelOptions = computed(() => {
    const levels = [...new Set(invitedUsers.value.map((u) => u.level))].sort((a, b) => a - b)
    return [
      { label: 'Todos os níveis', value: 'all' as const },
      ...levels.map((lvl) => ({ label: `Nível ${lvl}`, value: lvl })),
    ]
  })

  const filteredInvitedUsers = computed(() => {
    const q = convidadosSearch.value.trim().toLowerCase()
    return invitedUsers.value.filter((u) => {
      const matchSearch = !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
      const matchStatus = convidadosStatusFilter.value === 'all' || u.status === convidadosStatusFilter.value
      const matchExternal = convidadosExternalFilter.value === 'all'
        || (convidadosExternalFilter.value === 'external' ? u.isExternal : !u.isExternal)
      const matchLevel = convidadosLevelFilter.value === 'all' || u.level === convidadosLevelFilter.value
      // House filter is applied server-side via referralsHouseSlug — no client-side duplication
      return matchSearch && matchStatus && matchExternal && matchLevel
    })
  })

  const hasActiveNetworkFilters = computed(
    () => networkSearch.value !== '' || networkStatusFilter.value !== 'all' || networkHouseFilter.value !== 'all',
  )
  const hasActiveConvidadosFilters = computed(
    () => convidadosSearch.value !== '' || convidadosStatusFilter.value !== 'all' || convidadosHouseFilter.value !== 'all' || convidadosExternalFilter.value !== 'all' || convidadosLevelFilter.value !== 'all',
  )

  function clearNetworkFilters() {
    networkSearch.value = ''
    networkStatusFilter.value = 'all'
    networkHouseFilter.value = 'all'
  }

  function clearConvidadosFilters() {
    convidadosSearch.value = ''
    convidadosStatusFilter.value = 'all'
    convidadosHouseFilter.value = 'all'
    convidadosExternalFilter.value = 'all'
    convidadosLevelFilter.value = 'all'
  }

  // ─── Admin View (delegated) ───────────────────────────────
  const admin = useAdminAffiliates()

  // ─── House options ────────────────────────────────────────
  // Use slug as value so it matches the houses[] field in network members
  const allHouseOptions = computed(() =>
    houses.houses.value.map((h) => ({ label: h.name, value: h.slug })),
  )

  // ─── Formatters ───────────────────────────────────────────
  const houseNameMap = computed(() =>
    houses.houses.value.reduce<Record<string, string>>(
      (acc, h) => { acc[h.slug] = h.name; acc[h.id] = h.name; return acc },
      {},
    ),
  )

  /** Houses actually present in the current network tree — not the full catalog */
  const networkHouseOptions = computed(() => {
    const members = network.treeData.value?.network ?? []
    const slugSet = new Set<string>()
    for (const m of members) {
      for (const slug of m.houses) slugSet.add(slug)
    }
    return Array.from(slugSet)
      .map((slug) => ({ label: houseNameMap.value[slug] ?? slug, value: slug }))
      .sort((a, b) => a.label.localeCompare(b.label))
  })

  function statusLabel(status: UserStatus) {
    return { pending: 'Pendente', approved: 'Aprovado', rejected: 'Recusado' }[status] ?? status
  }
  function statusColor(status: UserStatus): 'warning' | 'success' | 'error' {
    return { pending: 'warning', approved: 'success', rejected: 'error' }[status] as 'warning' | 'success' | 'error'
  }
  function roleLabel(role: UserRole) {
    return role === 'admin' ? 'Admin' : 'Afiliado'
  }
  function formatDate(value: string) {
    return new Date(value).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  }
  function formatCurrency(value: number) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
  }
  function formatHouseLabel(slug: string) {
    return houseNameMap.value[slug] ?? slug
  }

  // ─── Admin compat shims ───────────────────────────────────
  // Bridge admin composable methods to the signature affiliates.vue expects
  // Supports both admin (delegates to admin composable) and affiliate referrer flow


  function openApprovalModal(id: string) {
    if (isAdmin.value) {
      const entry = admin.affiliates.value.find((u) => u.id === id)
      if (entry) admin.openApprovalModal(entry)
    } else {
      // Só convidados DIRETOS (quem veio do seu convite) — vêm da lista "Meus
      // Convidados". Quem não foi convidado por você não é aprovável aqui.
      const invited = invitedUsers.value.find((u) => u.id === id)
      if (!invited) return

      const entry = {
        id: invited.id,
        name: invited.name,
        email: invited.email,
        role: 'affiliate' as const,
        createdAt: invited.createdAt ?? new Date().toISOString(),
        memberships: [],
      }

      // Reset modal state manually (admin.openApprovalModal would use admin endpoint)
      admin.approvalTarget.value = entry
      admin.approvalForm.membershipId = entry.id
      admin.approvalForm.bettingHouse = ''
      admin.approvalForm.cpa = null
      admin.approvalForm.revshare = null
      admin.approvalForm.note = ''
      admin.approvalForm.maxCpa = 0
      admin.approvalForm.maxRevshare = 0
      admin.referrerLinks.value = []
      admin.approvalModalOpen.value = true

      // F7: use public endpoint (not admin) — referrer is not ADMIN
      fetchReferrerLinksForAffiliate(id)
    }
  }

  /**
   * F7 — Fetches referrer links using the public affiliate endpoint.
   * Called when a non-admin referrer opens the approval modal.
   */
  async function fetchReferrerLinksForAffiliate(targetUserId: string) {
    admin.loadingReferrerLinks.value = true
    try {
      const res = await $fetch<{ data: typeof admin.referrerLinks.value }>(`${apiBase}/v1/users/${targetUserId}/referrer-links`, {
        headers: authHeaders(),
      })
      admin.referrerLinks.value = res.data ?? []
      const superbetLink = admin.referrerLinks.value.find(link => link.bettingHouse === 'superbet')
      if (superbetLink) admin.selectReferrerLink(superbetLink)
    } catch {
      admin.referrerLinks.value = []
    } finally {
      admin.loadingReferrerLinks.value = false
    }
  }

  async function rejectUser(id: string) {
    if (isAdmin.value) {
      const entry = admin.affiliates.value.find((u) => u.id === id)
      if (entry) admin.rejectUser(entry)
    } else {
      // Affiliate referrer: reject via the approve endpoint with REJECTED status
      try {
        await $fetch(`${apiBase}/v1/users/${id}/approve`, {
          method: 'PATCH',
          headers: authHeaders(),
          body: { status: 'REJECTED' },
        })
        toast.add({ title: 'Convidado recusado', color: 'warning', icon: 'i-lucide-ban' })
        await Promise.all([referrals.refresh(), network.refresh()])
      } catch (err: unknown) {
        toast.add({ title: 'Erro ao recusar', description: parseApiError(err), color: 'error', icon: 'i-lucide-alert-circle' })
      }
    }
  }

  // Override submitApproval for referrer (non-admin) flow
  async function submitApprovalProxy() {
    if (isAdmin.value) {
      return admin.submitApproval()
    }
    // Affiliate referrer: use /users/:id/approve
    const target = admin.approvalTarget.value
    if (!target) return
    // Aprovação = só status. Sem acordo/comissão (definido depois, à parte).
    try {
      await $fetch(`${apiBase}/v1/users/${target.id}/approve`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: { status: 'APPROVED' },
      })
      toast.add({ title: 'Convidado aprovado', color: 'success', icon: 'i-lucide-check-circle' })
      admin.approvalModalOpen.value = false
      admin.approvalTarget.value = null
      await Promise.all([referrals.refresh(), network.refresh()])
    } catch (err: unknown) {
      toast.add({ title: 'Erro ao aprovar', description: parseApiError(err), color: 'error', icon: 'i-lucide-alert-circle' })
    }
  }

  function openEditUserModal(entry: Parameters<typeof admin.openEditUserModal>[0]) {
    admin.openEditUserModal(entry)
  }

  function confirmDeleteUser(entry: Parameters<typeof admin.confirmDeleteUser>[0]) {
    admin.confirmDeleteUser(entry)
  }

  return {
    // Auth
    isAdmin,

    // Tab
    activeTab,

    // Profile (affiliate view)
    myProfile,
    referralCode,
    referralLink,
    copied,
    copyReferralLink,
    agreementSummary,

    // Network
    filteredNetworkTree,
    networkSummary,
    networkPage: network.currentPage,
    networkTotal: network.total,
    networkTotalPages: network.totalPages,
    networkPageSize: network.pageSize,
    goToNetworkPage: network.goToPage,


    // Invited
    invitedUsers,
    filteredInvitedUsers,

    // Affiliate filters
    networkSearch,
    networkStatusFilter,
    networkHouseFilter,
    convidadosSearch,
    convidadosStatusFilter,
    convidadosHouseFilter,
    convidadosExternalFilter,
    convidadosLevelFilter,
    convidadosLevelOptions,
    hasActiveNetworkFilters,
    hasActiveConvidadosFilters,
    clearNetworkFilters,
    clearConvidadosFilters,

    // Admin View (delegated)
    adminUsers: admin.affiliates,
    filteredAdminUsers: admin.affiliates,
    paginatedAdminUsers: admin.affiliates,
    adminPage: computed({
      get: () => admin.filters.page,
      set: (v: number) => { admin.filters.page = v },
    }),
    adminPageSize: PAGE_SIZE,
    totalAdminPages: admin.totalPages,
    adminFilters: admin.filters,
    adminKpis: admin.adminKpis,
    adminLoading: admin.loading,
    adminError: admin.error,

    // Admin modals
    approvalModalOpen: admin.approvalModalOpen,
    approvalTarget: admin.approvalTarget,
    approvalForm: admin.approvalForm,
    referrerLinks: admin.referrerLinks,
    loadingReferrerLinks: admin.loadingReferrerLinks,
    selectReferrerLink: admin.selectReferrerLink,
    openApprovalModal,
    submitApproval: submitApprovalProxy,
    rejectUser,

    userModalOpen: admin.userModalOpen,
    userModalMode: admin.userModalMode,
    userForm: admin.userForm,
    userProfileLoading: admin.userProfileLoading,
    editingUserId: admin.editingUserId,
    deleteModalOpen: admin.deleteModalOpen,
    deleteTarget: admin.deleteTarget,
    openCreateUserModal: admin.openCreateUserModal,
    openEditUserModal,
    saveUserFromModal: admin.saveUser,
    confirmDeleteUser,
    deleteUser: admin.deleteUser,

    clearAdminFilters: admin.clearFilters,

    // Helpers
    getMembershipStatus: admin.getMembershipStatus,
    total: admin.total,

    // House options
    allHouseOptions,
    networkHouseOptions,

    // Formatters
    statusLabel,
    statusColor,
    roleLabel,
    formatDate,
    formatCurrency,
    formatHouseLabel,

    // Loading states
    profileLoading: profile.loading,
    networkLoading: network.loading,
  }
}
