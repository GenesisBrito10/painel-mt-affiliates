<script setup lang="ts">
/**
 * Affiliates Page — Orchestrator
 * All logic lives in useAffiliates composable.
 * Components render specific zones.
 */
import { panelOptions } from '~/composables/useAffiliates'

definePageMeta({ layout: 'default' })

const aff = useAffiliates()
</script>

<template>
  <div class="min-h-full flex flex-col">
    <!-- ─── PAGE HEADER ─── -->
    <header class="vex-page-header">
      <div class="flex items-center gap-3">
        <h1 class="text-base font-bold vex-title">Afiliados</h1>
        <span
          class="hidden md:inline-flex text-[10px] font-bold px-2 py-0.5 rounded"
          :style="{
            color: aff.isAdmin.value ? 'var(--vex-info)' : 'var(--vex-brand)',
            background: aff.isAdmin.value ? 'var(--vex-info-light)' : 'var(--vex-brand-muted)',
          }"
        >
          {{ aff.isAdmin.value ? 'Visão Admin' : 'Minha Rede' }}
        </span>
      </div>
    </header>

    <!-- ─── CONTENT ─── -->
    <div class="flex-1">
      <div class="py-4 md:py-5 space-y-4 md:space-y-5 w-full">

        <!-- ════════════════════════════════════════
             AFFILIATE VIEW (non-admin)
             ════════════════════════════════════════ -->
        <template v-if="!aff.isAdmin.value">

          <!-- COMMAND ZONE: Referral + Agreement -->
          <section class="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <AffiliatesReferralCard
              class="xl:col-span-1"
              :referral-code="aff.referralCode.value"
              :referral-link="aff.referralLink.value"
              :copied="aff.copied.value"
              @copy="aff.copyReferralLink"
            />
            <AffiliatesAgreementCard
              class="xl:col-span-2"
              :affiliate-links="aff.myProfile.value.affiliateLinks"
              :summary="aff.agreementSummary.value"
              :format-currency="aff.formatCurrency"
              :format-house-label="aff.formatHouseLabel"
            />
          </section>

          <!-- INTELLIGENCE ZONE: KPIs -->
          <AffiliatesNetworkKPIs
            :total="aff.networkSummary.value.total"
            :approved="aff.networkSummary.value.approved"
            :pending="aff.networkSummary.value.pending"
            :rejected="aff.networkSummary.value.rejected"
          />

          <!-- Tab toggle -->
          <section>
            <div class="inline-flex items-center p-0.5 rounded-lg" style="background: var(--vex-bg-muted)">
              <button
                class="px-3 py-1.5 rounded-md text-[12px] font-semibold transition-all duration-150"
                :class="aff.activeTab.value === 'rede' ? 'bg-[var(--vex-surface)] shadow-sm' : ''"
                :style="aff.activeTab.value === 'rede' ? 'color: var(--vex-text)' : 'color: var(--vex-text-faint)'"
                @click="aff.activeTab.value = 'rede'"
              >
                Árvore de Rede ({{ aff.networkSummary.value.total }})
              </button>
              <button
                class="px-3 py-1.5 rounded-md text-[12px] font-semibold transition-all duration-150"
                :class="aff.activeTab.value === 'convidados' ? 'bg-[var(--vex-surface)] shadow-sm' : ''"
                :style="aff.activeTab.value === 'convidados' ? 'color: var(--vex-text)' : 'color: var(--vex-text-faint)'"
                @click="aff.activeTab.value = 'convidados'"
              >
                Meus Convidados ({{ aff.invitedUsers.value.length }})
              </button>
            </div>
          </section>

          <!-- TAB: Árvore de Rede -->
          <section v-if="aff.activeTab.value === 'rede'" class="space-y-4">
            <AffiliatesFilterBar
              :search="aff.networkSearch.value"
              :status-filter="aff.networkStatusFilter.value"
              :house-filter="aff.networkHouseFilter.value"
              :house-options="aff.networkHouseOptions.value"
              :has-active-filters="aff.hasActiveNetworkFilters.value"
              @update:search="aff.networkSearch.value = $event"
              @update:status-filter="aff.networkStatusFilter.value = $event"
              @update:house-filter="aff.networkHouseFilter.value = $event"
              @clear-all="aff.clearNetworkFilters"
            />

            <AffiliatesAffiliateTree
              :tree="aff.filteredNetworkTree.value"
              :root-name="aff.myProfile.value.name"
              :root-email="aff.myProfile.value.email"
              :status-label="aff.statusLabel"
              :status-color="aff.statusColor"
              :format-currency="aff.formatCurrency"
              :format-house-label="aff.formatHouseLabel"
              :current-page="aff.networkPage.value"
              :total="aff.networkTotal.value"
              :page-size="aff.networkPageSize"
              @update:page="aff.goToNetworkPage($event)"
              @approve="aff.openApprovalModal"
            />
          </section>

          <!-- TAB: Meus Convidados -->
          <section v-else class="space-y-4">
            <AffiliatesFilterBar
              :search="aff.convidadosSearch.value"
              :status-filter="aff.convidadosStatusFilter.value"
              :house-filter="aff.convidadosHouseFilter.value"
              :house-options="aff.allHouseOptions.value"
              :has-active-filters="aff.hasActiveConvidadosFilters.value"
              @update:search="aff.convidadosSearch.value = $event"
              @update:status-filter="aff.convidadosStatusFilter.value = $event"
              @update:house-filter="aff.convidadosHouseFilter.value = $event"
              @clear-all="aff.clearConvidadosFilters"
            />

            <!-- Filtros: tipo (todos / externos / internos) + nível -->
            <div class="flex flex-wrap items-center gap-4">
              <div class="flex items-center gap-2">
                <span class="text-xs" style="color: var(--vex-text-muted)">Tipo:</span>
                <USelect
                  :model-value="aff.convidadosExternalFilter.value"
                  :items="[
                    { label: 'Todos', value: 'all' },
                    { label: 'Externos (API)', value: 'external' },
                    { label: 'Internos', value: 'internal' },
                  ]"
                  value-key="value"
                  size="sm"
                  class="w-44"
                  @update:model-value="aff.convidadosExternalFilter.value = ($event as 'all' | 'external' | 'internal')"
                />
              </div>
              <div class="flex items-center gap-2">
                <span class="text-xs" style="color: var(--vex-text-muted)">Nível:</span>
                <USelect
                  :model-value="aff.convidadosLevelFilter.value"
                  :items="aff.convidadosLevelOptions.value"
                  value-key="value"
                  size="sm"
                  class="w-44"
                  @update:model-value="aff.convidadosLevelFilter.value = ($event as 'all' | number)"
                />
              </div>
            </div>

            <AffiliatesInvitedList
              :users="aff.filteredInvitedUsers.value"
              :status-label="aff.statusLabel"
              :status-color="aff.statusColor"
              :format-date="aff.formatDate"
              :format-currency="aff.formatCurrency"
              :format-house-label="aff.formatHouseLabel"
              @approve="aff.openApprovalModal"
              @reject="aff.rejectUser"
            />
          </section>
        </template>

        <!-- ════════════════════════════════════════
             ADMIN VIEW
             ════════════════════════════════════════ -->
        <template v-else>
          <section class="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <h2 class="text-sm font-bold vex-title" style="color: var(--vex-text)">Gestão de Afiliados</h2>
              <p class="text-[11px] mt-0.5" style="color: var(--vex-text-faint)">
                Controle operacional de contas, status e comissionamento.
              </p>
            </div>
            <UButton label="Novo Usuário" icon="i-lucide-user-plus" color="primary" size="sm" @click="aff.openCreateUserModal" />
          </section>

          <!-- Admin KPIs (from backend via adminKpis computed) -->
          <section class="grid grid-cols-2 xl:grid-cols-4 gap-3 vex-stagger">
            <article class="vex-kpi-card">
              <span class="text-[11px] font-semibold uppercase tracking-wide" style="color: var(--vex-text-faint)">Usuários</span>
              <p class="vex-amount text-[1.5rem] leading-none mt-2" style="color: var(--vex-text)">{{ aff.adminKpis.value.total }}</p>
            </article>
            <article class="vex-kpi-card">
              <span class="text-[11px] font-semibold uppercase tracking-wide" style="color: var(--vex-text-faint)">Aprovados</span>
              <p class="vex-amount text-[1.5rem] leading-none mt-2" style="color: var(--vex-positive)">{{ aff.adminKpis.value.approved }}</p>
            </article>
            <article class="vex-kpi-card">
              <span class="text-[11px] font-semibold uppercase tracking-wide" style="color: var(--vex-text-faint)">Pendentes</span>
              <p class="vex-amount text-[1.5rem] leading-none mt-2" style="color: var(--vex-warning)">{{ aff.adminKpis.value.pending }}</p>
            </article>
            <article class="vex-kpi-card">
              <span class="text-[11px] font-semibold uppercase tracking-wide" style="color: var(--vex-text-faint)">Sem vínculo</span>
              <p class="vex-amount text-[1.5rem] leading-none mt-2" style="color: var(--vex-info)">{{ aff.adminKpis.value.noLink }}</p>
            </article>
          </section>

          <!-- Admin filters -->
          <section class="vex-card p-4">
            <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              <UInput v-model="aff.adminFilters.search" icon="i-lucide-search" placeholder="Buscar..." size="sm" class="xl:col-span-2" />
              <USelect v-model="aff.adminFilters.role" :items="[{ label: 'Todos os papéis', value: 'all' }, { label: 'Admin', value: 'admin' }, { label: 'Afiliado', value: 'affiliate' }]" size="sm" />
              <USelect v-model="aff.adminFilters.status" :items="[{ label: 'Todos os status', value: 'all' }, { label: 'Pendentes', value: 'pending' }, { label: 'Aprovados', value: 'approved' }, { label: 'Recusados', value: 'rejected' }]" size="sm" />
              <USelect v-model="aff.adminFilters.bettingHouseId" :items="[{ label: 'Todas as casas', value: 'all' }, ...aff.allHouseOptions.value]" size="sm" />
              <USelect v-model="aff.adminFilters.panel" :items="[{ label: 'Todos painéis', value: 'all' }, ...panelOptions]" size="sm" />
              <label class="flex items-center gap-2 rounded-lg px-3 py-1.5 text-[12px] cursor-pointer" style="border: 1px solid var(--vex-border-subtle); color: var(--vex-text-muted)">
                <input v-model="aff.adminFilters.noLink" type="checkbox" class="rounded" style="accent-color: var(--vex-brand)" />
                Sem vínculo
              </label>
            </div>
          </section>

          <!-- Admin table -->
          <section class="vex-card overflow-hidden">
            <!-- Loading state -->
            <div v-if="aff.adminLoading.value" class="flex items-center justify-center py-16">
              <UIcon name="i-lucide-loader-circle" class="animate-spin text-[24px]" style="color: var(--vex-brand)" />
            </div>

            <div v-else class="overflow-x-auto">
              <table class="min-w-[1080px] w-full text-[13px]">
                <thead>
                  <tr style="background: var(--vex-surface-strong); border-bottom: 1px solid var(--vex-border-subtle)">
                    <th class="px-4 py-2.5 text-left text-[10px] uppercase tracking-[0.1em] font-bold" style="color: var(--vex-text-faint)">Nome</th>
                    <th class="px-4 py-2.5 text-left text-[10px] uppercase tracking-[0.1em] font-bold" style="color: var(--vex-text-faint)">Email</th>
                    <th class="px-4 py-2.5 text-left text-[10px] uppercase tracking-[0.1em] font-bold" style="color: var(--vex-text-faint)">Papel</th>
                    <th class="px-4 py-2.5 text-left text-[10px] uppercase tracking-[0.1em] font-bold" style="color: var(--vex-text-faint)">Idade</th>
                    <th class="px-4 py-2.5 text-left text-[10px] uppercase tracking-[0.1em] font-bold" style="color: var(--vex-text-faint)">Vínculos</th>
                    <th class="px-4 py-2.5 text-left text-[10px] uppercase tracking-[0.1em] font-bold" style="color: var(--vex-text-faint)">CPA</th>
                    <th class="px-4 py-2.5 text-left text-[10px] uppercase tracking-[0.1em] font-bold" style="color: var(--vex-text-faint)">RevShare</th>
                    <th class="px-4 py-2.5 text-left text-[10px] uppercase tracking-[0.1em] font-bold" style="color: var(--vex-text-faint)">Status</th>
                    <th class="px-4 py-2.5 text-left text-[10px] uppercase tracking-[0.1em] font-bold" style="color: var(--vex-text-faint)">Criado em</th>
                    <th class="px-4 py-2.5 text-right text-[10px] uppercase tracking-[0.1em] font-bold" style="color: var(--vex-text-faint)">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-if="!aff.paginatedAdminUsers.value.length">
                    <td colspan="10" class="px-4 py-10 text-center text-[12px]" style="color: var(--vex-text-faint)">Nenhum usuário encontrado com os filtros atuais.</td>
                  </tr>

                  <tr
                    v-for="currentUser in aff.paginatedAdminUsers.value"
                    :key="currentUser.id"
                    class="transition-colors duration-100"
                    style="border-bottom: 1px solid var(--vex-border-subtle)"
                    @mouseenter="($event.currentTarget as HTMLElement).style.background = 'var(--vex-surface-strong)'"
                    @mouseleave="($event.currentTarget as HTMLElement).style.background = ''"
                  >
                    <td class="px-4 py-3 font-semibold" style="color: var(--vex-text)">{{ currentUser.name }}</td>
                    <td class="px-4 py-3" style="color: var(--vex-text-muted)">{{ currentUser.email }}</td>
                    <td class="px-4 py-3">
                      <UBadge :label="aff.roleLabel(currentUser.role)" :color="currentUser.role === 'admin' ? 'info' : 'primary'" variant="subtle" size="sm" />
                    </td>
                    <td class="px-4 py-3">
                      <UBadge
                        :label="currentUser.ageVerified ? 'Verificada' : 'Pendente'"
                        :color="currentUser.ageVerified ? 'success' : 'warning'"
                        variant="subtle"
                        size="sm"
                      />
                    </td>
                    <td class="px-4 py-3">
                      <div v-if="currentUser.memberships.length > 0" class="flex flex-wrap gap-1">
                        <span
                          v-for="m in currentUser.memberships"
                          :key="m.id"
                          class="text-[10px] px-1.5 py-0.5 rounded font-medium"
                          style="background: var(--vex-bg-muted); color: var(--vex-text-muted)"
                        >
                          <HouseBadge :slug="m.bettingHouse" size="xs" />
                        </span>
                      </div>
                      <span v-else style="color: var(--vex-text-faint)">—</span>
                    </td>
                    <td class="px-4 py-3">
                      <div v-if="currentUser.memberships.length" class="space-y-0.5">
                        <p v-for="m in currentUser.memberships" :key="`${currentUser.id}-${m.id}-cpa`" class="text-[11px] font-money" style="color: var(--vex-text-muted)">
                          <HouseBadge :slug="m.bettingHouse" size="xs" />: {{ m.commissionCpa ? aff.formatCurrency(m.commissionCpa) : '—' }}
                        </p>
                      </div>
                      <span v-else style="color: var(--vex-text-faint)">—</span>
                    </td>
                    <td class="px-4 py-3">
                      <div v-if="currentUser.memberships.length" class="space-y-0.5">
                        <p v-for="m in currentUser.memberships" :key="`${currentUser.id}-${m.id}-rev`" class="text-[11px] font-money" style="color: var(--vex-text-muted)">
                          <HouseBadge :slug="m.bettingHouse" size="xs" />: {{ m.commissionRevshare ? `${m.commissionRevshare}%` : '—' }}
                        </p>
                      </div>
                      <span v-else style="color: var(--vex-text-faint)">—</span>
                    </td>
                    <td class="px-4 py-3">
                      <UBadge
                        :label="aff.statusLabel(aff.getMembershipStatus(currentUser))"
                        :color="aff.statusColor(aff.getMembershipStatus(currentUser))"
                        variant="subtle" size="sm"
                      />
                    </td>
                    <td class="px-4 py-3" style="color: var(--vex-text-muted)">{{ aff.formatDate(currentUser.createdAt) }}</td>
                    <td class="px-4 py-3">
                      <div class="flex justify-end gap-1">
                        <UButton v-if="aff.getMembershipStatus(currentUser) === 'pending'" icon="i-lucide-check" color="success" variant="soft" size="xs" square @click="aff.openApprovalModal(currentUser.id)" />
                        <UButton v-if="aff.getMembershipStatus(currentUser) === 'pending'" icon="i-lucide-x" color="error" variant="soft" size="xs" square @click="aff.rejectUser(currentUser.id)" />
                        <UButton icon="i-lucide-pencil" color="neutral" variant="soft" size="xs" square @click="aff.openEditUserModal(currentUser)" />
                        <UButton icon="i-lucide-trash" color="error" variant="soft" size="xs" square @click="aff.confirmDeleteUser(currentUser)" />
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="vex-table-footer">
              <p class="text-[11px]" style="color: var(--vex-text-muted)">
                Mostrando
                <span class="font-bold" style="color: var(--vex-text)">{{ aff.paginatedAdminUsers.value.length }}</span>
                de
                <span class="font-bold" style="color: var(--vex-text)">{{ aff.total.value }}</span>
                usuários
              </p>
              <UPagination
                :page="aff.adminPage.value"
                :total="aff.total.value"
                :items-per-page="aff.adminPageSize"
                @update:page="aff.adminPage.value = $event"
              />
            </div>
          </section>
        </template>

      </div>
    </div>

    <!-- ════════════════════════════════════════
         MODALS
         ════════════════════════════════════════ -->

    <AffiliatesApprovalModal
      v-model:open="aff.approvalModalOpen.value"
      :target="aff.approvalTarget.value"
      :form="aff.approvalForm"
      :referrer-links="aff.referrerLinks.value"
      :loading-links="aff.loadingReferrerLinks.value"
      @submit="aff.submitApproval"
      @select-link="aff.selectReferrerLink"
    />

    <AffiliatesUserFormModal
      v-model:open="aff.userModalOpen.value"
      :mode="aff.userModalMode.value"
      :form="aff.userForm"
      :loading-profile="aff.userProfileLoading.value"
      @save="aff.saveUserFromModal"
    />

    <!-- Delete confirmation modal -->
    <UModal
      v-model:open="aff.deleteModalOpen.value"
      title="Confirmar exclusão"
      description="Esta ação remove o usuário da base mockada da página."
    >
      <template #body>
        <p class="text-[13px]" style="color: var(--vex-text-muted)">
          Deseja remover <strong style="color: var(--vex-text)">{{ aff.deleteTarget.value?.name }}</strong> da listagem?
        </p>
      </template>
      <template #footer>
        <div class="w-full flex justify-end gap-2">
          <UButton label="Cancelar" color="neutral" variant="ghost" @click="aff.deleteModalOpen.value = false" />
          <UButton label="Excluir" color="error" icon="i-lucide-trash-2" @click="aff.deleteUser" />
        </div>
      </template>
    </UModal>
  </div>
</template>
