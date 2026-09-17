# Sportingbet Link Pool Sheet V2 Completion

**Date:** 2026-07-27
**Status:** Implemented locally; database migration still requires deployment

## Delivered

- Replaced the legacy Sportingbet `ID | LINK | EMAIL | STATUS` reader with the
  header-driven `Afiliado | Tipo de Link | URL | STATUS | EMAIL` contract.
- Kept each spreadsheet row as one independent pool item.
- Added affiliate whitespace normalization and canonical keys in the form
  `<AfiliadoSemEspacos>::<Tipo de Link>`.
- Added nullable `AffiliateLink.linkType` and migration
  `20260727130000_add_sportingbet_link_type`.
- Assignment now persists `affiliateId`, `linkType`, `campaignId`, and
  `userLink` together.
- Fulfilled requests label their URL with the sheet link type.
- Sheet writes mark only the selected row's `STATUS` and `EMAIL` cells.
- Scheduler availability, pool alerts, and admin inconsistency checks use the
  same typed-row predicate.
- Updated `.env.example` and the local ignored `.env` to spreadsheet
  `1J4lnIYIAku2H5-R4WoJtVpZ56b8YQ6JIZOfrvld6la0`, tab `Links`.

## Verification

- Sportingbet tests: 5 files, 10 tests passed.
- Sportingbet module lint: passed.
- Nest build: passed, 394 files compiled.
- Prisma schema validation: passed.
- `git diff --check`: passed.
- Live read-only Google Sheets check: 2,151 rows parsed, 2,151 available; first
  canonical key resolved as `RicardoHelenaBatista::Cadastro`.

## Existing Repository-Wide Failures

- Full test suite: 466 passed, 1 failed. The unrelated failure already existed
  before this implementation:
  `AffiliateApiService > reuses an existing external user for the same
  (owner, externalId)` because its Prisma test mock does not define
  `user.update`.
- Full lint: 1,197 errors and 229 warnings across existing files. The focused
  Sportingbet module lint passes.

## Deployment

Before running the updated application against a database:

```bash
pnpm prisma:deploy
```

The configured Google service account must retain access to the new
spreadsheet. No production migration or row assignment was executed during
implementation.
