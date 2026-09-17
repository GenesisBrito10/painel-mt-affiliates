# Financial History Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove historical financial, withdrawal, receipt, and fraud data while preserving every user/referral edge, every affiliate link/link request, all Pinbet Mensal history, and only the new active Superbet deal history.

**Architecture:** Add a Superbet sync allowlist derived from fulfilled requests of the active deal so retired campaigns cannot return after cleanup. Execute the production cleanup through a dry-run-first script using an immutable preview token, sync pause, a serializable transaction, audit metadata, exact protected predicates, and independent post-write verification.

**Tech Stack:** NestJS, TypeScript, Vitest, Prisma, PostgreSQL, Node.js operational scripts.

---

### Task 1: Protect the new Superbet deal during sync

**Files:**

- Modify: `src/modules/sync/domain/ports/sync.repository.port.ts`
- Modify: `src/modules/sync/infrastructure/persistence/sync.prisma-repository.ts`
- Modify: `src/modules/sync/application/sync-orchestrator.service.ts`
- Modify: `src/modules/sync/application/sync-orchestrator.service.spec.ts`

- [x] Add a regression test where the Superbet provider returns one campaign from the active deal and one retired campaign.
- [x] Run the focused test and confirm it fails because both campaigns are persisted.
- [x] Add a repository method that returns the campaign IDs encoded in fulfilled link requests of active Superbet deals.
- [x] Filter Superbet reports to that exact allowlist before calculating totals or upserting.
- [x] Run the focused sync tests and confirm the retired campaign is not persisted.

### Task 2: Build the guarded cleanup operation

**Files:**

- Create: `scripts/reset-financial-history-preserve-active-deals.mjs`

- [x] Implement a read-only preview with the exact protected deal IDs, campaign codes, counts, totals, and referral/link fingerprints.
- [x] Produce a SHA-256 preview token and require it for apply mode.
- [x] Pause sync, wait for recent runs to drain, then re-read and reject any state drift.
- [x] Delete only approved historical rows inside one serializable transaction with an advisory lock.
- [x] Preserve all users, referral edges, affiliate links, link requests, deals, Pinbet Mensal finance, and new-Superbet finance.
- [x] Insert one audit record containing only counts, totals, predicates, and the preview token.
- [x] Verify the result through a new database connection and keep sync paused until the filtering code is deployed.

### Task 3: Verify, deploy, apply, and unpause

**Files:**

- Modify: `docs/superpowers/plans/2026-08-25-financial-history-reset.md`

- [x] Run focused tests, the full test suite, build, lint on changed files, Prisma validation, and `git diff --check`.
- [x] Commit the tested code and script on `main`.
- [x] Deploy the commit and verify the backend health endpoint.
- [x] Run a fresh preview and apply using its exact confirmation token.
- [x] Run independent database verification, execute one controlled Superbet sync, verify no retired campaign returns, then unpause automatic sync.
