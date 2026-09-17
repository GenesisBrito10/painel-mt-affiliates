<script setup lang="ts">
/**
 * AffiliateTreeNode — Recursive tree node component.
 * Renders a single affiliate with expand/collapse for children.
 * PENDING nodes show an "Aprovar" button that bubbles up via emit.
 */
import type { NetworkNode, UserStatus } from '~/composables/useAffiliates'

const props = defineProps<{
  node: NetworkNode
  level: number
  expandedNodes: Set<string>
  statusLabel: (s: UserStatus) => string
  statusColor: (s: UserStatus) => 'warning' | 'success' | 'error'
  formatCurrency: (v: number) => string
  formatHouseLabel: (v: string) => string
}>()

const emit = defineEmits<{
  toggle: [id: string]
  approve: [id: string]
}>()

const hasChildren = computed(() => props.node.children.length > 0)
const isExpanded = computed(() => props.expandedNodes.has(props.node.id))
const isPending = computed(() => props.node.status === 'pending')
</script>

<template>
  <div class="vex-tree-node">
    <!-- Connector line for non-root -->
    <div v-if="level > 1" class="vex-tree-connector" />

    <div
      class="vex-tree-node-content"
      :class="{ 'vex-tree-node-content--expandable': hasChildren }"
      @click="hasChildren && emit('toggle', node.id)"
    >
      <!-- Expand/collapse toggle -->
      <div class="vex-tree-toggle shrink-0">
        <UIcon
          v-if="hasChildren"
          :name="isExpanded ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
          class="size-3.5 transition-transform duration-150"
          style="color: var(--vex-text-faint)"
        />
        <div
          v-else
          class="size-1.5 rounded-full"
          style="background: var(--vex-border)"
        />
      </div>

      <!-- Node body -->
      <div class="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
        <!-- Name + status + email -->
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            <p class="font-semibold text-[12px] truncate" style="color: var(--vex-text)">{{ node.name }}</p>
            <UBadge :label="statusLabel(node.status)" :color="statusColor(node.status)" variant="subtle" size="sm" />
            <!-- Children count (mobile: inline) -->
            <span
              v-if="hasChildren && !isExpanded"
              class="text-[10px] font-medium px-1.5 py-0.5 rounded sm:hidden"
              style="background: var(--vex-brand-muted); color: var(--vex-brand)"
            >
              {{ node.children.length }} sub
            </span>
          </div>
          <p class="text-[10px] truncate" style="color: var(--vex-text-faint)">{{ node.email }}</p>
        </div>

        <!-- House badges + commission -->
        <div class="flex flex-wrap gap-1 shrink-0">
          <span
            v-for="link in node.affiliateLinks"
            :key="`${node.id}-${link.bettingHouse}`"
            class="text-[10px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap"
            style="background: var(--vex-bg-muted); color: var(--vex-text-muted)"
          >
            <HouseBadge :slug="link.bettingHouse" size="xs" /> · CPA {{ link.cpa ? formatCurrency(link.cpa) : '—' }} · Rev {{ link.revshare ? `${link.revshare}%` : '—' }}
          </span>
        </div>

        <!-- Children count (desktop) -->
        <span
          v-if="hasChildren && !isExpanded"
          class="hidden sm:inline text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0"
          style="background: var(--vex-brand-muted); color: var(--vex-brand)"
        >
          {{ node.children.length }} sub
        </span>

        <!-- ── Approve button for PENDING nodes ── -->
        <UButton
          v-if="isPending"
          size="xs"
          color="warning"
          variant="subtle"
          icon="i-lucide-user-check"
          label="Aprovar"
          class="shrink-0"
          @click.stop="emit('approve', node.id)"
        />
      </div>
    </div>

    <!-- Recursive children (expanded) -->
    <div v-if="hasChildren && isExpanded" class="vex-tree-children">
      <AffiliatesAffiliateTreeNode
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :level="level + 1"
        :expanded-nodes="expandedNodes"
        :status-label="statusLabel"
        :status-color="statusColor"
        :format-currency="formatCurrency"
        :format-house-label="formatHouseLabel"
        @toggle="emit('toggle', $event)"
        @approve="emit('approve', $event)"
      />
    </div>
  </div>
</template>
