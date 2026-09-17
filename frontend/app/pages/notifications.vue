<script setup lang="ts">
definePageMeta({ layout: 'default' })

const {
  notifications,
  unreadCount,
  hasMore,
  loading,
  loadingMore,
  markingAll,
  fetchList,
  loadMore,
  markAsRead,
  markAllAsRead,
  deleteNotification,
} = useNotifications()

// ─── Filter ────────────────────────────────────────────────────────────────

type Filter = 'all' | 'unread'
const filter = ref<Filter>('all')

const readFilter = computed<boolean | undefined>(() =>
  filter.value === 'unread' ? false : undefined,
)

watch(filter, () => fetchList(readFilter.value))

onMounted(() => fetchList())

// ─── Helpers ───────────────────────────────────────────────────────────────

function getRelativeTime(dateStr: string): string {
  const d = new Date(dateStr)
  const diffMs = Date.now() - d.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  const diffH = Math.floor(diffMin / 60)
  const diffD = Math.floor(diffH / 24)

  if (diffMin < 1) return 'agora'
  if (diffMin < 60) return `${diffMin}m atrás`
  if (diffH < 24) return `${diffH}h atrás`
  if (diffD === 1) return 'Ontem'
  return `${diffD} dias atrás`
}

function formatDateKey(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)

  if (d.toDateString() === today.toDateString()) return 'Hoje'
  if (d.toDateString() === yesterday.toDateString()) return 'Ontem'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
}

const groupedByDate = computed(() => {
  const groups: Record<string, typeof notifications.value> = {}
  for (const n of notifications.value) {
    const key = formatDateKey(n.createdAt)
    if (!groups[key]) groups[key] = []
    groups[key]!.push(n)
  }
  return groups
})

const TYPE_META: Record<string, { icon: string; color: string }> = {
  REGISTRATION: { icon: 'i-lucide-user-plus', color: 'var(--vex-brand)' },
  COMMISSION_CHANGE: { icon: 'i-lucide-trending-up', color: 'var(--vex-warning)' },
  WITHDRAWAL_APPROVED: { icon: 'i-lucide-banknote', color: 'var(--vex-positive)' },
  WITHDRAWAL_REJECTED: { icon: 'i-lucide-x-circle', color: 'var(--vex-negative)' },
  STATUS_CHANGE: { icon: 'i-lucide-shield-check', color: 'var(--vex-info)' },
  GENERAL: { icon: 'i-lucide-bell', color: 'var(--vex-text-muted)' },
}

function getTypeMeta(type: string) {
  return TYPE_META[type] ?? TYPE_META.GENERAL!
}
</script>

<template>
  <div class="min-h-full flex flex-col">
    <!-- ─── PAGE HEADER ─── -->
    <header class="vex-page-header">
      <div class="flex items-center gap-3">
        <h1 class="text-base font-bold vex-title">Notificações</h1>
        <span
          v-if="unreadCount > 0"
          class="text-[10px] font-bold px-2 py-0.5 rounded"
          style="color: var(--vex-brand); background: var(--vex-brand-muted)"
        >
          {{ unreadCount }} não {{ unreadCount === 1 ? 'lida' : 'lidas' }}
        </span>
      </div>

      <div class="flex items-center gap-2">
        <!-- Filter toggle -->
        <div
          class="vex-shell-segmented flex rounded-lg overflow-hidden text-[11px] font-semibold"
        >
          <button
            v-for="f in ([{ id: 'all', label: 'Todas' }, { id: 'unread', label: 'Não lidas' }] as const)"
            :key="f.id"
            class="vex-shell-tab px-3 py-1.5 transition-all duration-150"
            :class="filter === f.id ? 'is-active' : ''"
            @click="filter = f.id"
          >
            {{ f.label }}
          </button>
        </div>

        <!-- Mark all -->
        <UButton
          v-if="unreadCount > 0"
          label="Marcar todas"
          variant="ghost"
          color="neutral"
          icon="i-lucide-check-check"
          size="sm"
          :loading="markingAll"
          @click="markAllAsRead"
        />
      </div>
    </header>

    <!-- ─── CONTENT ─── -->
    <div class="flex-1">
      <div class="py-5 w-full">

        <!-- Skeletons -->
        <div v-if="loading" class="vex-card overflow-hidden">
          <div
            v-for="i in 5"
            :key="i"
            class="p-5 flex gap-4 items-start"
            :style="i < 5 ? 'border-bottom: 1px solid var(--vex-border-subtle)' : ''"
          >
            <USkeleton class="size-10 rounded-lg shrink-0" />
            <div class="flex-1 space-y-2">
              <div class="flex justify-between items-center w-full mb-1">
                <USkeleton class="h-4 w-40" />
                <USkeleton class="h-3 w-14" />
              </div>
              <USkeleton class="h-3.5 w-3/4" />
            </div>
          </div>
        </div>

        <!-- Grouped list -->
        <div v-else-if="notifications.length > 0" class="space-y-4">
          <template v-for="(group, dateKey) in groupedByDate" :key="dateKey">
            <!-- Date separator -->
            <div
              class="text-[10px] font-bold uppercase tracking-widest px-1 pb-1"
              style="color: var(--vex-text-faint); border-bottom: 1px solid var(--vex-border-subtle)"
            >
              {{ dateKey }}
            </div>

            <div class="vex-card overflow-hidden">
              <div
                v-for="(notif, idx) in group"
                :key="notif.id"
                class="p-4 md:p-5 flex gap-4 items-start transition-colors duration-150 group cursor-pointer"
                :style="{
                  borderBottom: idx < group.length - 1 ? '1px solid var(--vex-border-subtle)' : 'none',
                  background: !notif.read ? 'var(--vex-brand-muted)' : 'transparent',
                }"
                @click="markAsRead(notif.id)"
              >
                <!-- Icon badge -->
                <div class="relative shrink-0 mt-0.5">
                  <div
                    class="vex-icon-badge transition-transform group-hover:scale-105 duration-200"
                    :style="{ opacity: notif.read ? '0.5' : '1', '--badge-color': getTypeMeta(notif.type).color }"
                  >
                    <UIcon :name="getTypeMeta(notif.type).icon" class="size-4" />
                  </div>
                  <!-- Unread dot -->
                  <div
                    v-if="!notif.read"
                    class="absolute -top-1 -right-1 size-2.5 rounded-full"
                    style="background: var(--vex-brand); border: 2px solid var(--vex-surface)"
                  />
                </div>

                <!-- Content -->
                <div class="flex-1 min-w-0">
                  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-4 mb-1">
                    <h4
                      class="text-[13px] font-bold truncate"
                      :style="{ color: !notif.read ? 'var(--vex-text)' : 'var(--vex-text-muted)' }"
                    >
                      {{ notif.title }}
                    </h4>
                    <span
                      class="text-[10px] font-bold uppercase tracking-wider whitespace-nowrap"
                      style="color: var(--vex-text-faint)"
                    >
                      {{ getRelativeTime(notif.createdAt) }}
                    </span>
                  </div>
                  <p
                    class="text-[12px] leading-relaxed"
                    :style="{ color: !notif.read ? 'var(--vex-text-muted)' : 'var(--vex-text-faint)' }"
                  >
                    {{ notif.message }}
                  </p>
                </div>

                <!-- Actions -->
                <div class="shrink-0 flex items-center gap-1 pl-1">
                  <UButton
                    v-if="!notif.read"
                    icon="i-lucide-check"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    square
                    title="Marcar como lida"
                    class="opacity-40 hover:opacity-100 transition-opacity"
                    @click.stop="markAsRead(notif.id)"
                  />
                  <UButton
                    icon="i-lucide-trash-2"
                    color="error"
                    variant="ghost"
                    size="xs"
                    square
                    title="Excluir notificação"
                    class="opacity-0 group-hover:opacity-40 hover:!opacity-100 transition-opacity"
                    @click.stop="deleteNotification(notif.id)"
                  />
                </div>
              </div>
            </div>
          </template>

          <!-- Load more -->
          <div v-if="hasMore" class="flex justify-center pt-2">
            <UButton
              label="Carregar mais"
              variant="ghost"
              color="neutral"
              icon="i-lucide-chevron-down"
              size="sm"
              :loading="loadingMore"
              @click="loadMore(readFilter)"
            />
          </div>
        </div>

        <!-- Empty state -->
        <div v-else class="vex-card py-20 flex flex-col items-center justify-center text-center">
          <div class="vex-icon-badge mb-4" style="width: 3.5rem; height: 3.5rem">
            <UIcon name="i-lucide-bell-off" class="size-7" />
          </div>
          <h3 class="text-sm font-bold" style="color: var(--vex-text)">
            {{ filter === 'unread' ? 'Nenhuma notificação não lida' : 'Tudo limpo por aqui' }}
          </h3>
          <p class="text-[12px] max-w-xs mt-1" style="color: var(--vex-text-faint)">
            {{ filter === 'unread'
              ? 'Você está em dia com todas as notificações.'
              : 'Você não possui notificações no momento.' }}
          </p>
          <UButton
            v-if="filter === 'unread'"
            label="Ver todas"
            variant="ghost"
            color="neutral"
            size="sm"
            class="mt-4"
            @click="filter = 'all'"
          />
        </div>

      </div>
    </div>
  </div>
</template>
