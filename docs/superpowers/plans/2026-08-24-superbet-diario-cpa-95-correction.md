# Superbet Diário CPA 95 Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the 35 fulfilled referred affiliates in Superbet Diário to CPA 95, audit every changed link, and align the Superbet seed with the live 105/105/10 rule.

**Architecture:** Keep the runtime resolver algorithm unchanged because it already reads the deal-scoped inviter snapshot. Update the seed/test contract, then use a dry-run-first one-off script whose pure validation helpers are unit-tested and whose apply mode executes one serializable, count-guarded transaction.

**Tech Stack:** Node.js, NestJS, TypeScript, Prisma/PostgreSQL, Vitest

---

### Task 1: Lock the Superbet 105 minus 10 rule in tests and seed

**Files:**
- Modify: `backend-vexxa/src/modules/link-request/application/cpa-resolution.service.spec.ts`
- Modify: `backend-vexxa/prisma/seed.ts`

- [ ] **Step 1: Change the Superbet expectation first**

Change the Superbet fixture to `defaultCpa=105`, `fallbackCpa=105`, `inviterCpaThreshold=105`, and `inviterCpaDiscount=10`. Assert these cases:

```ts
const cases: Array<[number, number, string]> = [
  [120, 105, 'DEFAULT'],
  [110, 105, 'DEFAULT'],
  [105, 95, 'INVITER_MINUS_DISCOUNT'],
  [100, 90, 'INVITER_MINUS_DISCOUNT'],
  [95, 85, 'INVITER_MINUS_DISCOUNT'],
];
```

Keep non-Superbet fixtures explicitly at discount 5.

- [ ] **Step 2: Run RED**

Run: `pnpm exec vitest run src/modules/link-request/application/cpa-resolution.service.spec.ts`

Expected: FAIL because the shared Superbet fixture still contains 100/100/5.

- [ ] **Step 3: Align the test fixture and seed**

Update only the Superbet values in `makeRule()` and `prisma/seed.ts`:

```ts
defaultCpa: 105,
fallbackCpa: 105,
inviterCpaThreshold: 105,
inviterCpaDiscount: 10,
```

For other house tests that depend on the shared fixture, override `inviterCpaDiscount: D(5)` so their production rules remain unchanged.

- [ ] **Step 4: Run GREEN**

Run: `pnpm exec vitest run src/modules/link-request/application/cpa-resolution.service.spec.ts`

Expected: all resolver tests pass and the 105-to-95 case is green.

- [ ] **Step 5: Commit**

```bash
git add backend-vexxa/prisma/seed.ts backend-vexxa/src/modules/link-request/application/cpa-resolution.service.spec.ts
git commit -m "fix(superbet): align inviter discount seed"
```

### Task 2: Build tested correction guards

**Files:**
- Create: `backend-vexxa/scripts/lib/superbet-diario-cpa-95.mjs`
- Create: `backend-vexxa/scripts/lib/superbet-diario-cpa-95.d.mts`
- Create: `backend-vexxa/scripts/lib/superbet-diario-cpa-95.spec.ts`

- [ ] **Step 1: Write the failing helper tests**

The tests dynamically import the wished-for module and first assert that it exports `parseSuperbetCampaignId`, `buildCorrectionPlan`, and `assertSafeImpact`. Then verify:

```ts
expect(parseSuperbetCampaignId(
  'https://wlsuperbet.adsrv.eacdn.com/C.ashx?siteid=5565&c=MJM01',
)).toBe('5565-MJM01');

expect(buildCorrectionPlan(requests, links, 2)).toHaveLength(2);
expect(() => buildCorrectionPlan(requests, links.slice(0, 1), 2))
  .toThrow(/mapeamento/i);
expect(() => assertSafeImpact({ openWithdrawals: 1 }))
  .toThrow(/saque aberto/i);
```

- [ ] **Step 2: Run RED**

Run: `pnpm exec vitest run scripts/lib/superbet-diario-cpa-95.spec.ts`

Expected: FAIL because the helper module does not exist.

- [ ] **Step 3: Implement the minimal pure helpers**

Implement:

```js
export function parseSuperbetCampaignId(rawUrl) {
  const url = new URL(rawUrl);
  const siteId = url.searchParams.get('siteid');
  const campaign = url.searchParams.get('c');
  if (!siteId || !campaign) throw new Error('URL Superbet sem siteid/c');
  return `${siteId}-${campaign}`;
}
```

`buildCorrectionPlan()` requires the exact request count, unique users, one URL/campaign per request, and exactly one active link with the same user/campaign. `assertSafeImpact()` rejects any open withdrawal.

- [ ] **Step 4: Run GREEN**

Run: `pnpm exec vitest run scripts/lib/superbet-diario-cpa-95.spec.ts`

Expected: all helper tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend-vexxa/scripts/lib/superbet-diario-cpa-95.mjs backend-vexxa/scripts/lib/superbet-diario-cpa-95.d.mts backend-vexxa/scripts/lib/superbet-diario-cpa-95.spec.ts
git commit -m "test(superbet): add CPA correction guards"
```

### Task 3: Implement and dry-run the audited operation

**Files:**
- Create: `backend-vexxa/scripts/correct-superbet-diario-cpa-95.mjs`

- [ ] **Step 1: Implement dry-run-first orchestration**

Use constants:

```js
const DEAL_ID = '3a11aa0d-d9cf-467c-bc1a-1fd62f7a7429';
const EXPECTED_TARGETS = 35;
const TARGET_CPA = 95;
const OPERATION_ID = 'superbet-diario-cpa95-2026-08-24';
const APPLY = process.env.APPLY === '1';
```

Read the deal, live rule, exact fulfilled/referred requests at CPA 100 or 105, their mapped active links, campaign metrics, and open withdrawals. Print distributions and direct CPA impact. In dry-run mode, disconnect without writes.

- [ ] **Step 2: Add serializable apply mode**

Inside one transaction with `isolationLevel: 'Serializable'`:

1. lock the exact request and link rows;
2. repeat all count/mapping/rule/withdrawal guards;
3. update the 35 request snapshots to 95;
4. update only the 35 mapped links to 95;
5. insert 35 `CommissionLog` rows with actual old CPA and source `SCRIPT`;
6. insert one `AuditLog` with `operationId`, IDs, distributions, and impact;
7. assert every affected count before commit.

The script rejects a previous `AuditLog` with the same operation ID and never edits withdrawals, metrics, old deals, or unrelated links.

- [ ] **Step 3: Run code checks before production access**

Run:

```bash
pnpm exec vitest run src/modules/link-request/application/cpa-resolution.service.spec.ts scripts/lib/superbet-diario-cpa-95.spec.ts
node --check scripts/correct-superbet-diario-cpa-95.mjs
node --check scripts/lib/superbet-diario-cpa-95.mjs
git diff --check
```

Expected: tests pass, syntax checks exit 0, and diff check is clean.

- [ ] **Step 4: Commit the operational script**

```bash
git add backend-vexxa/scripts/correct-superbet-diario-cpa-95.mjs
git commit -m "chore(superbet): add audited CPA correction"
```

- [ ] **Step 5: Run a fresh production dry-run**

Run from the worktree backend using the main checkout environment file:

```bash
pnpm exec dotenv -e /Users/user/Documents/mjmcompany/backend-vexxa/.env -- node scripts/correct-superbet-diario-cpa-95.mjs
```

Expected immediately before apply: 35 targets, 35 unique users, snapshot distribution 100=32/105=3, link distribution 100=32/105=2/120=1, zero campaign metrics, and zero open withdrawals.

- [ ] **Step 6: Apply once**

Run:

```bash
APPLY=1 pnpm exec dotenv -e /Users/user/Documents/mjmcompany/backend-vexxa/.env -- node scripts/correct-superbet-diario-cpa-95.mjs
```

Expected: one committed transaction, 35 requests updated, 35 links updated, 35 commission logs inserted, and one batch audit inserted.

### Task 4: Independently verify and integrate

**Files:**
- Verify all files above and production state

- [ ] **Step 1: Verify production through a new connection**

Run a separate read-only Prisma query that checks:

```text
remaining target requests at 100/105 = 0
audited target requests at 95 = 35
fulfilled no-inviter requests at 105 = pre-transaction baseline
corrected mapped links at 95 = 35
operation commission logs = 35
batch audit logs = 1
open withdrawals = 0
```

Also verify the inactive legacy deal counts are unchanged from the pre-write snapshot.

- [ ] **Step 2: Run final code verification**

Run:

```bash
pnpm test
pnpm build
git diff --check
git status --short
```

Expected: 0 test failures, build exit 0, no whitespace errors, and no uncommitted files.

- [ ] **Step 3: Review and integrate**

Review `main..HEAD`, merge locally to `main`, rerun the backend suite/build on the merged commit, and remove only the temporary worktree and branch after success.
