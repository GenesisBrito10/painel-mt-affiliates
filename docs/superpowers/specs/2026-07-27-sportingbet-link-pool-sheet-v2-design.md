# Sportingbet Link Pool Sheet V2 Design

**Date:** 2026-07-27
**Status:** Approved in conversation; awaiting review of this written specification

## Objective

Adapt the existing Sportingbet link pool to the new Google Sheets contract and
persist the provider dimensions required by a future Sportingbet metrics API.

Each sheet row is one independent pool item. Rows with the same affiliate name
but different link types are not a group and may be assigned to different
users.

## Scope

This feature covers:

1. Reading the `Links` tab from the supplied Sportingbet spreadsheet.
2. Mapping the `Afiliado`, `Tipo de Link`, `URL`, `STATUS`, and `EMAIL`
   columns by header name.
3. Assigning exactly one available row per link request.
4. Normalizing the affiliate name to the format returned by the future API.
5. Persisting the normalized affiliate, link type, canonical campaign key, and
   affiliate URL in `AffiliateLink`.
6. Marking only the assigned row in the spreadsheet.
7. Updating Sportingbet pool status and inconsistency detection for the new
   identity.
8. Updating environment documentation for the new spreadsheet and tab.
9. Adding focused automated tests for parsing, normalization, persistence,
   uniqueness, and single-row consumption.

This feature does not implement the future Sportingbet metrics extractor or
change Sportingbet CPA, RevShare, eligibility, scheduler cadence, notification,
webhook, or Redis locking rules.

## Existing Architecture

`SportingbetLinkPoolModule` already contains:

- `SportingbetSheetService`, which reads and writes Google Sheets;
- `SportingbetAssignmentService`, which serializes assignments with Redis and
  fulfills link requests transactionally;
- `SportingbetSchedulerService`, which processes eligible pending requests in
  creation order and batches sheet writes;
- `SportingbetAdminController`, which exposes manual backfill and pool status.

The old sheet contract is:

```text
ID | LINK | EMAIL | STATUS
```

It derives `campaignId` from the old ID using a fixed provider prefix and
suffix. It does not persist the URL in `AffiliateLink.userLink`.

The new sheet has one `Links` tab and the following relevant columns:

```text
Afiliado | Tipo de Link | URL | STATUS | EMAIL
```

At design time it contains 717 affiliates, each with one `Cadastro`, one
`Instagram`, and one `Telegram` row. These 2,151 rows are independent pool
items.

## Sheet Contract

The service reads the header row and resolves required columns by their trimmed,
case-insensitive names:

- `Afiliado`
- `Tipo de Link`
- `URL`
- `STATUS`
- `EMAIL`

Unrelated columns such as `Data` and `Casa` are ignored.

Reading by header name avoids coupling the parser to the current physical
positions (`B`, `D`, `E`, `F`, and `G`) while preserving each row's original
sheet index for writes.

If a required header is missing or duplicated, `readPool()` fails with an
explicit schema error. The scheduler treats this as a sheet read failure and
does not assign any row from a partially understood schema.

A row is available only when:

- `Afiliado` is non-empty;
- `Tipo de Link` is non-empty;
- `URL` is non-empty;
- `STATUS` is empty;
- `EMAIL` is empty.

Rows remain in sheet order. The first available row that has no database
conflict is assigned.

## Affiliate Normalization and Identity

The provider response uses separate dimensions:

```json
{
  "affiliate": "CaioFernandesRochaSouza",
  "campaign": "Telegram"
}
```

The sheet affiliate is normalized by removing all whitespace:

```text
Caio Fernandes Rocha Souza -> CaioFernandesRochaSouza
```

Normalization preserves case, accents, punctuation, and all non-whitespace
characters. This feature must not invent transliteration or case-folding rules
that were not specified by the provider contract.

The canonical campaign key is:

```text
<normalizedAffiliate>::<linkType>
```

Example:

```text
CaioFernandesRochaSouza::Telegram
```

The future API extractor must build the same key from `affiliate` and
`campaign`. This allows the existing analytics join on
`(campaignId, bettingHouse)` to remain unchanged.

## Data Model

Add a nullable field to `AffiliateLink`:

```prisma
linkType String?
```

It is nullable because links belonging to other houses and existing
Sportingbet rows do not have this dimension. No historical value is inferred
or backfilled.

For an assigned row, persist:

| Database field | Value |
| --- | --- |
| `bettingHouse` | `sportingbet` |
| `affiliateId` | normalized `Afiliado` |
| `linkType` | trimmed `Tipo de Link`, unchanged otherwise |
| `campaignId` | `<affiliateId>::<linkType>` |
| `userLink` | trimmed `URL` |
| `source` | `POOL` |

Example:

| Database field | Value |
| --- | --- |
| `affiliateId` | `CaioFernandesRochaSouza` |
| `linkType` | `Telegram` |
| `campaignId` | `CaioFernandesRochaSouza::Telegram` |
| `userLink` | URL from the Telegram row |

`campaignId` remains globally unique within Sportingbet. The same affiliate may
therefore supply three independent rows because `Cadastro`, `Instagram`, and
`Telegram` produce three different canonical keys.

## Assignment Flow

For each eligible request:

1. Acquire the existing Sportingbet Redis assignment lock.
2. Confirm the request is still `PENDING`.
3. Read the pool or reuse the scheduler's prefetched rows.
4. Filter available rows using the new five-field contract.
5. Normalize `Afiliado` and build the canonical campaign key.
6. Skip a row when that active key already belongs to another Sportingbet
   affiliate link.
7. In the existing database transaction, create or update the user's active
   Sportingbet `AffiliateLink` with `affiliateId`, `linkType`, `campaignId`,
   `userLink`, commission snapshot, and `source=POOL`.
8. Fulfill the request with:

   ```json
   [{ "label": "Telegram", "url": "<URL from the row>" }]
   ```

9. Mark only the selected row as used.
10. Emit the existing notification and approval webhook.

The update path replaces all four provider identity fields together. It must
not leave a new campaign key paired with an old affiliate, link type, or URL.

The sheet status value remains `marcado`. `EMAIL` receives the requesting
user's email.

The scheduler continues batching writes, but each successful assignment adds
only its own row index to the batch. Mutating the prefetched row in memory
prevents the same row from being selected again in the same cycle.

## Pool Status and Inconsistencies

The admin status endpoint uses the same availability predicate as assignment.

- `total`: all parsed data rows;
- `available`: rows with required identity and URL fields and empty control
  fields;
- `used`: rows having `STATUS` or `EMAIL`;
- `inconsistencies`: available-looking rows whose canonical campaign key
  already exists in an active Sportingbet `AffiliateLink`.

Incomplete rows are not assignable. They are excluded from `available` and are
not silently treated as successfully used.

## Configuration

Document these values:

```dotenv
SPORTINGBET_SHEET_ID=1J4lnIYIAku2H5-R4WoJtVpZ56b8YQ6JIZOfrvld6la0
SPORTINGBET_SHEET_TAB=Links
```

The spreadsheet ID remains runtime configuration rather than a hardcoded
service constant. Deployment must share the spreadsheet with the configured
Google service account.

## Error Handling

- Missing configuration keeps the existing behavior: the pool is inactive and
  requests remain pending.
- Missing or duplicated required headers aborts the read before assignment.
- Rows with missing affiliate, link type, or URL are ignored as invalid.
- A database uniqueness race continues to skip the colliding row and tries the
  next available row.
- A database success followed by a sheet write failure remains logged as an
  explicit inconsistency; the database transaction is not rolled back after
  commit.
- Notification or webhook failures do not undo a successful assignment.

No error path may mark all three rows belonging to the same affiliate name.

## Testing

Automated tests must prove:

1. Whitespace is removed from an affiliate while case and accents are
   preserved.
2. The canonical key combines normalized affiliate and unchanged link type.
3. Header mapping reads the five required columns from the supplied layout.
4. Missing or duplicated required headers fail explicitly.
5. One request selects and persists exactly one row.
6. `affiliateId`, `linkType`, `campaignId`, and `userLink` are written together.
7. The fulfilled request stores the link type as its label.
8. A consumed row is marked while sibling rows with the same affiliate remain
   available.
9. Different link types for the same affiliate produce distinct campaign keys.
10. The admin inconsistency check uses the canonical key.
11. Existing scheduler locking, commission snapshot, notification, and webhook
    behavior remain intact.

## Acceptance Criteria

The feature is accepted when:

- the new spreadsheet is readable using the documented configuration;
- a Sportingbet request consumes only one available row;
- only that row receives `marcado` and the user's email;
- the active `AffiliateLink` contains normalized affiliate, exact link type,
  canonical campaign key, and row URL;
- another request can still consume a sibling link type for the same affiliate;
- the stored identity can be reconstructed from a future API response containing
  `affiliate` and `campaign`;
- focused tests, lint, and TypeScript build pass without introducing unrelated
  changes.
