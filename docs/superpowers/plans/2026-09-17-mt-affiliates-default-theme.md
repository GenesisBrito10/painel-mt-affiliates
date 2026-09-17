# MT Affiliates Default Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make black, MT green, and white the default visual palette in the affiliate frontend and admin panel without changing semantic error and warning colors.

**Architecture:** Keep the existing CSS-variable theme systems and replace only their default brand and surface values. Add a custom `mtgreen` Tailwind/Nuxt UI scale, retain legacy admin token names as compatibility aliases, and update the admin theme-reset defaults. A focused Vitest contract will read both apps' theme sources so future changes cannot silently restore the old gold/violet defaults.

**Tech Stack:** Nuxt 4, Vue 3, Nuxt UI, Tailwind CSS 4, CSS custom properties, Vitest.

---

### Task 1: Add the cross-app theme contract

**Files:**
- Create: `frontend/test/mt-affiliates-theme.spec.ts`

- [x] **Step 1: Write the failing test**

```ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const frontendRoot = fileURLToPath(new URL('..', import.meta.url))
const repoRoot = resolve(frontendRoot, '..')
const read = (path: string) => readFileSync(resolve(repoRoot, path), 'utf8')

describe('MT Affiliates default theme', () => {
  it('uses the approved palette in the affiliate frontend', () => {
    const css = read('frontend/app/assets/css/main.css')
    const config = read('frontend/app.config.ts')
    const nuxt = read('frontend/nuxt.config.ts')
    const auth = read('frontend/app/layouts/auth.vue')

    expect(css).toContain('--vex-brand: #39ff14')
    expect(css).toContain('--vex-bg: #080a08')
    expect(css).toContain('--vex-text: #ffffff')
    expect(config).toContain("primary: 'mtgreen'")
    expect(nuxt).toContain("preference: 'dark'")
    expect(nuxt).toContain("content: '#39FF14'")
    expect(auth).not.toMatch(/245,\s*158,\s*11|168,\s*85,\s*247|124,\s*58,\s*237/)
  })

  it('uses the approved palette in the admin panel and theme reset', () => {
    const css = read('admin/app/assets/css/main.css')
    const config = read('admin/app/app.config.ts')
    const defaults = read('admin/app/pages/theme.vue')

    expect(css).toContain('--color-mtgreen-500: #39FF14')
    expect(css).toContain('--color-bg: #080A08')
    expect(css).toContain('--color-text: #FFFFFF')
    expect(config).toContain("primary: 'mtgreen'")
    expect(defaults).toContain("brand: '#39FF14'")
    expect(defaults).toContain("sidebarBg: '#080A08'")
  })
})
```

- [x] **Step 2: Run the test and verify the RED state**

Run:

```bash
cd frontend && corepack pnpm test test/mt-affiliates-theme.spec.ts
```

Expected: both tests fail because the source files still contain the Vallex gold/violet defaults.

### Task 2: Apply the MT palette to the frontend

**Files:**
- Modify: `frontend/app/assets/css/main.css`
- Modify: `frontend/app.config.ts`
- Modify: `frontend/nuxt.config.ts`
- Modify: `frontend/app/layouts/auth.vue`

- [x] **Step 1: Add the `mtgreen` scale and replace default tokens**

Add an eleven-step `--color-mtgreen-*` scale under `@theme`, anchored at
`--color-mtgreen-500: #39ff14`, then set the root and dark variables to:

```css
--vex-bg: #080a08;
--vex-bg-muted: #0c100c;
--vex-surface: #101410;
--vex-surface-strong: #141914;
--vex-surface-raised: #171d17;
--vex-border: #273027;
--vex-border-subtle: #1c241c;
--vex-text: #ffffff;
--vex-text-muted: #b8c2b8;
--vex-text-faint: #788378;
--vex-brand: #39ff14;
--vex-brand-hover: #2ed10f;
--vex-accent: #ffffff;
--vex-info: #39ff14;
--vex-sidebar-bg: #080a08;
--vex-sidebar-text: #b8c2b8;
--vex-sidebar-text-active: #ffffff;
```

Keep `--vex-negative` red and `--vex-warning` amber. Change the authentication gradient to green/white tones and update brand comments.

- [x] **Step 2: Align Nuxt UI and browser defaults**

Set `primary: 'mtgreen'` and `info: 'mtgreen'` in `frontend/app.config.ts`. Add:

```ts
colorMode: {
  preference: 'dark',
  fallback: 'dark'
},
```

to `frontend/nuxt.config.ts`, and change the browser `theme-color` to `#39FF14`.

- [x] **Step 3: Replace authentication glows**

Use translucent MT green for the two main ambient glows and a subtle white/green mix for the third. Do not alter layout or content.

### Task 3: Apply the MT palette to the admin

**Files:**
- Modify: `admin/app/assets/css/main.css`
- Modify: `admin/app/app.config.ts`
- Modify: `admin/app/pages/theme.vue`
- Modify: `admin/nuxt.config.ts`

- [x] **Step 1: Define the admin `mtgreen` scale and surface defaults**

Replace the old Tailwind gold/violet scales with `--color-mtgreen-*`. Preserve the widely used names as compatibility aliases:

```css
--color-gold: var(--color-mtgreen-500);
--color-gold-bright: var(--color-mtgreen-400);
--color-gold-soft: rgba(57, 255, 20, 0.12);
--color-purple: var(--color-mtgreen-500);
--color-purple-bright: var(--color-mtgreen-300);
--color-purple-soft: rgba(57, 255, 20, 0.12);
--color-purple-border: rgba(57, 255, 20, 0.30);
--color-gold-border: rgba(57, 255, 20, 0.32);
```

Set admin surfaces and text to the same approved black/graphite/white hierarchy as the frontend.

- [x] **Step 2: Align Nuxt UI and theme-reset defaults**

Set `primary` and `info` to `mtgreen` in `admin/app/app.config.ts`. Change `DEFAULTS` in `admin/app/pages/theme.vue` to brand/accent/info `#39FF14`, warning `#F59E0B`, sidebar background `#080A08`, secondary text `#B8C2B8`, and active text `#FFFFFF`. Update the Accent field hint so it no longer mentions violet.

- [x] **Step 3: Align the browser chrome**

Add `<meta name="theme-color" content="#39FF14">` through `admin/nuxt.config.ts` without changing favicon scope.

### Task 4: Verify and document

**Files:**
- Modify: `.claude/completions/2026-09-17-mt-affiliates-logo.md`

- [x] **Step 1: Run the focused test and verify GREEN**

Run:

```bash
cd frontend && corepack pnpm test test/mt-affiliates-theme.spec.ts
```

Expected: 1 file and 2 tests pass.

- [x] **Step 2: Run both production builds**

Run in `frontend` and `admin`:

```bash
corepack pnpm build
```

Expected: both builds exit with code 0.

- [x] **Step 3: Run focused static checks**

```bash
rg -n -i '#f59e0b|#7c3aed|gold|purple|violet' \
  frontend/app/assets/css/main.css frontend/app.config.ts frontend/app/layouts/auth.vue \
  admin/app/assets/css/main.css admin/app/app.config.ts admin/app/pages/theme.vue
git diff --check
```

Expected: only preserved semantic-warning values or documented compatibility token names remain; `git diff --check` exits 0.

- [x] **Step 4: Update the completion record**

Append the palette, modified theme surfaces, test result, and build result to the existing completion record. State explicitly that no API/DB theme record was mutated and no deployment occurred.
