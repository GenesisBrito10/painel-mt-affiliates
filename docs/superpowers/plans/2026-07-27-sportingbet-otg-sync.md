# Sportingbet OTG Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import the current São Paulo day's Sportingbet OTG campaign metrics through the existing sync scheduler, matching the typed link-pool identity and keeping RevShare at zero.

**Architecture:** Add an `OtgExtractor` behind the existing provider port, expose date-scope and token-TTL capabilities on extractors, and let the orchestrator enforce those capabilities for both Smartico and OTG. Reuse the current persistence and balance flow, then cut the Sportingbet provider association over with an idempotent, encrypted, dry-run-first script.

**Tech Stack:** NestJS 11, TypeScript 6, Vitest 4, Prisma 7, native `fetch`, PostgreSQL, AES-256-GCM

---

### Task 1: Generalize current-day providers and token lifetime

**Files:**
- Modify: `backend-vexxa/src/modules/sync/domain/ports/provider-extractor.port.ts`
- Modify: `backend-vexxa/src/modules/sync/application/sync-orchestrator.service.spec.ts`
- Modify: `backend-vexxa/src/modules/sync/application/sync-orchestrator.service.ts`
- Modify: `backend-vexxa/src/modules/sync/infrastructure/extractors/smartico.extractor.ts`

- [ ] **Step 1: Write failing orchestrator tests**

Add tests proving an extractor with `dateScope: 'current-day-only'` ignores
explicit historical dates and proving `tokenTtlMs` controls when a cached token
is refreshed:

```ts
const extractor = makeExtractor({
  providerSlug: 'otg',
  dateScope: 'current-day-only',
  tokenTtlMs: 10 * 60 * 1000,
  fetchReports,
});
```

Use fake time to assert one login before ten minutes and a second login after
the TTL.

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
cd backend-vexxa
pnpm vitest run src/modules/sync/application/sync-orchestrator.service.spec.ts
```

Expected: FAIL because `dateScope`, `tokenTtlMs`, and capability-based date
selection do not exist.

- [ ] **Step 3: Add extractor capabilities and minimal orchestrator support**

Add to `IProviderExtractor`:

```ts
readonly dateScope?: 'historical' | 'current-day-only';
readonly tokenTtlMs?: number;
```

Use `extractor.tokenTtlMs ?? TOKEN_TTL_MS` when caching a token. Replace the
Smartico slug condition with:

```ts
const isCurrentDayOnly = extractor?.dateScope === 'current-day-only';
```

Use this flag for requested-date collapse and gap-fill suppression. Declare
`dateScope = 'current-day-only'` on Smartico.

- [ ] **Step 4: Run the focused tests and confirm GREEN**

Run the same Vitest command and expect all orchestrator tests to pass.

- [ ] **Step 5: Commit**

```bash
git add backend-vexxa/src/modules/sync/domain/ports/provider-extractor.port.ts \
  backend-vexxa/src/modules/sync/application/sync-orchestrator.service.ts \
  backend-vexxa/src/modules/sync/application/sync-orchestrator.service.spec.ts \
  backend-vexxa/src/modules/sync/infrastructure/extractors/smartico.extractor.ts
git commit -m "refactor(sync): support provider date and token capabilities"
```

### Task 2: Enforce active provider-house associations

**Files:**
- Create: `backend-vexxa/src/modules/sync/infrastructure/scheduling/sync-scheduler.service.spec.ts`
- Modify: `backend-vexxa/src/modules/sync/infrastructure/scheduling/sync-scheduler.service.ts`

- [ ] **Step 1: Write failing scheduler tests**

Construct an active provider account whose Sportingbet association has
`active: false`. Assert that `runAllHouses`, `runRecentForAllHouses`, and
`runHouse` never call `orchestrator.runSync`. Add a positive case for an active
association.

- [ ] **Step 2: Run the scheduler spec and confirm RED**

```bash
cd backend-vexxa
pnpm vitest run src/modules/sync/infrastructure/scheduling/sync-scheduler.service.spec.ts
```

Expected: inactive associations still invoke sync.

- [ ] **Step 3: Add the association checks**

Before checking the related betting house, add:

```ts
if (!house.active) continue;
```

Apply it to recent, all-house, and manual single-house paths.

- [ ] **Step 4: Run the scheduler spec and confirm GREEN**

Run the same Vitest command and expect all scheduler tests to pass.

- [ ] **Step 5: Commit**

```bash
git add backend-vexxa/src/modules/sync/infrastructure/scheduling/sync-scheduler.service.ts \
  backend-vexxa/src/modules/sync/infrastructure/scheduling/sync-scheduler.service.spec.ts
git commit -m "fix(sync): skip inactive provider house associations"
```

### Task 3: Implement the OTG extractor

**Files:**
- Create: `backend-vexxa/src/modules/sync/infrastructure/extractors/otg.extractor.spec.ts`
- Create: `backend-vexxa/src/modules/sync/infrastructure/extractors/otg.extractor.ts`

- [ ] **Step 1: Write failing login tests**

Test that login posts JSON credentials to the configured API base, returns
`data.access_token`, and raises `ProviderLoginFailedException` without leaking
the password when the token is absent.

- [ ] **Step 2: Run the extractor spec and confirm RED**

```bash
cd backend-vexxa
pnpm vitest run src/modules/sync/infrastructure/extractors/otg.extractor.spec.ts
```

Expected: FAIL because `OtgExtractor` does not exist.

- [ ] **Step 3: Implement login minimally**

Create `OtgExtractor` with:

```ts
readonly providerSlug = 'otg';
readonly dateScope = 'current-day-only' as const;
readonly tokenTtlMs = 10 * 60 * 1000;
```

Use native `fetch`, accept only a successful HTTP response containing a
non-empty `data.access_token`, and keep secrets out of error messages.

- [ ] **Step 4: Run login tests and confirm GREEN**

Run the extractor spec and expect the login cases to pass.

- [ ] **Step 5: Write failing pagination and mapping tests**

Mock two report pages. Assert page 2 is requested from
`data.meta.totalPages`, query parameters match the OTG contract, and output
contains:

```ts
{
  campaignId: 'CaioFernandesRochaSouza::Telegram',
  affiliateId: 'CaioFernandesRochaSouza',
  registrations: 2,
  ftds: 1,
  qftd: 1,
  cpaQualified: 1,
  deposit: 100,
  revShare: 0
}
```

Supply non-zero `rvs` and assert it is still zero internally. Also prove empty
affiliate/campaign rows are skipped and a failed later page rejects the whole
request.

- [ ] **Step 6: Run the extractor spec and confirm RED**

Expected: pagination and report mapping are absent.

- [ ] **Step 7: Implement report fetching and mapping**

Build each request with `URL`/`URLSearchParams`. Validate
`payload.data.data` and `payload.data.meta.totalPages`, request all pages, and
only return the combined mapped rows after every page succeeds. Normalize
finite numbers to their value and invalid values to zero. Set `revShare: 0`
unconditionally.

- [ ] **Step 8: Run the extractor spec and confirm GREEN**

Run the extractor spec and expect all cases to pass.

- [ ] **Step 9: Commit**

```bash
git add backend-vexxa/src/modules/sync/infrastructure/extractors/otg.extractor.ts \
  backend-vexxa/src/modules/sync/infrastructure/extractors/otg.extractor.spec.ts
git commit -m "feat(sportingbet): add OTG metrics extractor"
```

### Task 4: Register OTG in provider and sync modules

**Files:**
- Modify: `backend-vexxa/src/modules/provider-account/domain/types/provider-account.types.ts`
- Modify: `backend-vexxa/src/modules/sync/sync.module.ts`
- Create: `backend-vexxa/src/modules/provider-account/domain/types/provider-account.types.spec.ts`

- [ ] **Step 1: Write a failing provider registration test**

Assert:

```ts
expect(SUPPORTED_PROVIDERS).toContain('otg');
```

- [ ] **Step 2: Run it and confirm RED**

```bash
cd backend-vexxa
pnpm vitest run src/modules/provider-account/domain/types/provider-account.types.spec.ts
```

- [ ] **Step 3: Register OTG**

Add `otg` to `SUPPORTED_PROVIDERS`. Add `OtgExtractor` to the module providers,
factory injection list, and extractor map inputs.

- [ ] **Step 4: Run provider and extractor tests**

```bash
pnpm vitest run \
  src/modules/provider-account/domain/types/provider-account.types.spec.ts \
  src/modules/sync/infrastructure/extractors/otg.extractor.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend-vexxa/src/modules/provider-account/domain/types/provider-account.types.ts \
  backend-vexxa/src/modules/provider-account/domain/types/provider-account.types.spec.ts \
  backend-vexxa/src/modules/sync/sync.module.ts
git commit -m "feat(sync): register OTG provider"
```

### Task 5: Add the encrypted Sportingbet OTG cutover

**Files:**
- Create: `backend-vexxa/src/modules/sync/infrastructure/setup/sportingbet-otg-cutover.spec.ts`
- Create: `backend-vexxa/src/modules/sync/infrastructure/setup/sportingbet-otg-cutover.ts`
- Create: `backend-vexxa/scripts/setup-sportingbet-otg.mjs`
- Modify: `backend-vexxa/.env.example`

- [ ] **Step 1: Write failing cutover-plan tests**

Test a pure `buildSportingbetOtgCutoverPlan` function with snapshots containing:

- an active Betboard Sportingbet association and no other active association;
- a Betboard account with another active house;
- an existing inactive OTG association.

Assert that only the first Betboard account is deactivated and the intended OTG
account/association is activated.

- [ ] **Step 2: Run the setup spec and confirm RED**

```bash
cd backend-vexxa
pnpm vitest run src/modules/sync/infrastructure/setup/sportingbet-otg-cutover.spec.ts
```

- [ ] **Step 3: Implement the pure cutover decision**

Return an explicit plan describing OTG upsert, association upsert, old
association deactivation, conditional old-account deactivation, and
`syncMode=AUTO`. Keep Prisma and secrets outside this pure function.

- [ ] **Step 4: Run the setup spec and confirm GREEN**

Run the same spec and expect all cases to pass.

- [ ] **Step 5: Add the operational script**

Create a dry-run-by-default `.mjs` script that loads `.env`, validates
`DATABASE_URL`, `ENCRYPTION_KEY`, `SPORTINGBET_OTG_EMAIL`, and
`SPORTINGBET_OTG_PASSWORD`, derives the existing AES-256-GCM key, reads exact
current state, prints only non-secret identifiers/actions, and applies the plan
in one Prisma transaction only with `--apply`. Perform a fresh read after the
transaction and fail unless exactly one active OTG Sportingbet association
exists and no active Betboard Sportingbet association remains.

Add placeholders to `.env.example`:

```dotenv
SPORTINGBET_OTG_EMAIL=""
SPORTINGBET_OTG_PASSWORD=""
```

- [ ] **Step 6: Run script dry-run and inspect exact targets**

```bash
cd backend-vexxa
node scripts/setup-sportingbet-otg.mjs
```

Expected: no database writes; output lists Sportingbet, OTG upsert, old
Betboard association deactivation, and AUTO mode.

- [ ] **Step 7: Commit**

```bash
git add backend-vexxa/src/modules/sync/infrastructure/setup \
  backend-vexxa/scripts/setup-sportingbet-otg.mjs \
  backend-vexxa/.env.example
git commit -m "feat(sportingbet): add secure OTG provider cutover"
```

### Task 6: Verify, apply, and independently audit

**Files:**
- Modify if required by verification: only files already in this plan

- [ ] **Step 1: Run focused OTG and sync tests**

```bash
cd backend-vexxa
pnpm vitest run \
  src/modules/sync/infrastructure/extractors/otg.extractor.spec.ts \
  src/modules/sync/application/sync-orchestrator.service.spec.ts \
  src/modules/sync/infrastructure/scheduling/sync-scheduler.service.spec.ts \
  src/modules/sync/infrastructure/setup/sportingbet-otg-cutover.spec.ts \
  src/modules/provider-account/domain/types/provider-account.types.spec.ts \
  src/modules/dashboard/application/dashboard-balance.service.spec.ts
```

- [ ] **Step 2: Run lint on changed TypeScript files**

```bash
pnpm eslint \
  src/modules/sync/domain/ports/provider-extractor.port.ts \
  src/modules/sync/application/sync-orchestrator.service.ts \
  src/modules/sync/application/sync-orchestrator.service.spec.ts \
  src/modules/sync/infrastructure/extractors/smartico.extractor.ts \
  src/modules/sync/infrastructure/extractors/otg.extractor.ts \
  src/modules/sync/infrastructure/extractors/otg.extractor.spec.ts \
  src/modules/sync/infrastructure/scheduling/sync-scheduler.service.ts \
  src/modules/sync/infrastructure/scheduling/sync-scheduler.service.spec.ts \
  src/modules/sync/infrastructure/setup/sportingbet-otg-cutover.ts \
  src/modules/sync/infrastructure/setup/sportingbet-otg-cutover.spec.ts \
  src/modules/provider-account/domain/types/provider-account.types.ts \
  src/modules/provider-account/domain/types/provider-account.types.spec.ts \
  src/modules/sync/sync.module.ts
```

- [ ] **Step 3: Run build**

```bash
pnpm build
```

- [ ] **Step 4: Apply the cutover**

Only after the three verification commands pass and the required secrets exist
in ignored `.env`:

```bash
node scripts/setup-sportingbet-otg.mjs --apply
```

- [ ] **Step 5: Run an independent read-only database audit**

Verify:

- Sportingbet is `AUTO`;
- exactly one active `otg` association exists for Sportingbet;
- it has bookmaker ID `cmm5dhdqm000e19b58dqc549a`;
- no active Betboard Sportingbet association remains;
- no plaintext password or token exists in tracked files.

- [ ] **Step 6: Run a live current-day OTG extractor smoke test**

Authenticate through the encrypted provider account, fetch the current date,
report only row/page counts and aggregate numeric totals, and never print
credentials, token, or raw affiliate rows.

- [ ] **Step 7: Final status check**

```bash
git status --short
git log --oneline -8
```

Confirm only the user's pre-existing unrelated files remain uncommitted.
