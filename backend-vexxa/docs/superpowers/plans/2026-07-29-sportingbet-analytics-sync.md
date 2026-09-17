# Sportingbet Analytics Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move both Sportingbet OTG syncs to the campaign analytics endpoint and persist clicks, deposits, and betting volume without changing commission rules.

**Architecture:** Update the single shared `OtgExtractor`, because both `sportingbet` and `sportingbet-diario` are associated with provider `otg`. Keep the extractor port unchanged, ignore the now-unused `bookmarkerId`, validate `data.rows` plus pagination metadata, and map the analytics fields into the existing `ExtractedReport` model.

**Tech Stack:** NestJS, TypeScript, native `fetch`, Vitest, Prisma sync pipeline

---

### Task 1: Specify the analytics request and metric mapping

**Files:**
- Modify: `src/modules/sync/infrastructure/extractors/otg.extractor.spec.ts`
- Test: `src/modules/sync/infrastructure/extractors/otg.extractor.spec.ts`

- [ ] **Step 1: Replace the existing report fixture with the analytics contract**

Change the paginated test payload from `data.data` to `data.rows` and use the
new fields:

```ts
data: {
  rows: [
    {
      affiliate: ' Caio Fernandes  Rocha Souza ',
      campaign: ' Telegram ',
      clicks: 23,
      registrations: 7,
      ftd: 2,
      cpa_qual: 1,
      deposits: 99.97,
      bet_amount: 88.8,
      ngr: 36.19,
    },
    {
      affiliate: ' ',
      campaign: 'Cadastro',
      registrations: 9,
    },
  ],
  meta: { currentPage: 1, totalPages: 2, pageSize: 10000 },
}
```

Use a second page containing:

```ts
data: {
  rows: [
    {
      affiliate: 'Maria Silva',
      campaign: 'Instagram',
      clicks: 'invalid',
      registrations: 'invalid',
      ftd: 0,
      cpa_qual: 0,
      deposits: 0,
      bet_amount: 'invalid',
      ngr: -15,
    },
  ],
  meta: { currentPage: 2, totalPages: 2, pageSize: 10000 },
}
```

- [ ] **Step 2: Assert the new endpoint and query**

Replace the old `/agency/results/table` expectations with:

```ts
expect(url.pathname).toBe('/api/v1/agency/sportingbet-analytics');
expect(Object.fromEntries(url.searchParams)).toMatchObject({
  initialDate: '2026-07-27',
  finalDate: '2026-07-27',
  scope: 'CAMPAIGNS',
  sortBy: 'affiliate',
  sortDirection: 'asc',
  pageSize: '10000',
});
expect(url.searchParams.has('bettingHouseId')).toBe(false);
expect(url.searchParams.has('tab')).toBe(false);
expect(url.searchParams.has('viewMode')).toBe(false);
```

Keep the authorization-header assertion unchanged.

- [ ] **Step 3: Assert the complete analytics mapping**

Change the first expected report to:

```ts
expect(reports[0]).toEqual({
  campaignId: 'CaioFernandesRochaSouza::Telegram',
  affiliateId: 'CaioFernandesRochaSouza',
  date: new Date('2026-07-27T00:00:00.000Z'),
  clicks: 23,
  registrations: 7,
  ftds: 2,
  qftd: 1,
  deposit: 99.97,
  netPl: null,
  withdrawalTotal: null,
  volume: 88.8,
  revShare: 0,
  cpaQualified: 1,
  cpaValue: 0,
  totalCommission: 0,
});
```

Assert that the second report converts invalid scalar metrics to zero, keeps
`netPl` null despite a numeric `ngr`, and keeps RevShare zero:

```ts
expect(reports[1]).toMatchObject({
  campaignId: 'MariaSilva::Instagram',
  clicks: 0,
  registrations: 0,
  volume: 0,
  netPl: null,
  revShare: 0,
  cpaValue: 0,
  totalCommission: 0,
});
```

- [ ] **Step 4: Update the empty and later-page fixtures**

Use `data.rows` in the later-page failure setup and in the valid empty report:

```ts
data: {
  rows: [],
  meta: {
    currentPage: 1,
    totalPages: 0,
    totalRows: 0,
    pageSize: 10000,
  },
}
```

- [ ] **Step 5: Run the focused test and verify RED**

Run:

```bash
pnpm vitest run src/modules/sync/infrastructure/extractors/otg.extractor.spec.ts
```

Expected: FAIL because the extractor still requests
`/agency/results/table`, reads `data.data`, and maps the legacy fields.

### Task 2: Implement the analytics extractor contract

**Files:**
- Modify: `src/modules/sync/infrastructure/extractors/otg.extractor.ts`
- Test: `src/modules/sync/infrastructure/extractors/otg.extractor.spec.ts`

- [ ] **Step 1: Replace the legacy row and payload types**

Use the analytics response fields:

```ts
interface OtgAnalyticsRow {
  affiliate?: unknown;
  campaign?: unknown;
  clicks?: unknown;
  registrations?: unknown;
  ftd?: unknown;
  cpa_qual?: unknown;
  deposits?: unknown;
  bet_amount?: unknown;
  ngr?: unknown;
}

interface OtgAnalyticsPayload {
  data?: {
    rows?: unknown;
    meta?: {
      totalPages?: unknown;
    };
  };
}
```

Set:

```ts
const PAGE_SIZE = 10_000;
```

- [ ] **Step 2: Request every analytics page**

Keep the extractor method signature compatible, but mark the bookmaker
parameter unused:

```ts
async fetchReports(
  accessToken: string,
  date: string,
  _bookmarkerId: string,
): Promise<ExtractedReport[]> {
```

Build each page with:

```ts
const url = new URL(
  `${this.apiBaseUrl}/agency/sportingbet-analytics`,
);
url.search = new URLSearchParams({
  initialDate: date,
  finalDate: date,
  scope: 'CAMPAIGNS',
  sortBy: 'affiliate',
  sortDirection: 'asc',
  page: String(page),
  pageSize: String(PAGE_SIZE),
}).toString();
```

Read rows and pagination from:

```ts
const pageRows = payload.data?.rows;
const pageCount = payload.data?.meta?.totalPages;
```

Retain the existing strict shape validation, empty-report exception, all-page
loop, HTTP handling, and invalid-JSON handling.

- [ ] **Step 3: Map analytics metrics**

Normalize identity exactly as before, then map:

```ts
const qualifiedCpa = finiteNumber(row.cpa_qual);
return [
  {
    campaignId: `${affiliate}::${campaign}`,
    affiliateId: affiliate,
    date: new Date(`${date}T00:00:00.000Z`),
    clicks: finiteNumber(row.clicks),
    registrations: finiteNumber(row.registrations),
    ftds: finiteNumber(row.ftd),
    qftd: qualifiedCpa,
    deposit: finiteNumber(row.deposits),
    netPl: null,
    withdrawalTotal: null,
    volume: finiteNumber(row.bet_amount),
    revShare: 0,
    cpaQualified: qualifiedCpa,
    cpaValue: 0,
    totalCommission: 0,
  },
];
```

Do not map `ngr`.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
pnpm vitest run src/modules/sync/infrastructure/extractors/otg.extractor.spec.ts
```

Expected: all OTG extractor tests PASS.

- [ ] **Step 5: Run related sync tests**

Run:

```bash
pnpm vitest run \
  src/modules/sync/infrastructure/extractors/otg.extractor.spec.ts \
  src/modules/sync/application/sync-orchestrator.service.spec.ts \
  src/modules/sync/infrastructure/scheduling/sync-scheduler.service.spec.ts
```

Expected: all selected test files PASS.

- [ ] **Step 6: Commit the extractor migration**

```bash
git add \
  src/modules/sync/infrastructure/extractors/otg.extractor.ts \
  src/modules/sync/infrastructure/extractors/otg.extractor.spec.ts
git diff --cached --check
git commit -m "feat(sportingbet): sync analytics metrics"
```

### Task 3: Verify repository compatibility

**Files:**
- Verify: `src/modules/sync/infrastructure/extractors/otg.extractor.ts`
- Verify: `src/modules/sync/infrastructure/extractors/otg.extractor.spec.ts`

- [ ] **Step 1: Run the complete backend test suite excluding the known unrelated affiliate API mock failure**

```bash
pnpm vitest run \
  --exclude src/modules/affiliate-api/application/affiliate-api.service.spec.ts
```

Expected: all selected tests PASS.

- [ ] **Step 2: Run typecheck and build**

```bash
pnpm tsc --noEmit
pnpm build
```

Expected: both commands exit with code 0.

- [ ] **Step 3: Run scoped lint and formatting checks**

```bash
pnpm eslint \
  src/modules/sync/infrastructure/extractors/otg.extractor.ts \
  src/modules/sync/infrastructure/extractors/otg.extractor.spec.ts
pnpm prettier --check \
  src/modules/sync/infrastructure/extractors/otg.extractor.ts \
  src/modules/sync/infrastructure/extractors/otg.extractor.spec.ts
git diff --check
```

Expected: all commands exit with code 0.

- [ ] **Step 4: Confirm only intended files were committed**

```bash
git status --short
git log -3 --oneline
```

Expected: the analytics implementation commit is present; pre-existing
unrelated modifications and untracked files remain untouched.
