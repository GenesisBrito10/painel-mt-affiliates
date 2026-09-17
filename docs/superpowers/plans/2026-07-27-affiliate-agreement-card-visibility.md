# Affiliate Agreement Card Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Link ID and all RevShare presentation from the affiliate dashboard's Meus Acordos card.

**Architecture:** Make a template-only change in `AgreementCard.vue`; identifiers and commission data remain available to the component and upstream composable. Protect the presentation contract with a focused source regression test matching the frontend's existing Vitest pattern.

**Tech Stack:** Nuxt 4, Vue 3 SFC templates, TypeScript, Vitest

---

### Task 1: Simplify Meus Acordos presentation

**Files:**
- Create: `frontend/test/agreement-card-visibility.spec.ts`
- Modify: `frontend/app/components/affiliates/AgreementCard.vue`

- [ ] **Step 1: Write the failing regression test**

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const agreementCard = readFileSync(
  new URL('../app/components/affiliates/AgreementCard.vue', import.meta.url),
  'utf8',
)

describe('AgreementCard visibility', () => {
  it('shows houses and CPA without Link ID or RevShare', () => {
    expect(agreementCard).toContain('Meus Acordos')
    expect(agreementCard).toContain('CPA Total')
    expect(agreementCard).toContain('CPA {{ link.cpa')
    expect(agreementCard).not.toContain('LINK ID')
    expect(agreementCard).not.toContain('link.affiliateName')
    expect(agreementCard).not.toContain('RevShare Médio')
    expect(agreementCard).not.toContain('link.revshare')
  })
})
```

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm --dir frontend test -- agreement-card-visibility.spec.ts`

Expected: FAIL because `AgreementCard.vue` still contains `LINK ID`,
`link.affiliateName`, `RevShare Médio`, and `link.revshare`.

- [ ] **Step 3: Remove the presentation fields**

In `frontend/app/components/affiliates/AgreementCard.vue`, replace the two-column
summary with the single `CPA Total` cell, remove the secondary Link ID paragraph,
and remove the per-link Rev paragraph. Preserve the `affiliateId`-based list key
and the per-link CPA paragraph.

- [ ] **Step 4: Run focused and full verification**

Run:

```bash
pnpm --dir frontend test -- agreement-card-visibility.spec.ts
pnpm --dir frontend test
pnpm --dir frontend build
```

Expected: the focused test passes, the full suite reports zero failures, and the
Nuxt production build exits successfully.

- [ ] **Step 5: Commit only the scoped files**

```bash
git add \
  docs/superpowers/specs/2026-07-27-affiliate-agreement-card-visibility-design.md \
  docs/superpowers/plans/2026-07-27-affiliate-agreement-card-visibility.md \
  frontend/test/agreement-card-visibility.spec.ts \
  frontend/app/components/affiliates/AgreementCard.vue
git commit -m "fix(frontend): simplify affiliate agreement card"
```
