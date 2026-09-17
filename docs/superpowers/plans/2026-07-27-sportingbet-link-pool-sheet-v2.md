# Sportingbet Link Pool Sheet V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adapt the existing Sportingbet pool to consume one row from the new five-field sheet contract and persist the normalized affiliate, link type, canonical campaign key, and URL.

**Architecture:** Keep the existing Sportingbet module, locks, scheduler, transaction, notifications, and webhook. Add pure domain helpers for normalization, canonical identity, header-driven sheet parsing, and availability; add nullable `AffiliateLink.linkType`; then update sheet I/O, assignment persistence, and admin/scheduler consumers to use the shared contract.

**Tech Stack:** NestJS 11, TypeScript 6, Prisma 7/PostgreSQL, Google Sheets API, Vitest 4, Redis/ioredis.

---

## File Structure

- Modify `backend-vexxa/src/modules/sportingbet-link-pool/domain/sportingbet.types.ts`
  — define the new row shape and canonical identity helpers.
- Create `backend-vexxa/src/modules/sportingbet-link-pool/domain/sportingbet-sheet.parser.ts`
  — parse header-driven sheet data and expose control-column coordinates.
- Create `backend-vexxa/src/modules/sportingbet-link-pool/domain/sportingbet.types.spec.ts`
  — verify affiliate normalization, campaign key, and availability.
- Create `backend-vexxa/src/modules/sportingbet-link-pool/domain/sportingbet-sheet.parser.spec.ts`
  — verify the new sheet contract and schema failures.
- Modify `backend-vexxa/src/modules/sportingbet-link-pool/application/sportingbet-sheet.service.ts`
  — read headers and write only the resolved status/email cells.
- Create `backend-vexxa/src/modules/sportingbet-link-pool/application/sportingbet-sheet.service.spec.ts`
  — verify header-driven reads and single-row writes.
- Modify `backend-vexxa/prisma/schema.prisma`
  — add nullable `AffiliateLink.linkType`.
- Create `backend-vexxa/prisma/migrations/20260727130000_add_sportingbet_link_type/migration.sql`
  — add the physical nullable column.
- Modify `backend-vexxa/src/modules/sportingbet-link-pool/application/sportingbet-assignment.service.ts`
  — persist all provider identity fields and label the fulfilled URL.
- Create `backend-vexxa/src/modules/sportingbet-link-pool/application/sportingbet-assignment.service.spec.ts`
  — verify one-row assignment and persistence.
- Modify `backend-vexxa/src/modules/sportingbet-link-pool/application/sportingbet-scheduler.service.ts`
  — use the shared availability predicate.
- Modify `backend-vexxa/src/modules/sportingbet-link-pool/infrastructure/sportingbet-admin.controller.ts`
  — calculate status and inconsistencies with the canonical key.
- Create `backend-vexxa/src/modules/sportingbet-link-pool/infrastructure/sportingbet-admin.controller.spec.ts`
  — verify available/used/invalid/inconsistent counts.
- Modify `backend-vexxa/.env.example`
  — document the new spreadsheet and tab.
- Create `.claude/completions/2026-07-27-sportingbet-link-pool-sheet-v2.md`
  — record changes and verification evidence.

### Task 1: Domain Identity and Availability Contract

**Files:**
- Create: `backend-vexxa/src/modules/sportingbet-link-pool/domain/sportingbet.types.spec.ts`
- Modify: `backend-vexxa/src/modules/sportingbet-link-pool/domain/sportingbet.types.ts`

- [ ] **Step 1: Write the failing identity tests**

```ts
import {
  buildSportingbetCampaignId,
  isSportingbetRowAvailable,
  normalizeSportingbetAffiliate,
  type SheetRow,
} from './sportingbet.types.js';

describe('Sportingbet identity', () => {
  it('removes whitespace while preserving case and accents', () => {
    expect(normalizeSportingbetAffiliate('  Eloá Rafael  Farias Viana ')).toBe(
      'EloáRafaelFariasViana',
    );
  });

  it('builds the canonical key from affiliate and unchanged link type', () => {
    expect(
      buildSportingbetCampaignId('Caio Fernandes Rocha Souza', 'Telegram'),
    ).toBe('CaioFernandesRochaSouza::Telegram');
  });

  it('requires identity, URL, and empty control fields for availability', () => {
    const row: SheetRow = {
      rowIndex: 2,
      affiliate: 'Caio Fernandes Rocha Souza',
      linkType: 'Telegram',
      link: 'https://example.com/telegram',
      status: '',
      email: '',
    };
    expect(isSportingbetRowAvailable(row)).toBe(true);
    expect(isSportingbetRowAvailable({ ...row, status: 'marcado' })).toBe(false);
    expect(isSportingbetRowAvailable({ ...row, linkType: '' })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify RED**

Run:

```bash
pnpm test -- src/modules/sportingbet-link-pool/domain/sportingbet.types.spec.ts
```

Expected: FAIL because the new helpers and row fields do not exist.

- [ ] **Step 3: Implement the minimal domain contract**

Replace the old prefix/suffix builder and old `SheetRow.id` shape with:

```ts
export interface SheetRow {
  rowIndex: number;
  affiliate: string;
  linkType: string;
  link: string;
  status: string;
  email: string;
}

export function normalizeSportingbetAffiliate(value: string): string {
  return value.trim().replace(/\s+/gu, '');
}

export function buildSportingbetCampaignId(
  affiliate: string,
  linkType: string,
): string {
  return `${normalizeSportingbetAffiliate(affiliate)}::${linkType.trim()}`;
}

export function isSportingbetRowAvailable(row: SheetRow): boolean {
  return Boolean(
    row.affiliate &&
      row.linkType &&
      row.link &&
      !row.status &&
      !row.email,
  );
}
```

Keep the existing lock, scheduler, result, status, and slug contracts.

- [ ] **Step 4: Run the focused test to verify GREEN**

Run:

```bash
pnpm test -- src/modules/sportingbet-link-pool/domain/sportingbet.types.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the domain contract**

```bash
git add backend-vexxa/src/modules/sportingbet-link-pool/domain/sportingbet.types.ts \
  backend-vexxa/src/modules/sportingbet-link-pool/domain/sportingbet.types.spec.ts
git commit -m "feat(sportingbet): define sheet row identity"
```

### Task 2: Header-Driven Sheet Parser and Writes

**Files:**
- Create: `backend-vexxa/src/modules/sportingbet-link-pool/domain/sportingbet-sheet.parser.ts`
- Create: `backend-vexxa/src/modules/sportingbet-link-pool/domain/sportingbet-sheet.parser.spec.ts`
- Modify: `backend-vexxa/src/modules/sportingbet-link-pool/application/sportingbet-sheet.service.ts`
- Create: `backend-vexxa/src/modules/sportingbet-link-pool/application/sportingbet-sheet.service.spec.ts`

- [ ] **Step 1: Write failing parser tests**

Test the supplied physical layout:

```ts
const values = [
  ['Data', 'Afiliado', 'Casa', 'Tipo de Link', 'URL', 'STATUS', 'EMAIL'],
  [
    '22/07/2026',
    'Caio Fernandes Rocha Souza',
    'Sportingbet',
    'Telegram',
    'https://example.com/tg',
    '',
    '',
  ],
];

expect(parseSportingbetSheet(values)).toEqual({
  rows: [
    {
      rowIndex: 2,
      affiliate: 'Caio Fernandes Rocha Souza',
      linkType: 'Telegram',
      link: 'https://example.com/tg',
      status: '',
      email: '',
    },
  ],
  columns: { status: 'F', email: 'G' },
});
```

Also assert that missing and duplicated required headers throw
`SportingbetSheetSchemaError`.

- [ ] **Step 2: Run parser tests to verify RED**

Run:

```bash
pnpm test -- src/modules/sportingbet-link-pool/domain/sportingbet-sheet.parser.spec.ts
```

Expected: FAIL because the parser does not exist.

- [ ] **Step 3: Implement the pure parser**

Implement:

```ts
export interface SportingbetSheetParseResult {
  rows: SheetRow[];
  columns: { status: string; email: string };
}

export class SportingbetSheetSchemaError extends Error {}

export function parseSportingbetSheet(
  values: string[][],
): SportingbetSheetParseResult
```

Normalize headers with `trim().toLocaleLowerCase('pt-BR')`, require exactly one
match for each field, convert zero-based column indexes to A1 letters, and trim
all cell values.

- [ ] **Step 4: Run parser tests to verify GREEN**

Run:

```bash
pnpm test -- src/modules/sportingbet-link-pool/domain/sportingbet-sheet.parser.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing sheet-service tests**

Instantiate `SportingbetSheetService` with a fake config and inject a fake
Sheets client. Assert:

- `readPool()` requests `Links!A1:ZZ`;
- the returned row matches the parser result;
- `markRowUsed(2, 'user@example.com')` performs one batch request containing
  `Links!F2 = marcado` and `Links!G2 = user@example.com`;
- no sibling row is included.

- [ ] **Step 6: Run sheet-service tests to verify RED**

Run:

```bash
pnpm test -- src/modules/sportingbet-link-pool/application/sportingbet-sheet.service.spec.ts
```

Expected: FAIL because the service still reads `A2:D` and writes the old
columns.

- [ ] **Step 7: Implement header-driven sheet I/O**

Change `readPool()` to request `A1:ZZ`, parse the values, cache the status/email
column letters, and return parsed rows. Change mark/clear operations to one
`values.batchUpdate` HTTP call with separate status and email cell ranges.
Throw a schema error if a write is attempted before a successful header read.

- [ ] **Step 8: Run all sheet tests to verify GREEN**

Run:

```bash
pnpm test -- \
  src/modules/sportingbet-link-pool/domain/sportingbet-sheet.parser.spec.ts \
  src/modules/sportingbet-link-pool/application/sportingbet-sheet.service.spec.ts
```

Expected: PASS.

- [ ] **Step 9: Commit sheet parsing and I/O**

```bash
git add backend-vexxa/src/modules/sportingbet-link-pool/domain/sportingbet-sheet.parser.ts \
  backend-vexxa/src/modules/sportingbet-link-pool/domain/sportingbet-sheet.parser.spec.ts \
  backend-vexxa/src/modules/sportingbet-link-pool/application/sportingbet-sheet.service.ts \
  backend-vexxa/src/modules/sportingbet-link-pool/application/sportingbet-sheet.service.spec.ts
git commit -m "feat(sportingbet): read new pool sheet contract"
```

### Task 3: One-Row Assignment and Link Type Persistence

**Files:**
- Create: `backend-vexxa/src/modules/sportingbet-link-pool/application/sportingbet-assignment.service.spec.ts`
- Modify: `backend-vexxa/src/modules/sportingbet-link-pool/application/sportingbet-assignment.service.ts`
- Modify: `backend-vexxa/prisma/schema.prisma`
- Create: `backend-vexxa/prisma/migrations/20260727130000_add_sportingbet_link_type/migration.sql`

- [ ] **Step 1: Write the failing assignment test**

Create a service with fake Redis, Prisma transaction, sheet, notification, and
webhook dependencies. Use two available rows with the same affiliate and
different link types. Assert the first assignment writes:

```ts
expect(tx.affiliateLink.create).toHaveBeenCalledWith({
  data: expect.objectContaining({
    bettingHouse: 'sportingbet',
    affiliateId: 'CaioFernandesRochaSouza',
    linkType: 'Telegram',
    campaignId: 'CaioFernandesRochaSouza::Telegram',
    userLink: 'https://example.com/telegram',
    source: LinkSource.POOL,
  }),
});
expect(tx.linkRequest.update).toHaveBeenCalledWith({
  where: { id: 'request-1' },
  data: expect.objectContaining({
    links: [
      { label: 'Telegram', url: 'https://example.com/telegram' },
    ],
  }),
});
expect(rows[0]).toMatchObject({
  status: 'marcado',
  email: 'user@example.com',
});
expect(rows[1]).toMatchObject({ status: '', email: '' });
expect(sheetService.markRowUsed).toHaveBeenCalledWith(
  2,
  'user@example.com',
);
```

- [ ] **Step 2: Run the assignment test to verify RED**

Run:

```bash
pnpm test -- src/modules/sportingbet-link-pool/application/sportingbet-assignment.service.spec.ts
```

Expected: FAIL because assignment still reads `row.id`, saves an empty
`affiliateId`, omits `linkType/userLink`, and uses an empty link label.

- [ ] **Step 3: Add the nullable Prisma field**

Add next to `userLink`:

```prisma
// Dimensão de campanha retornada pelo provedor (ex.: Telegram na Sportingbet).
linkType String?
```

- [ ] **Step 4: Add the migration**

```sql
ALTER TABLE "affiliate_links" ADD COLUMN "linkType" TEXT;
```

- [ ] **Step 5: Generate Prisma Client and validate the schema**

Run:

```bash
pnpm prisma:generate
pnpm exec prisma validate
```

Expected: both commands exit 0.

- [ ] **Step 6: Implement minimal assignment changes**

Use `isSportingbetRowAvailable(row)` for candidates. For each candidate:

```ts
const affiliateId = normalizeSportingbetAffiliate(row.affiliate);
const campaignId = buildSportingbetCampaignId(
  row.affiliate,
  row.linkType,
);
```

Write `affiliateId`, `linkType: row.linkType`, `campaignId`,
`userLink: row.link`, and `source: LinkSource.POOL` in both update and create
paths. Fulfill with `links: [{ label: row.linkType, url: row.link }]`.

- [ ] **Step 7: Run the assignment test to verify GREEN**

Run:

```bash
pnpm test -- src/modules/sportingbet-link-pool/application/sportingbet-assignment.service.spec.ts
```

Expected: PASS.

- [ ] **Step 8: Run all Sportingbet tests**

Run:

```bash
pnpm test -- src/modules/sportingbet-link-pool
```

Expected: all Sportingbet tests PASS.

- [ ] **Step 9: Commit assignment behavior and data model**

```bash
git add backend-vexxa/prisma/schema.prisma \
  backend-vexxa/prisma/migrations/20260727130000_add_sportingbet_link_type/migration.sql \
  backend-vexxa/src/modules/sportingbet-link-pool/application/sportingbet-assignment.service.ts \
  backend-vexxa/src/modules/sportingbet-link-pool/application/sportingbet-assignment.service.spec.ts
git commit -m "feat(sportingbet): assign one typed affiliate link"
```

### Task 4: Scheduler and Admin Consumers

**Files:**
- Modify: `backend-vexxa/src/modules/sportingbet-link-pool/application/sportingbet-scheduler.service.ts`
- Modify: `backend-vexxa/src/modules/sportingbet-link-pool/infrastructure/sportingbet-admin.controller.ts`
- Create: `backend-vexxa/src/modules/sportingbet-link-pool/infrastructure/sportingbet-admin.controller.spec.ts`

- [ ] **Step 1: Write the failing admin status test**

Return rows containing one available row, one used row, one incomplete row, and
one available-looking row whose canonical key already exists. Assert:

```ts
expect(await controller.poolStatus()).toEqual({
  total: 4,
  available: 2,
  used: 1,
  inconsistencies: 1,
});
```

Assert Prisma receives
`campaignId: 'CaioFernandesRochaSouza::Telegram'`.

- [ ] **Step 2: Run the admin test to verify RED**

Run:

```bash
pnpm test -- src/modules/sportingbet-link-pool/infrastructure/sportingbet-admin.controller.spec.ts
```

Expected: FAIL because the controller uses the old row ID and availability
logic.

- [ ] **Step 3: Update scheduler and admin**

Use `isSportingbetRowAvailable()` for scheduler free-count and admin available
count. Use `buildSportingbetCampaignId(row.affiliate, row.linkType)` for the
inconsistency lookup. Keep total/used definitions from the approved design.

- [ ] **Step 4: Run focused tests to verify GREEN**

Run:

```bash
pnpm test -- src/modules/sportingbet-link-pool
```

Expected: all Sportingbet tests PASS.

- [ ] **Step 5: Commit consumers**

```bash
git add backend-vexxa/src/modules/sportingbet-link-pool/application/sportingbet-scheduler.service.ts \
  backend-vexxa/src/modules/sportingbet-link-pool/infrastructure/sportingbet-admin.controller.ts \
  backend-vexxa/src/modules/sportingbet-link-pool/infrastructure/sportingbet-admin.controller.spec.ts
git commit -m "fix(sportingbet): align pool consumers with typed rows"
```

### Task 5: Configuration, Full Verification, and Completion Record

**Files:**
- Modify: `backend-vexxa/.env.example`
- Create: `.claude/completions/2026-07-27-sportingbet-link-pool-sheet-v2.md`

- [ ] **Step 1: Update environment documentation**

Replace the old Sportingbet sheet comment and values with:

```dotenv
# Sportingbet: aba Links; campos obrigatórios lidos por cabeçalho:
# Afiliado, Tipo de Link, URL, STATUS e EMAIL.
# campaignId salvo = "<AfiliadoSemEspacos>::<Tipo de Link>".
SPORTINGBET_SHEET_ID=1J4lnIYIAku2H5-R4WoJtVpZ56b8YQ6JIZOfrvld6la0
SPORTINGBET_SHEET_TAB=Links
```

- [ ] **Step 2: Format changed TypeScript files**

Run:

```bash
pnpm exec prettier --write \
  "src/modules/sportingbet-link-pool/**/*.ts"
```

Expected: exit 0.

- [ ] **Step 3: Run fresh focused verification**

Run:

```bash
pnpm test -- src/modules/sportingbet-link-pool
```

Expected: all Sportingbet tests PASS.

- [ ] **Step 4: Run fresh full verification**

Run:

```bash
pnpm test
pnpm lint
pnpm build
pnpm exec prisma validate
git diff --check
```

Expected: every command exits 0. If a pre-existing failure remains, record the
exact command and evidence without claiming it passed.

- [ ] **Step 5: Review the implementation against the specification**

Confirm every acceptance criterion in
`docs/superpowers/specs/2026-07-27-sportingbet-link-pool-sheet-v2-design.md`,
inspect `git diff --stat` and `git diff`, and verify no unrelated user file is
staged.

- [ ] **Step 6: Write the completion record**

Create `.claude/completions/2026-07-27-sportingbet-link-pool-sheet-v2.md` with:

- approved scope;
- files and behavior changed;
- migration name;
- test, lint, build, and Prisma validation results;
- environment values required for deployment;
- any remaining operational action, including migration deployment.

- [ ] **Step 7: Commit documentation and final formatting**

```bash
git add backend-vexxa/.env.example \
  backend-vexxa/src/modules/sportingbet-link-pool \
  .claude/completions/2026-07-27-sportingbet-link-pool-sheet-v2.md
git commit -m "docs(sportingbet): document typed link pool setup"
```

- [ ] **Step 8: Verify the final commit scope**

Run:

```bash
git status --short
git log --oneline -8
```

Expected: only the user's pre-existing unrelated changes remain uncommitted.
