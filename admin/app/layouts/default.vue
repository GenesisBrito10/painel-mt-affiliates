<script setup lang="ts">
const route = useRoute()
const colorMode = useColorMode()
const { logout, user, isSuperAdmin } = useAuth()
const mobileOpen = ref(false)
const openNavGroups = ref<Record<string, boolean>>({
  general: true,
  operation: true
})

if (import.meta.client) {
  colorMode.preference = 'dark'
}

// Pages only accessible to SUPERADMIN (hidden from regular ADMIN)
const SUPERADMIN_ONLY_PATHS = ['/sync', '/audit', '/theme', '/maintenance', '/settings']

type NavItem = {
  label: string
  icon: string
  to: string
}

type NavGroup = {
  key: string
  label: string
  icon: string
  items: NavItem[]
}

const navGroups: NavGroup[] = [
  {
    key: 'general',
    label: 'Visão geral',
    icon: 'i-lucide-layout-dashboard',
    items: [
      { label: 'Dashboard', icon: 'i-lucide-layout-dashboard', to: '/' }
    ]
  },
  {
    key: 'operation',
    label: 'Operação',
    icon: 'i-lucide-briefcase-business',
    items: [
      { label: 'Afiliados', icon: 'i-lucide-users', to: '/affiliates' },
      { label: 'Links', icon: 'i-lucide-link', to: '/links' },
      { label: 'Regras de Link', icon: 'i-lucide-sliders-horizontal', to: '/link-rules' },
      { label: 'Saques', icon: 'i-lucide-wallet', to: '/withdrawals' },
      { label: 'Casas', icon: 'i-lucide-building-2', to: '/houses' },
      { label: 'Deals', icon: 'i-lucide-tag', to: '/deals' }
    ]
  },
  {
    key: 'support',
    label: 'Atendimento',
    icon: 'i-lucide-headphones',
    items: [
      { label: 'Suporte', icon: 'i-lucide-headphones', to: '/support' },
      { label: 'Broadcasts', icon: 'i-lucide-radio-tower', to: '/notifications' }
    ]
  },
  {
    key: 'management',
    label: 'Gestão',
    icon: 'i-lucide-shield-check',
    items: [
      { label: 'Admins', icon: 'i-lucide-shield-check', to: '/admins' },
      { label: 'Prêmios', icon: 'i-lucide-trophy', to: '/prizes' }
    ]
  },
  {
    key: 'system',
    label: 'Sistema',
    icon: 'i-lucide-settings',
    items: [
      { label: 'WhatsApp', icon: 'i-lucide-message-circle', to: '/whatsapp' },
      { label: 'Webhooks', icon: 'i-lucide-webhook', to: '/webhooks' },
      { label: 'Sincronização', icon: 'i-lucide-refresh-cw', to: '/sync' },
      { label: 'Auditoria', icon: 'i-lucide-shield', to: '/audit' },
      { label: 'Tema', icon: 'i-lucide-palette', to: '/theme' },
      { label: 'Manutenção', icon: 'i-lucide-construction', to: '/maintenance' },
      { label: 'Modais', icon: 'i-lucide-panels-top-left', to: '/login-modals' },
      { label: 'Configurações', icon: 'i-lucide-settings', to: '/settings' }
    ]
  }
]

// Filter nav based on role: ADMIN cannot see SUPERADMIN-only pages.
const filteredNavGroups = computed(() => {
  return navGroups
    .map(group => ({
      ...group,
      items: isSuperAdmin.value
        ? group.items
        : group.items.filter(item => !SUPERADMIN_ONLY_PATHS.includes(item.to))
    }))
    .filter(group => group.items.length > 0)
})

const roleLabel = computed(() => isSuperAdmin.value ? 'Super Admin' : 'Admin')

watch(() => route.path, () => {
  mobileOpen.value = false
})

function isActive(to: string | undefined) {
  if (!to) return false
  if (to === '/') return route.path === '/'
  return route.path === to || route.path.startsWith(to + '/')
}

function isGroupActive(group: NavGroup) {
  return group.items.some(item => isActive(item.to))
}

function isGroupOpen(group: NavGroup) {
  return Boolean(openNavGroups.value[group.key] || isGroupActive(group))
}

function toggleNavGroup(group: NavGroup) {
  openNavGroups.value = {
    ...openNavGroups.value,
    [group.key]: !isGroupOpen(group)
  }
}

const titleMap: Record<string, [string, string]> = {
  '/': ['Dashboard Admin', 'Visão da rede inteira'],
  '/affiliates': ['Gestão de Afiliados', 'Aprovações, status e ações'],
  '/links': ['Links', 'Solicitações pendentes'],
  '/withdrawals': ['Saques', 'Aprovações e pagamentos'],
  '/houses': ['Casas de Apostas', 'Operadoras integradas'],
  '/deals': ['Deals', 'Gestão de deals por casa'],
  '/support': ['Suporte', 'Conversas e histórico de atendimentos'],
  '/prizes': ['Prêmios', 'Premiação por ranking'],
  '/sync': ['Sincronização', 'Status das integrações'],
  '/audit': ['Auditoria', 'Log de ações no sistema'],
  '/notifications': ['Broadcasts', 'Comunicação com afiliados'],
  '/theme': ['Tema do sistema', 'Cores aplicadas no frontend'],
  '/maintenance': ['Modo manutenção', 'Bloquear acesso ao frontend'],
  '/login-modals': ['Modais de Login', 'Conteúdos exibidos no painel do afiliado'],
  '/settings': ['Configurações', 'Configuração do sistema'],
  '/admins': ['Admins', 'Gestão de administradores']
}

const currentTitle = computed<[string, string]>(() => {
  const path = route.path
  const exact = titleMap[path]
  if (exact) return exact
  for (const key of Object.keys(titleMap)) {
    if (key !== '/' && path.startsWith(key)) {
      const match = titleMap[key]
      if (match) return match
    }
  }
  return ['Admin', '']
})

const initials = computed(() => {
  const name = user.value?.name || user.value?.email || 'A'
  return name.split(' ').map(s => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
})
</script>

<template>
  <div
    class="min-h-dvh flex flex-col lg:flex-row gap-3 p-3 overflow-x-hidden w-full"
    style="background: var(--color-bg); max-width: 100vw"
  >
    <!-- Mobile topbar -->
    <header
      class="lg:hidden h-14 px-4 flex items-center justify-between sticky top-3 z-30 w-full"
      :style="{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: '14px',
        boxShadow: '0 12px 32px -18px rgba(0, 0, 0, 0.45)'
      }"
    >
      <AppLogo
        size="sm"
        compact
      />
      <UButton
        icon="i-lucide-menu"
        color="neutral"
        variant="ghost"
        @click="mobileOpen = true"
      />
    </header>

    <!-- Mobile drawer -->
    <USlideover
      v-model:open="mobileOpen"
      side="left"
    >
      <template #content>
        <aside
          class="h-full w-72 flex flex-col"
          style="background: var(--color-surface); border-right: 1px solid var(--color-border)"
        >
          <div
            class="px-5 pt-5 pb-4 border-b flex items-center justify-between"
            style="border-color: var(--color-border)"
          >
            <AppLogo
              size="sm"
              :show-subtitle="true"
            />
            <UButton
              icon="i-lucide-x"
              color="neutral"
              variant="ghost"
              @click="mobileOpen = false"
            />
          </div>
          <nav class="flex-1 px-2.5 py-3 overflow-y-auto">
            <div
              v-for="group in filteredNavGroups"
              :key="group.key"
              class="mb-1.5"
            >
              <button
                type="button"
                class="flex w-full items-center gap-1.5 px-2 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] transition-all"
                :style="{ color: 'var(--color-text-muted)', opacity: 0.68 }"
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
                  class="flex items-center gap-3 px-3 py-2.5 text-[13px] transition-all duration-150"
                  :style="isActive(item.to) ? {
                    background: 'var(--color-surface-elevated)',
                    color: 'var(--color-gold)',
                    borderLeft: '2px solid var(--color-gold)',
                    borderRadius: '8px',
                    fontWeight: '600',
                    paddingLeft: '10px'
                  } : {
                    color: 'var(--color-text-secondary)',
                    borderLeft: '2px solid transparent',
                    borderRadius: '8px',
                    fontWeight: '500',
                    paddingLeft: '10px'
                  }"
                >
                  <UIcon
                    :name="item.icon"
                    class="size-[17px] shrink-0"
                  />
                  <span class="truncate">{{ item.label }}</span>
                </NuxtLink>
              </div>
            </div>
          </nav>
          <div
            class="px-3 py-3 border-t flex items-center gap-2.5"
            style="border-color: var(--color-border)"
          >
            <div
              class="grid place-items-center rounded-full font-extrabold text-sm shrink-0"
              :style="{ width: '34px', height: '34px', background: 'var(--color-gold)', color: '#FFFFFF' }"
            >
              {{ initials }}
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-[13px] font-semibold truncate">
                {{ user?.name || 'Admin' }}
              </div>
              <div class="label-kicker truncate">
                {{ roleLabel }}
              </div>
            </div>
            <button
              class="grid place-items-center rounded-md transition-colors"
              :style="{ width: '28px', height: '28px', color: 'var(--color-text-muted)' }"
              title="Sair"
              @click="logout"
            >
              <UIcon
                name="i-lucide-log-out"
                class="size-[15px]"
              />
            </button>
          </div>
        </aside>
      </template>
    </USlideover>

    <!-- Desktop sidebar -->
    <aside
      class="hidden lg:flex flex-col flex-shrink-0 sticky"
      :style="{
        width: '248px',
        height: 'calc(100dvh - 1.5rem)',
        top: '0.75rem',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: '16px',
        boxShadow: '0 12px 32px -18px rgba(0, 0, 0, 0.55)',
        overflow: 'hidden'
      }"
    >
      <div
        class="px-5 pt-5 pb-4 border-b"
        style="border-color: var(--color-border)"
      >
        <AppLogo
          size="sidebar"
          :show-subtitle="true"
        />
      </div>
      <nav class="flex-1 px-2.5 py-3 overflow-y-auto">
        <div
          v-for="group in filteredNavGroups"
          :key="group.key"
          class="mb-1.5"
        >
          <button
            type="button"
            class="flex w-full items-center gap-1.5 px-2 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] transition-all"
            :style="{ color: 'var(--color-text-muted)', opacity: 0.68 }"
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
              class="flex items-center gap-3 px-3 py-2.5 text-[13px] transition-all duration-150"
              :style="isActive(item.to) ? {
                background: 'var(--color-surface-elevated)',
                color: 'var(--color-gold)',
                borderLeft: '2px solid var(--color-gold)',
                borderRadius: '8px',
                fontWeight: '600',
                paddingLeft: '10px'
              } : {
                color: 'var(--color-text-secondary)',
                borderLeft: '2px solid transparent',
                borderRadius: '8px',
                fontWeight: '500',
                paddingLeft: '10px'
              }"
            >
              <UIcon
                :name="item.icon"
                class="size-[17px] shrink-0"
              />
              <span class="truncate">{{ item.label }}</span>
            </NuxtLink>
          </div>
        </div>
      </nav>
      <div
        class="px-3 py-3 border-t flex items-center gap-2.5"
        style="border-color: var(--color-border)"
      >
        <div
          class="grid place-items-center rounded-full font-extrabold text-sm shrink-0"
          :style="{ width: '34px', height: '34px', background: 'var(--color-gold)', color: '#FFFFFF' }"
        >
          {{ initials }}
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-[13px] font-semibold truncate">
            {{ user?.name || 'Admin' }}
          </div>
          <div class="label-kicker truncate">
            {{ roleLabel }}
          </div>
        </div>
        <button
          class="grid place-items-center rounded-md transition-colors hover:text-white"
          :style="{ width: '28px', height: '28px', color: 'var(--color-text-muted)' }"
          title="Sair"
          @click="logout"
        >
          <UIcon
            name="i-lucide-log-out"
            class="size-[15px]"
          />
        </button>
      </div>
    </aside>

    <!-- Main column -->
    <div class="flex-1 flex flex-col min-w-0 max-w-full gap-3">
      <!-- Desktop topbar -->
      <header
        class="hidden lg:flex items-center gap-4 sticky z-10"
        :style="{
          top: '0.75rem',
          height: '60px',
          padding: '0 24px',
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: '16px',
          boxShadow: '0 12px 32px -18px rgba(0, 0, 0, 0.45)'
        }"
      >
        <div>
          <div
            class="leading-tight"
            style="font-size: 15px; font-weight: 700; letter-spacing: -0.01em"
          >
            {{ currentTitle[0] }}
          </div>
          <div
            v-if="currentTitle[1]"
            style="font-size: 11px; color: var(--color-text-muted); margin-top: 2px"
          >
            {{ currentTitle[1] }}
          </div>
        </div>
        <div class="ml-auto flex items-center gap-2.5">
          <NuxtLink
            to="/notifications"
            class="grid place-items-center relative transition-colors"
            :style="{ width: '36px', height: '36px', borderRadius: '10px', background: 'var(--color-surface-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }"
            title="Broadcasts"
          >
            <UIcon
              name="i-lucide-bell"
              class="size-4"
            />
            <span
              class="absolute"
              :style="{ top: '6px', right: '6px', width: '7px', height: '7px', borderRadius: '50%', background: 'var(--color-gold)', boxShadow: '0 0 6px var(--color-gold)' }"
            />
          </NuxtLink>
        </div>
      </header>

      <main class="flex-1 fade-up min-w-0 max-w-full">
        <slot />
      </main>
    </div>
  </div>
</template>
