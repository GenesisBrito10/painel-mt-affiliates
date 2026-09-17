# Dashboard Operational Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display general deposit and betting-volume metrics in all affiliate and admin dashboard cards and tables.

**Architecture:** Extend the shared dashboard metric contracts and Prisma aggregations with `volume`, while leaving Pinbet-only Net P&L and withdrawal metrics unchanged. Use the general summary for deposit and volume cards, and propagate volume through daily, per-campaign, per-house, and admin link-performance responses.

**Tech Stack:** NestJS, Prisma, TypeScript, Vitest, Nuxt 4, Vue 3

---

### Task 1: Add volume to backend dashboard aggregations

**Files:**
- Create: `src/modules/dashboard/infrastructure/persistence/dashboard.prisma-repository.spec.ts`
- Modify: `src/modules/dashboard/domain/types/dashboard.types.ts`
- Modify: `src/modules/dashboard/domain/ports/dashboard.repository.ts`
- Modify: `src/modules/dashboard/infrastructure/persistence/dashboard.prisma-repository.ts`

- [ ] **Step 1: Write failing repository tests**

Create a Vitest suite that instantiates `DashboardPrismaRepository` with a
mocked Prisma service and verifies:

```ts
expect(ZERO_METRICS.volume).toBe(0);
```

For `aggregateSummary`, return an aggregate containing:

```ts
_sum: {
  clicks: 1,
  registrations: 2,
  ftds: 3,
  qftd: 4,
  deposit: new Prisma.Decimal('99.97'),
  volume: new Prisma.Decimal('88.80'),
  revShare: new Prisma.Decimal(0),
  cpaValue: new Prisma.Decimal(60),
  cpaQualified: 4,
  totalCommission: new Prisma.Decimal(60),
}
```

and assert:

```ts
expect(result).toMatchObject({ deposit: 99.97, volume: 88.8 });
expect(prisma.affiliateData.aggregate).toHaveBeenCalledWith(
  expect.objectContaining({
    _sum: expect.objectContaining({ volume: true }),
  }),
);
```

For `aggregateDaily`, return a raw row with `volume: '88.8'` and assert the
mapped row contains `volume: 88.8`.

For `aggregateByCampaign` and `aggregateDailyPerHouse`, mock `groupBy` rows
whose `_sum.volume` is `new Prisma.Decimal('88.80')`; assert both mapped rows
contain `volume: 88.8` and both Prisma calls request `_sum.volume`.

- [ ] **Step 2: Run the repository suite and verify RED**

```bash
pnpm vitest run src/modules/dashboard/infrastructure/persistence/dashboard.prisma-repository.spec.ts
```

Expected: FAIL because `volume` is absent from zero metrics and all four
general aggregations.

- [ ] **Step 3: Extend the shared metric types**

Add `volume: number` to:

```ts
export interface AggregatedMetrics
export const ZERO_METRICS
export interface DailyMetrics
export interface CampaignMetrics
```

Add `volume: number` to the inline result type of
`IDashboardRepository.aggregateDailyPerHouse`.

- [ ] **Step 4: Extend all Prisma aggregations**

In `aggregateSummary`, `aggregateByCampaign`, and
`aggregateDailyPerHouse`, add:

```ts
_sum: {
  volume: true,
}
```

and map:

```ts
volume: toNum(result._sum.volume)
```

or the corresponding row value.

In `aggregateDaily`, add:

```ts
volume: string;
```

to `RawRow`, select:

```sql
SUM(volume)::text AS volume
```

and map:

```ts
volume: parseFloat(r.volume)
```

- [ ] **Step 5: Run the repository suite and verify GREEN**

```bash
pnpm vitest run src/modules/dashboard/infrastructure/persistence/dashboard.prisma-repository.spec.ts
```

Expected: all repository tests PASS.

### Task 2: Add volume to admin link performance

**Files:**
- Modify: `src/modules/user/infrastructure/user.controller.ts`
- Test: `src/modules/dashboard/infrastructure/persistence/dashboard.prisma-repository.spec.ts`

- [ ] **Step 1: Add a source-contract assertion**

In the repository spec, read `user.controller.ts` and assert that the admin link
aggregation requests and returns volume:

```ts
expect(userControllerSource).toContain('volume: true');
expect(userControllerSource).toContain(
  'volume: row?._sum.volume?.toNumber() ?? 0',
);
```

- [ ] **Step 2: Run the focused suite and verify RED**

```bash
pnpm vitest run src/modules/dashboard/infrastructure/persistence/dashboard.prisma-repository.spec.ts
```

Expected: FAIL because link performance does not yet aggregate volume.

- [ ] **Step 3: Extend link performance**

Add `volume: true` to the `_sum` selection in
`getLinksPerformanceForAffiliate`, then return:

```ts
volume: row?._sum.volume?.toNumber() ?? 0,
```

- [ ] **Step 4: Run backend focused tests**

```bash
pnpm vitest run \
  src/modules/dashboard/infrastructure/persistence/dashboard.prisma-repository.spec.ts \
  src/modules/dashboard/application/dashboard.service.spec.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit the backend change**

```bash
git add \
  src/modules/dashboard/domain/types/dashboard.types.ts \
  src/modules/dashboard/domain/ports/dashboard.repository.ts \
  src/modules/dashboard/infrastructure/persistence/dashboard.prisma-repository.ts \
  src/modules/dashboard/infrastructure/persistence/dashboard.prisma-repository.spec.ts \
  src/modules/user/infrastructure/user.controller.ts
git diff --cached --check
git commit -m "feat(dashboard): expose betting volume metrics"
```

### Task 3: Adapt the affiliate dashboard

**Files:**
- Create: `frontend/test/dashboard-operational-metrics.spec.ts`
- Modify: `frontend/app/types/dashboard.ts`
- Modify: `frontend/app/pages/index.vue`

- [ ] **Step 1: Write failing frontend contract tests**

Read `app/pages/index.vue` and assert:

```ts
expect(dashboard).toContain('value: formatCurrency(s.deposit)')
expect(dashboard).toContain('value: formatCurrency(s.volume)')
expect(dashboard).not.toContain(
  'value: formatCurrency(operationalKpis.value.depositTotal)',
)
expect(dashboard).toContain(
  "{ accessorKey: 'volume', header: 'Volume apostado' }",
)
```

Read `app/types/dashboard.ts` and assert both `DashboardSummary` and
`DailyDataPoint` contain `volume: number`.

Retain assertions that Net P&L and withdrawals still use
`operationalKpis.value`.

- [ ] **Step 2: Run the frontend contract suite and verify RED**

```bash
pnpm --dir ../frontend test -- dashboard-operational-metrics.spec.ts
```

Expected: FAIL because the general summary and daily types do not contain
volume, the cards use Pinbet metrics, and the daily table has no volume column.

- [ ] **Step 3: Extend frontend contracts and cards**

Add:

```ts
volume: number
```

to `DashboardSummary` and `DailyDataPoint`.

Change the deposit card to:

```ts
value: formatCurrency(s.deposit),
```

Change the volume card to:

```ts
value: formatCurrency(s.volume),
```

Keep Net P&L and withdrawals on `operationalKpis`.

- [ ] **Step 4: Add volume to the daily table**

Add:

```ts
{ accessorKey: 'volume', header: 'Volume apostado' },
```

after deposits in the daily table columns. Format `volume` with the existing
currency cell behavior used by `deposit`, adding an explicit slot only if the
table component does not already format currency columns generically.

- [ ] **Step 5: Run frontend tests and build**

```bash
pnpm --dir ../frontend test
pnpm --dir ../frontend build
```

Expected: all frontend tests PASS and Nuxt build exits with code 0.

### Task 4: Adapt the admin affiliate detail

**Files:**
- Modify: `frontend/test/dashboard-operational-metrics.spec.ts`
- Modify: `admin/app/pages/affiliates/[id].vue`

- [ ] **Step 1: Add failing admin contract assertions**

Read the admin affiliate page from the frontend contract suite and assert:

```ts
expect(adminAffiliate).toContain('volume: number')
expect(adminAffiliate).toContain('Volume apostado')
expect(adminAffiliate).toContain('money(summary?.volume || 0)')
expect(adminAffiliate).toContain('money(row.volume)')
expect(adminAffiliate).toContain('money(c.volume)')
```

- [ ] **Step 2: Run the contract suite and verify RED**

```bash
pnpm --dir ../frontend test -- dashboard-operational-metrics.spec.ts
```

Expected: FAIL because the admin types, card, and tables do not expose volume.

- [ ] **Step 3: Extend admin response types**

Add `volume: number` to:

```ts
interface Summary
interface CampaignRow
interface LinkPerformance
interface DailyPerHouseRow
```

Ensure the merged campaign row preserves the general campaign volume and can
fall back to link-performance volume:

```ts
volume: c.volume ?? lp?.volume ?? 0,
```

- [ ] **Step 4: Add the admin card and table columns**

Add a **Volume apostado** card next to the existing summary metrics:

```vue
<p class="text-xs text-muted">Volume apostado</p>
<p class="text-xl font-black mt-1">
  {{ money(summary?.volume || 0) }}
</p>
```

Add **Volume apostado** after deposit in both the daily-per-house and campaigns
tables, rendering:

```vue
{{ money(row.volume) }}
{{ money(c.volume) }}
```

Update empty-table `colspan` values to match the new number of columns.

- [ ] **Step 5: Run frontend contract tests and admin checks**

```bash
pnpm --dir ../frontend test -- dashboard-operational-metrics.spec.ts
pnpm --dir ../admin typecheck
pnpm --dir ../admin build
```

Expected: contract tests, admin typecheck, and admin build PASS.

- [ ] **Step 6: Commit frontend and admin changes**

```bash
git add \
  ../frontend/app/types/dashboard.ts \
  ../frontend/app/pages/index.vue \
  ../frontend/test/dashboard-operational-metrics.spec.ts \
  ../admin/app/pages/affiliates/[id].vue
git diff --cached --check
git commit -m "feat(dashboard): display deposits and betting volume"
```

### Task 5: Verify the complete change

**Files:**
- Verify all files changed in Tasks 1-4.

- [ ] **Step 1: Run backend verification**

```bash
pnpm vitest run \
  --exclude src/modules/affiliate-api/application/affiliate-api.service.spec.ts
pnpm tsc --noEmit
pnpm build
```

Expected: 55 backend test files and 485 or more tests PASS; typecheck and build
exit with code 0.

- [ ] **Step 2: Run frontend verification**

```bash
pnpm --dir ../frontend test
pnpm --dir ../frontend build
```

Expected: all frontend tests and Nuxt build PASS.

- [ ] **Step 3: Run admin verification**

```bash
pnpm --dir ../admin typecheck
pnpm --dir ../admin build
```

Expected: both commands exit with code 0.

- [ ] **Step 4: Run formatting and diff checks**

```bash
pnpm eslint \
  src/modules/dashboard/domain/types/dashboard.types.ts \
  src/modules/dashboard/domain/ports/dashboard.repository.ts \
  src/modules/dashboard/infrastructure/persistence/dashboard.prisma-repository.ts \
  src/modules/dashboard/infrastructure/persistence/dashboard.prisma-repository.spec.ts \
  src/modules/user/infrastructure/user.controller.ts
pnpm prettier --check \
  src/modules/dashboard/domain/types/dashboard.types.ts \
  src/modules/dashboard/domain/ports/dashboard.repository.ts \
  src/modules/dashboard/infrastructure/persistence/dashboard.prisma-repository.ts \
  src/modules/dashboard/infrastructure/persistence/dashboard.prisma-repository.spec.ts \
  src/modules/user/infrastructure/user.controller.ts
git diff --check
git status --short
git log -6 --oneline
```

Expected: lint, formatting, and diff checks pass; only pre-existing unrelated
files remain dirty or untracked.
