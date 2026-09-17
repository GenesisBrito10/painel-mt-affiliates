# Superbet Legacy Links Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every legacy Superbet link artifact while preserving the active `Superbet Diário` deal, its links and requests, financial records, withdrawals, users, and referral topology.

**Architecture:** A pure policy module parses and classifies protected campaigns, covered by Node tests written first. A guarded PostgreSQL script performs preview, simulated rollback, apply, and independent verification using a fresh snapshot token, immutable backup, serializable transaction, advisory lock, exact affected counts, and audit log.

**Tech Stack:** Node.js ESM, `node:test`, PostgreSQL `pg`, Prisma schema conventions, SHA-256 JSON snapshots.

---

### Task 1: Test and implement the cleanup policy

**Files:**
- Create: `scripts/lib/superbet-legacy-cleanup-policy.test.mjs`
- Create: `scripts/lib/superbet-legacy-cleanup-policy.mjs`

- [ ] **Step 1: Write a failing module-existence test**

```js
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';

test('cleanup policy module exists', () => {
  assert.equal(
    existsSync(new URL('./superbet-legacy-cleanup-policy.mjs', import.meta.url)),
    true,
  );
});
```

- [ ] **Step 2: Run the test and observe RED**

Run: `node --test scripts/lib/superbet-legacy-cleanup-policy.test.mjs`

Expected: one assertion failure because the policy module does not exist.

- [ ] **Step 3: Create the empty policy module and confirm the existence test passes**

```js
export {};
```

Run: `node --test scripts/lib/superbet-legacy-cleanup-policy.test.mjs`

Expected: one passing test.

- [ ] **Step 4: Add failing behavioral tests**

Add tests that require these exports and assertions:

```js
import {
  assertSingleActiveDeal,
  classifyCampaigns,
  parseCampaignIds,
} from './superbet-legacy-cleanup-policy.mjs';

test('parses unique siteid-c campaign ids from fulfilled links', () => {
  assert.deepEqual(
    parseCampaignIds([
      { url: 'https://example.test/C.ashx?siteid=5565&c=MJM14' },
      { url: 'https://example.test/C.ashx?c=MJM14&siteid=5565' },
    ]),
    ['5565-MJM14'],
  );
});

test('rejects malformed protected links', () => {
  assert.throws(() => parseCampaignIds([{ url: 'https://example.test/' }]));
});

test('requires exactly one active Superbet deal', () => {
  assert.equal(assertSingleActiveDeal([{ id: 'new', active: true }]).id, 'new');
  assert.throws(() => assertSingleActiveDeal([]));
  assert.throws(() =>
    assertSingleActiveDeal([
      { id: 'one', active: true },
      { id: 'two', active: true },
    ]),
  );
});

test('classifies only protected campaigns as current', () => {
  assert.deepEqual(
    classifyCampaigns(
      [{ id: 'a', campaignId: '5565-MJM14' }, { id: 'b', campaignId: '5602-OLD' }],
      new Set(['5565-MJM14']),
    ),
    { currentIds: ['a'], legacyIds: ['b'] },
  );
});
```

Run the same test command. Expected: assertion failures because the exports are absent.

- [ ] **Step 5: Implement the minimal pure policy**

```js
export function parseCampaignIds(links) {
  const campaigns = new Set();
  for (const item of links) {
    const parsed = new URL(item.url);
    const siteId = parsed.searchParams.get('siteid');
    const code = parsed.searchParams.get('c');
    if (!siteId || !code) throw new Error('Link protegido inválido');
    campaigns.add(`${siteId}-${code}`);
  }
  return [...campaigns].sort();
}

export function assertSingleActiveDeal(deals) {
  const active = deals.filter((deal) => deal.active);
  if (active.length !== 1) throw new Error(`Deals ativas divergentes: ${active.length}`);
  return active[0];
}

export function classifyCampaigns(links, protectedCampaigns) {
  const currentIds = [];
  const legacyIds = [];
  for (const link of links) {
    (protectedCampaigns.has(link.campaignId) ? currentIds : legacyIds).push(link.id);
  }
  return { currentIds, legacyIds };
}
```

- [ ] **Step 6: Run GREEN verification**

Run: `node --test scripts/lib/superbet-legacy-cleanup-policy.test.mjs`

Expected: all tests pass with zero failures.

### Task 2: Build the guarded operational script

**Files:**
- Create: `scripts/cleanup-superbet-legacy-links.mjs`

- [ ] **Step 1: Implement modes and immutable snapshot helpers**

The script accepts `preview`, `simulate`, `apply`, and `verify`. It uses:

```js
const OPERATION_ID = 'superbet-legacy-links-cleanup-2026-08-25-v1';
const HOUSE = 'superbet';
const MODE = process.argv[2] ?? 'preview';
const APPLY_TOKEN = argument('--token');
const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stable(item)]),
    );
  }
  return value;
};
const tokenFor = (value) =>
  createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
```

The stable function must preserve array order and recursively sort every object
key. The script refuses unknown modes or a missing `DATABASE_URL`.

- [ ] **Step 2: Implement the read-only snapshot**

Load exactly one active Superbet deal and parse protected campaigns from all of
its fulfilled request URLs using the tested policy module. Capture complete rows
for every target and counts/fingerprints for:

```js
{
  protected: {
    deal,
    campaigns,
    activeLinks,
    fulfilledRequests,
    pendingRequests,
    financialRows,
    withdrawals,
  },
  deletion: {
    legacyLinks,
    requests,
    notifications,
    webhookDeliveries,
    affiliateApiLogs,
    inactiveDeals,
  },
  integrity: { users, referralEdges, userReferralFingerprint, otherHouseLinks },
}
```

Legacy requests use the exact predicate `bettingHouseSlug = 'superbet' AND
(dealId IS NULL OR dealId <> activeDealId)`. Legacy affiliate links use
`bettingHouse = 'superbet' AND deletedAt IS NULL AND campaignId NOT IN
protectedCampaigns`.

- [ ] **Step 3: Write the recovery backup**

Preview writes the full target rows and state to
`output/superbet-legacy-links-cleanup/<timestamp>/backup.json` with mode `0600`,
then writes a sibling `backup.sha256`. The apply token is the SHA-256 of the
stable snapshot excluding volatile timestamps and output paths.

- [ ] **Step 4: Implement transactional cleanup**

Within a serializable transaction:

```sql
SELECT pg_advisory_xact_lock(hashtext($1));
UPDATE affiliate_links
SET "deletedAt" = $2, "updatedAt" = $2
WHERE "bettingHouse" = 'superbet'
  AND "deletedAt" IS NULL
  AND NOT ("campaignId" = ANY($3::text[]));
DELETE FROM notifications WHERE id = ANY($4::text[]);
DELETE FROM link_webhook_deliveries WHERE id = ANY($5::text[]);
DELETE FROM affiliate_api_link_request_logs WHERE id = ANY($6::text[]);
DELETE FROM link_requests WHERE id = ANY($7::text[]);
DELETE FROM deals WHERE id = ANY($8::text[]);
```

Recompute the snapshot after row locks, compare its token to `--token`, require
every affected count to match the preview, and insert one audit log containing
the operation ID, backup hash, active deal ID, and counts. `simulate` executes
the same logic and always rolls back; `apply` commits.

- [ ] **Step 5: Implement independent verification**

Using a fresh PostgreSQL connection, require zero remaining target rows and
exact preservation of protected and integrity fingerprints. Verify no financial
table or withdrawal count changed. Print a JSON summary and fail with a nonzero
exit code on any divergence.

### Task 3: Exercise, apply, and independently reconcile production

**Files:**
- Modify: `docs/superpowers/plans/2026-08-25-superbet-legacy-links-cleanup.md`

- [ ] **Step 1: Run focused tests and static checks**

Run:

```bash
node --test scripts/lib/superbet-legacy-cleanup-policy.test.mjs
node --check scripts/lib/superbet-legacy-cleanup-policy.mjs
node --check scripts/cleanup-superbet-legacy-links.mjs
git diff --check
```

Expected: every command exits zero.

- [ ] **Step 2: Generate a fresh preview and backup**

Run:

```bash
node --env-file=.env scripts/cleanup-superbet-legacy-links.mjs preview
```

Read the complete summary, validate the exact active deal and protected counts,
and retain the emitted token and backup path.

- [ ] **Step 3: Simulate the exact transaction**

Run:

```bash
SUPERBET_CLEANUP_TOKEN='token-printed-by-the-immediately-preceding-preview'
node --env-file=.env scripts/cleanup-superbet-legacy-links.mjs simulate --token "$SUPERBET_CLEANUP_TOKEN"
```

Expected: all target counts are affected inside the transaction, the transaction
rolls back, and a fresh preview returns the original token.

- [ ] **Step 4: Apply with the fresh token**

Run:

```bash
node --env-file=.env scripts/cleanup-superbet-legacy-links.mjs apply --token "$SUPERBET_CLEANUP_TOKEN"
```

Expected: the transaction commits once and prints the cleanup audit ID.

- [ ] **Step 5: Verify with a fresh connection**

Run:

```bash
node --env-file=.env scripts/cleanup-superbet-legacy-links.mjs verify
```

Expected: zero legacy artifacts, unchanged protected/integrity/financial state,
and one cleanup audit event.

- [ ] **Step 6: Reconcile the known Network account**

Invoke `DashboardBalanceService` for `network@gmail.com`, house `superbet`, dates
2026-08-23 through 2026-08-25. Expected: CPA 120 from `5565-MJM14`, six network
CPAs at a R$10 spread, R$60 network CPA, zero Superbet withdrawals since the 23rd.

- [ ] **Step 7: Run repository verification and commit**

Run the focused test, `pnpm test`, `pnpm build`, `pnpm exec prisma validate`, and
`git diff --check`. Mark every checkbox complete, then commit only the plan,
policy, tests, and cleanup script with:

```bash
git add docs/superpowers/plans/2026-08-25-superbet-legacy-links-cleanup.md \
  scripts/lib/superbet-legacy-cleanup-policy.mjs \
  scripts/lib/superbet-legacy-cleanup-policy.test.mjs \
  scripts/cleanup-superbet-legacy-links.mjs
git commit -m "chore(superbet): remove legacy link artifacts"
```
