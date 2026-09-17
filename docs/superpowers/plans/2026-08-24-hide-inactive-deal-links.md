# Hide Inactive Deal Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide requests associated with inactive deals from the affiliate's "Meus Links" tab without deleting history or changing administrative listings.

**Architecture:** Extend the existing `mine=true` backend predicate with an OR condition that accepts either a request with no deal or a request whose related deal is active. Keep all other list modes unchanged.

**Tech Stack:** NestJS, TypeScript, Prisma, Vitest

---

### Task 1: Filter inactive deals from the affiliate link list

**Files:**
- Modify: `backend-vexxa/src/modules/link-request/application/link-request.service.ts:1890`
- Modify: `backend-vexxa/src/modules/link-request/application/link-request.list-referral.spec.ts`

- [ ] **Step 1: Write the failing regression test**

Add a test that calls `list()` with `mine: true` and asserts the Prisma query receives:

```ts
where: {
  userId: 'affiliate-1',
  OR: [
    { dealId: null },
    { deal: { is: { active: true } } },
  ],
}
```

Keep the existing admin test as proof that a query without `mine=true` still uses an empty `where` predicate.

- [ ] **Step 2: Run the test to verify RED**

Run: `pnpm exec vitest run src/modules/link-request/application/link-request.list-referral.spec.ts`

Expected: FAIL because `buildListWhere()` currently adds only `userId` for `mine=true`.

- [ ] **Step 3: Implement the minimal backend filter**

In the `query.mine` branch of `buildListWhere()`, add:

```ts
where.OR = [
  { dealId: null },
  { deal: { is: { active: true } } },
];
```

- [ ] **Step 4: Run the focused test to verify GREEN**

Run: `pnpm exec vitest run src/modules/link-request/application/link-request.list-referral.spec.ts`

Expected: all tests in the file pass.

- [ ] **Step 5: Run complete verification**

Run:

```bash
pnpm exec eslint src/modules/link-request/application/link-request.service.ts src/modules/link-request/application/link-request.list-referral.spec.ts
pnpm test
pnpm build
git diff --check
```

Expected: zero lint errors, all tests pass, build exits with code 0, and no whitespace errors are reported.

