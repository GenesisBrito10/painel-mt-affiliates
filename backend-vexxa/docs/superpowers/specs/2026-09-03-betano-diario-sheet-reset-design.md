# Betano Diario Sheet Assignment, Metrics Sync, and Full Reset Design

**Date:** 2026-09-03

## Goal

Restart the `betano-diario` operation from zero, move link assignment and daily
performance ingestion to spreadsheet
`1NPeKinpO5pRlhmJKkDQ8RRE8nZE1bhJAvyTEMrZH2v4`, isolate its data from regular
Betano, and enforce the newly approved commercial and request-eligibility
rules.

## Approved Business Rules

- A user without an inviter receives CPA `60` and RevShare `0`.
- A user with an inviter receives the inviter's current Betano Diario CPA minus
  `5`, clamped at zero.
- If the inviter does not yet have a real active Betano Diario link with CPA,
  the request remains `PENDING` with no CPA snapshot and no link assignment.
- A user may request Betano Diario only after producing at least `10` qualified
  CPAs on their own Superbet campaigns in the rolling previous `30` Sao Paulo
  calendar days, including today.
- Network production does not count toward the 10-CPA gate.
- The Betano Diario average-deposit requirement is `R$20`.
- The Betano Diario minimum withdrawal amount is `R$100`.
- The spreadsheet `CPA` column is a count of qualified CPAs, not money.
- The operation is reset completely before the new source is enabled.

## Current State

The existing Betano Diario module reads the legacy Betano spreadsheet through
`BETANO_DIARIO_SHEET_ID` and a fixed `Diario` tab. It expects four columns,
including an obsolete identification column, and shares the Betano assignment
lock and physical pool.

Metrics are not independently ingested for Betano Diario. Dashboard and balance
queries instead redirect `betano-diario` to raw rows stored under `betano`
through `HOUSE_DATA_SOURCE`. The existing seed still configures CPA `120`, an
inviter discount of `10`, and average deposit `110`.

The new spreadsheet was inspected through the configured service account. It
currently contains:

- `LINKS`, with header `LINK | STATUS | E-MAIL` and 100 link rows;
- dated tabs such as `02/09/2026`, `03/09/2026`, and `04/09/2026`;
- a presentation title in row 1 of dated tabs;
- header `LINKS | CLICKS | REGISTROS | FTDs | FTD AMOUNT | CPA` in row 2;
- metric rows beginning at row 3;
- 100 pre-populated link URLs per dated tab, currently with empty metrics.

A live database inventory was attempted during design, but PostgreSQL rejected
the connection with `P2037 / TooManyConnections`. All reset predicates and
counts therefore require a fresh read-only preview immediately before apply.

## Architecture

The existing `betano-diario-link-pool` module remains the ownership boundary.
It receives two separate spreadsheet responsibilities:

1. `BetanoDiarioSheetService` owns the writable `LINKS` assignment pool.
2. A new metrics sheet reader owns discovery and parsing of dated, read-only
   metric tabs.
3. A new metrics sync service owns validation, commission calculation,
   idempotent persistence, locking, sync logs, and manual/cron execution.

This is preferred over registering a fake provider account in the shared sync
orchestrator. A spreadsheet does not authenticate like a provider API, and the
dedicated module pattern already exists for Betnacional and Hiperbet.

Regular Betano remains unchanged. After reset and cutover,
`betano-diario` becomes its own data source and is removed from
`HOUSE_DATA_SOURCE`.

## Configuration

The three environment templates use:

```dotenv
BETANO_DIARIO_SHEET_ID="1NPeKinpO5pRlhmJKkDQ8RRE8nZE1bhJAvyTEMrZH2v4"
BETANO_DIARIO_SHEET_TAB="LINKS"
```

The Google service-account credentials remain in environment variables. No
credential or decrypted secret is copied into code, documentation, fixtures,
logs, reset snapshots, or audit metadata.

The deal eligibility window setting is updated to `30`. Only Betano Diario is
enabled for deal eligibility, so no other house is newly gated.

## Link Assignment Contract

The pool reader resolves required headers by trimmed, case-insensitive name.
The required headers are `LINK`, `STATUS`, and `E-MAIL`; missing or duplicate
headers abort the pool read before a row can be consumed. Column order may
change without breaking assignment.

Every spreadsheet row is one independent pool item. A row is available only
when:

- `LINK` is non-empty;
- `STATUS` is empty; and
- `E-MAIL` is empty.

The existing Betano URL parser extracts `siteid` and `c`. The persisted identity
remains:

```text
affiliateId = siteid
campaignId  = siteid + "-" + c
userLink    = original LINK cell
```

On successful assignment, only the selected row receives `STATUS=marcado` and
the requester's email. Database fulfillment occurs transactionally before the
sheet control cells are written. A failed sheet write is logged as an explicit
inconsistency and is discoverable through pool status.

Betano and Betano Diario no longer share a physical pool, but the existing
cross-house campaign conflict check remains. The two assignment paths continue
using a shared Redis assignment lock so the same physical tracking campaign can
never become active in both houses under a race.

## Superbet Eligibility Gate

`isDealEligibilityRequired()` returns true only for `betano-diario` users who do
not already have a real active Betano Diario link. Both the deal-list response
and the create endpoint use the same check, preventing UI/API disagreement.

Eligibility reads every real active Superbet link owned by the requester, not
an arbitrary single link. It aggregates `affiliate_data.cpaQualified` for those
campaign IDs under `bettingHouse='superbet'` across a rolling 30-day Sao Paulo
date window. The gate passes when the sum is at least 10.

The Betano Diario `R$20` average-deposit rule is not a Superbet request gate.
The eligibility evaluation therefore disables the Superbet average-deposit
threshold for this house while retaining `minAvgDepositPerFtd=20` in the deal
and `minAvgDepositPerCpa=20` in the betting house for commercial display and
withdrawal validation. The frontend eligibility message omits average deposit
when its gate threshold is zero and displays only the 10-CPA/30-day rule.

An ineligible POST returns HTTP 403 with the observed qualified-CPA count,
required count, window dates, and a user-facing explanation. It does not create
a rejected or pending request. A user who passes the gate but has an inviter
without Betano Diario CPA receives a `PENDING` request under the separate
inviter-hold rule.

## Daily Metrics Sheet Contract

The reader first lists spreadsheet tab titles. A valid metric tab title matches
strict `dd/MM/yyyy` and represents a real calendar date. Only tabs whose date is
not later than the current Sao Paulo date are eligible. Prepared future tabs are
ignored until their date arrives.

For every eligible tab, the reader expects the six required headers in row 2:

| Sheet header | Stored field |
| --- | --- |
| `LINKS` | parsed `campaignId`, `affiliateId`, and original URL identity |
| `CLICKS` | `clicks` |
| `REGISTROS` | `registrations` |
| `FTDs` | `ftds` |
| `FTD AMOUNT` | `deposit` |
| `CPA` | both `qftd` and `cpaQualified` |

Headers are matched by normalized name. A missing dated tab is a normal skip.
An existing dated tab with missing or duplicate required headers is skipped as
an invalid tab and logged; it cannot partially write rows.

Metric rows begin at row 3. A row is ignored when:

- `LINKS` is empty;
- the URL does not contain valid `siteid` and `c`; or
- all five metric cells are blank.

Explicit numeric zero is data and is persisted. Blank metrics never create a
new row and never overwrite or delete an existing row. To intentionally reset a
previously synchronized metric row, the operator must enter explicit zeroes.

Counts must be finite non-negative integers. `FTD AMOUNT` accepts Brazilian or
plain decimal formatting and must be a finite non-negative amount. Invalid
populated values reject that complete spreadsheet row and emit a warning with
tab and row number; invalid data is never silently converted to zero.

## Commission Mapping and Persistence

For each parsed row, the sync finds the real active Betano Diario affiliate link
with the same `campaignId`. Rows without a matching active link are skipped and
reported, because no contracted CPA can be determined.

The stored financial values are:

```text
qftd            = sheet CPA count
cpaQualified    = sheet CPA count
cpaValue        = cpaQualified * AffiliateLink.cpa
revShare        = 0
totalCommission = cpaValue
netPl           = null
withdrawalTotal = null
volume          = null
```

Rows are upserted idempotently using the existing unique identity:

```text
campaignId + bettingHouse + date + campaignName + utmCampaign
```

The constants are:

```text
bettingHouse = betano-diario
campaignName = campaignId
utmCampaign  = sheet
source       = betano-diario-sheet
```

Meaningful changes create `AffiliateDataChangeLog` rows with the same source.
The service records a normal `SyncLog`, updates `BettingHouse.lastSyncAt` only
after a completed cycle, and emits the existing `affiliate_data.synced` webhook
when at least one row was inserted or materially updated.

## Scheduling and Manual Operation

The metrics sync runs every 15 minutes in `America/Sao_Paulo`, respects the
global `sync_paused` setting, verifies that the house is active and automatic,
and uses a Betano Diario metrics Redis lock with a ten-minute TTL.

Each cycle lists all valid dated tabs through today and re-reads them so manual
corrections remain idempotently applicable. This is acceptable for the current
small spreadsheet. If tab volume later becomes material, a last-modified or
bounded-window optimization can be designed separately.

The admin controller exposes a fire-and-forget `POST
/v1/admin/betano-diario/sync-metrics` endpoint equivalent to the existing
Betnacional operation. Assignment backfill and pool-status endpoints remain
separate.

## Full Reset Contract

The reset is a guarded operational script, not application startup behavior. It
defaults to dry-run and requires both `--apply` and a snapshot token generated
by the immediately preceding preview.

The preview resolves the exact Betano Diario campaign set from all active and
deleted Betano Diario links before deleting anything. It inventories counts,
IDs, financial totals, gateway linkage, and dependent records across every
house-scoped table. It also identifies legacy raw metrics stored under
`betano` only when their campaign ID belongs to that resolved Betano Diario
campaign set.

The snapshot is written outside the repository, includes the sheet control
cells that will be cleared, and receives a SHA-256 digest. It must not contain
decrypted secrets. The apply phase validates the digest and live target counts,
pauses house processing, acquires a PostgreSQL advisory lock, and performs the
database reset in a serializable transaction.

The reset removes every internal Betano Diario operational and financial record,
including:

- affiliate metrics and their change logs;
- active and deleted affiliate links;
- link requests, webhook deliveries, assignment logs, and backfill runs;
- withdrawals of every status and house-specific withdrawal-day releases;
- gateway webhook rows linked exclusively to removed withdrawals;
- commission logs, fraud counts/logs, balance adjustments, notification
  snapshots, and house-tagged notifications;
- financial-ledger rows tagged `betano-diario`;
- sync logs and any old provider-account association for `betano-diario`;
- house-scoped affiliate API request logs;
- legacy `betano` metrics whose campaign belongs to the Betano Diario campaign
  set.

House-scoped prize/ranking records are included only when their persisted
`bettingHouse` is exactly `betano-diario`; global prize records are not inferred
to belong to the house and are left unchanged.

The `BettingHouse` identity is retained. Existing Betano Diario deals and its
house rule are replaced with one canonical active deal/rule carrying the
approved values. A new append-only audit record describes the reset and points
to the snapshot digest.

After the database transaction commits, the script clears only `STATUS` and
`E-MAIL` cells in the new `LINKS` tab. Link URLs are never cleared. Failure of
this external write leaves the database reset committed but reports a hard
inconsistency and a retry command that only clears the control cells.

Payments already submitted to an external gateway are not reversed by deleting
their internal records. Their exact request/response/receipt evidence remains
recoverable from the reset snapshot.

## Reset Verification and Cutover

An independent connection performs post-write verification. Success requires:

- zero Betano Diario links and requests before the canonical rule is reseeded;
- zero direct Betano Diario metrics and zero legacy Betano metrics for the
  captured campaign set;
- zero house-specific balances, withdrawals, adjustments, fraud entries,
  commission logs, sync logs, and provider associations;
- no remaining dependent rows pointing at deleted requests or withdrawals;
- the `LINKS` tab still containing the original URLs with empty control cells;
- the canonical deal and house rule containing CPA 60, discount 5, RevShare 0,
  average deposit 20, withdrawal minimum 100, and inviter hold behavior;
- the dashboard data-source mapping resolving `betano-diario` to itself;
- an initial Betano Diario dashboard balance of zero.

Only after those checks pass are assignment and metrics sync enabled. The first
metrics cycle may ingest dated tabs up to the current Sao Paulo day. Because
all currently inspected metric cells are blank, the first cycle should write
zero metric rows until manual data is entered.

## Testing

Focused tests must cover:

1. Header-driven `LINKS` parsing and isolated STATUS/E-MAIL writes.
2. Available-row rules, malformed links, campaign conflicts, and sheet-write
   inconsistency reporting.
3. CPA 60 for users without inviters and inviter CPA minus 5 for invited users.
4. Inviter-without-CPA requests remaining pending without assignment.
5. Superbet eligibility across every real active user campaign, excluding
   network production and inactive/placeholder links.
6. Rolling 30-day Sao Paulo boundaries, sums below 10, exactly 10, and above 10.
7. API and deal-list agreement for eligible and ineligible users.
8. Dated-tab discovery, missing/future/invalid tabs, row-2 headers, empty metric
   rows, explicit zeroes, localized decimals, and invalid populated values.
9. Idempotent metric inserts, manual updates, commission recalculation from the
   assigned link CPA, change logs, sync logs, and webhook emission.
10. Dashboard and balance isolation after removing the Betano alias.
11. Reset dry-run/apply token validation, count drift rejection, exact house and
    campaign predicates, rollback on database failure, sheet-only retry, and
    independent zero-state verification.

Repository verification includes focused Vitest suites, TypeScript typecheck,
Nest build, scoped ESLint/Prettier checks, and a final diff inspection. The
destructive reset itself is never run from an automated test against a shared or
production database.
