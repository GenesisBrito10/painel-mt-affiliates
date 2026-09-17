<script setup lang="ts">
import type { LoginModalConfig } from '~/composables/useLoginModals'

const colorMode = useColorMode()
const { logout, user, token } = useAuth()
const { state: maintenance } = useMaintenance()
const route = useRoute()
const mobileMoreOpen = ref(false)
const openNavGroups = ref<Record<string, boolean>>({
  general: true,
  growth: true,
})

const { unreadCount, startPolling, stopPolling } = useNotifications()
const { houses: filterHouses, selectedSlug: filterSlug, fetchHouses: fetchFilterHouses, reset: resetHouseFilter, select: selectHouse } = useHouseFilter()
const { modals: loginModals, fetchLoginModals, resetLoginModals } = useLoginModals()
const {
  showModal: showPrizeModal,
  current: prizeCurrent,
  total: prizeTotal,
  redeeming: prizeRedeeming,
  check: checkPrizes,
  redeemCurrent: redeemPrizeCurrent,
  skipCurrent: skipPrizeCurrent,
  dismiss: dismissPrizeModal,
} = usePrizeNotification()

// Modal de engajamento (premiação ativa ou Classificação Geral) no login.
const {
  showModal: showRankingPromo,
  mode: rankingPromoMode,
  activePrize: rankingPromoPrize,
  topEntries: rankingPromoTop,
  myEntry: rankingPromoMe,
  check: checkRankingPromo,
  dismiss: dismissRankingPromo,
} = useRankingPromo()
// Só libera os modais seguintes (social/superbet/banner) depois que o promo
// de ranking foi resolvido (exibido ou descartado), evitando sobreposição.
const rankingPromoResolved = ref(false)

// Track which user's houses are currently loaded to detect user switches
const loadedForUser = ref<string | null>(null)
const prizeCheckFinished = ref(false)
const genericLoginModalOpen = ref(false)
const activeLoginModal = ref<LoginModalConfig | null>(null)
const loginModalFlowRunning = ref(false)

const BANNER_SESSION_PREFIX = 'vex_banner_seen'
const HOUSE_FILTER_COLLAPSE_PREFIX = 'vex_house_filter_collapsed'

const bannerModalOpen = ref(false)
const bannerProgress = ref(100)
const houseFilterCollapsed = ref(false)
let bannerInterval: ReturnType<typeof setInterval> | null = null

function getStorageItem(storage: Storage, key: string) {
  try {
    return storage.getItem(key)
  } catch {
    return null
  }
}

function setStorageItem(storage: Storage, key: string, value: string) {
  try {
    storage.setItem(key, value)
  } catch {
    // Storage can be unavailable on restricted Safari sessions.
  }
}

function dismissBanner() {
  bannerModalOpen.value = false
  if (bannerInterval) {
    clearInterval(bannerInterval)
    bannerInterval = null
  }
}

function maybeShowBanner() {
  if (!import.meta.client || !prizeCheckFinished.value || !rankingPromoResolved.value || showRankingPromo.value || showPrizeModal.value || genericLoginModalOpen.value) return
  const currentUser = user.value
  if (!currentUser || currentUser.role !== 'affiliate') return
  if (!maintenance.value.bannerEnabled || maintenance.value.enabled) return

  const key = `${BANNER_SESSION_PREFIX}:${currentUser.id}:${maintenance.value.bannerTitle}`
  if (getStorageItem(sessionStorage, key)) return
  setStorageItem(sessionStorage, key, '1')

  bannerProgress.value = 100
  bannerModalOpen.value = true

  const DURATION = 5000
  const TICK = 50
  const step = (TICK / DURATION) * 100
  bannerInterval = setInterval(() => {
    bannerProgress.value = Math.max(0, bannerProgress.value - step)
    if (bannerProgress.value <= 0) dismissBanner()
  }, TICK)
}

function hasOpenLoginModal() {
  return showPrizeModal.value
    || showRankingPromo.value
    || genericLoginModalOpen.value
    || bannerModalOpen.value
}

function loginModalDismissStorage(modal: LoginModalConfig) {
  if (modal.dismissScope === 'local') return localStorage
  return sessionStorage
}

function loginModalDismissKey(modal: LoginModalConfig) {
  const currentUser = user.value
  const storageKey = modal.storageKey || modal.key
  return `vex_login_modal_seen:${currentUser?.id ?? 'anon'}:${storageKey}`
}

function wasLoginModalDismissed(modal: LoginModalConfig) {
  if (!import.meta.client) return true
  try {
    return loginModalDismissStorage(modal).getItem(loginModalDismissKey(modal)) === '1'
  } catch {
    return false
  }
}

function markLoginModalDismissed(modal: LoginModalConfig) {
  if (!import.meta.client) return
  try {
    loginModalDismissStorage(modal).setItem(loginModalDismissKey(modal), '1')
  } catch {
    // ignore storage failures
  }
}

function maybeShowNextGenericLoginModal() {
  if (!import.meta.client || hasOpenLoginModal()) return false
  const currentUser = user.value
  if (!currentUser || currentUser.role !== 'affiliate') return false

  const nextModal = loginModals.value
    .slice()
    .sort((a, b) => a.priority - b.priority)
    .find(modal => modal.enabled && !wasLoginModalDismissed(modal))

  if (!nextModal) return false
  activeLoginModal.value = nextModal
  genericLoginModalOpen.value = true
  return true
}

function closeGenericLoginModal() {
  if (activeLoginModal.value) markLoginModalDismissed(activeLoginModal.value)
  genericLoginModalOpen.value = false
  activeLoginModal.value = null
  nextTick(() => continueLoginModalFlow())
}

function actionGenericLoginModal() {
  const modal = activeLoginModal.value
  if (modal?.actionUrl && import.meta.client) {
    window.open(modal.actionUrl, '_blank', 'noopener,noreferrer')
  }
  closeGenericLoginModal()
}

async function continueLoginModalFlow() {
  if (!import.meta.client || loginModalFlowRunning.value || !prizeCheckFinished.value) return
  if (hasOpenLoginModal()) return

  loginModalFlowRunning.value = true
  try {
    if (!rankingPromoResolved.value) {
      await checkRankingPromo()
      rankingPromoResolved.value = true
      if (showRankingPromo.value) return
    }

    await nextTick()
    if (hasOpenLoginModal()) return

    await fetchLoginModals(true)
    if (maybeShowNextGenericLoginModal()) return

    maybeShowBanner()
  } finally {
    loginModalFlowRunning.value = false
  }
}

function closeRankingPromo() {
  dismissRankingPromo()
  nextTick(() => continueLoginModalFlow())
}

function goToRankingFromPromo() {
  dismissRankingPromo()
  navigateTo('/ranking')
}

function formatPromoDate(iso?: string | null) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}
const rankingPromoMedal = (rank: number) => (rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}º`)

onMounted(async () => {
  startPolling()
  await checkPrizes()
  prizeCheckFinished.value = true
  await continueLoginModalFlow()
})
onUnmounted(() => {
  stopPolling()
  if (bannerInterval) clearInterval(bannerInterval)
})

watch(
  [showPrizeModal, genericLoginModalOpen, () => user.value?.id],
  () => {
    if (!showPrizeModal.value && !genericLoginModalOpen.value) nextTick(() => continueLoginModalFlow())
  },
)

// Fetch approved houses as soon as the auth token is available (or when user changes)
watch(
  [token, () => user.value?.id],
  ([newToken, newUserId]) => {
    if (!newToken || !newUserId) return
    // If this is a different user, clear previous cache first
    if (loadedForUser.value && loadedForUser.value !== newUserId) {
      resetHouseFilter()
      resetLoginModals()
    }
    loadedForUser.value = newUserId
    fetchFilterHouses()
    fetchLoginModals()
  },
  { immediate: true },
)

type SidebarNavItem = {
  label: string
  icon: string
  to: string
  badge?: string
}

type SidebarNavGroup = {
  key: string
  label: string
  icon: string
  items: SidebarNavItem[]
}

const navGroups = computed<SidebarNavGroup[]>(() => {
  if (user.value?.role === 'support') {
    return [{
      key: 'service',
      label: 'Atendimento',
      icon: 'i-lucide-headphones',
      items: [{
        label: 'Suporte',
        icon: 'i-lucide-headphones',
        to: '/support',
      }]
    }, {
      key: 'account',
      label: 'Conta',
      icon: 'i-lucide-user-cog',
      items: [{
        label: 'Configurações',
        icon: 'i-lucide-settings',
        to: '/settings',
      }]
    }]
  }

  return [{
    key: 'general',
    label: 'Visão geral',
    icon: 'i-lucide-layout-dashboard',
    items: [{
      label: 'Dashboard',
      icon: 'i-lucide-layout-dashboard',
      to: '/'
    }]
  }, {
    key: 'growth',
    label: 'Crescimento',
    icon: 'i-lucide-sprout',
    items: [{
      label: 'Afiliados',
      icon: 'i-lucide-network',
      to: '/affiliates'
    }, {
      label: 'Links',
      icon: 'i-lucide-link',
      to: '/links'
    }, {
      label: 'Deals',
      icon: 'i-lucide-store',
      to: '/deals'
    }]
  }, {
    key: 'finance',
    label: 'Resultados',
    icon: 'i-lucide-chart-no-axes-combined',
    items: [{
      label: 'Rede',
      icon: 'i-lucide-network',
      to: '/earnings'
    }, {
      label: 'Pagamentos',
      icon: 'i-lucide-credit-card',
      to: '/payments'
    }, {
      label: 'Ranking',
      icon: 'i-lucide-trophy',
      to: '/ranking'
    }, {
      label: 'Premiações CPA',
      icon: 'i-lucide-target',
      to: '/cpa-prizes'
    }]
  }, {
    key: 'integrations',
    label: 'Integrações',
    icon: 'i-lucide-plug',
    items: [...(user.value?.role === 'admin' || user.value?.apiAccessEnabled
      ? [{
          label: 'API',
          icon: 'i-lucide-braces',
          to: '/api-webhook'
        }, {
          label: 'Eventos de Webhook',
          icon: 'i-lucide-webhook',
          to: '/webhook-events'
        }]
      : []), ...(user.value?.role === 'admin'
      ? [{
          label: 'Premiações CPA (admin)',
          icon: 'i-lucide-target',
          to: '/cpa-prizes-admin'
        }, {
          label: 'WhatsApp',
          icon: 'i-lucide-message-circle',
          to: '/whatsapp'
        }]
      : [])]
  }, {
    key: 'account',
    label: 'Conta',
    icon: 'i-lucide-user-cog',
    items: [{
      label: 'Notificações',
      icon: 'i-lucide-bell',
      to: '/notifications',
      badge: unreadCount.value > 0 ? unreadCount.value.toString() : undefined
    }, {
      label: 'Configurações',
      icon: 'i-lucide-settings',
      to: '/settings'
    }]
  }].filter((g) => g.items.length > 0)
})

const mobileNavItems = computed(() => {
  if (user.value?.role === 'support') {
    return [{
      label: 'Suporte',
      icon: 'i-lucide-headphones',
      to: '/support',
      kind: 'pill',
      active: route.path === '/support',
    }, {
      label: 'Conta',
      icon: 'i-lucide-settings',
      to: '/settings',
      kind: 'icon',
      active: route.path === '/settings',
    }]
  }

  return [{
  label: 'Dashboard',
  icon: 'i-lucide-layout-dashboard',
  to: '/',
  kind: 'pill',
  active: route.path === '/'
}, {
  label: 'Links',
  icon: 'i-lucide-link',
  to: '/links',
  kind: 'icon',
  active: route.path === '/links'
}, {
  label: 'Afiliados',
  icon: 'i-lucide-network',
  to: '/affiliates',
  kind: 'icon',
  active: route.path === '/affiliates'
}, {
  label: 'Pagamentos',
  icon: 'i-lucide-credit-card',
  to: '/payments',
  kind: 'icon',
  active: route.path === '/payments'
}, {
  label: 'Mais',
  icon: 'i-lucide-ellipsis',
  kind: 'pill',
  active: route.path === '/settings' || route.path === '/notifications' || route.path === '/ranking' || route.path === '/deals' || route.path === '/earnings' || route.path === '/link-webhooks'
}]
})

const mobileMoreItems = computed(() => user.value?.role === 'support' ? [] : [{
  label: 'Premiações CPA',
  icon: 'i-lucide-target',
  to: '/cpa-prizes'
}, {
  label: 'Rede',
  icon: 'i-lucide-network',
  to: '/earnings'
}, {
  label: 'Deals',
  icon: 'i-lucide-store',
  to: '/deals'
}, {
  label: 'Ranking',
  icon: 'i-lucide-trophy',
  to: '/ranking'
}, {
  label: 'API',
  icon: 'i-lucide-braces',
  to: '/api-webhook'
}, {
  label: 'Notificações',
  icon: 'i-lucide-bell',
  to: '/notifications'
}, {
  label: 'Configurações',
  icon: 'i-lucide-settings',
  to: '/settings'
}])

const showMaintenanceBanner = computed(() =>
  user.value?.role === 'affiliate'
  && maintenance.value.bannerEnabled
  && !maintenance.value.enabled
)

const selectedFilterHouseLabel = computed(() => {
  if (filterSlug.value === '__all__') return 'Todas'
  return filterHouses.value.find(h => h.slug === filterSlug.value)?.name ?? 'Casa selecionada'
})

const houseFilterStorageKey = computed(() =>
  `${HOUSE_FILTER_COLLAPSE_PREFIX}:${user.value?.id ?? 'anon'}:${route.path}`,
)

function persistHouseFilterCollapsedState() {
  if (!import.meta.client) return
  setStorageItem(localStorage, houseFilterStorageKey.value, houseFilterCollapsed.value ? '1' : '0')
}

function syncHouseFilterCollapsedStateForPage() {
  if (!import.meta.client) return
  const stored = getStorageItem(localStorage, houseFilterStorageKey.value)
  if (stored === null) {
    persistHouseFilterCollapsedState()
    return
  }
  houseFilterCollapsed.value = stored === '1'
}

function toggleHouseFilterCollapsed() {
  houseFilterCollapsed.value = !houseFilterCollapsed.value
  persistHouseFilterCollapsedState()
}

watch(() => route.path, () => {
  mobileMoreOpen.value = false
  syncHouseFilterCollapsedStateForPage()
})

watch(
  [() => user.value?.id, () => user.value?.role, showPrizeModal, showRankingPromo, genericLoginModalOpen, prizeCheckFinished],
  () => {
    if (!showPrizeModal.value && !showRankingPromo.value && !genericLoginModalOpen.value) nextTick(() => continueLoginModalFlow())
  },
  { immediate: true },
)

watch(
  () => user.value?.id,
  () => syncHouseFilterCollapsedStateForPage(),
  { immediate: true },
)

function toggleDark() {
  colorMode.preference = colorMode.value === 'dark' ? 'light' : 'dark'
}

function isActive(to: string) {
  if (to === '/') return route.path === '/'
  return route.path === to || route.path.startsWith(to + '/')
}

function isGroupActive(group: SidebarNavGroup) {
  return group.items.some(item => isActive(item.to))
}

function isGroupOpen(group: SidebarNavGroup) {
  return Boolean(openNavGroups.value[group.key] || isGroupActive(group))
}

function toggleNavGroup(group: SidebarNavGroup) {
  openNavGroups.value = {
    ...openNavGroups.value,
    [group.key]: !isGroupOpen(group)
  }
}
</script>

<template>
  <div class="min-h-dvh flex flex-col lg:flex-row w-full overflow-hidden lg:gap-4 lg:p-4" style="background: var(--vex-bg)">
    <!-- Header Mobile -->
    <div class="lg:hidden shrink-0 px-3 pt-3 pb-0">
      <div class="flex items-center gap-2 min-h-[3.75rem] px-2.5 py-1.5 vex-sidebar rounded-[1.35rem]" style="box-shadow: var(--vex-shadow-shell-header-mobile)">
        <NuxtLink
          to="/"
          class="min-w-0 flex-1 flex items-center gap-2 rounded-2xl px-1 py-1 text-left transition-all"
        >
          <AppLogo variant="dark" size="mobile" />
        </NuxtLink>

        <div class="flex items-center gap-1.5 shrink-0">
          <NuxtLink
            to="/settings"
            class="vex-shell-icon-button flex size-[2.125rem] items-center justify-center rounded-full transition-all overflow-hidden"
            :class="route.path === '/settings' ? 'is-active' : ''"
          >
            <UAvatar
              :src="user?.avatarUrl || undefined"
              :alt="user?.name ?? 'Minha Conta'"
              size="xs"
            />
          </NuxtLink>

          <NuxtLink
            to="/notifications"
            class="vex-shell-icon-button relative flex size-[2.125rem] items-center justify-center rounded-full transition-all"
            :class="route.path === '/notifications' ? 'is-active' : ''"
          >
            <UIcon name="i-lucide-bell" class="size-4" />
            <span
              v-if="unreadCount > 0"
              class="absolute right-1.5 top-1.5 size-2 rounded-full bg-rose-400"
            />
          </NuxtLink>

          <NuxtLink
            to="/"
            class="vex-shell-icon-button flex size-[2.125rem] items-center justify-center rounded-full transition-all"
            :class="route.path === '/' ? 'is-active' : ''"
          >
            <UIcon name="i-lucide-house" class="size-4" />
          </NuxtLink>

          <button
            class="vex-shell-icon-button flex size-[2.125rem] items-center justify-center rounded-full transition-all"
            @click="toggleDark"
          >
            <UIcon :name="colorMode.value === 'dark' ? 'i-lucide-sun' : 'i-lucide-moon'" class="size-4" />
          </button>

          <button
            class="vex-shell-icon-button flex size-[2.125rem] items-center justify-center rounded-full transition-all"
            @click="logout"
          >
            <UIcon name="i-lucide-log-out" class="size-4" />
          </button>
        </div>
      </div>
    </div>

    <!-- Sidebar Desktop — always dark, branded -->
    <aside class="hidden lg:flex flex-col w-[15.5rem] h-[calc(100dvh-2rem)] sticky top-4 shrink-0 vex-sidebar vex-sidebar-floating">
      <!-- Logo -->
      <div class="h-20 flex items-center px-5 shrink-0" style="border-bottom: 1px solid var(--vex-sidebar-border)">
        <AppLogo variant="dark" size="sidebar" />
      </div>

      <!-- Profile + Preferences (moved to top, just below logo) -->
      <div class="px-3 pt-3 pb-3 flex flex-col gap-1 shrink-0" style="border-bottom: 1px solid var(--vex-sidebar-border)">
        <NuxtLink
          to="/settings"
          class="flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium text-[var(--vex-sidebar-text)] hover:text-[var(--vex-sidebar-text-active)] hover:bg-[var(--vex-sidebar-hover)] transition-all w-full"
        >
          <UAvatar
            :src="user?.avatarUrl || undefined"
            :alt="user?.name ?? 'Minha Conta'"
            size="sm"
            class="shrink-0 ring-2 shadow-sm"
            style="--tw-ring-color: var(--vex-sidebar-border)"
          />
          <span class="truncate">{{ user?.name ?? 'Minha Conta' }}</span>
          <UIcon name="i-lucide-chevron-right" class="ml-auto size-3.5 opacity-40" />
        </NuxtLink>

        <p class="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--vex-sidebar-text)] opacity-40">Preferências</p>

        <button
          @click="toggleDark"
          class="flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium text-[var(--vex-sidebar-text)] hover:text-[var(--vex-sidebar-text-active)] hover:bg-[var(--vex-sidebar-hover)] transition-all"
        >
          <UIcon :name="colorMode.value === 'dark' ? 'i-lucide-sun' : 'i-lucide-moon'" class="size-[18px] opacity-60" />
          <span>{{ colorMode.value === 'dark' ? 'Modo Claro' : 'Modo Escuro' }}</span>
        </button>
      </div>

      <!-- Navigation -->
      <nav class="flex-1 overflow-y-auto px-3 py-4">
        <div
          v-for="group in navGroups"
          :key="group.key"
          class="mb-1.5"
        >
          <button
            type="button"
            class="flex w-full items-center gap-1.5 px-2 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] transition-all"
            :class="'text-[var(--vex-sidebar-text)] opacity-45 hover:opacity-80'"
            @click="toggleNavGroup(group)"
          >
            <UIcon
              :name="group.icon"
              class="size-3 shrink-0"
            />
            <span class="flex-1 truncate text-left">
              {{ group.label }}
            </span>
            <UIcon
              name="i-lucide-chevron-down"
              class="size-3 shrink-0 transition-transform"
              :class="isGroupOpen(group) ? 'rotate-180' : ''"
            />
          </button>
          <div
            v-show="isGroupOpen(group)"
            class="mt-1 space-y-0.5 pl-2"
          >
            <NuxtLink
              v-for="item in group.items"
              :key="item.to"
              :to="item.to"
              class="group flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-semibold transition-all duration-150"
              :class="[
                isActive(item.to)
                  ? 'text-[var(--vex-sidebar-text-active)] bg-[var(--vex-sidebar-active)]'
                  : 'text-[var(--vex-sidebar-text)] hover:text-[var(--vex-sidebar-text-active)] hover:bg-[var(--vex-sidebar-hover)]'
              ]"
            >
              <UIcon
                :name="item.icon"
                class="size-[18px] shrink-0 opacity-70 transition-opacity group-hover:opacity-100"
              />
              <span class="truncate">{{ item.label }}</span>
              <!-- Notification badge -->
              <span
                v-if="item.badge"
                class="ml-auto inline-flex items-center justify-center size-5 rounded-full text-[10px] font-bold bg-rose-500 text-white animate-pulse"
              >
                {{ item.badge }}
              </span>
            </NuxtLink>
          </div>
        </div>
      </nav>

      <!-- House Filter -->
      <div v-if="filterHouses.length" class="px-3 py-3 flex flex-col gap-2 shrink-0" style="border-top: 1px solid var(--vex-sidebar-border)">
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-all text-[var(--vex-sidebar-text)] hover:text-[var(--vex-sidebar-text-active)] hover:bg-[var(--vex-sidebar-hover)]"
          :title="houseFilterCollapsed ? 'Mostrar casas' : 'Ocultar casas'"
          @click="toggleHouseFilterCollapsed"
        >
          <UIcon name="i-lucide-building-2" class="size-4 shrink-0 opacity-60" />
          <span class="min-w-0 flex-1">
            <span class="block text-[10px] font-bold uppercase tracking-[0.12em] opacity-45">Casas</span>
            <span v-if="houseFilterCollapsed" class="block truncate text-[12px] font-semibold">
              {{ selectedFilterHouseLabel }}
            </span>
          </span>
          <span class="text-[10px] font-bold tabular-nums opacity-45">{{ filterHouses.length }}</span>
          <UIcon
            :name="houseFilterCollapsed ? 'i-lucide-eye' : 'i-lucide-eye-off'"
            class="size-4 shrink-0 opacity-70"
          />
        </button>

        <div
          v-show="!houseFilterCollapsed"
          class="max-h-[min(20rem,38vh)] overflow-y-auto pr-1 space-y-1"
        >
          <button
            class="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12px] font-semibold transition-all w-full"
            :class="filterSlug === '__all__'
              ? 'text-[var(--vex-sidebar-text-active)] bg-[var(--vex-sidebar-active)]'
              : 'text-[var(--vex-sidebar-text)] hover:text-[var(--vex-sidebar-text-active)] hover:bg-[var(--vex-sidebar-hover)]'"
            @click="selectHouse('__all__')"
          >
            <UIcon name="i-lucide-layers" class="size-4 opacity-60" />
            <span>Todas</span>
          </button>
          <button
            v-for="h in filterHouses"
            :key="h.slug"
            class="flex min-h-9 items-center gap-2.5 px-3 py-2 rounded-lg text-[12px] font-semibold transition-all w-full"
            :class="filterSlug === h.slug
              ? 'text-[var(--vex-sidebar-text-active)] bg-[var(--vex-sidebar-active)]'
              : 'text-[var(--vex-sidebar-text)] hover:text-[var(--vex-sidebar-text-active)] hover:bg-[var(--vex-sidebar-hover)]'"
            :title="h.name"
            @click="selectHouse(h.slug)"
          >
            <img
              v-if="h.logoUrl"
              :src="h.logoUrl"
              :alt="h.name"
              class="h-5 max-w-[7rem] object-contain shrink-0"
            >
            <span v-else class="truncate">{{ h.name }}</span>
          </button>
        </div>
      </div>

      <!-- Logout (always at bottom) -->
      <div class="px-3 py-3 shrink-0 mt-auto" style="border-top: 1px solid var(--vex-sidebar-border)">
        <button
          class="flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-semibold w-full transition-all text-rose-300 hover:text-rose-200 hover:bg-rose-500/10"
          @click="logout"
        >
          <UIcon name="i-lucide-log-out" class="size-[18px] opacity-80" />
          <span>Sair da Conta</span>
        </button>
      </div>
    </aside>

    <!-- Maintenance Banner Modal -->
    <UModal
      v-model:open="bannerModalOpen"
      :dismissible="false"
      :ui="{ content: 'max-w-sm overflow-hidden p-0' }"
    >
      <template #content>
        <div>
          <div class="relative overflow-hidden px-6 pt-8 pb-7 text-center vex-shell-hero-panel">
            <div
              class="relative z-10 mx-auto mb-3 flex size-16 items-center justify-center rounded-2xl"
              style="background: var(--vex-warning-soft-bg); border: 1px solid var(--vex-warning-soft-border)"
            >
              <UIcon name="i-lucide-megaphone" class="size-8" style="color: var(--vex-warning)" />
            </div>
            <p class="relative z-10 text-[10px] font-bold uppercase tracking-[0.14em]" style="color: var(--vex-shell-dark-label)">
              Aviso do sistema
            </p>
            <h2 class="relative z-10 mt-1 text-[18px] font-extrabold vex-title text-white leading-tight">
              {{ maintenance.bannerTitle }}
            </h2>
            <p class="relative z-10 mt-2 text-[12px] leading-relaxed" style="color: var(--vex-shell-dark-subtle)">
              {{ maintenance.bannerMessage }}
            </p>
          </div>

          <div class="p-5 space-y-3" style="background: var(--vex-surface)">
            <!-- Progress bar -->
            <div class="h-1 w-full overflow-hidden rounded-full" style="background: var(--vex-border-subtle)">
              <div
                class="h-full rounded-full transition-none"
                :style="{ width: `${bannerProgress}%`, background: 'var(--vex-warning)' }"
              />
            </div>
            <UButton
              block
              size="lg"
              color="primary"
              icon="i-lucide-check-circle"
              @click="dismissBanner"
            >
              Entendi
            </UButton>
          </div>
        </div>
      </template>
    </UModal>

    <GenericLoginModal
      v-model:open="genericLoginModalOpen"
      :modal="activeLoginModal"
      @close="closeGenericLoginModal"
      @action="actionGenericLoginModal"
    />

    <!-- Engajamento no login: premiação ativa OU Classificação Geral -->
    <UModal
      v-model:open="showRankingPromo"
      :dismissible="false"
      :ui="{ content: 'max-w-sm overflow-hidden p-0 max-h-[90dvh] overflow-y-auto overscroll-contain' }"
    >
      <template #content>
        <div>
          <!-- Hero -->
          <div class="vex-shell-hero-panel relative flex flex-col items-center gap-2 px-6 pt-8 pb-7 text-center overflow-hidden">
            <div class="vex-shell-hero-orb--brand absolute top-0 left-1/2 w-48 h-48 rounded-full opacity-[0.09] pointer-events-none" style="transform: translate(-50%, -40%)" />
            <div
              class="relative z-10 flex size-16 items-center justify-center rounded-2xl text-4xl mb-1"
              style="background: var(--vex-brand-soft-bg-strong); border: 1px solid var(--vex-brand-soft-border)"
            >
              <template v-if="rankingPromoMode === 'prize'">{{ rankingPromoPrize?.icon || '🏆' }}</template>
              <UIcon v-else name="i-lucide-trophy" class="size-8" style="color: var(--vex-brand-soft-text)" />
            </div>
            <p class="relative z-10 text-[10px] font-bold uppercase tracking-[0.14em]" style="color: var(--vex-shell-dark-label)">
              {{ rankingPromoMode === 'prize' ? 'Premiação em andamento' : 'Competição' }}
            </p>
            <h2 class="relative z-10 text-[16px] font-extrabold vex-title text-white leading-tight">
              {{ rankingPromoMode === 'prize' ? (rankingPromoPrize?.title ?? 'Premiação') : 'Classificação Geral' }}
            </h2>
            <p
              v-if="rankingPromoMode === 'prize' && rankingPromoPrize?.description"
              class="relative z-10 text-[12px] leading-relaxed"
              style="color: var(--vex-shell-dark-subtle)"
            >
              {{ rankingPromoPrize.description }}
            </p>
            <p
              v-else-if="rankingPromoMode === 'ranking'"
              class="relative z-10 text-[12px] leading-relaxed"
              style="color: var(--vex-shell-dark-subtle)"
            >
              Veja quem está liderando e suba de posição. Quanto mais CPAs, mais alto você fica!
            </p>
          </div>

          <div class="p-5 space-y-4" style="background: var(--vex-surface)">
            <!-- Detalhe do prêmio (modo premiação) -->
            <div
              v-if="rankingPromoMode === 'prize' && rankingPromoPrize"
              class="flex items-center gap-3 rounded-lg p-3.5"
              style="background: var(--vex-surface-strong); border: 1px solid var(--vex-border-subtle); border-left: 3px solid var(--vex-brand)"
            >
              <div class="vex-icon-badge shrink-0">
                <UIcon name="i-lucide-gift" class="size-4" />
              </div>
              <div class="min-w-0 flex-1">
                <p class="text-[10px] font-bold uppercase tracking-wider" style="color: var(--vex-text-faint)">Prêmio</p>
                <p class="text-[14px] font-extrabold font-money" style="color: var(--vex-brand)">
                  {{ rankingPromoPrize.prizeLabel || `R$ ${rankingPromoPrize.prizeValue.toFixed(2)}` }}
                </p>
                <p class="text-[10px] mt-0.5" style="color: var(--vex-text-faint)">
                  <template v-if="rankingPromoPrize.winMode === 'RANKING'">Top {{ rankingPromoPrize.winnersCount }} colocados</template>
                  <template v-else>Meta: {{ rankingPromoPrize.targetCpa }} CPAs</template>
                  <template v-if="rankingPromoPrize.endDate"> · até {{ formatPromoDate(rankingPromoPrize.endDate) }}</template>
                </p>
              </div>
            </div>

            <!-- Ranking (top 5) — ambos os modos -->
            <div v-if="rankingPromoTop.length" class="space-y-1.5">
              <p class="text-[10px] font-bold uppercase tracking-wider" style="color: var(--vex-text-faint)">
                {{ rankingPromoMode === 'prize' ? 'Quem está na frente' : 'Top colocados' }}
              </p>
              <div
                v-for="e in rankingPromoTop"
                :key="e.userId"
                class="flex items-center justify-between gap-2 rounded-lg px-3 py-2"
                :style="e.isMe
                  ? 'background: var(--vex-brand-soft-bg); border: 1px solid var(--vex-brand-soft-border)'
                  : 'background: var(--vex-surface-strong); border: 1px solid var(--vex-border-subtle)'"
              >
                <div class="flex items-center gap-2 min-w-0">
                  <span class="text-[13px] w-6 text-center shrink-0">{{ rankingPromoMedal(e.rank) }}</span>
                  <span class="text-[12px] font-semibold truncate" style="color: var(--vex-text)">
                    {{ e.isMe ? 'Você' : e.userName }}
                  </span>
                </div>
                <span class="text-[12px] font-bold font-money shrink-0" style="color: var(--vex-brand)">{{ e.cpa }} CPAs</span>
              </div>
            </div>

            <!-- Minha posição (quando fora do top 5) -->
            <div
              v-if="rankingPromoMe && rankingPromoMe.rank > 5"
              class="flex items-center justify-between gap-2 rounded-lg px-3 py-2"
              style="background: var(--vex-brand-soft-bg); border: 1px dashed var(--vex-brand-soft-border)"
            >
              <div class="flex items-center gap-2 min-w-0">
                <span class="text-[13px] w-6 text-center shrink-0">{{ rankingPromoMe.rank }}º</span>
                <span class="text-[12px] font-semibold truncate" style="color: var(--vex-text)">Você</span>
              </div>
              <span class="text-[12px] font-bold font-money shrink-0" style="color: var(--vex-brand)">{{ rankingPromoMe.cpa }} CPAs</span>
            </div>

            <div class="flex flex-col gap-2">
              <UButton
                block
                size="lg"
                color="primary"
                icon="i-lucide-trophy"
                @click="goToRankingFromPromo"
              >
                Ver ranking completo
              </UButton>
              <UButton
                block
                color="neutral"
                variant="ghost"
                size="sm"
                @click="closeRankingPromo"
              >
                Agora não
              </UButton>
            </div>
          </div>
        </div>
      </template>
    </UModal>

    <!-- Content Area -->
    <main class="flex-1 overflow-y-auto h-[calc(100dvh-4.25rem)] lg:h-[calc(100dvh-2rem)] w-full relative px-3 pb-20 pt-3 lg:px-0 lg:pb-0 lg:pt-0">
      <slot />
    </main>

    <div class="lg:hidden fixed inset-x-0 bottom-0 z-20 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pointer-events-none">
      <nav class="pointer-events-auto relative mx-auto flex w-full items-center justify-between rounded-[1.75rem] border px-2 py-1.5 vex-sidebar" style="border-color: var(--vex-sidebar-border); box-shadow: var(--vex-shadow-shell-nav-mobile)">
        <template v-for="item in mobileNavItems" :key="item.label">
          <button
            v-if="item.label === 'Mais'"
            class="flex items-center justify-center rounded-full px-3.5 py-2 text-[11px] font-semibold transition-all duration-150"
            :class="item.active || mobileMoreOpen ? 'gap-2 text-white bg-white/10' : 'gap-2 text-[var(--vex-sidebar-text)] bg-white/6'"
            @click="mobileMoreOpen = !mobileMoreOpen"
          >
            <UIcon :name="item.icon" class="size-4 shrink-0" :class="item.active || mobileMoreOpen ? 'opacity-100' : 'opacity-75'" />
            <span class="truncate">{{ item.label }}</span>
          </button>

          <NuxtLink
            v-else
            :to="item.to"
            class="flex items-center justify-center text-[11px] font-semibold transition-all duration-150"
            :class="item.kind === 'pill'
              ? (item.active
                  ? 'gap-2 rounded-full px-3.5 py-2 text-white bg-white/10'
                  : 'gap-2 rounded-full px-3.5 py-2 text-[var(--vex-sidebar-text)] bg-white/6')
              : (item.active
                  ? 'size-10 rounded-full text-white bg-white/10'
                  : 'size-10 rounded-full text-[var(--vex-sidebar-text)]')"
          >
            <UIcon :name="item.icon" class="size-4 shrink-0" :class="item.active ? 'opacity-100' : 'opacity-75'" />
            <span v-if="item.kind === 'pill'" class="truncate">{{ item.label }}</span>
          </NuxtLink>
        </template>

        <div
          v-if="mobileMoreOpen"
          class="absolute right-0 bottom-[calc(100%+0.625rem)] w-[12.5rem] overflow-hidden rounded-[1.75rem] border px-1.5 py-1.5 vex-sidebar"
          style="border-color: var(--vex-sidebar-border); box-shadow: var(--vex-shadow-shell-popover-mobile)"
        >
          <div class="flex flex-col gap-1">
            <NuxtLink
              v-for="item in mobileMoreItems"
              :key="item.to"
              :to="item.to"
              class="flex items-center gap-3 rounded-full px-3.5 py-2.5 text-[12px] font-semibold transition-all duration-150"
              :class="route.path === item.to ? 'text-white bg-white/10' : 'text-[var(--vex-sidebar-text)] hover:text-white hover:bg-white/6'"
            >
              <UIcon :name="item.icon" class="size-4 shrink-0" />
              <span>{{ item.label }}</span>
            </NuxtLink>
          </div>
        </div>
      </nav>
    </div>
    <!-- Prize Redemption Modal -->
    <UModal
      v-model:open="showPrizeModal"
      :dismissible="false"
      :ui="{ content: 'max-w-sm overflow-hidden p-0' }"
    >
      <template #content>
        <div v-if="prizeCurrent">
          <!-- Hero header — mesmo padrão vex-shell-hero-panel do ranking.vue -->
          <div class="vex-shell-hero-panel relative flex flex-col items-center gap-2 px-6 pt-8 pb-7 text-center overflow-hidden">
            <!-- Orb decorativo brand -->
            <div class="vex-shell-hero-orb--brand absolute top-0 left-1/2 w-48 h-48 rounded-full opacity-[0.09] pointer-events-none" style="transform: translate(-50%, -40%)" />
            <!-- Ícone do prêmio -->
            <div
              class="relative z-10 flex size-16 items-center justify-center rounded-2xl text-4xl mb-1"
              style="background: var(--vex-brand-soft-bg-strong); border: 1px solid var(--vex-brand-soft-border)"
            >
              {{ prizeCurrent.icon || '🏆' }}
            </div>
            <!-- Label de status -->
            <p class="relative z-10 text-[10px] font-bold uppercase tracking-[0.14em]" style="color: var(--vex-shell-dark-label)">
              Prêmio Disponível
            </p>
            <h2 class="relative z-10 text-[15px] font-extrabold vex-title text-white leading-tight">
              {{ prizeCurrent.title }}
            </h2>
            <p class="relative z-10 text-[12px]" style="color: var(--vex-shell-dark-subtle)">
              Você ficou em
              <strong class="text-white">{{ prizeCurrent.rank }}º lugar</strong>
              · {{ prizeCurrent.cpaAchieved }} CPAs
            </p>
            <!-- Badge contador se múltiplos prêmios -->
            <div
              v-if="prizeTotal > 1"
              class="absolute right-3 top-3 rounded-full px-2 py-0.5 text-[10px] font-bold"
              style="background: var(--vex-brand-soft-bg-strong); color: var(--vex-brand-soft-text); border: 1px solid var(--vex-brand-soft-border)"
            >
              {{ prizeTotal }} prêmios
            </div>
          </div>

          <!-- Prize detail — estilo vex-card com border-left brand -->
          <div class="p-5 space-y-4" style="background: var(--vex-surface)">
            <div
              class="flex items-center gap-3 rounded-lg p-3.5"
              style="background: var(--vex-surface-strong); border: 1px solid var(--vex-border-subtle); border-left: 3px solid var(--vex-brand)"
            >
              <div class="vex-icon-badge shrink-0">
                <UIcon name="i-lucide-trophy" class="size-4" />
              </div>
              <div class="min-w-0 flex-1">
                <p class="text-[10px] font-bold uppercase tracking-wider" style="color: var(--vex-text-faint)">Seu prêmio</p>
                <p class="text-[14px] font-extrabold font-money" style="color: var(--vex-brand)">
                  {{ prizeCurrent.prizeLabel || `R$ ${prizeCurrent.prizeValue.toFixed(2)}` }}
                </p>
              </div>
            </div>

            <p class="text-center text-[11px]" style="color: var(--vex-text-faint)">
              Parabéns pelo desempenho! Confirme abaixo para receber o prêmio.
            </p>

            <!-- Actions -->
            <div class="flex flex-col gap-2">
              <UButton
                block
                size="lg"
                color="primary"
                icon="i-lucide-check-circle"
                :loading="prizeRedeeming"
                @click="redeemPrizeCurrent"
              >
                Resgatar Prêmio
              </UButton>
              <UButton
                block
                color="neutral"
                variant="ghost"
                size="sm"
                @click="skipPrizeCurrent"
              >
                Agora não
              </UButton>
            </div>
          </div>
        </div>
      </template>
    </UModal>

    <ChatWidget />
  </div>
</template>
