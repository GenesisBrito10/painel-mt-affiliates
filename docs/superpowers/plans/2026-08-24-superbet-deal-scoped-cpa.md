# Superbet Deal-Scoped CPA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Superbet inviter CPA resolution use only a fulfilled inviter request from the same deal and keep the assigned affiliate-link commission equal to that deal snapshot.

**Architecture:** Add an optional `dealId` context to the existing CPA resolver. Superbet uses a same-deal `LinkRequest.resolvedCpa` lookup, while legacy and other-house behavior remains unchanged; creation and every pending-request reprocessing path forward the request deal. The Superbet assignment service always persists a supplied snapshot commission.

**Tech Stack:** NestJS, TypeScript, Prisma, Vitest

---

### Task 1: Resolve Superbet inviter CPA by deal

**Files:**
- Modify: `backend-vexxa/src/modules/link-request/application/cpa-resolution.service.ts`
- Test: `backend-vexxa/src/modules/link-request/application/cpa-resolution.service.spec.ts`

- [ ] **Step 1: Write failing resolver tests**

Add tests that pass `dealId: 'deal-new'` and mock `linkRequest.findFirst`:

```ts
it('holds when inviter only has a CPA outside the requested Superbet deal', async () => {
  const svc = new CpaResolutionService(makePrismaByDeal(null, 130));
  const result = await svc.resolveCpa({
    houseSlug: 'superbet', dealId: 'deal-new', userId: 'user',
    inviterId: 'inviter', rule: makeRule(),
  });
  expect(result.hold).toBe(true);
});

it('uses the inviter fulfilled CPA from the same Superbet deal', async () => {
  const svc = new CpaResolutionService(makePrismaByDeal(105, 130));
  const result = await svc.resolveCpa({
    houseSlug: 'superbet', dealId: 'deal-new', userId: 'user',
    inviterId: 'inviter', rule: makeRule(),
  });
  expect(result).toMatchObject({ cpa: 100, inviterCpa: 105,
    ruleApplied: 'INVITER_MINUS_DISCOUNT' });
});
```

- [ ] **Step 2: Run RED**

Run: `pnpm exec vitest run src/modules/link-request/application/cpa-resolution.service.spec.ts`

Expected: FAIL because `dealId` is not accepted and the resolver still reads `affiliateLink` house-wide.

- [ ] **Step 3: Implement the deal lookup**

Extend the resolver input with `dealId?: string | null`. For Superbet with `dealId`, replace the inviter house-wide lookup with:

```ts
private async readDealCpa(userId: string, houseSlug: string, dealId: string) {
  const request = await this.prisma.linkRequest.findFirst({
    where: {
      userId, dealId, bettingHouseSlug: houseSlug,
      status: LinkRequestStatus.FULFILLED,
      resolvedCpa: { not: null },
    },
    select: { resolvedCpa: true },
    orderBy: [{ fulfilledAt: 'desc' }, { updatedAt: 'desc' }],
  });
  return request?.resolvedCpa ?? null;
}
```

- [ ] **Step 4: Run GREEN**

Run: `pnpm exec vitest run src/modules/link-request/application/cpa-resolution.service.spec.ts`

Expected: all resolver tests pass.

### Task 2: Forward deal context through creation and reprocessing

**Files:**
- Modify: `backend-vexxa/src/modules/link-request/application/link-request.service.ts`
- Modify: `backend-vexxa/src/modules/link-request/application/link-backfill.service.ts`
- Test: `backend-vexxa/src/modules/link-request/application/link-request.create.spec.ts`
- Test: `backend-vexxa/src/modules/link-request/application/link-backfill.service.spec.ts`

- [ ] **Step 1: Write failing propagation tests**

Assert that creation calls `resolveCpa` with `dealId`, and that a Superbet pending request with an old affiliate CPA still calls the resolver with its own deal during auto-snapshot.
Also assert that manual reprocessing returns `WAITING_SNAPSHOT` without calling the pool while the inviter is not fulfilled in that deal.

```ts
expect(resolveCpa).toHaveBeenCalledWith(expect.objectContaining({
  houseSlug: 'superbet', dealId: 'deal-new',
}));
```

- [ ] **Step 2: Run RED**

Run: `pnpm exec vitest run src/modules/link-request/application/link-request.create.spec.ts src/modules/link-request/application/link-backfill.service.spec.ts`

Expected: FAIL because call sites and backfill candidates omit `dealId`.

- [ ] **Step 3: Implement propagation**

Add `dealId` to candidate/reprocess selects and request types, pass it to every resolver call, and change `resolveOrPreserve` so deal-scoped Superbet requests bypass house-wide existing-CPA preservation:

```ts
if (rule.houseSlug === SUPERBET_SLUG && dealId) {
  return this.wrapResolution(await this.cpaResolution.resolveCpa({
    houseSlug: rule.houseSlug, dealId, userId, inviterId, rule,
  }));
}
```

- [ ] **Step 4: Run GREEN**

Run: `pnpm exec vitest run src/modules/link-request/application/link-request.create.spec.ts src/modules/link-request/application/link-backfill.service.spec.ts`

Expected: both files pass.

### Task 3: Persist the new-deal snapshot on assignment

**Files:**
- Modify: `backend-vexxa/src/modules/superbet-link-pool/application/superbet-assignment.service.ts`
- Create: `backend-vexxa/src/modules/superbet-link-pool/application/superbet-assignment.service.spec.ts`

- [ ] **Step 1: Write a failing assignment test**

Build a service with an existing Superbet link at CPA 130 and call `tryAssign` with `defaultCommission: { cpa: 100, revshare: 0 }`. Assert the transactional update includes CPA 100.

```ts
expect(tx.affiliateLink.update).toHaveBeenCalledWith({
  where: { id: 'existing-link' },
  data: expect.objectContaining({ cpa: 100, revshare: 0 }),
});
```

- [ ] **Step 2: Run RED**

Run: `pnpm exec vitest run src/modules/superbet-link-pool/application/superbet-assignment.service.spec.ts`

Expected: FAIL because commission data is currently omitted when an existing commission exists.

- [ ] **Step 3: Implement authoritative snapshot persistence**

Use `opts.defaultCommission` whenever provided:

```ts
const commissionData = opts.defaultCommission
  ? { cpa: opts.defaultCommission.cpa, revshare: opts.defaultCommission.revshare }
  : {};
```

- [ ] **Step 4: Run GREEN**

Run: `pnpm exec vitest run src/modules/superbet-link-pool/application/superbet-assignment.service.spec.ts`

Expected: assignment test passes.

### Task 4: Verify and integrate

**Files:**
- Verify all files above

- [ ] **Step 1: Run focused regression tests**

Run: `pnpm exec vitest run src/modules/link-request/application/cpa-resolution.service.spec.ts src/modules/link-request/application/link-request.create.spec.ts src/modules/link-request/application/link-backfill.service.spec.ts src/modules/superbet-link-pool/application/superbet-assignment.service.spec.ts`

Expected: all pass.

- [ ] **Step 2: Run lint on changed TypeScript files**

Run: `pnpm exec eslint src/modules/link-request/application/cpa-resolution.service.ts src/modules/link-request/application/cpa-resolution.service.spec.ts src/modules/link-request/application/link-request.service.ts src/modules/link-request/application/link-request.create.spec.ts src/modules/link-request/application/link-backfill.service.ts src/modules/link-request/application/link-backfill.service.spec.ts src/modules/superbet-link-pool/application/superbet-assignment.service.ts src/modules/superbet-link-pool/application/superbet-assignment.service.spec.ts`

Expected: zero errors.

- [ ] **Step 3: Build**

Run: `pnpm build`

Expected: exit code 0.

- [ ] **Step 4: Review and commit**

Run: `git diff --check && git status --short`, then commit only the scoped files with `fix(superbet): scope inviter CPA by deal`.
