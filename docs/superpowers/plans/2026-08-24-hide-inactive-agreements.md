# Hide Inactive Agreements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide inactive-only deal agreements from the affiliate's Meus Acordos card without removing history or hiding standalone links.

**Architecture:** A pure helper classifies affiliate links by the fulfilled request history of each house. The existing memberships endpoint applies that helper before returning data, so the current frontend card and summary automatically use the filtered set.

**Tech Stack:** NestJS, Prisma, TypeScript, Vitest, Nuxt 4.

---

### Task 1: Membership visibility rule

**Files:**
- Create: `backend-vexxa/src/modules/user/application/membership-visibility.ts`
- Create: `backend-vexxa/src/modules/user/application/membership-visibility.spec.ts`

- [ ] **Step 1: Write the failing unit tests**

Cover these inputs with a pure `filterLinksForActiveAgreements()` function:

```ts
inactive-only deal history => []
active fulfilled deal history => [link]
standalone fulfilled history => [link]
no fulfilled history => [link]
inactive fulfilled plus active pending => []
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm exec vitest run src/modules/user/application/membership-visibility.spec.ts`

Expected: failure because the helper does not exist.

- [ ] **Step 3: Implement the minimal classifier**

Build a set of houses with deal-backed fulfilled history and a set of houses made visible by active or standalone fulfilled history. Keep a link when its house has no deal-backed history or belongs to the visible set.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `pnpm exec vitest run src/modules/user/application/membership-visibility.spec.ts`

Expected: all membership visibility tests pass.

### Task 2: Membership endpoint integration

**Files:**
- Modify: `backend-vexxa/src/modules/user/infrastructure/user.controller.ts`
- Test: `backend-vexxa/src/modules/user/application/membership-visibility.spec.ts`

- [ ] **Step 1: Load only relevant request history**

In `getMemberships()`, load affiliate links and the user's `FULFILLED` link requests in parallel. Select `bettingHouseSlug`, `dealId`, and `deal.active`.

- [ ] **Step 2: Filter before response mapping**

Pass the links and fulfilled requests to `filterLinksForActiveAgreements()` and map only the returned links into the unchanged membership response contract.

- [ ] **Step 3: Run focused verification**

Run:

```bash
pnpm exec vitest run src/modules/user/application/membership-visibility.spec.ts
pnpm exec eslint src/modules/user/application/membership-visibility.ts src/modules/user/application/membership-visibility.spec.ts src/modules/user/infrastructure/user.controller.ts
```

Expected: focused tests pass; no new lint errors in the changed lines.

### Task 3: Full verification and integration

**Files:**
- Verify all changed files and repository state.

- [ ] **Step 1: Run complete validation**

Run backend `pnpm test` and `pnpm build`, plus frontend `pnpm test` and `pnpm build`.

- [ ] **Step 2: Review and commit**

Run `git diff --check`, inspect `main...HEAD`, commit the implementation, fast-forward `main`, repeat test/build on `main`, and remove the temporary branch/worktree after success.

### Task 4: Admin affiliate profile links

**Files:**
- Modify: `backend-vexxa/src/modules/user/application/user.service.ts`
- Modify: `backend-vexxa/src/modules/user/user.service.spec.ts`

- [ ] **Step 1: Add the failing admin-profile regression test**

Mock an affiliate with a Superbet link and only a fulfilled inactive-deal request. Assert that `getAdminAffiliateProfile()` returns an empty `affiliateLinks` array while preserving the existing sensitive-access audit.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm exec vitest run src/modules/user/user.service.spec.ts`

Expected: the inactive Superbet link is still returned.

- [ ] **Step 3: Reuse the shared classifier**

Load the target user's fulfilled link requests together with the user/admin records, then pass `target.affiliateLinks` and those requests through `filterLinksForActiveAgreements()` before serializing CPA and RevShare.

- [ ] **Step 4: Run verification and commit to main**

Run the focused test, backend full test/build, frontend test/build, admin build, focused lint, and `git diff --check`; then commit the change on `main`.

### Task 5: Same-house campaign isolation and Superbet URL repair

**Files:**
- Modify: `backend-vexxa/src/modules/user/application/membership-visibility.ts`
- Modify: `backend-vexxa/src/modules/user/application/membership-visibility.spec.ts`
- Modify: `backend-vexxa/src/modules/user/infrastructure/user.controller.ts`
- Modify: `backend-vexxa/src/modules/user/application/user.service.ts`
- Modify: `backend-vexxa/src/modules/superbet-link-pool/application/superbet-assignment.service.ts`
- Modify: `backend-vexxa/src/modules/superbet-link-pool/application/superbet-assignment.service.spec.ts`
- Create: `backend-vexxa/scripts/correct-superbet-active-user-links.mjs`

- [x] **Step 1: Reproduce both regressions**

Prove that an active Superbet deal exposes an old campaign from the same house and that pool reassignment leaves `AffiliateLink.userLink` stale.

- [x] **Step 2: Filter by the fulfilled active campaign**

Select request `links`, parse `siteid` and `c`, and retain only matching campaign IDs when the active request provides a parseable provider URL.

- [x] **Step 3: Persist the assigned URL**

Write the selected pool row URL into `userLink` on both update and create paths.

- [x] **Step 4: Repair existing active-deal URLs safely**

Preview the exact active Superbet Diário assignments, update only deterministic mismatches in a serializable audited transaction, and verify through a fresh connection.

- [x] **Step 5: Verify and commit to main**

Run focused and full backend tests, backend build, `git diff --check`, inspect the final diff, and commit on `main`.
