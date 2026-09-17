# Betboard API Endpoint Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore automatic Betboard/Superbet synchronization through the provider's current API and backfill the named account from 2026-08-23.

**Architecture:** Add a narrowly scoped legacy-base resolver inside the Betboard extractor, use it for authentication and reports, and migrate the named provider account with an expected-state-guarded script. Invoke the existing orchestrator for explicit backfill dates so persistence and commission behavior are not duplicated.

**Tech Stack:** NestJS, TypeScript, Vitest, Prisma 7, PostgreSQL, native `fetch`.

---

### Task 1: Lock the provider URL behavior with a failing test

**Files:**
- Create: `src/modules/sync/infrastructure/extractors/betboard.extractor.spec.ts`
- Modify: `src/modules/sync/infrastructure/extractors/betboard.extractor.ts`

- [ ] Write a test that stubs `global.fetch`, calls `login()` with the retired
      `https://api.betboard.com.br/api` base, calls `fetchReports()`, and expects
      both requests to target `https://api-affiliates.mgaffiliates.site/api`.
- [ ] Run `pnpm exec vitest run src/modules/sync/infrastructure/extractors/betboard.extractor.spec.ts`
      and confirm the URL assertion fails against the retired host.
- [ ] Add `resolveBetboardApiBaseUrl`, use it in `login()`, and reuse the resolved
      base in `fetchReports()`.
- [ ] Re-run the focused test and confirm it passes.

### Task 2: Update durable defaults and guarded production configuration

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `prisma/seed-provider-accounts.ts`
- Modify: `prisma/setup-mjm-provider-esportiva.mjs`
- Modify: `prisma/migrate-fresh.ts`
- Modify: `prisma/setup-vallex-sportingbet.mjs`
- Create: `scripts/update-betboard-api-and-backfill-superbet.mjs`

- [ ] Replace active defaults/seeds that create Betboard accounts with the
      retired host, without rewriting historical migrations.
- [ ] Create a dry-run-by-default script that asserts the exact named account,
      association, active house, `AUTO` mode, and old API base before updating.
- [ ] Record the configuration change in `audit_logs` and reject duplicate runs.
- [ ] Add an explicit backfill mode that boots the application context with
      scheduled jobs disabled, selects only the named account association, and
      invokes `SyncOrchestratorService.runSync()` for 2026-08-23..2026-08-25.

### Task 3: Verify and commit

**Files:**
- Test: `src/modules/sync/infrastructure/extractors/betboard.extractor.spec.ts`
- Test: `src/modules/sync/application/sync-orchestrator.service.spec.ts`

- [ ] Run the configuration script in dry-run mode and inspect the exact target.
- [ ] Apply the configuration update and execute the targeted backfill.
- [ ] Independently query `sync_logs`, `affiliate_data`, `affiliate_links`, and
      `audit_logs` for the account, dates, and `5565-*` campaigns.
- [ ] Run `pnpm exec vitest run src/modules/sync/infrastructure/extractors/betboard.extractor.spec.ts src/modules/sync/application/sync-orchestrator.service.spec.ts`.
- [ ] Run `pnpm test`, `pnpm lint`, and `pnpm build`.
- [ ] Run `git diff --check`, confirm only scoped files are staged, and commit to
      `main` with `fix(sync): restore Betboard API endpoint`.
