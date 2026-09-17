# Pinbet Diário to Mensal Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every active Pinbet Diário user, metric, balance adjustment, and withdrawal to Pinbet Mensal while preserving existing rates, calculating the 80% Net P&L limit independently for `afp1` and `afp2`, cancelling Diário pending withdrawals, and retaining an exact rollback path.

**Architecture:** Persist the financial dimension on withdrawals, reuse `AffiliateLink.linkType` for campaign dimension, and extend the dashboard balance calculation with two Pinbet sub-buckets whose already-limited withdrawable amounts are summed. A guarded operations CLI performs preview, backup, cancellation, atomic re-keying, Google Sheet mirroring, verification, and rollback; the Mensal Smartico mapping fetches `afp1` and `afp2` sequentially.

**Tech Stack:** NestJS 11, TypeScript 6, Prisma 7, PostgreSQL 16, Vitest, Node.js ESM, `pg`, Google Sheets API, Smartico HTTP API.

---

## File map

- Modify `prisma/schema.prisma`: add persisted Pinbet dimensions to withdrawals and balance adjustments.
- Create `prisma/migrations/20260805170000_add_pinbet_withdrawal_dimension/migration.sql`: deploy the enum, column, and lookup index.
- Create `src/modules/withdrawal/domain/pinbet-dimension.ts`: normalize link and withdrawal dimensions and produce dimension-aware rate keys.
- Create `src/modules/withdrawal/domain/pinbet-dimension.spec.ts`: test legacy fallbacks and new values.
- Modify `src/modules/withdrawal/domain/pinbet-withdrawal-limit.ts`: add the segmented `afp1`/`afp2` calculation.
- Modify `src/modules/withdrawal/domain/pinbet-withdrawal-limit.spec.ts`: cover separation and combined post-migration consumption.
- Modify `src/modules/dashboard/domain/types/dashboard.types.ts`: expose optional Pinbet dimension breakdown and dimension-aware network link types.
- Modify `src/modules/dashboard/application/dashboard-balance.service.ts`: accumulate earnings, Net P&L, adjustments, and withdrawals by Pinbet dimension.
- Modify `src/modules/dashboard/application/dashboard-balance.service.spec.ts`: prove exact pre/post availability and dimension-aware network rates.
- Modify `src/modules/withdrawal/application/withdrawal.service.ts`: tag new Mensal withdrawals as post-migration combined withdrawals.
- Modify `src/modules/withdrawal/application/withdrawal.service.spec.ts`: verify both internal and affiliate-API creation paths.
- Modify `src/modules/sync/infrastructure/extractors/smartico.extractor.ts`: accept a comma-separated dimension list and fetch sequentially.
- Modify `src/modules/sync/infrastructure/extractors/smartico.extractor.spec.ts`: verify `afp1,afp2` requests and disjoint reports.
- Create `scripts/lib/pinbet-diario-mensal-migration.mjs`: pure backup, hash, validation, SQL result, and sheet helpers.
- Create `scripts/lib/pinbet-diario-mensal-migration.spec.ts`: unit tests for backup and rollback guards.
- Create `scripts/pinbet-diario-to-mensal.mjs`: guarded `preview`, `apply`, `verify`, and `rollback` CLI.
- Create `scripts/pinbet-balance-snapshot.mjs`: instantiate compiled dashboard services without starting schedulers and snapshot per-user balances.
- Update `docs/superpowers/specs/2026-08-05-pinbet-diario-to-mensal-migration-design.md` only if implementation uncovers a contradiction; do not weaken an approved invariant.

### Task 1: Persist the Pinbet withdrawal dimension

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260805170000_add_pinbet_withdrawal_dimension/migration.sql`

- [ ] **Step 1: Add the Prisma enum and field**

Add next to `WithdrawalStatus`:

```prisma
enum PinbetTrackingDimension {
  AFP1
  AFP2
  COMBINED
}
```

Add to `WithdrawalRequest` after `bettingHouse`:

```prisma
  pinbetDimension PinbetTrackingDimension?
```

Add to `BalanceAdjustment` after `bettingHouse`:

```prisma
  pinbetDimension PinbetTrackingDimension?
```

Add the lookup index:

```prisma
  @@index([bettingHouse, pinbetDimension])
```

Add the same lookup index to `BalanceAdjustment` while retaining its existing
`@@unique([userId, bettingHouse])` invariant.

- [ ] **Step 2: Write the SQL migration**

```sql
CREATE TYPE "PinbetTrackingDimension" AS ENUM ('AFP1', 'AFP2', 'COMBINED');

ALTER TABLE "withdrawal_requests"
ADD COLUMN "pinbetDimension" "PinbetTrackingDimension";

ALTER TABLE "balance_adjustments"
ADD COLUMN "pinbetDimension" "PinbetTrackingDimension";

CREATE INDEX "withdrawal_requests_bettingHouse_pinbetDimension_idx"
ON "withdrawal_requests"("bettingHouse", "pinbetDimension");

CREATE INDEX "balance_adjustments_bettingHouse_pinbetDimension_idx"
ON "balance_adjustments"("bettingHouse", "pinbetDimension");
```

- [ ] **Step 3: Validate and regenerate the client**

Run:

```bash
pnpm exec prisma validate
pnpm prisma:generate
```

Expected: schema validation succeeds and Prisma Client generation exits `0`.

- [ ] **Step 4: Commit the schema change**

```bash
git add prisma/schema.prisma prisma/migrations/20260805170000_add_pinbet_withdrawal_dimension/migration.sql
git commit -m "feat(pinbet): persist withdrawal tracking dimension"
```

### Task 2: Add dimension normalization helpers

**Files:**
- Create: `src/modules/withdrawal/domain/pinbet-dimension.ts`
- Create: `src/modules/withdrawal/domain/pinbet-dimension.spec.ts`

- [ ] **Step 1: Write failing helper tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  pinbetDimensionForLink,
  pinbetDimensionForWithdrawal,
  pinbetDimensionForAdjustment,
  pinbetRateKey,
} from './pinbet-dimension.js';

describe('Pinbet dimension helpers', () => {
  it('uses explicit linkType before campaign fallback', () => {
    expect(pinbetDimensionForLink({ linkType: 'afp2', campaignId: 'VALLEX0001' })).toBe('AFP2');
  });

  it('recognizes legacy campaigns', () => {
    expect(pinbetDimensionForLink({ linkType: null, campaignId: 'VALLEX0028' })).toBe('AFP1');
    expect(pinbetDimensionForLink({ linkType: null, campaignId: 'MJM0042' })).toBe('AFP2');
  });

  it('falls back from legacy withdrawal house', () => {
    expect(pinbetDimensionForWithdrawal(null, 'pinbet-diario')).toBe('AFP1');
    expect(pinbetDimensionForWithdrawal(null, 'pinbet-mensal')).toBe('AFP2');
  });

  it('falls back from a legacy balance adjustment house', () => {
    expect(pinbetDimensionForAdjustment(null, 'pinbet-diario')).toBe('AFP1');
    expect(pinbetDimensionForAdjustment(null, 'pinbet-mensal')).toBe('AFP2');
  });

  it('builds different rate keys for the same house', () => {
    expect(pinbetRateKey('pinbet-mensal', 'AFP1')).toBe('pinbet-mensal::AFP1');
    expect(pinbetRateKey('pinbet-mensal', 'AFP2')).toBe('pinbet-mensal::AFP2');
  });
});
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run:

```bash
pnpm test -- src/modules/withdrawal/domain/pinbet-dimension.spec.ts
```

Expected: FAIL because `pinbet-dimension.ts` does not exist.

- [ ] **Step 3: Implement the helpers**

```ts
import type { PinbetTrackingDimension } from '@prisma/client';

export type PinbetDimension = PinbetTrackingDimension;

export function pinbetDimensionForLink(link: {
  linkType?: string | null;
  campaignId: string;
}): PinbetDimension {
  const explicit = link.linkType?.trim().toLowerCase();
  if (explicit === 'afp1') return 'AFP1';
  if (explicit === 'afp2') return 'AFP2';
  return link.campaignId.toUpperCase().startsWith('MJM') ? 'AFP2' : 'AFP1';
}

export function pinbetDimensionForWithdrawal(
  dimension: PinbetTrackingDimension | null | undefined,
  bettingHouse: string,
): PinbetDimension {
  if (dimension) return dimension;
  return bettingHouse === 'pinbet-diario' ? 'AFP1' : 'AFP2';
}

export const pinbetDimensionForAdjustment = pinbetDimensionForWithdrawal;

export const pinbetRateKey = (
  house: string,
  dimension: PinbetDimension,
): string => `${house}::${dimension}`;
```

- [ ] **Step 4: Run the focused test**

Run:

```bash
pnpm test -- src/modules/withdrawal/domain/pinbet-dimension.spec.ts
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/modules/withdrawal/domain/pinbet-dimension.ts src/modules/withdrawal/domain/pinbet-dimension.spec.ts
git commit -m "feat(pinbet): normalize financial dimensions"
```

### Task 3: Calculate the 80% cap separately and sum it

**Files:**
- Modify: `src/modules/withdrawal/domain/pinbet-withdrawal-limit.ts`
- Modify: `src/modules/withdrawal/domain/pinbet-withdrawal-limit.spec.ts`

- [ ] **Step 1: Write failing segmented-cap tests**

Append:

```ts
import { calculateSegmentedPinbetWithdrawalLimit } from './pinbet-withdrawal-limit.js';

it('does not let AFP2 spare cap subsidize AFP1', () => {
  const result = calculateSegmentedPinbetWithdrawalLimit({
    segments: [
      { dimension: 'AFP1', balance: 1_000, netPl: 100, consumed: 0, metricsComplete: true },
      { dimension: 'AFP2', balance: 0, netPl: 1_000, consumed: 0, metricsComplete: true },
    ],
    combinedConsumed: 0,
  });
  expect(result.withdrawable).toBe(80);
});

it('does not let negative AFP2 net PL reduce AFP1', () => {
  const result = calculateSegmentedPinbetWithdrawalLimit({
    segments: [
      { dimension: 'AFP1', balance: 1_000, netPl: 1_000, consumed: 0, metricsComplete: true },
      { dimension: 'AFP2', balance: 0, netPl: -500, consumed: 0, metricsComplete: true },
    ],
    combinedConsumed: 0,
  });
  expect(result.withdrawable).toBe(800);
});

it('subtracts post-migration withdrawals once after summing buckets', () => {
  const result = calculateSegmentedPinbetWithdrawalLimit({
    segments: [
      { dimension: 'AFP1', balance: 500, netPl: 1_000, consumed: 100, metricsComplete: true },
      { dimension: 'AFP2', balance: 300, netPl: 500, consumed: 50, metricsComplete: true },
    ],
    combinedConsumed: 200,
  });
  expect(result.withdrawable).toBe(600);
  expect(result.consumed).toBe(350);
});
```

- [ ] **Step 2: Run the tests and confirm the missing export**

Run:

```bash
pnpm test -- src/modules/withdrawal/domain/pinbet-withdrawal-limit.spec.ts
```

Expected: FAIL because `calculateSegmentedPinbetWithdrawalLimit` is missing.

- [ ] **Step 3: Implement the segmented calculation**

Add exported interfaces and function:

```ts
import type { PinbetTrackingDimension } from '@prisma/client';

export type PinbetLimitSegment = Omit<PinbetWithdrawalLimitInput, 'house'> & {
  dimension: Exclude<PinbetTrackingDimension, 'COMBINED'>;
};

export interface SegmentedPinbetWithdrawalLimit {
  balance: number;
  netPl: number | null;
  netPlLimit: number | null;
  consumed: number;
  remainingNetPlLimit: number | null;
  withdrawable: number;
  restriction: PinbetWithdrawalRestriction | null;
  segments: Array<PinbetWithdrawalLimit & { dimension: 'AFP1' | 'AFP2' }>;
}

export function calculateSegmentedPinbetWithdrawalLimit(input: {
  segments: PinbetLimitSegment[];
  combinedConsumed: number;
}): SegmentedPinbetWithdrawalLimit {
  const segments = input.segments.map((segment) => ({
    dimension: segment.dimension,
    ...calculatePinbetWithdrawalLimit({ ...segment, house: 'pinbet-mensal' }),
  }));
  const combinedConsumed = Math.max(0, money(input.combinedConsumed));
  const complete = segments.every((segment) => segment.netPl !== null);
  const preCombinedWithdrawable = segments.reduce((sum, segment) => sum + segment.withdrawable, 0);
  const remaining = segments.reduce((sum, segment) => sum + (segment.remainingNetPlLimit ?? 0), 0);
  const balance = Math.max(0, money(segments.reduce((sum, segment) => sum + segment.balance, 0) - combinedConsumed));
  const withdrawable = Math.max(0, money(preCombinedWithdrawable - combinedConsumed));
  const allNonPositive = segments.every((segment) => (segment.netPl ?? 0) <= 0);
  return {
    balance,
    netPl: complete ? money(segments.reduce((sum, segment) => sum + (segment.netPl ?? 0), 0)) : null,
    netPlLimit: complete ? money(segments.reduce((sum, segment) => sum + (segment.netPlLimit ?? 0), 0)) : null,
    consumed: money(segments.reduce((sum, segment) => sum + segment.consumed, 0) + combinedConsumed),
    remainingNetPlLimit: complete ? Math.max(0, money(remaining - combinedConsumed)) : null,
    withdrawable,
    restriction: !complete
      ? 'METRICS_SYNCING'
      : allNonPositive && withdrawable === 0
        ? 'NET_PL_NON_POSITIVE'
        : withdrawable < balance
          ? 'NET_PL_CAP'
          : null,
    segments,
  };
}
```

- [ ] **Step 4: Run both domain test files**

Run:

```bash
pnpm test -- src/modules/withdrawal/domain/pinbet-withdrawal-limit.spec.ts src/modules/withdrawal/domain/pinbet-dimension.spec.ts
```

Expected: both files pass.

- [ ] **Step 5: Commit**

```bash
git add src/modules/withdrawal/domain/pinbet-withdrawal-limit.ts src/modules/withdrawal/domain/pinbet-withdrawal-limit.spec.ts
git commit -m "feat(pinbet): separate afp withdrawal caps"
```

### Task 4: Make dashboard balances dimension-aware

**Files:**
- Modify: `src/modules/dashboard/domain/types/dashboard.types.ts`
- Modify: `src/modules/dashboard/application/dashboard-balance.service.ts`
- Modify: `src/modules/dashboard/application/dashboard-balance.service.spec.ts`

- [ ] **Step 1: Add failing balance tests for two dimensions**

Add fixtures with two links for the same user and same house:

```ts
affiliateLinks: [
  { campaignId: 'VALLEX0001', bettingHouse: 'pinbet-mensal', linkType: 'afp1', cpa: d(40), revshare: d(0) },
  { campaignId: 'MJM0001', bettingHouse: 'pinbet-mensal', linkType: 'afp2', cpa: d(65), revshare: d(0) },
]
```

Return one `AFP1` withdrawal, one `AFP2` withdrawal, and one `COMBINED`
withdrawal from the Prisma mock. Assert:

```ts
expect(house.pinbetDimensions).toEqual([
  expect.objectContaining({ dimension: 'AFP1' }),
  expect.objectContaining({ dimension: 'AFP2' }),
]);
expect(house.withdrawable).toBe(
  house.pinbetDimensions![0]!.withdrawable +
    house.pinbetDimensions![1]!.withdrawable -
    200,
);
```

Add a network fixture where the root has CPA 40 in `AFP1` and CPA 65 in
`AFP2`; assert an `AFP1` downline uses the CPA 40 anchor.

- [ ] **Step 2: Run the focused dashboard test and confirm failure**

Run:

```bash
pnpm test -- src/modules/dashboard/application/dashboard-balance.service.spec.ts
```

Expected: FAIL because links do not select `linkType`, withdrawals do not
select `pinbetDimension`, and `pinbetDimensions` is absent.

- [ ] **Step 3: Extend dashboard types**

Add:

```ts
export interface PinbetDimensionBalance {
  dimension: 'AFP1' | 'AFP2';
  balance: number;
  netPl: number | null;
  netPlLimit: number | null;
  consumed: number;
  withdrawable: number;
}
```

Add `pinbetDimensions?: PinbetDimensionBalance[]` to `PerHouseBalance`, and
`linkType: string | null` to `NetworkMemberLink`.

- [ ] **Step 4: Key link rates by house and dimension**

Import `pinbetDimensionForLink`, `pinbetDimensionForAdjustment`, and
`pinbetRateKey`. Include `linkType: true`
in every affiliate-link select in `getBalance()` and `loadNetworkMembers()`.
Replace the L1 anchor writes with:

```ts
const dimension = isPinbetHouse(link.bettingHouse)
  ? pinbetDimensionForLink(link)
  : null;
const key = dimension
  ? pinbetRateKey(link.bettingHouse, dimension)
  : link.bettingHouse;
if (link.cpa && link.cpa.toNumber() > 0) anchor.cpaByHouse.set(key, link.cpa.toNumber());
if (link.revshare && link.revshare.toNumber() > 0) anchor.revByHouse.set(key, link.revshare.toNumber());
```

Use the same key when selecting the root link and L1 spread rate for each
network member link.

```ts
const dimension = isPinbetHouse(ml.bettingHouse)
  ? pinbetDimensionForLink(ml)
  : null;
const rateKey = dimension
  ? pinbetRateKey(ml.bettingHouse, dimension)
  : ml.bettingHouse;
const myLink = dbUser.affiliateLinks.find((link) =>
  link.bettingHouse === ml.bettingHouse &&
  (!dimension || pinbetDimensionForLink(link) === dimension),
);
const l1Cpa = member.l1CpaByHouse.get(rateKey) ?? 0;
const l1Rev = member.l1RevByHouse.get(rateKey) ?? 0;
```

- [ ] **Step 5: Accumulate Pinbet financial values by dimension**

Create an internal map keyed by `house::dimension` with CPA, revshare, network,
adjustment, fraud, Net P&L, completeness, and legacy withdrawals. Whenever an
own or network row is matched to a link, add its values to both the existing
house total and the matching dimension bucket. Existing non-Pinbet behavior
must remain unchanged.

Use this exact lookup at each matched row:

```ts
const dimension = pinbetDimensionForLink(link);
const bucket = getOrCreatePinbetBucket(link.bettingHouse, dimension);
bucket.cpa += houseCpa;
bucket.rev += houseRev;
```

Select `pinbetDimension` on withdrawals and balance adjustments. Send `AFP1`
and `AFP2` withdrawals and adjustments to
their bucket and sum `COMBINED` withdrawals separately. Call
`calculateSegmentedPinbetWithdrawalLimit()` for `pinbet-mensal`; retain the
single-bucket calculation for pre-migration `pinbet-diario` compatibility.

- [ ] **Step 6: Run dashboard tests**

Run:

```bash
pnpm test -- src/modules/dashboard/application/dashboard-balance.service.spec.ts
```

Expected: all dashboard balance tests pass, including the two new dimension
tests.

- [ ] **Step 7: Commit**

```bash
git add src/modules/dashboard/domain/types/dashboard.types.ts src/modules/dashboard/application/dashboard-balance.service.ts src/modules/dashboard/application/dashboard-balance.service.spec.ts
git commit -m "feat(pinbet): calculate monthly balance by tracking dimension"
```

### Task 5: Tag new post-migration withdrawals

**Files:**
- Modify: `src/modules/withdrawal/application/withdrawal.service.ts`
- Modify: `src/modules/withdrawal/application/withdrawal.service.spec.ts`

- [ ] **Step 1: Write failing creation assertions**

For both normal and affiliate-API withdrawal creation, assert:

```ts
expect(prisma.withdrawalRequest.create).toHaveBeenCalledWith(
  expect.objectContaining({
    data: expect.objectContaining({
      bettingHouse: 'pinbet-mensal',
      pinbetDimension: 'COMBINED',
    }),
  }),
);
```

Add a non-Pinbet case asserting `pinbetDimension: null`.

- [ ] **Step 2: Run the test and confirm failure**

Run:

```bash
pnpm test -- src/modules/withdrawal/application/withdrawal.service.spec.ts
```

Expected: FAIL because the create payload lacks `pinbetDimension`.

- [ ] **Step 3: Add a single dimension resolver and use it in both create paths**

```ts
const newWithdrawalDimension = (house: string) =>
  house === 'pinbet-mensal' ? PinbetTrackingDimension.COMBINED : null;
```

Set `pinbetDimension: newWithdrawalDimension(dto.bettingHouse)` in normal
creation and `pinbetDimension: newWithdrawalDimension(bettingHouse)` in the
affiliate-API creation path.

- [ ] **Step 4: Run withdrawal tests**

Run:

```bash
pnpm test -- src/modules/withdrawal/application/withdrawal.service.spec.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/modules/withdrawal/application/withdrawal.service.ts src/modules/withdrawal/application/withdrawal.service.spec.ts
git commit -m "feat(pinbet): tag combined monthly withdrawals"
```

### Task 6: Sync both Smartico dimensions into Mensal

**Files:**
- Modify: `src/modules/sync/infrastructure/extractors/smartico.extractor.ts`
- Modify: `src/modules/sync/infrastructure/extractors/smartico.extractor.spec.ts`

- [ ] **Step 1: Write a failing dual-dimension test**

Mock two HTTP 200 responses and call:

```ts
const rows = await extractor.fetchReports('token', '2026-08-05', 'afp1,afp2');
expect(fetch).toHaveBeenNthCalledWith(
  1,
  expect.stringContaining('group_by=afp1'),
  expect.anything(),
);
expect(fetch).toHaveBeenNthCalledWith(
  2,
  expect.stringContaining('group_by=afp2'),
  expect.anything(),
);
expect(rows.map((row) => row.campaignId)).toEqual(['VALLEX0001', 'MJM0001']);
```

- [ ] **Step 2: Run the extractor tests and confirm failure**

Run:

```bash
pnpm test -- src/modules/sync/infrastructure/extractors/smartico.extractor.spec.ts
```

Expected: FAIL because the extractor treats the value as one dimension.

- [ ] **Step 3: Parse and fetch dimensions sequentially**

Add:

```ts
const parseGroupBy = (value: string): GroupByField[] => {
  const values = value.split(',').map((part) => part.trim()).filter(Boolean);
  const normalized = values.map((part) => (part === 'afp2' ? 'afp2' : 'afp1'));
  return [...new Set(normalized)];
};
```

Make `fetchReportsRange()` loop over `parseGroupBy(bookmarkerId)`, invoke a
private `fetchDimensionRange()` containing the current single-request body,
and concatenate the returned rows. Keep requests sequential and preserve the
existing provider error behavior.

- [ ] **Step 4: Run extractor and orchestrator tests**

Run:

```bash
pnpm test -- src/modules/sync/infrastructure/extractors/smartico.extractor.spec.ts src/modules/sync/application/sync-orchestrator.service.spec.ts
```

Expected: both files pass.

- [ ] **Step 5: Commit**

```bash
git add src/modules/sync/infrastructure/extractors/smartico.extractor.ts src/modules/sync/infrastructure/extractors/smartico.extractor.spec.ts
git commit -m "feat(pinbet): sync afp1 and afp2 into monthly house"
```

### Task 7: Build backup and rollback primitives

**Files:**
- Create: `scripts/lib/pinbet-diario-mensal-migration.mjs`
- Create: `scripts/lib/pinbet-diario-mensal-migration.spec.ts`

- [ ] **Step 1: Write failing unit tests**

Test that `validateBackup()` rejects a changed count, changed SHA-256, duplicate
row ID, and a rollback row whose current state differs from `expectedAfter`.
Test that JSON serialization preserves decimals as strings and dates as ISO
strings.

```ts
expect(() => validateBackup(tampered, validManifest)).toThrow(/hash/i);
expect(() => assertRollbackState([{ id: 'w1', status: 'COMPLETED' }], [{ id: 'w1', status: 'FAILED' }])).toThrow(/diverg/);
```

- [ ] **Step 2: Run the unit test and confirm failure**

Run:

```bash
pnpm test -- scripts/lib/pinbet-diario-mensal-migration.spec.ts
```

Expected: FAIL because the module is absent.

- [ ] **Step 3: Implement pure helpers**

Export these functions with deterministic key ordering:

```js
import { createHash } from 'node:crypto';

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
};

export const stableJson = (value) => JSON.stringify(canonicalize(value), null, 2);
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const assertUniqueIds = (rows, label) => {
  const ids = rows.map((row) => row.id);
  if (new Set(ids).size !== ids.length) throw new Error(`IDs duplicados em ${label}`);
};

export function validateBackup(backup, manifest) {
  const actualHash = sha256(stableJson(backup));
  if (actualHash !== manifest.backupSha256) throw new Error('Hash do backup divergente');
  for (const [label, expectedCount] of Object.entries(manifest.counts)) {
    const rows = backup.tables[label];
    if (!Array.isArray(rows) || rows.length !== expectedCount) {
      throw new Error(`Contagem divergente em ${label}`);
    }
    assertUniqueIds(rows, label);
  }
  return true;
}

export function assertRollbackState(current, expected) {
  const currentMap = new Map(current.map((row) => [row.id, row]));
  if (currentMap.size !== expected.length) throw new Error('Contagem divergente no rollback');
  for (const row of expected) {
    const found = currentMap.get(row.id);
    if (!found || stableJson(found) !== stableJson(row)) {
      throw new Error(`Estado divergente no rollback para ${row.id}`);
    }
  }
  return true;
}

export const summarizeMoney = (rows, field) => rows.reduce((sum, row) => sum + Number(row[field] ?? 0), 0).toFixed(2);
```

Keep this module free of environment reads and network connections so the unit
tests remain deterministic.

- [ ] **Step 4: Run the helper tests**

Run:

```bash
pnpm test -- scripts/lib/pinbet-diario-mensal-migration.spec.ts
```

Expected: all backup and rollback guard tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/pinbet-diario-mensal-migration.mjs scripts/lib/pinbet-diario-mensal-migration.spec.ts
git commit -m "feat(pinbet): add migration backup guards"
```

### Task 8: Implement the guarded operations CLI

**Files:**
- Create: `scripts/pinbet-diario-to-mensal.mjs`
- Create: `scripts/pinbet-balance-snapshot.mjs`

- [ ] **Step 1: Implement read-only `preview`**

Use `pg.Client` with `DATABASE_URL`. Print database identity, fresh counts,
money totals, status totals, gateway linkage, active campaign collisions,
adjustment conflicts, fraud rows, running sync logs, house configuration, and
sheet availability. Never print credentials, PIX keys, or user e-mails.

Invocation:

```bash
node --env-file=.env scripts/pinbet-diario-to-mensal.mjs preview
```

Exit non-zero when there is a campaign collision, a Diário fraud row, a
conflicting balance adjustment, a running Pinbet sync, or a pending withdrawal
with gateway linkage.

- [ ] **Step 2: Implement the compiled-service balance snapshot**

After `pnpm build`, dynamically import `ConfigService`, `PrismaService`,
`SettingsPrismaRepository`, `SettingsService`, `DashboardAccessService`,
`DashboardPrismaRepository`, and `DashboardBalanceService` from `dist/src`.
Instantiate them directly so no scheduler module starts. For every user with an
active link in either Pinbet house, call `getBalance()` with concurrency `5`
and store, in cents:

```js
{
  userId,
  diario: { total, withdrawable },
  mensal: { total, withdrawable },
  expectedMensal: {
    total: diario.total + mensal.total,
    withdrawable: diario.withdrawable + mensal.withdrawable,
  },
}
```

Do not print user identity fields. Write the snapshot with mode `0o600`.

- [ ] **Step 3: Implement backup creation**

Before mutation, snapshot full affected rows from active Diário links, existing
Mensal links whose `linkType` will be backfilled, Diário affiliate data, all
Diário withdrawals, existing Mensal withdrawals whose dimension is null,
Diário/Mensal adjustments, house/provider mappings, `sync_paused`, and both
Google Sheet tabs. Store under:

```text
../output/pinbet-diario-mensal/$PINBET_BATCH_ID/backup.json
```

Write `manifest.json` with counts and the backup SHA-256, then reopen both files
and validate before proceeding.

- [ ] **Step 4: Implement quiesce and pending cancellation**

Set `sync_paused=true` and `withdrawalEnabled=false` for both Pinbet houses.
Recheck that no Pinbet `sync_logs.status='RUNNING'` exists. Cancel only exact
backup IDs with this compare-and-set predicate:

```sql
UPDATE withdrawal_requests
SET status = 'REJECTED',
    "adminNote" = CASE
      WHEN "adminNote" = '' THEN 'Cancelado na migração Pinbet Diário para Mensal'
      ELSE "adminNote" || E'\nCancelado na migração Pinbet Diário para Mensal'
    END,
    "updatedAt" = now()
WHERE id = ANY($1::uuid[])
  AND "bettingHouse" = 'pinbet-diario'
  AND status = 'PENDING'
  AND "gatewayId" IS NULL
  AND "gatewaySentAt" IS NULL
RETURNING id;
```

Assert the returned IDs equal the backup pending IDs. Run the pre-rekey balance
snapshot only after this cancellation. If a later step fails, rollback restores
the original pending statuses from backup.

- [ ] **Step 5: Implement the atomic database migration**

Within `SERIALIZABLE`, acquire:

```sql
SELECT pg_advisory_xact_lock(hashtext('pinbet-diario-to-mensal-v1'));
LOCK TABLE affiliate_links, affiliate_data, withdrawal_requests,
  balance_adjustments, provider_account_houses, betting_houses IN SHARE ROW EXCLUSIVE MODE;
```

Repeat preview predicates and abort on drift. Apply:

```sql
UPDATE affiliate_links SET "linkType"='afp2', "updatedAt"=now()
WHERE "bettingHouse"='pinbet-mensal' AND "deletedAt" IS NULL AND coalesce("linkType",'')='';

UPDATE affiliate_links SET "bettingHouse"='pinbet-mensal', "linkType"='afp1', "updatedAt"=now()
WHERE "bettingHouse"='pinbet-diario' AND "deletedAt" IS NULL;

UPDATE affiliate_data SET "bettingHouse"='pinbet-mensal', "updatedAt"=now()
WHERE "bettingHouse"='pinbet-diario';

UPDATE withdrawal_requests SET "pinbetDimension"='AFP2'
WHERE "bettingHouse"='pinbet-mensal' AND "pinbetDimension" IS NULL;

UPDATE balance_adjustments SET "pinbetDimension"='AFP2', "updatedAt"=now()
WHERE "bettingHouse"='pinbet-mensal' AND "pinbetDimension" IS NULL;

UPDATE withdrawal_requests
SET "bettingHouse"='pinbet-mensal', "pinbetDimension"='AFP1', "updatedAt"=now()
WHERE "bettingHouse"='pinbet-diario';

UPDATE balance_adjustments
SET "bettingHouse"='pinbet-mensal', "pinbetDimension"='AFP1',
    reason=concat_ws(E'\n', nullif(reason,''), 'Origem: pinbet-diario; dimensão: afp1'), "updatedAt"=now()
WHERE "bettingHouse"='pinbet-diario';

UPDATE provider_account_houses SET active=false, "updatedAt"=now()
WHERE "bettingHouseSlug"='pinbet-diario';

UPDATE provider_account_houses SET active=true, "bookmarkerId"='afp1,afp2', "updatedAt"=now()
WHERE "bettingHouseSlug"='pinbet-mensal';

UPDATE betting_houses SET active=false, "syncMode"='MANUAL', "withdrawalEnabled"=false, "updatedAt"=now()
WHERE slug='pinbet-diario';

UPDATE betting_houses SET active=true, "syncMode"='AUTO', "withdrawalEnabled"=true, "updatedAt"=now()
WHERE slug='pinbet-mensal';
```

Insert one master `audit_logs` row and one per migrated user with `batchId`, old
and new link IDs/campaigns/rates, withdrawal IDs/statuses/totals, and backup
hash. Commit only after returned counts match the locked preview.

- [ ] **Step 6: Implement idempotent Sheet mirroring**

Read the Diário and Mensal tabs. Append only Diário campaigns absent from the
Mensal code column, preserving identification, code, URL, marked status, and
e-mail. Store appended row numbers in the operation result. A retry must append
zero duplicates.

- [ ] **Step 7: Implement `verify` and automatic rollback trigger**

Verify counts, metric money sums, withdrawal counts/status/value/gateway fields,
campaign rates, dimensions, house configuration, provider mapping, audit count,
backup hash, and sheet rows. Run the post-migration balance snapshot and compare
every user's Mensal `total` and `withdrawable` to the pre-rekey expected values
in cents. Any database, rate, withdrawal, or balance mismatch invokes rollback
before re-enabling operations. A Sheet mismatch records `SHEET_SYNC_PENDING`,
keeps sync and withdrawals paused, and retries the idempotent Sheet step; it
does not silently undo a database migration whose financial verification passed.

- [ ] **Step 8: Implement guarded rollback**

Require:

```bash
PINBET_BATCH_ID="$(node -e "const fs=require('fs');const x=JSON.parse(fs.readFileSync('../output/pinbet-diario-mensal/latest.json','utf8'));process.stdout.write(x.batchId)")"
node --env-file=.env scripts/pinbet-diario-to-mensal.mjs rollback \
  --backup "../output/pinbet-diario-mensal/$PINBET_BATCH_ID/backup.json" \
  --confirm "$PINBET_BATCH_ID"
```

Validate every current row against the stored expected post-state, restore all
rows by primary key in one serializable transaction, restore house/provider and
pause configuration, and insert a rollback audit master row. Clear appended
Sheet ranges only when their current contents exactly equal the backup's
expected appended values.

- [ ] **Step 9: Run syntax, helper, and dry-run checks**

```bash
node --check scripts/pinbet-diario-to-mensal.mjs
node --check scripts/pinbet-balance-snapshot.mjs
pnpm test -- scripts/lib/pinbet-diario-mensal-migration.spec.ts
node --env-file=.env scripts/pinbet-diario-to-mensal.mjs preview
```

Expected: syntax/tests pass and preview performs no writes.

- [ ] **Step 10: Commit**

```bash
git add scripts/pinbet-diario-to-mensal.mjs scripts/pinbet-balance-snapshot.mjs
git commit -m "feat(pinbet): add audited daily to monthly migration"
```

### Task 9: Run full focused verification before production

**Files:**
- No additional files expected

- [ ] **Step 1: Run all affected tests**

```bash
pnpm test -- \
  src/modules/withdrawal/domain/pinbet-dimension.spec.ts \
  src/modules/withdrawal/domain/pinbet-withdrawal-limit.spec.ts \
  src/modules/dashboard/application/dashboard-balance.service.spec.ts \
  src/modules/withdrawal/application/withdrawal.service.spec.ts \
  src/modules/sync/infrastructure/extractors/smartico.extractor.spec.ts \
  src/modules/sync/application/sync-orchestrator.service.spec.ts \
  scripts/lib/pinbet-diario-mensal-migration.spec.ts
```

Expected: all focused tests pass.

- [ ] **Step 2: Run static verification**

```bash
pnpm exec eslint \
  src/modules/withdrawal/domain/pinbet-dimension.ts \
  src/modules/withdrawal/domain/pinbet-withdrawal-limit.ts \
  src/modules/dashboard/application/dashboard-balance.service.ts \
  src/modules/withdrawal/application/withdrawal.service.ts \
  src/modules/sync/infrastructure/extractors/smartico.extractor.ts
pnpm build
pnpm exec prisma validate
```

Expected: all commands exit `0`.

- [ ] **Step 3: Run rollback simulation**

Run preview to generate a read-only operation manifest, then run rollback in
validation-only mode:

```bash
node --env-file=.env scripts/pinbet-diario-to-mensal.mjs preview --write-manifest
node --env-file=.env scripts/pinbet-diario-to-mensal.mjs rollback \
  --backup ../output/pinbet-diario-mensal/preview/backup.json \
  --validate-only
```

Expected: validation succeeds and reports zero writes.

- [ ] **Step 4: Record verification commit**

If verification required no source changes, do not create an empty commit. If
test-only corrections were needed, commit only those corrections with:

```bash
git add \
  src/modules/withdrawal/domain/pinbet-dimension.ts \
  src/modules/withdrawal/domain/pinbet-dimension.spec.ts \
  src/modules/withdrawal/domain/pinbet-withdrawal-limit.ts \
  src/modules/withdrawal/domain/pinbet-withdrawal-limit.spec.ts \
  src/modules/dashboard/application/dashboard-balance.service.ts \
  src/modules/dashboard/application/dashboard-balance.service.spec.ts \
  src/modules/sync/infrastructure/extractors/smartico.extractor.ts \
  src/modules/sync/infrastructure/extractors/smartico.extractor.spec.ts \
  scripts/lib/pinbet-diario-mensal-migration.mjs \
  scripts/lib/pinbet-diario-mensal-migration.spec.ts
git commit -m "test(pinbet): verify migration safeguards"
```

### Task 10: Deploy and execute the production migration

**Files:**
- Runtime backup artifacts under `../output/pinbet-diario-mensal/$PINBET_BATCH_ID/`

- [ ] **Step 1: Deploy schema and backward-compatible application code**

Run in the production deployment environment:

```bash
pnpm install --frozen-lockfile
pnpm prisma:deploy
pnpm build
```

Restart and verify the backend with the repository's configured PM2 process:

```bash
pm2 restart api-mjmcompany-affiliates --update-env
curl -fsS http://127.0.0.1:3011/health
```

Expected: PM2 reports `online` and the health request exits `0`. Do not run the
data migration before both checks pass.

- [ ] **Step 2: Run a fresh production preview**

```bash
node --env-file=.env scripts/pinbet-diario-to-mensal.mjs preview
PINBET_PREVIEW_TOKEN="$(node -e "const fs=require('fs');const x=JSON.parse(fs.readFileSync('../output/pinbet-diario-mensal/latest-preview.json','utf8'));process.stdout.write(x.previewToken)")"
```

Expected: exact current counts are printed, pending gateway linkage is zero,
and every abort predicate is false.

- [ ] **Step 3: Apply with the preview confirmation token**

```bash
node --env-file=.env scripts/pinbet-diario-to-mensal.mjs apply \
  --confirm "$PINBET_PREVIEW_TOKEN"
PINBET_BATCH_ID="$(node -e "const fs=require('fs');const x=JSON.parse(fs.readFileSync('../output/pinbet-diario-mensal/latest.json','utf8'));process.stdout.write(x.batchId)")"
```

The CLI prints the `batchId` and backup paths before any mutation. Keep that
terminal open until verification finishes.

- [ ] **Step 4: Verify and reconcile Smartico**

Run:

```bash
node --env-file=.env scripts/pinbet-diario-to-mensal.mjs verify \
  --backup "../output/pinbet-diario-mensal/$PINBET_BATCH_ID/backup.json"
```

Then trigger one controlled Mensal sync for the required recent date window.
Verify the sync log reports both `afp1` and `afp2` and that no Diário sync ran.

- [ ] **Step 5: Final independent checks**

Confirm:

```text
pinbet-diario active links = 0
pinbet-diario affiliate_data rows = 0
pinbet-diario pending withdrawals = 0
all former Diário withdrawals now reference pinbet-mensal
former Diário PENDING rows are REJECTED
COMPLETED IDs/status/amount/gateway values are unchanged
all former Diário links are pinbet-mensal + afp1 with unchanged CPA/revshare
all prior Mensal links are afp2
per-user expected and actual balance snapshots match to the cent
backup and manifest hashes validate
one master audit and one audit per migrated user exist
```

- [ ] **Step 6: Restore normal operation only after verification**

Set `sync_paused` back to its backed-up value. Keep Diário inactive/manual with
withdrawals disabled; keep Mensal active/auto with withdrawals enabled. Report
the batch ID, backup path, counts, totals, cancelled pending amount, audit IDs,
sheet rows appended, sync result, and balance comparison result.
