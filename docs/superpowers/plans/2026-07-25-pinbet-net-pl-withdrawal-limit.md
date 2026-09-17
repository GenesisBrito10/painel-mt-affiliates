# Pinbet Net P&L Withdrawal Limit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist Pinbet operational metrics and cap each Pinbet house's cumulative gross withdrawals at 80% of positive cumulative Net P&L while explaining the result in the affiliate dashboard and payments page.

**Architecture:** Extend the existing daily `affiliate_data` ledger with nullable Pinbet metrics, aggregate them through the existing dashboard access/cutover boundaries, and centralize the cap in a pure withdrawal-domain calculator consumed by `DashboardBalanceService`. Expose backend-calculated metric and limit contracts to Nuxt so the frontend only formats and explains values.

**Tech Stack:** NestJS 11, Prisma 7/PostgreSQL, Vitest, TypeScript 6, Nuxt 4/Vue 3, Nuxt UI, Decimal.js.

---

## Baseline and execution constraints

- Worktree: `/Users/user/.config/superpowers/worktrees/mjmcompany/pinbet-net-pl-limit`
- Branch: `feat/pinbet-net-pl-limit`
- Approved design:
  `docs/superpowers/specs/2026-07-25-pinbet-net-pl-withdrawal-limit-design.md`
- Frontend baseline: 6/6 tests pass.
- Backend baseline: 435/437 tests pass. The two pre-existing failures are:
  - `affiliate-api.service.spec.ts`: `this.prisma.user.update is not a function`;
  - `sync-orchestrator.service.spec.ts`: existing gap-fill test exceeds 5 seconds.
- Every task must run its targeted suite. Final verification must report the two
  baseline failures separately and must not attribute them to this feature.
- Do not use the production `.env` during implementation. Generate Prisma types
  with:

```bash
DATABASE_URL=postgresql://localhost:5432/worktree_types pnpm --dir backend-vexxa exec prisma generate
```

## File map

### Backend

- `backend-vexxa/prisma/schema.prisma`: nullable daily metrics and append-only
  history fields.
- `backend-vexxa/prisma/migrations/20260725190000_pinbet_operational_metrics/migration.sql`:
  additive database migration.
- `backend-vexxa/src/common/persistence/affiliate-data-change.helper.ts`:
  snapshot comparison and history payload.
- `backend-vexxa/src/modules/sync/domain/ports/provider-extractor.port.ts`:
  optional extracted provider metrics.
- `backend-vexxa/src/modules/sync/domain/ports/sync.repository.port.ts`:
  optional persisted provider metrics.
- `backend-vexxa/src/modules/sync/infrastructure/extractors/smartico.extractor.ts`:
  Smartico parsing and cent normalization.
- `backend-vexxa/src/modules/sync/infrastructure/extractors/smartico.extractor.spec.ts`:
  extractor regression tests.
- `backend-vexxa/src/modules/sync/application/sync-orchestrator.service.ts` and
  `.spec.ts`: pass optional values through without changing other providers.
- `backend-vexxa/src/modules/sync/infrastructure/persistence/sync.prisma-repository.ts`
  and `.spec.ts`: idempotent persistence and history.
- `backend-vexxa/src/modules/withdrawal/domain/pinbet-withdrawal-limit.ts` and
  `.spec.ts`: pure limit calculation.
- `backend-vexxa/src/modules/dashboard/domain/types/dashboard.types.ts`:
  per-house balance and Pinbet metrics types.
- `backend-vexxa/src/modules/dashboard/domain/ports/dashboard.repository.ts`:
  aggregation contracts.
- `backend-vexxa/src/modules/dashboard/infrastructure/persistence/dashboard.prisma-repository.ts`:
  completeness-aware Pinbet aggregation.
- `backend-vexxa/src/modules/dashboard/application/dto/dashboard.dto.ts`:
  balance and metric response contracts.
- `backend-vexxa/src/modules/dashboard/application/dashboard-balance.service.ts`
  and `.spec.ts`: own/network Net P&L, cutover, withdrawals, and global totals.
- `backend-vexxa/src/modules/dashboard/application/dashboard.service.ts` and
  `.spec.ts`: scoped metric endpoint behavior.
- `backend-vexxa/src/modules/dashboard/infrastructure/dashboard.controller.ts`:
  `GET /v1/dashboard/pinbet-metrics`.
- `backend-vexxa/src/modules/withdrawal/application/withdrawal.service.ts` and
  `.spec.ts`: use `withdrawable` and expose explanation fields.
- `backend-vexxa/scripts/verify-pinbet-operational-metrics.mjs`: dry-run
  post-sync verification.

### Frontend

- `frontend/app/types/dashboard.ts`: balance and Pinbet metric types.
- `frontend/app/composables/useDashboard.ts`: fetch Pinbet metrics with current
  date/house/scope filters.
- `frontend/app/components/dashboard/PinbetMetricsCards.vue`: final cards.
- `frontend/app/utils/pinbet-metrics.ts` and
  `frontend/test/pinbet-metrics.spec.ts`: presentation-state helpers.
- `frontend/app/pages/index.vue`: render cards and keep financial balance
  separate from withdrawable balance.
- `frontend/app/composables/useWithdrawals.ts`: extended rule contract.
- `frontend/app/components/payments/PinbetWithdrawalLimitCard.vue`: explanation
  card.
- `frontend/app/utils/pinbet-withdrawal-explanation.ts` and
  `frontend/test/pinbet-withdrawal-explanation.spec.ts`: deterministic
  user-facing messages.
- `frontend/app/pages/payments.vue`: place the explanation in each Pinbet house
  breakdown.

---

### Task 1: Add nullable Pinbet metric columns and audit snapshots

**Files:**

- Modify: `backend-vexxa/prisma/schema.prisma`
- Create: `backend-vexxa/prisma/migrations/20260725190000_pinbet_operational_metrics/migration.sql`
- Modify: `backend-vexxa/src/common/persistence/affiliate-data-change.helper.ts`
- Create: `backend-vexxa/src/common/persistence/affiliate-data-change.helper.spec.ts`

- [ ] **Step 1: Write failing change-history tests**

Add tests that use real `Prisma.Decimal` values:

```ts
import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  buildChangeLogData,
  isMaterialChange,
  type AffiliateDataValues,
} from './affiliate-data-change.helper.js';

const values = (overrides: Partial<AffiliateDataValues> = {}): AffiliateDataValues => ({
  clicks: 1,
  registrations: 1,
  ftds: 1,
  qftd: 1,
  deposit: new Prisma.Decimal(10),
  revShare: new Prisma.Decimal(2),
  cpaQualified: 1,
  cpaValue: new Prisma.Decimal(40),
  totalCommission: new Prisma.Decimal(42),
  netPl: new Prisma.Decimal('100.00'),
  withdrawalTotal: new Prisma.Decimal('30.00'),
  volume: new Prisma.Decimal('500.00'),
  ...overrides,
});

describe('affiliate data Pinbet change history', () => {
  it('treats a Net P&L change as material', () => {
    expect(
      isMaterialChange(values(), values({ netPl: new Prisma.Decimal('100.01') })),
    ).toBe(true);
  });

  it('writes previous and new Pinbet metrics to the change payload', () => {
    const data = buildChangeLogData({
      key: {
        campaignId: 'VALLEX0001',
        bettingHouse: 'pinbet-diario',
        campaignName: 'VALLEX0001',
        utmCampaign: 'Pinbet',
        date: new Date('2026-07-23T00:00:00.000Z'),
      },
      affiliateDataId: 'row-1',
      prev: values(),
      next: values({ netPl: new Prisma.Decimal('-68.26') }),
      source: 'smartico-api',
    });

    expect(data.prevNetPl?.toString()).toBe('100');
    expect(data.newNetPl?.toString()).toBe('-68.26');
    expect(data.newWithdrawalTotal?.toString()).toBe('30');
    expect(data.newVolume?.toString()).toBe('500');
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
pnpm --dir backend-vexxa test src/common/persistence/affiliate-data-change.helper.spec.ts
```

Expected: TypeScript/test failure because the three fields do not exist.

- [ ] **Step 3: Add schema and migration**

Add to `AffiliateData`:

```prisma
netPl           Decimal? @db.Decimal(14, 2)
withdrawalTotal Decimal? @db.Decimal(14, 2)
volume          Decimal? @db.Decimal(14, 2)
```

Add nullable previous/new fields to `AffiliateDataChangeLog`:

```prisma
prevNetPl           Decimal? @db.Decimal(14, 2)
prevWithdrawalTotal Decimal? @db.Decimal(14, 2)
prevVolume          Decimal? @db.Decimal(14, 2)
newNetPl            Decimal? @db.Decimal(14, 2)
newWithdrawalTotal  Decimal? @db.Decimal(14, 2)
newVolume           Decimal? @db.Decimal(14, 2)
```

Create the migration:

```sql
ALTER TABLE "affiliate_data"
  ADD COLUMN "netPl" DECIMAL(14,2),
  ADD COLUMN "withdrawalTotal" DECIMAL(14,2),
  ADD COLUMN "volume" DECIMAL(14,2);

ALTER TABLE "affiliate_data_change_logs"
  ADD COLUMN "prevNetPl" DECIMAL(14,2),
  ADD COLUMN "prevWithdrawalTotal" DECIMAL(14,2),
  ADD COLUMN "prevVolume" DECIMAL(14,2),
  ADD COLUMN "newNetPl" DECIMAL(14,2),
  ADD COLUMN "newWithdrawalTotal" DECIMAL(14,2),
  ADD COLUMN "newVolume" DECIMAL(14,2);
```

- [ ] **Step 4: Extend the change helper**

Add nullable fields to `AffiliateDataValues`:

```ts
netPl: Prisma.Decimal | number | null;
withdrawalTotal: Prisma.Decimal | number | null;
volume: Prisma.Decimal | number | null;
```

Add nullable comparison helpers:

```ts
const nullableNumber = (
  value: Prisma.Decimal | number | null,
): number | null => value == null ? null : toNumber(value);

const nullableDecimal = (
  value: Prisma.Decimal | number | null,
): Prisma.Decimal | null => value == null ? null : toDecimal(value);
```

Include all three in `isMaterialChange` and emit:

```ts
prevNetPl: prev ? nullableDecimal(prev.netPl) : null,
prevWithdrawalTotal: prev ? nullableDecimal(prev.withdrawalTotal) : null,
prevVolume: prev ? nullableDecimal(prev.volume) : null,
newNetPl: nullableDecimal(next.netPl),
newWithdrawalTotal: nullableDecimal(next.withdrawalTotal),
newVolume: nullableDecimal(next.volume),
```

- [ ] **Step 5: Generate Prisma Client and verify GREEN**

Run:

```bash
DATABASE_URL=postgresql://localhost:5432/worktree_types pnpm --dir backend-vexxa exec prisma generate
DATABASE_URL=postgresql://localhost:5432/worktree_types pnpm --dir backend-vexxa exec prisma validate
pnpm --dir backend-vexxa test src/common/persistence/affiliate-data-change.helper.spec.ts
```

Expected: Prisma validation passes and both tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend-vexxa/prisma backend-vexxa/src/common/persistence
git commit -m "feat(pinbet): persist operational metric columns"
```

---

### Task 2: Extract, normalize, and upsert Smartico metrics

**Files:**

- Modify: `backend-vexxa/src/modules/sync/domain/ports/provider-extractor.port.ts`
- Modify: `backend-vexxa/src/modules/sync/domain/ports/sync.repository.port.ts`
- Modify: `backend-vexxa/src/modules/sync/infrastructure/extractors/smartico.extractor.ts`
- Create: `backend-vexxa/src/modules/sync/infrastructure/extractors/smartico.extractor.spec.ts`
- Modify: `backend-vexxa/src/modules/sync/application/sync-orchestrator.service.ts`
- Modify: `backend-vexxa/src/modules/sync/application/sync-orchestrator.service.spec.ts`
- Modify: `backend-vexxa/src/modules/sync/infrastructure/persistence/sync.prisma-repository.ts`
- Create: `backend-vexxa/src/modules/sync/infrastructure/persistence/sync.prisma-repository.spec.ts`

- [ ] **Step 1: Write failing Smartico extractor tests**

Stub `fetch` with the approved sample and assert exact values:

```ts
it('maps and rounds Pinbet operational metrics to cents', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      data: [{
        dt: '2026-07-23T00:00:00.000Z',
        afp1: 'VALLEX0001',
        visit_count: 377,
        registration_count: 97,
        qftd_count: 74,
        ftd_count: 77,
        deposit_total: 3122.029998779297,
        net_pl: -68.25999727100134,
        withdrawal_total: 3125.9999923706055,
        volume: 7776.850036621094,
        commissions_rev_share: -6.8259995291009545,
      }],
    }),
  }));

  const extractor = new SmarticoExtractor({
    get: vi.fn().mockReturnValue(''),
  } as any);
  const [report] = await extractor.fetchReports(
    'token',
    '2026-07-23',
    'afp1',
  );

  expect(report).toMatchObject({
    campaignId: 'VALLEX0001',
    deposit: 3122.03,
    netPl: -68.26,
    withdrawalTotal: 3126,
    volume: 7776.85,
  });
});
```

Add cases for `afp2`, legitimate zero, and missing/non-finite values returning
`null`.

- [ ] **Step 2: Run extractor test and verify RED**

```bash
pnpm --dir backend-vexxa test src/modules/sync/infrastructure/extractors/smartico.extractor.spec.ts
```

Expected: missing report fields.

- [ ] **Step 3: Implement cent normalization in the extractor**

Add optional report fields:

```ts
netPl?: number | null;
withdrawalTotal?: number | null;
volume?: number | null;
```

Use one helper:

```ts
function moneyOrNull(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
```

Map:

```ts
deposit: moneyOrNull(r.deposit_total) ?? 0,
netPl: moneyOrNull(r.net_pl),
withdrawalTotal: moneyOrNull(r.withdrawal_total),
volume: moneyOrNull(r.volume),
```

Log one warning per malformed field with campaign/date/group dimension, never
the access token.

- [ ] **Step 4: Write failing orchestrator pass-through test**

Extend the first `runSync` test report with:

```ts
netPl: -68.26,
withdrawalTotal: 3126,
volume: 7776.85,
```

Assert the row sent to `upsertBatch`:

```ts
expect(repo.upsertBatch).toHaveBeenCalledWith(
  [expect.objectContaining({
    bettingHouse: 'pinbet-diario',
    netPl: -68.26,
    withdrawalTotal: 3126,
    volume: 7776.85,
  })],
  'log-id-123',
);
```

Use `houseSlug: 'pinbet-diario'`.

- [ ] **Step 5: Run orchestrator test and verify RED**

```bash
pnpm --dir backend-vexxa test src/modules/sync/application/sync-orchestrator.service.spec.ts -t "creates sync log"
```

Expected: optional fields absent from the upsert input.

- [ ] **Step 6: Pass fields through the orchestrator**

Add to `UpsertAffiliateDataInput`:

```ts
netPl?: number | null;
withdrawalTotal?: number | null;
volume?: number | null;
```

Map without synthesizing values:

```ts
netPl: r.netPl,
withdrawalTotal: r.withdrawalTotal,
volume: r.volume,
```

- [ ] **Step 7: Write failing repository upsert tests**

Mock `affiliateData.findUnique`, `affiliateData.upsert`, and
`affiliateDataChangeLog.create`. Assert both create/update payloads contain:

```ts
netPl: -68.26,
withdrawalTotal: 3126,
volume: 7776.85,
```

Add a non-Pinbet row with the optional properties omitted and assert all three
are persisted as `null`, not zero.

- [ ] **Step 8: Implement persistence and history snapshots**

Select the new fields in `prevRow`, set them in both Prisma `update` and
`create`, and set:

```ts
netPl: row.netPl ?? null,
withdrawalTotal: row.withdrawalTotal ?? null,
volume: row.volume ?? null,
```

Include the same values in `next: AffiliateDataValues`.

- [ ] **Step 9: Run targeted sync tests and verify GREEN**

```bash
pnpm --dir backend-vexxa test \
  src/modules/sync/infrastructure/extractors/smartico.extractor.spec.ts \
  src/modules/sync/application/sync-orchestrator.service.spec.ts \
  src/modules/sync/infrastructure/persistence/sync.prisma-repository.spec.ts
```

Expected: all new tests pass. If the pre-existing gap-fill timeout appears when
running the whole orchestrator file, rerun the feature-specific test by name and
record the timeout separately.

- [ ] **Step 10: Commit**

```bash
git add backend-vexxa/src/modules/sync
git commit -m "feat(pinbet): sync Smartico operational metrics"
```

---

### Task 3: Implement the pure Pinbet withdrawal-limit domain rule

**Files:**

- Create: `backend-vexxa/src/modules/withdrawal/domain/pinbet-withdrawal-limit.ts`
- Create: `backend-vexxa/src/modules/withdrawal/domain/pinbet-withdrawal-limit.spec.ts`

- [ ] **Step 1: Write the full failing domain matrix**

Use table-driven tests:

```ts
it.each([
  {
    name: 'caps R$1000 balance at 80% of R$100 Net P&L',
    input: { house: 'pinbet-diario', balance: 1000, netPl: 100, consumed: 0 },
    expected: { withdrawalLimit: 80, withdrawable: 80, restriction: 'PINBET_NET_PL_LIMIT' },
  },
  {
    name: 'blocks negative Net P&L',
    input: { house: 'pinbet-mensal', balance: 1000, netPl: -68.26, consumed: 0 },
    expected: { withdrawalLimit: 0, withdrawable: 0, restriction: 'PINBET_NET_PL_NON_POSITIVE' },
  },
  {
    name: 'blocks unsynced metrics distinctly from zero',
    input: { house: 'pinbet-diario', balance: 1000, netPl: null, consumed: 0 },
    expected: { withdrawalLimit: null, withdrawable: 0, restriction: 'PINBET_METRICS_PENDING' },
  },
  {
    name: 'subtracts prior withdrawals from the cumulative cap',
    input: { house: 'pinbet-diario', balance: 920, netPl: 100, consumed: 80 },
    expected: { withdrawalLimit: 80, withdrawable: 0, restriction: 'PINBET_NET_PL_LIMIT' },
  },
  {
    name: 'uses balance when balance is lower than the remaining cap',
    input: { house: 'pinbet-diario', balance: 30, netPl: 100, consumed: 0 },
    expected: { withdrawalLimit: 80, withdrawable: 30, restriction: null },
  },
  {
    name: 'floors the limit so it never exceeds 80%',
    input: { house: 'pinbet-diario', balance: 1000, netPl: 100.01, consumed: 0 },
    expected: { withdrawalLimit: 80, withdrawable: 80, restriction: 'PINBET_NET_PL_LIMIT' },
  },
  {
    name: 'leaves non-Pinbet behavior unchanged',
    input: { house: 'superbet', balance: 125.55, netPl: null, consumed: 0 },
    expected: { withdrawalLimit: null, withdrawable: 125.55, restriction: null },
  },
])('$name', ({ input, expected }) => {
  expect(calculatePinbetWithdrawalLimit(input)).toEqual(
    expect.objectContaining(expected),
  );
});
```

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --dir backend-vexxa test src/modules/withdrawal/domain/pinbet-withdrawal-limit.spec.ts
```

Expected: module not found.

- [ ] **Step 3: Implement with Decimal.js**

```ts
import Decimal from 'decimal.js';

export const PINBET_HOUSES = ['pinbet-diario', 'pinbet-mensal'] as const;
export type PinbetHouse = (typeof PINBET_HOUSES)[number];
export type WithdrawalRestriction =
  | 'PINBET_METRICS_PENDING'
  | 'PINBET_NET_PL_NON_POSITIVE'
  | 'PINBET_NET_PL_LIMIT'
  | null;

export function isPinbetHouse(house: string): house is PinbetHouse {
  return PINBET_HOUSES.includes(house as PinbetHouse);
}

export function calculatePinbetWithdrawalLimit(input: {
  house: string;
  balance: number;
  netPl: number | null;
  consumed: number;
}) {
  const balance = Decimal.max(0, input.balance);
  if (!isPinbetHouse(input.house)) {
    return {
      netPl: null,
      withdrawalLimit: null,
      withdrawnFromLimit: 0,
      withdrawable: balance.toDecimalPlaces(2).toNumber(),
      restriction: null satisfies WithdrawalRestriction,
    };
  }
  if (input.netPl == null) {
    return {
      netPl: null,
      withdrawalLimit: null,
      withdrawnFromLimit: Math.max(0, input.consumed),
      withdrawable: 0,
      restriction: 'PINBET_METRICS_PENDING' as const,
    };
  }

  const netPl = new Decimal(input.netPl);
  const totalLimit = Decimal.max(0, netPl)
    .mul('0.80')
    .toDecimalPlaces(2, Decimal.ROUND_DOWN);
  const consumed = Decimal.max(0, input.consumed);
  const remaining = Decimal.max(0, totalLimit.minus(consumed));
  const withdrawable = Decimal.min(balance, remaining).toDecimalPlaces(2);
  const restriction: WithdrawalRestriction =
    netPl.lte(0)
      ? 'PINBET_NET_PL_NON_POSITIVE'
      : withdrawable.lt(balance)
        ? 'PINBET_NET_PL_LIMIT'
        : null;

  return {
    netPl: netPl.toDecimalPlaces(2).toNumber(),
    withdrawalLimit: totalLimit.toNumber(),
    withdrawnFromLimit: consumed.toDecimalPlaces(2).toNumber(),
    withdrawable: withdrawable.toNumber(),
    restriction,
  };
}
```

- [ ] **Step 4: Run and verify GREEN**

```bash
pnpm --dir backend-vexxa test src/modules/withdrawal/domain/pinbet-withdrawal-limit.spec.ts
```

Expected: full matrix passes.

- [ ] **Step 5: Commit**

```bash
git add backend-vexxa/src/modules/withdrawal/domain
git commit -m "feat(pinbet): add Net P&L withdrawal limit rule"
```

---

### Task 4: Integrate Net P&L into the balance source of truth

**Files:**

- Modify: `backend-vexxa/src/modules/dashboard/domain/types/dashboard.types.ts`
- Modify: `backend-vexxa/src/modules/dashboard/domain/ports/dashboard.repository.ts`
- Modify: `backend-vexxa/src/modules/dashboard/infrastructure/persistence/dashboard.prisma-repository.ts`
- Modify: `backend-vexxa/src/modules/dashboard/application/dto/dashboard.dto.ts`
- Modify: `backend-vexxa/src/modules/dashboard/application/dashboard-balance.service.ts`
- Modify: `backend-vexxa/src/modules/dashboard/application/dashboard-balance.service.spec.ts`

- [ ] **Step 1: Extend the repository test fixture and write failing balance tests**

Extend `CampaignHouseMetrics` with:

```ts
netPl: number | null;
pinbetMetricsComplete: boolean;
```

Add tests for:

1. own Pinbet Net P&L;
2. own + network sum;
3. incomplete metrics;
4. prior active/completed withdrawals;
5. failed/rejected exclusion (already excluded by the query);
6. refund restoration;
7. independent Diário/Mensal values;
8. global `withdrawableTotal`;
9. unchanged non-Pinbet behavior.

Representative assertion:

```ts
expect(result.perHouse).toContainEqual(
  expect.objectContaining({
    house: 'pinbet-diario',
    total: 1000,
    netPl: 100,
    withdrawalLimit: 80,
    withdrawnFromLimit: 0,
    withdrawable: 80,
    withdrawalRestriction: 'PINBET_NET_PL_LIMIT',
  }),
);
expect(result.withdrawableTotal).toBe(80);
```

For prior R$80:

```ts
prisma.withdrawalRequest.findMany.mockResolvedValue([{
  originalAmount: decimal(80),
  gatewayRefundedAmount: null,
  bettingHouse: 'pinbet-diario',
  status: 'COMPLETED',
  createdAt: new Date('2026-07-24T00:00:00.000Z'),
}]);
expect(house.withdrawnFromLimit).toBe(80);
expect(house.withdrawable).toBe(0);
```

- [ ] **Step 2: Run the balance tests and verify RED**

```bash
pnpm --dir backend-vexxa test src/modules/dashboard/application/dashboard-balance.service.spec.ts
```

Expected: new per-house fields and cap are absent.

- [ ] **Step 3: Make repository aggregation completeness-aware**

In `aggregatePerCampaignHouse`, request:

```ts
_sum: {
  cpaQualified: true,
  revShare: true,
  deposit: true,
  netPl: true,
},
_count: {
  _all: true,
  netPl: true,
},
```

Return:

```ts
netPl:
  r._count._all > 0 && r._count.netPl === r._count._all
    ? toNum(r._sum.netPl)
    : null,
pinbetMetricsComplete:
  r._count._all > 0 && r._count.netPl === r._count._all,
```

The completeness flag prevents a partially backfilled campaign from unlocking
withdrawals.

- [ ] **Step 4: Extend per-house balance types**

Add to `PerHouseBalance`:

```ts
netPl: number | null;
withdrawalLimit: number | null;
withdrawnFromLimit: number;
withdrawable: number;
withdrawalRestriction: WithdrawalRestriction;
```

Initialize non-Pinbet houses with `netPl: null`, `withdrawalLimit: null`,
`withdrawnFromLimit: 0`, `withdrawable: 0`, and `withdrawalRestriction: null`.

- [ ] **Step 5: Accumulate own and network Net P&L without applying CPA rates**

Maintain an internal completeness map:

```ts
const pinbetMetricsComplete = new Map<string, boolean>();
const addNetPl = (
  house: string,
  value: number | null,
  complete: boolean,
) => {
  if (!isPinbetHouse(house)) return;
  const h = getOrCreateHouse(house);
  h.netPl = (h.netPl ?? 0) + (value ?? 0);
  pinbetMetricsComplete.set(
    house,
    (pinbetMetricsComplete.get(house) ?? true) && complete && value != null,
  );
};
```

Call it for own rows and every eligible network row. Net P&L is raw operational
performance and is not multiplied by CPA or RevShare rates.

Build expected campaign keys from every active Pinbet link before aggregation:

```ts
const expectedPinbetKeys = new Set(
  [
    ...dbUser.affiliateLinks,
    ...networkMembers.flatMap((member) => member.links),
  ]
    .filter((link) => isPinbetHouse(link.bettingHouse))
    .map((link) => `${link.bettingHouse}__${link.campaignId}`),
);
const observedPinbetKeys = new Set<string>();
```

Add an observed key for every returned Pinbet aggregation row. After own and
network aggregation, mark a house incomplete if any expected campaign key for
that house is absent. This makes “no provider row for an active Pinbet link”
behave as pending metrics instead of a legitimate zero.

- [ ] **Step 6: Reuse effective withdrawals for both ledger and cap**

While iterating active/completed withdrawals, accumulate:

```ts
const withdrawnByHouse = new Map<string, number>();
withdrawnByHouse.set(
  w.bettingHouse,
  (withdrawnByHouse.get(w.bettingHouse) ?? 0) + amt,
);
```

The existing cutover check and refund-adjusted `amt` remain the source of truth.

- [ ] **Step 7: Apply the pure limit after every house total is final**

```ts
for (const h of Object.values(perHouse)) {
  const complete = pinbetMetricsComplete.get(h.house) ?? !isPinbetHouse(h.house);
  const limited = calculatePinbetWithdrawalLimit({
    house: h.house,
    balance: h.total,
    netPl: complete ? h.netPl : null,
    consumed: withdrawnByHouse.get(h.house) ?? 0,
  });
  const { restriction, ...values } = limited;
  Object.assign(h, values, {
    withdrawalRestriction: restriction,
  });
}
```

Calculate:

```ts
const houseWithdrawable = Object.values(perHouse)
  .filter((h) => h.house !== 'bonus')
  .reduce((sum, h) => sum + h.withdrawable, 0);
```

- [ ] **Step 8: Run targeted balance/domain tests and verify GREEN**

```bash
pnpm --dir backend-vexxa test \
  src/modules/withdrawal/domain/pinbet-withdrawal-limit.spec.ts \
  src/modules/dashboard/application/dashboard-balance.service.spec.ts
```

Expected: all targeted tests pass.

- [ ] **Step 9: Commit**

```bash
git add backend-vexxa/src/modules/dashboard backend-vexxa/src/modules/withdrawal/domain
git commit -m "feat(pinbet): cap house withdrawals by cumulative Net P&L"
```

---

### Task 5: Make withdrawal creation and rules consume the capped amount

**Files:**

- Modify: `backend-vexxa/src/modules/withdrawal/application/withdrawal.service.ts`
- Modify: `backend-vexxa/src/modules/withdrawal/application/withdrawal.service.spec.ts`

- [ ] **Step 1: Write failing internal and external creation tests**

Mock `balanceService.getBalance` with:

```ts
{
  minWithdrawalAmount: 50,
  depositInfo: {
    exemptByNetworkHead: true,
    belowMinimum: false,
  },
  perHouse: [{
    house: 'pinbet-diario',
    total: 1000,
    netPl: 100,
    withdrawalLimit: 80,
    withdrawnFromLimit: 0,
    withdrawable: 80,
    withdrawalRestriction: 'PINBET_NET_PL_LIMIT',
  }],
}
```

Assert the created request uses:

```ts
expect(tx.withdrawalRequest.create).toHaveBeenCalledWith(
  expect.objectContaining({
    data: expect.objectContaining({
      originalAmount: 80,
      withdrawalFee: 4.8,
      amount: 75.2,
      bettingHouse: 'pinbet-diario',
    }),
  }),
);
```

Add a metrics-pending test that expects an explicit
`BadRequestException` message instead of a generic minimum-balance message.

For `createForExternal`, assert `originalAmount: 80` and `amount: 80` because
that path intentionally has no fee.

- [ ] **Step 2: Run creation tests and verify RED**

```bash
pnpm --dir backend-vexxa test \
  src/modules/withdrawal/application/withdrawal.service.spec.ts \
  -t "Pinbet Net P&L"
```

Expected: current code reads `houseBal.total` and creates R$1,000.

- [ ] **Step 3: Return `withdrawable` from the shared helper**

Change:

```ts
return Math.max(0, houseBal?.total ?? 0);
```

to:

```ts
return Math.max(0, houseBal?.withdrawable ?? houseBal?.total ?? 0);
```

The fallback protects compatibility with older mocked/non-Pinbet DTOs during
the transition.

- [ ] **Step 4: Produce explicit Pinbet block messages**

Before the generic minimum check, inspect the selected per-house balance:

```ts
const selectedHouseBalance = balanceData.perHouse.find(
  (house) => house.house === dto.bettingHouse,
);

if (
  selectedHouseBalance?.withdrawalRestriction === 'PINBET_METRICS_PENDING'
) {
  throw new BadRequestException(
    'As métricas operacionais da Pinbet ainda estão sendo sincronizadas. O saque ficará disponível após a atualização.',
  );
}
if (
  selectedHouseBalance?.withdrawalRestriction ===
    'PINBET_NET_PL_NON_POSITIVE'
) {
  throw new BadRequestException(
    `O Net P&L da Pinbet está em R$${(selectedHouseBalance.netPl ?? 0).toFixed(2)}. Enquanto o acumulado não ficar positivo, não há saldo liberado para saque nesta casa.`,
  );
}
```

- [ ] **Step 5: Write failing withdrawal-rules contract test**

Assert the Pinbet item contains:

```ts
expect(result).toContainEqual(expect.objectContaining({
  slug: 'pinbet-diario',
  balance: 1000,
  availableBalance: 80,
  netPl: 100,
  netPlLimit: 80,
  withdrawnFromNetPlLimit: 0,
  withdrawalRestriction: 'PINBET_NET_PL_LIMIT',
}));
```

- [ ] **Step 6: Map backend-calculated explanation fields**

Replace `earningsBySlug: Map<string, number>` with a map of the full
`PerHouseBalance`. Map:

```ts
balance: parseFloat(Math.max(0, houseBalance?.total ?? 0).toFixed(2)),
availableBalance: parseFloat(
  Math.max(0, houseBalance?.withdrawable ?? houseBalance?.total ?? 0).toFixed(2),
),
netPl: houseBalance?.netPl ?? null,
netPlLimit: houseBalance?.withdrawalLimit ?? null,
withdrawnFromNetPlLimit: houseBalance?.withdrawnFromLimit ?? 0,
withdrawalRestriction: houseBalance?.withdrawalRestriction ?? null,
```

Bonus gets `balance === availableBalance` and null Pinbet fields.

- [ ] **Step 7: Run targeted withdrawal tests and verify GREEN**

```bash
pnpm --dir backend-vexxa test \
  src/modules/withdrawal/application/withdrawal.service.spec.ts \
  -t "Pinbet Net P&L|withdrawal rules|external"
```

Expected: new Pinbet tests pass and existing external/rules tests remain green.

- [ ] **Step 8: Commit**

```bash
git add backend-vexxa/src/modules/withdrawal/application
git commit -m "feat(pinbet): enforce capped amount in withdrawal flows"
```

---

### Task 6: Add the scoped Pinbet metrics API

**Files:**

- Modify: `backend-vexxa/src/modules/dashboard/domain/types/dashboard.types.ts`
- Modify: `backend-vexxa/src/modules/dashboard/domain/ports/dashboard.repository.ts`
- Modify: `backend-vexxa/src/modules/dashboard/infrastructure/persistence/dashboard.prisma-repository.ts`
- Modify: `backend-vexxa/src/modules/dashboard/application/dto/dashboard.dto.ts`
- Modify: `backend-vexxa/src/modules/dashboard/application/dashboard.service.ts`
- Modify: `backend-vexxa/src/modules/dashboard/application/dashboard.service.spec.ts`
- Modify: `backend-vexxa/src/modules/dashboard/infrastructure/dashboard.controller.ts`

- [ ] **Step 1: Define the response type and write failing service tests**

Use:

```ts
export interface PinbetMetricsItem {
  house: 'pinbet-diario' | 'pinbet-mensal';
  name: 'Pinbet Diário' | 'Pinbet Mensal';
  netPl: number | null;
  depositTotal: number;
  withdrawalTotal: number | null;
  volume: number | null;
  health: 'POSITIVE' | 'NON_POSITIVE' | 'NO_DATA';
}
```

Test:

- no house filter returns separate Diário and Mensal rows;
- a Pinbet filter returns one row;
- another house returns `{ houses: [] }` without querying the repository;
- `scope` uses `DashboardAccessService`;
- partial/null data returns `NO_DATA`.

Representative test:

```ts
repo.aggregatePinbetMetrics.mockResolvedValue([
  {
    house: 'pinbet-diario',
    netPl: -68.26,
    depositTotal: 3122.03,
    withdrawalTotal: 3126,
    volume: 7776.85,
    complete: true,
  },
]);

expect(await svc.getPinbetMetrics(JWT, {
  startDate: '2026-07-23',
  endDate: '2026-07-23',
  scope: 'all',
} as any)).toEqual({
  houses: [expect.objectContaining({
    house: 'pinbet-diario',
    netPl: -68.26,
    health: 'NON_POSITIVE',
  })],
});
```

- [ ] **Step 2: Run service tests and verify RED**

```bash
pnpm --dir backend-vexxa test src/modules/dashboard/application/dashboard.service.spec.ts -t "Pinbet metrics"
```

Expected: method/repository contract absent.

- [ ] **Step 3: Add a completeness-aware repository method**

Add:

```ts
aggregatePinbetMetrics(filters: DashboardFilters): Promise<Array<{
  house: 'pinbet-diario' | 'pinbet-mensal';
  netPl: number | null;
  depositTotal: number;
  withdrawalTotal: number | null;
  volume: number | null;
  complete: boolean;
}>>;
```

Use Prisma groupBy with:

```ts
by: ['bettingHouse'],
where: {
  ...buildWhere(filters),
  bettingHouse: {
    in: requestedPinbetHouses,
  },
},
_sum: {
  netPl: true,
  deposit: true,
  withdrawalTotal: true,
  volume: true,
},
_count: {
  _all: true,
  netPl: true,
  withdrawalTotal: true,
  volume: true,
},
```

Set `complete` only when every row has every new Pinbet metric. Preserve the
existing `deposit` value as `depositTotal`.

- [ ] **Step 4: Implement service and controller**

Service:

```ts
async getPinbetMetrics(user: JwtPayload, query: DashboardQueryDto) {
  if (
    query.bettingHouse &&
    !isPinbetHouse(query.bettingHouse)
  ) return { houses: [] };

  const filters = await this.buildFilters(user, query);
  if (!filters) return { houses: [] };
  const rows = await this.repo.aggregatePinbetMetrics(filters);
  return {
    houses: rows.map((row) => ({
      house: row.house,
      name:
        row.house === 'pinbet-diario' ? 'Pinbet Diário' : 'Pinbet Mensal',
      netPl: row.complete ? row.netPl : null,
      depositTotal: row.depositTotal,
      withdrawalTotal: row.complete ? row.withdrawalTotal : null,
      volume: row.complete ? row.volume : null,
      health: !row.complete
        ? 'NO_DATA'
        : (row.netPl ?? 0) > 0
          ? 'POSITIVE'
          : 'NON_POSITIVE',
    })),
  };
}
```

Controller:

```ts
@Get('pinbet-metrics')
getPinbetMetrics(
  @CurrentUser() user: JwtPayload,
  @Query() query: DashboardQueryDto,
) {
  return this.dashboardService.getPinbetMetrics(user, query);
}
```

- [ ] **Step 5: Run dashboard service tests and verify GREEN**

```bash
pnpm --dir backend-vexxa test \
  src/modules/dashboard/application/dashboard.service.spec.ts \
  src/modules/dashboard/application/dashboard-balance.service.spec.ts
```

Expected: all targeted tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend-vexxa/src/modules/dashboard
git commit -m "feat(pinbet): expose scoped operational metrics"
```

---

### Task 7: Render Pinbet health cards in the dashboard

**Required skill before editing UI:** `frontend-design`

**Files:**

- Modify: `frontend/app/types/dashboard.ts`
- Modify: `frontend/app/composables/useDashboard.ts`
- Create: `frontend/app/utils/pinbet-metrics.ts`
- Create: `frontend/test/pinbet-metrics.spec.ts`
- Create: `frontend/app/components/dashboard/PinbetMetricsCards.vue`
- Modify: `frontend/app/pages/index.vue`

- [ ] **Step 1: Write failing presentation helper tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  pinbetMetricTone,
  shouldShowPinbetMetrics,
} from '../app/utils/pinbet-metrics';

describe('Pinbet metric presentation', () => {
  it('marks positive and non-positive Net P&L correctly', () => {
    expect(pinbetMetricTone({ netPl: 100, health: 'POSITIVE' })).toBe('positive');
    expect(pinbetMetricTone({ netPl: -68.26, health: 'NON_POSITIVE' })).toBe('negative');
    expect(pinbetMetricTone({ netPl: null, health: 'NO_DATA' })).toBe('neutral');
  });

  it('shows metrics for all or a Pinbet filter only', () => {
    expect(shouldShowPinbetMetrics(undefined)).toBe(true);
    expect(shouldShowPinbetMetrics('pinbet-diario')).toBe(true);
    expect(shouldShowPinbetMetrics('superbet')).toBe(false);
  });
});
```

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --dir frontend test test/pinbet-metrics.spec.ts
```

Expected: utility module absent.

- [ ] **Step 3: Add frontend contracts and helper**

```ts
export type PinbetMetricHealth = 'POSITIVE' | 'NON_POSITIVE' | 'NO_DATA';

export interface PinbetMetricHouse {
  house: 'pinbet-diario' | 'pinbet-mensal';
  name: 'Pinbet Diário' | 'Pinbet Mensal';
  netPl: number | null;
  depositTotal: number;
  withdrawalTotal: number | null;
  volume: number | null;
  health: PinbetMetricHealth;
}
```

Helper:

```ts
export const shouldShowPinbetMetrics = (house?: string) =>
  !house || house === 'pinbet-diario' || house === 'pinbet-mensal';

export const pinbetMetricTone = (
  metric: Pick<PinbetMetricHouse, 'health' | 'netPl'>,
) => metric.health === 'NO_DATA'
  ? 'neutral'
  : metric.health === 'POSITIVE'
    ? 'positive'
    : 'negative';
```

- [ ] **Step 4: Fetch metrics with the same query as summary**

Add `pinbetMetrics` state to `useDashboard`. In both initial and scoped fetches,
request:

```ts
$fetch<PinbetMetricsResponse>(
  `${apiBase}/v1/dashboard/pinbet-metrics`,
  { headers: authHeaders(), query },
)
```

When the selected house is not Pinbet, set `{ houses: [] }` without making the
request.

- [ ] **Step 5: Build the approved card component**

`PinbetMetricsCards.vue` accepts:

```ts
defineProps<{
  houses: PinbetMetricHouse[];
  pending: boolean;
}>();
```

Render separate Diário/Mensal groups, each with only these labels:

- `Net P&L`
- `Depósitos`
- `Saques`
- `Volume`

Do not render `net_pl`, `deposit_total`, `withdrawal_total`, `afp1`, or `afp2`.
Use `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`.
Show “Aguardando sincronização” for `NO_DATA`, not `R$0,00`.

- [ ] **Step 6: Keep financial balance separate from withdrawable balance**

In `index.vue`, change the global hero calculation to the financial balance:

```ts
const totalBalance = computed(() => {
  if (activeHouse.value) return Math.max(0, activeHouse.value.total);
  return Math.max(0, balance.value?.balance ?? 0);
});
```

Render `<DashboardPinbetMetricsCards>` below the view/scope switch and before
the generic KPI grid, using the current period/scope result.

- [ ] **Step 7: Add a raw-field-name guard and verify GREEN**

In the frontend test, read the component source:

```ts
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../app/components/dashboard/PinbetMetricsCards.vue', import.meta.url),
  'utf8',
);
expect(source).not.toMatch(/deposit_total|withdrawal_total|net_pl|afp1|afp2/);
```

Run:

```bash
pnpm --dir frontend test test/pinbet-metrics.spec.ts
pnpm --dir frontend build
```

Expected: tests and Nuxt build pass.

- [ ] **Step 8: Commit**

```bash
git add frontend/app/types frontend/app/composables/useDashboard.ts \
  frontend/app/utils frontend/app/components/dashboard frontend/app/pages/index.vue \
  frontend/test/pinbet-metrics.spec.ts
git commit -m "feat(pinbet): add operational health cards"
```

---

### Task 8: Explain the Pinbet cap in the payments page

**Required skill before editing UI:** `frontend-design`

**Files:**

- Modify: `frontend/app/composables/useWithdrawals.ts`
- Create: `frontend/app/utils/pinbet-withdrawal-explanation.ts`
- Create: `frontend/test/pinbet-withdrawal-explanation.spec.ts`
- Create: `frontend/app/components/payments/PinbetWithdrawalLimitCard.vue`
- Modify: `frontend/app/pages/payments.vue`

- [ ] **Step 1: Write failing explanation tests**

```ts
describe('Pinbet withdrawal explanation', () => {
  it('explains the approved R$1000 / R$100 / R$80 example', () => {
    const vm = buildPinbetWithdrawalExplanation({
      slug: 'pinbet-diario',
      balance: 1000,
      availableBalance: 80,
      netPl: 100,
      netPlLimit: 80,
      withdrawnFromNetPlLimit: 0,
      withdrawalRestriction: 'PINBET_NET_PL_LIMIT',
    }, 0.06);

    expect(vm).toMatchObject({
      gross: 80,
      netAfterFee: 75.2,
      message:
        'Seu saldo é R$ 1.000,00, mas na Pinbet o saque é limitado a 80% do Net P&L positivo acumulado. Por isso, seu limite atual é R$ 80,00.',
    });
  });

  it('explains negative Net P&L', () => {
    const vm = buildPinbetWithdrawalExplanation({
      slug: 'pinbet-mensal',
      balance: 1000,
      availableBalance: 0,
      netPl: -68.26,
      netPlLimit: 0,
      withdrawnFromNetPlLimit: 0,
      withdrawalRestriction: 'PINBET_NET_PL_NON_POSITIVE',
    }, 0.06);
    expect(vm.message).toContain('Enquanto o acumulado não ficar positivo');
  });

  it('distinguishes pending metrics from a real zero', () => {
    const vm = buildPinbetWithdrawalExplanation({
      slug: 'pinbet-diario',
      balance: 1000,
      availableBalance: 0,
      netPl: null,
      netPlLimit: null,
      withdrawnFromNetPlLimit: 0,
      withdrawalRestriction: 'PINBET_METRICS_PENDING',
    }, 0.06);
    expect(vm.message).toContain('ainda estão sendo sincronizadas');
  });
});
```

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --dir frontend test test/pinbet-withdrawal-explanation.spec.ts
```

Expected: utility module absent.

- [ ] **Step 3: Extend the withdrawal rule contract**

Add:

```ts
balance: number;
netPl: number | null;
netPlLimit: number | null;
withdrawnFromNetPlLimit: number;
withdrawalRestriction:
  | 'PINBET_METRICS_PENDING'
  | 'PINBET_NET_PL_NON_POSITIVE'
  | 'PINBET_NET_PL_LIMIT'
  | null;
```

- [ ] **Step 4: Implement the pure view-model helper**

Return formatted values and the exact approved messages. Calculate:

```ts
const gross = rule.availableBalance;
const fee = roundMoney(gross * feeRate);
const netAfterFee = roundMoney(gross - fee);
```

Never recalculate the 80% limit; use `netPlLimit` and `availableBalance` from the
backend.

- [ ] **Step 5: Build the payment explanation component**

The component receives `rule` and `feeRate`. For Pinbet only, render:

- `Saldo da casa`;
- `Net P&L acumulado`;
- `80% do Net P&L`;
- `Limite já utilizado`;
- `Disponível para saque`;
- `Valor líquido após taxa`.

Render the approved explanatory callout below the values. Use a neutral pending
state and a negative non-positive state.

- [ ] **Step 6: Integrate with each house breakdown**

Extend `HouseBreakdown` with the original `rule` or the Pinbet explanation
view-model. Render:

```vue
<PaymentsPinbetWithdrawalLimitCard
  v-if="h.slug === 'pinbet-diario' || h.slug === 'pinbet-mensal'"
  :rule="h.rule"
  :fee-rate="feeRate"
/>
```

When `withdrawalRestriction` is a Pinbet restriction, use its explicit message
before the generic minimum-balance message.

- [ ] **Step 7: Run frontend tests and build**

```bash
pnpm --dir frontend test
pnpm --dir frontend build
```

Expected: 6 baseline tests plus all new tests pass; build exits 0.

- [ ] **Step 8: Commit**

```bash
git add frontend/app/composables/useWithdrawals.ts \
  frontend/app/utils/pinbet-withdrawal-explanation.ts \
  frontend/app/components/payments frontend/app/pages/payments.vue \
  frontend/test/pinbet-withdrawal-explanation.spec.ts
git commit -m "feat(pinbet): explain Net P&L withdrawal cap"
```

---

### Task 9: Add safe post-sync verification and complete validation

**Files:**

- Create: `backend-vexxa/scripts/verify-pinbet-operational-metrics.mjs`
- Modify: `docs/superpowers/specs/2026-07-25-pinbet-net-pl-withdrawal-limit-design.md`
  only if implementation evidence requires a factual clarification

- [ ] **Step 1: Create a read-only verification script**

The script must:

- require `DATABASE_URL`;
- accept `--house=pinbet-diario|pinbet-mensal`;
- reject every other house;
- perform no INSERT/UPDATE/DELETE;
- print:
  - first/last date;
  - row and campaign counts;
  - null counts for each new metric;
  - sums of Net P&L, deposits, withdrawals, and volume;
  - count of rows belonging to the other Pinbet house;
  - a representative row rounded to two decimals.

Core query:

```js
const result = await client.query(`
  SELECT
    MIN(date)::text AS first_date,
    MAX(date)::text AS last_date,
    COUNT(*)::int AS rows,
    COUNT(DISTINCT "campaignId")::int AS campaigns,
    COUNT(*) FILTER (WHERE "netPl" IS NULL)::int AS net_pl_nulls,
    COUNT(*) FILTER (WHERE "withdrawalTotal" IS NULL)::int AS withdrawal_nulls,
    COUNT(*) FILTER (WHERE volume IS NULL)::int AS volume_nulls,
    COALESCE(SUM("netPl"), 0)::text AS net_pl,
    COALESCE(SUM(deposit), 0)::text AS deposits,
    COALESCE(SUM("withdrawalTotal"), 0)::text AS withdrawals,
    COALESCE(SUM(volume), 0)::text AS volume
  FROM affiliate_data
  WHERE "bettingHouse" = $1
`, [house]);
```

- [ ] **Step 2: Syntax-check the script**

```bash
node --check backend-vexxa/scripts/verify-pinbet-operational-metrics.mjs
```

Expected: exit 0. Do not run against production during local implementation.

- [ ] **Step 3: Run backend targeted suites**

```bash
pnpm --dir backend-vexxa test \
  src/common/persistence/affiliate-data-change.helper.spec.ts \
  src/modules/sync/infrastructure/extractors/smartico.extractor.spec.ts \
  src/modules/sync/infrastructure/persistence/sync.prisma-repository.spec.ts \
  src/modules/withdrawal/domain/pinbet-withdrawal-limit.spec.ts \
  src/modules/dashboard/application/dashboard-balance.service.spec.ts \
  src/modules/dashboard/application/dashboard.service.spec.ts \
  src/modules/withdrawal/application/withdrawal.service.spec.ts
```

Expected: all feature-relevant tests pass.

- [ ] **Step 4: Run backend static verification**

```bash
DATABASE_URL=postgresql://localhost:5432/worktree_types pnpm --dir backend-vexxa exec prisma validate
pnpm --dir backend-vexxa build
```

Expected: Prisma schema valid and Nest build exits 0.

- [ ] **Step 5: Run frontend verification**

```bash
pnpm --dir frontend test
pnpm --dir frontend build
```

Expected: all tests and build pass.

- [ ] **Step 6: Run the full backend suite and classify baseline failures**

```bash
pnpm --dir backend-vexxa test
```

Expected:

- no feature-related failures;
- the two documented baseline failures may remain:
  `affiliate-api.service.spec.ts` mock and
  `sync-orchestrator.service.spec.ts` gap-fill timeout.

If a new failure appears, fix it before completion. Do not claim the backend
suite is fully green while either baseline failure remains.

- [ ] **Step 7: Inspect diff and migration safety**

```bash
git diff --check
git status --short
git diff --stat main...HEAD
git log --oneline main..HEAD
```

Confirm:

- migration is additive and nullable;
- no `.env`, credentials, tokens, generated `.nuxt`, or `node_modules` files are
  tracked;
- no unrelated user changes are present;
- raw Smartico field names appear only in backend extraction/tests, not cards.

- [ ] **Step 8: Commit verification script**

```bash
git add backend-vexxa/scripts/verify-pinbet-operational-metrics.mjs
git commit -m "chore(pinbet): add operational metric verification"
```

- [ ] **Step 9: Prepare deployment/backfill runbook**

After application deployment and migration, run the existing authenticated
admin sync for:

```text
pinbet-diario — full current-month sync
pinbet-mensal — full current-month sync
```

Then run the read-only verifier for each house and independently compare the
dashboard metrics endpoint, balance endpoint, and withdrawal-rules endpoint.
Production sync/backfill is a separate authorized deployment operation and must
not be triggered from the local worktree.
