# Betano Diario Sheet Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Betano Diario assignment and metrics around the new Google Sheet, enforce the approved CPA and Superbet eligibility rules, isolate its dashboard data, and provide a guarded full-reset operation.

**Architecture:** Keep assignment, metric parsing, metric persistence, and reset support inside the existing `betano-diario-link-pool` boundary. Use header-driven parsers, an idempotent sheet metrics sync with its own Redis lock, the existing deal-eligibility response contract for the 10-CPA/30-day gate, and a dry-run/snapshot-token reset script for destructive state changes.

**Tech Stack:** NestJS, TypeScript, Prisma/PostgreSQL, Google Sheets API, Redis, Vitest, Vue 3/Nuxt frontend

---

### Task 1: Make the Betano Diario `LINKS` pool header-driven

**Files:**
- Create: `src/modules/betano-diario-link-pool/domain/betano-diario-sheet.parser.ts`
- Create: `src/modules/betano-diario-link-pool/domain/betano-diario-sheet.parser.spec.ts`
- Create: `src/modules/betano-diario-link-pool/application/betano-diario-sheet.service.spec.ts`
- Modify: `src/modules/betano-diario-link-pool/application/betano-diario-sheet.service.ts`
- Modify: `src/modules/betano-diario-link-pool/domain/betano-diario.types.ts`

- [ ] **Step 1: Write failing parser and sheet-service tests**

Cover `LINK | STATUS | E-MAIL`, reordered/case-insensitive headers, missing and
duplicate header rejection, row indexes, and control-cell writes. The core
expectation is:

```ts
expect(parseBetanoDiarioPoolSheet([
  ['LINK', 'STATUS', 'E-MAIL'],
  ['https://kg-br.com/C.ashx?siteid=52769&c=VALLEX101', '', ''],
])).toEqual({
  columns: { status: 'B', email: 'C' },
  rows: [{
    rowIndex: 2,
    link: 'https://kg-br.com/C.ashx?siteid=52769&c=VALLEX101',
    status: '',
    email: '',
  }],
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
pnpm vitest run \
  src/modules/betano-diario-link-pool/domain/betano-diario-sheet.parser.spec.ts \
  src/modules/betano-diario-link-pool/application/betano-diario-sheet.service.spec.ts
```

Expected: FAIL because the parser does not exist and the service still reads
fixed `A2:D` columns.

- [ ] **Step 3: Implement the parser and update the sheet service**

Use normalized header names, convert zero-based indexes to A1 letters, read
`'LINKS'!A1:ZZ`, cache the resolved control columns, and batch-write only the
resolved STATUS/E-MAIL cells. Keep the Sheets scope writable because assignment
must mark rows.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run the command from Step 2. Expected: all selected tests PASS.

- [ ] **Step 5: Commit the pool contract**

```bash
git add src/modules/betano-diario-link-pool
git commit -m "feat(betano-diario): read links pool by headers"
```

### Task 2: Parse dated metric tabs safely

**Files:**
- Create: `src/modules/betano-diario-link-pool/domain/betano-diario-metrics.parser.ts`
- Create: `src/modules/betano-diario-link-pool/domain/betano-diario-metrics.parser.spec.ts`
- Create: `src/modules/betano-diario-link-pool/application/betano-diario-metrics-sheet.service.ts`
- Create: `src/modules/betano-diario-link-pool/application/betano-diario-metrics-sheet.service.spec.ts`

- [ ] **Step 1: Write failing date, header, and row tests**

Cover strict real dates, Sao Paulo future-tab filtering, row-2 headers, blank
metrics, explicit zeros, Brazilian decimals, malformed URLs, negative/decimal
counts, and duplicate headers. Assert the approved mapping:

```ts
expect(row).toMatchObject({
  campaignId: '52769-VALLEX101',
  affiliateId: '52769',
  clicks: 3,
  registrations: 2,
  ftds: 1,
  deposit: 20,
  cpaQualified: 1,
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

```bash
pnpm vitest run \
  src/modules/betano-diario-link-pool/domain/betano-diario-metrics.parser.spec.ts \
  src/modules/betano-diario-link-pool/application/betano-diario-metrics-sheet.service.spec.ts
```

Expected: FAIL because the metric parser and reader do not exist.

- [ ] **Step 3: Implement pure parsing helpers**

Expose strict helpers equivalent to:

```ts
parseMetricTabDate('03/09/2026')
parseMetricRows('03/09/2026', values)
hasExplicitMetricValue(row)
```

Return row-level issues with tab and spreadsheet row number. Blank metric cells
produce no row; the string `0` produces a valid zero-valued row.

- [ ] **Step 4: Implement the read-only Sheets reader**

List sheet titles with `spreadsheets.get`, filter valid dates through the
current Sao Paulo day, and `batchGet` quoted ranges `'<tab>'!A1:F`. Return parsed
rows plus structured issues; absence of a date is represented by no tab and is
not an exception.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run the command from Step 2. Expected: all selected tests PASS.

- [ ] **Step 6: Commit dated-tab parsing**

```bash
git add src/modules/betano-diario-link-pool
git commit -m "feat(betano-diario): parse dated metrics tabs"
```

### Task 3: Persist Betano Diario metrics idempotently

**Files:**
- Create: `src/modules/betano-diario-link-pool/application/betano-diario-metrics-sync.service.ts`
- Create: `src/modules/betano-diario-link-pool/application/betano-diario-metrics-sync.service.spec.ts`
- Modify: `src/modules/betano-diario-link-pool/betano-diario-link-pool.module.ts`
- Modify: `src/modules/betano-diario-link-pool/infrastructure/betano-diario-admin.controller.ts`

- [ ] **Step 1: Write failing sync tests**

Test paused/manual/inactive guards, Redis exclusion, skipping rows without an
active link, CPA calculation, upsert keys, explicit-zero updates, change-log
creation, sync-log completion/failure, last-sync update, webhook emission, and
the manual endpoint. The financial expectation is:

```ts
expect(upsertData).toMatchObject({
  bettingHouse: 'betano-diario',
  campaignName: '52769-VALLEX101',
  utmCampaign: 'sheet',
  qftd: 2,
  cpaQualified: 2,
  cpaValue: 120,
  revShare: 0,
  totalCommission: 120,
  source: 'betano-diario-sheet',
});
```

- [ ] **Step 2: Run the sync test and verify RED**

```bash
pnpm vitest run src/modules/betano-diario-link-pool/application/betano-diario-metrics-sync.service.spec.ts
```

Expected: FAIL because the sync service does not exist.

- [ ] **Step 3: Implement the sync service**

Run every 15 minutes in `America/Sao_Paulo`; respect `sync_paused`, house
activity, and `syncMode`. Acquire `betano-diario:metrics-sync:lock`, read parsed
rows, prefetch active real links by campaign ID, and upsert into
`affiliate_data` under `betano-diario`. Use `isMaterialChange` and
`buildChangeLogData` for history. Create/complete one `SyncLog` per cycle and
emit `affiliate_data.synced` only when a row was written.

- [ ] **Step 4: Wire module and controller**

Import `SettingsModule`, register both metric services, and add:

```ts
@Post('sync-metrics')
@HttpCode(HttpStatus.ACCEPTED)
async syncMetrics(): Promise<{ triggered: true }>
```

The endpoint starts the same guarded service asynchronously.

- [ ] **Step 5: Run focused and related tests**

```bash
pnpm vitest run \
  src/modules/betano-diario-link-pool \
  src/modules/link-webhook/application/link-webhook.service.spec.ts
```

Expected: all selected tests PASS.

- [ ] **Step 6: Commit metric persistence**

```bash
git add src/modules/betano-diario-link-pool
git commit -m "feat(betano-diario): sync daily sheet metrics"
```

### Task 4: Enforce the 10-CPA Superbet gate for 30 days

**Files:**
- Create: `src/modules/link-request/application/deal-eligibility.service.spec.ts`
- Modify: `src/modules/link-request/application/deal-eligibility.service.ts`
- Modify: `src/modules/link-request/domain/types/link-request.types.ts`
- Modify: `src/modules/link-request/application/link-request.service.ts`
- Modify: `src/modules/link-request/application/link-request.create.spec.ts`
- Modify: `src/modules/link-request/application/link-request.list-deals.spec.ts`
- Modify: `frontend/app/pages/deals.vue`
- Modify: `frontend/app/components/DealCard.vue`

- [ ] **Step 1: Write failing eligibility aggregation tests**

Prove that all real active Superbet campaigns owned by the requester are
aggregated, placeholder/deleted links and network campaigns are excluded, and
the rolling window is 30 Sao Paulo dates. Cover 9, 10, and 11 qualified CPAs.

- [ ] **Step 2: Write failing request/list agreement tests**

Assert that only `betano-diario` requires eligibility, the POST returns 403
without creating a request below 10, exactly 10 proceeds, and the deal-list
eligibility object uses `minQualifiedFtd=10`, `minAvgDepositPerFtd=0`, and
`windowDays=30`.

- [ ] **Step 3: Run tests and verify RED**

```bash
pnpm vitest run \
  src/modules/link-request/application/deal-eligibility.service.spec.ts \
  src/modules/link-request/application/link-request.create.spec.ts \
  src/modules/link-request/application/link-request.list-deals.spec.ts
```

Expected: FAIL because eligibility is disabled and the snapshot reads one
arbitrary Superbet link.

- [ ] **Step 4: Implement the gate**

Enable `isDealEligibilityRequired()` only for `betano-diario` without an
existing real active house link. Query all real active Superbet campaign IDs,
sum `affiliate_data.cpaQualified`, use a 30-day Sao Paulo window, and pass a
zero Superbet average-deposit threshold while keeping the deal's own R$20
commercial condition.

- [ ] **Step 5: Adjust frontend eligibility wording**

When `eligibility.minAvgDepositPerFtd <= 0`, render only the qualified-CPA count
and window, for example `Minimo 10 CPAs na Superbet em 30 dias`; keep the
existing combined QFTD/average wording for any future gate that uses both.

- [ ] **Step 6: Run backend and frontend checks**

```bash
pnpm vitest run src/modules/link-request/application
pnpm --dir ../frontend typecheck
```

Expected: selected backend tests and frontend typecheck PASS.

- [ ] **Step 7: Commit eligibility**

```bash
git add src/modules/link-request ../frontend/app/pages/deals.vue ../frontend/app/components/DealCard.vue
git commit -m "feat(betano-diario): require superbet CPA eligibility"
```

### Task 5: Apply the approved commercial configuration and data isolation

**Files:**
- Modify: `.env`
- Modify: `.env.prod`
- Modify: `.env.example`
- Modify: `src/modules/betano-diario-link-pool/domain/betano-diario.types.ts`
- Modify: `scripts/seed-betano-diario.mjs`
- Modify: `src/modules/dashboard/domain/house-alias.ts`
- Modify: `src/modules/dashboard/application/dashboard.service.spec.ts`
- Modify: `src/modules/dashboard/application/dashboard-balance.service.spec.ts`

- [ ] **Step 1: Write failing isolation tests**

Add assertions that `dataSourceHouse('betano-diario')` returns itself and that
dashboard filters query `bettingHouse='betano-diario'` without alias campaign
remapping.

- [ ] **Step 2: Run isolation tests and verify RED**

```bash
pnpm vitest run \
  src/modules/dashboard/application/dashboard.service.spec.ts \
  src/modules/dashboard/application/dashboard-balance.service.spec.ts
```

Expected: the new Betano Diario assertions FAIL because the alias still maps to
`betano`.

- [ ] **Step 3: Update environment and constants**

Set the approved sheet ID and `LINKS` tab in local, production, and example env
files. Change default Betano Diario CPA to 60 and keep RevShare zero.

- [ ] **Step 4: Update the idempotent seed**

Upsert these exact values:

```text
BettingHouse.minAvgDepositPerCpa = 20
BettingHouse.minWithdrawalAmount = 100
Deal.cpa = 60
Deal.revshare = 0
Deal.minAvgDepositPerFtd = 20
Deal.minQualifiedFtd = 10
HouseLinkRule.defaultCpa = 60
HouseLinkRule.fallbackCpa = 60
HouseLinkRule.inviterCpaDiscount = 5
HouseLinkRule.defaultRevshare = 0
```

Retain the global inviter-without-CPA hold behavior.

- [ ] **Step 5: Remove only the Betano Diario alias**

Delete `'betano-diario': 'betano'` from `HOUSE_DATA_SOURCE`; retain Esportiva
and Sportingbet aliases unchanged.

- [ ] **Step 6: Run isolation tests and verify GREEN**

Run the command from Step 2. Expected: all selected tests PASS.

- [ ] **Step 7: Commit configuration and isolation**

```bash
git add .env .env.prod .env.example scripts/seed-betano-diario.mjs \
  src/modules/betano-diario-link-pool/domain/betano-diario.types.ts \
  src/modules/dashboard
git commit -m "feat(betano-diario): apply new deal and isolate data"
```

### Task 6: Implement the guarded full reset

**Files:**
- Create: `scripts/lib/reset-betano-diario.ts`
- Create: `scripts/lib/reset-betano-diario.spec.ts`
- Create: `scripts/reset-betano-diario.mjs`

- [ ] **Step 1: Write failing pure reset-helper tests**

Test exact slug/campaign predicates, snapshot token hashing, drift comparison,
table ordering, aggregate totals, future proof unknown-table reporting, and
sheet control-cell range generation. No test connects to a shared database.

- [ ] **Step 2: Run helper tests and verify RED**

```bash
pnpm vitest run scripts/lib/reset-betano-diario.spec.ts
```

Expected: FAIL because the reset helper does not exist.

- [ ] **Step 3: Implement dry-run and snapshot creation**

Resolve every Betano Diario link campaign before mutation. Inventory all tables
named in the design, legacy `betano` metrics limited to those campaigns,
withdrawal gateway linkage, sheet STATUS/E-MAIL values, counts, and monetary
totals. Write JSON under `output/betano-diario-reset/<timestamp>/`, calculate
SHA-256, and print the exact apply command without secrets.

- [ ] **Step 4: Implement guarded apply**

Require:

```bash
node --env-file=.env scripts/reset-betano-diario.mjs \
  --apply --snapshot-token=<sha256>
```

Re-read live counts, reject drift, acquire a PostgreSQL advisory transaction
lock, and delete dependencies before parents in a serializable transaction.
Create the canonical house/deal/rule and an append-only audit record in the
same transaction. After commit, clear only STATUS/E-MAIL cells in `LINKS`.

- [ ] **Step 5: Implement independent verification and sheet retry**

Open a new connection after apply and assert all reset targets are zero plus the
canonical configuration is exact. Support a non-database `--retry-sheet
--snapshot-token=<sha256>` path for an external sheet-write failure.

- [ ] **Step 6: Run helper tests and script syntax checks**

```bash
pnpm vitest run scripts/lib/reset-betano-diario.spec.ts
node --check scripts/reset-betano-diario.mjs
```

Expected: tests PASS and Node syntax check exits zero.

- [ ] **Step 7: Commit reset tooling**

```bash
git add scripts/lib/reset-betano-diario.ts \
  scripts/lib/reset-betano-diario.spec.ts scripts/reset-betano-diario.mjs
git commit -m "feat(betano-diario): add guarded full reset"
```

### Task 7: Verify the integrated implementation

**Files:**
- Verify: all files changed in Tasks 1-6

- [ ] **Step 1: Run focused Betano Diario and eligibility tests**

```bash
pnpm vitest run \
  src/modules/betano-diario-link-pool \
  src/modules/link-request/application/deal-eligibility.service.spec.ts \
  src/modules/link-request/application/link-request.create.spec.ts \
  src/modules/link-request/application/link-request.list-deals.spec.ts \
  src/modules/dashboard/application/dashboard.service.spec.ts \
  src/modules/dashboard/application/dashboard-balance.service.spec.ts \
  scripts/lib/reset-betano-diario.spec.ts
```

Expected: all selected tests PASS.

- [ ] **Step 2: Run backend static and build checks**

```bash
pnpm tsc --noEmit
pnpm build
pnpm eslint \
  src/modules/betano-diario-link-pool \
  src/modules/link-request/application/deal-eligibility.service.ts \
  src/modules/link-request/domain/types/link-request.types.ts \
  src/modules/link-request/application/link-request.service.ts \
  src/modules/dashboard/domain/house-alias.ts \
  scripts/lib/reset-betano-diario.ts
```

Expected: all commands exit zero.

- [ ] **Step 3: Run frontend checks**

```bash
pnpm --dir ../frontend typecheck
pnpm --dir ../frontend build
```

Expected: both commands exit zero.

- [ ] **Step 4: Run a non-mutating live preview only if PostgreSQL accepts connections**

```bash
node --env-file=.env scripts/reset-betano-diario.mjs
```

Expected: a snapshot, exact target counts/totals, and an apply token. Do not run
the printed apply command in this implementation task.

- [ ] **Step 5: Inspect final repository state**

```bash
git diff --check
git status --short
git log --oneline -10
```

Expected: no whitespace errors, only intentionally uncommitted operational
snapshot output if preview ran, and all implementation commits present.
