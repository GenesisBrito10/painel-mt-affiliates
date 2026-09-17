# Sportingbet OTG Sync Design

**Date:** 2026-07-27
**Status:** Approved in conversation; awaiting review of this written specification

## Objective

Add the Sportingbet OTG affiliate API to the existing provider sync pipeline so
the global application scheduler imports the current São Paulo day and matches
each report row to the typed Sportingbet link pool.

The integration must authenticate with encrypted credentials, follow report
pagination, preserve the pool identity contract, and keep Sportingbet RevShare
at zero in persisted metrics and balance calculations.

## Scope

This feature covers:

1. A new `otg` provider extractor.
2. Login through the OTG `/auth/login` endpoint.
3. Current-day report collection through `/agency/results/table`.
4. Pagination based on `data.meta.totalPages`.
5. Mapping `affiliate` and `campaign` to the canonical Sportingbet pool key.
6. Persisting CPA, registration, FTD, qualified CPA, and deposit metrics.
7. Explicitly ignoring OTG RevShare and persisting `revShare = 0`.
8. Replacing provider-specific current-day logic with extractor capabilities.
9. Respecting the active state of each `ProviderAccountHouse` association in
   scheduled and manual syncs.
10. Registering OTG in the provider account and sync modules.
11. An idempotent, dry-run-by-default setup script for the Sportingbet account
    cutover.
12. Automated tests for authentication, pagination, mapping, current-day
    enforcement, token caching, scheduler eligibility, and balance inputs.

This feature does not add a separate cron process, import historical OTG data,
change Sportingbet pool assignment rules, or change CPA rates and eligibility
rules.

## Existing Architecture

The NestJS `SyncModule` already provides:

- provider extractors behind `IProviderExtractor`;
- encrypted `ProviderAccount` credentials;
- `ProviderAccountHouse` associations containing the provider bookmaker ID;
- `SyncOrchestratorService` for date selection, retries, rate application,
  persistence, and webhook delivery;
- `SyncSchedulerService` for the global recurring jobs;
- `SyncPrismaRepository` for idempotent daily upserts.

Sportingbet links now use this identity:

```text
<affiliate-without-whitespace>::<link-type>
```

Example:

```text
CaioFernandesRochaSouza::Telegram
```

The OTG report exposes the same two dimensions as `affiliate` and `campaign`,
so the extractor can use the existing `(campaignId, bettingHouse)` join without
adding another database identity model.

## Provider Capabilities

Extend `IProviderExtractor` with two optional capabilities:

```ts
readonly dateScope?: 'historical' | 'current-day-only';
readonly tokenTtlMs?: number;
```

Defaults remain:

- `dateScope = 'historical'`;
- token TTL of 25 minutes.

`SmarticoExtractor` and `OtgExtractor` declare
`dateScope = 'current-day-only'`. This replaces the current Smartico slug
special case and guarantees that explicit historical dates, gap-fill, regular
sync, and recent sync all query only the current São Paulo date for OTG.

`OtgExtractor` declares a 10-minute token TTL because the observed OTG access
token lifetime is 15 minutes. The orchestrator caches the token per provider
account using the extractor-specific TTL, leaving a five-minute safety margin.

## Authentication

`OtgExtractor.login()` sends:

```http
POST {apiBaseUrl}/auth/login
Content-Type: application/json
Accept: application/json

{
  "email": "<decrypted ProviderAccount email>",
  "password": "<decrypted ProviderAccount password>"
}
```

Only `data.access_token` is accepted as a successful login result. A non-2xx
response, invalid JSON, or missing token raises a provider login exception
without including the password, access token, or complete response body in
logs.

The production API base is configuration stored in `ProviderAccount`:

```text
https://affiliate-api-prd.partnersotg.com/api/v1
```

Browser-only headers from the supplied curl are not copied. The server request
uses only the API headers required for authentication and authorization.

## Report Request and Pagination

For each sync, the orchestrator supplies the current São Paulo date. The
extractor requests:

```http
GET {apiBaseUrl}/agency/results/table
Authorization: Bearer <access_token>
Accept: application/json
```

Query parameters:

| Parameter | Value |
| --- | --- |
| `initialDate` | current São Paulo date |
| `finalDate` | same current São Paulo date |
| `tab` | `campaigns` |
| `viewMode` | `subaffiliates` |
| `sortBy` | `label` |
| `sortDirection` | `desc` |
| `page` | current page, starting at `1` |
| `pageSize` | `10000` |
| `bettingHouseId` | `ProviderAccountHouse.bookmarkerId` |

After page 1, the extractor reads `data.meta.totalPages` and requests every page
through that value. It never relies only on the number of rows returned by the
first page.

The extractor validates each response independently. A failed page fails that
date instead of persisting a partial result. The orchestrator's existing retry
wrapper retries the complete date request.

## Report Mapping

The observed OTG response row is:

```json
{
  "affiliate": "CaioFernandesRochaSouza",
  "campaign": "Telegram",
  "registrations": 0,
  "first_deposits": 0,
  "qualified_cpa": 0,
  "cpa": 0,
  "rvs": 0,
  "raw_commission": 0,
  "deposit": 0
}
```

Map it to `ExtractedReport` as follows:

| OTG field | Internal field | Rule |
| --- | --- | --- |
| `affiliate` | `affiliateId` | trim and remove all whitespace |
| `affiliate` + `campaign` | `campaignId` | `<affiliateId>::<trimmed campaign>` |
| requested date | `date` | UTC midnight for the requested calendar day |
| none | `clicks` | `0` |
| `registrations` | `registrations` | finite number, otherwise `0` |
| `first_deposits` | `ftds` | finite number, otherwise `0` |
| `qualified_cpa` | `qftd` | finite number, otherwise `0` |
| `qualified_cpa` | `cpaQualified` | same normalized number as `qftd` |
| `deposit` | `deposit` | finite number, otherwise `0` |
| none | `netPl` | `null` |
| none | `withdrawalTotal` | `null` |
| none | `volume` | `null` |
| ignored | `revShare` | always `0` |
| `cpa` | `cpaValue` | raw fallback for a campaign without a matching link |
| `raw_commission` | `totalCommission` | raw reference/fallback only |

Rows with an empty normalized affiliate or empty campaign are aggregate or
invalid rows and are ignored.

The campaign string is trimmed but otherwise preserved. The affiliate uses the
same whitespace-only normalization already defined by the Sportingbet pool.

## CPA and Balance Calculation

Sportingbet balance remains contract-driven:

```text
CPA balance = AffiliateLink.cpa * AffiliateData.cpaQualified
RevShare balance = 0
```

For a report that matches an `AffiliateLink`, the existing orchestrator
recalculates:

```text
cpaValue = qualified_cpa * contracted link CPA
totalCommission = cpaValue + (0 * contracted RevShare percentage)
```

`DashboardBalanceService` also calculates the user's and network CPA from
`cpaQualified` and the stored link rates. Because the extractor always persists
`revShare = 0`, neither the user balance nor network spread can include OTG
RevShare.

`deposit` remains available for CPA qualification/compliance views. OTG `rvs`
is deliberately not persisted, even when the API returns a non-zero value.
`raw_commission` is not a source for the contracted balance calculation.

## Scheduler Behavior

No new cron decorator or external cron is added. Sportingbet OTG runs through
the existing global scheduler.

Before invoking a house, every scheduler path checks:

- `ProviderAccount.active`;
- `ProviderAccountHouse.active`;
- `BettingHouse.active`;
- `BettingHouse.syncMode !== MANUAL`.

The same association-active check applies to the manual `runHouse` helper so a
deactivated provider association cannot be invoked accidentally.

Although the main, gap-fill, and recent scheduler jobs may all call Sportingbet,
the extractor capability collapses every request to the current São Paulo day.
The orchestrator's per-house lock and the repository's daily upsert preserve
idempotency.

## Provider Registration

Add `otg` to `SUPPORTED_PROVIDERS`, register `OtgExtractor` in `SyncModule`, and
include it in `EXTRACTOR_MAP`.

The Sportingbet association uses this OTG bookmaker ID:

```text
cmm5dhdqm000e19b58dqc549a
```

## Database Cutover Script

Add an idempotent script dedicated to the Sportingbet OTG setup. It:

1. reads `SPORTINGBET_OTG_EMAIL` and `SPORTINGBET_OTG_PASSWORD` from the ignored
   `.env`;
2. encrypts the password with the existing AES-256-GCM contract;
3. finds the `sportingbet` house and existing Betboard association;
4. previews exact affected records and planned values by default;
5. with `--apply`, executes one transaction that:
   - creates or updates the active OTG provider account;
   - creates or updates its active Sportingbet association with the OTG
     bookmaker ID;
   - deactivates the old Betboard Sportingbet association;
   - deactivates the old Betboard account only if it has no other active house
     association;
   - changes Sportingbet `syncMode` to `AUTO`;
6. verifies the final state with an independent read after the transaction.

The script never prints the plaintext password, encrypted payload, or access
token. It does not hardcode credentials supplied in conversation.

The transaction is applied only after the OTG extractor code has passed
verification, preventing an active account from referencing an extractor that
is not registered in the current application code.

## Error Handling

- Login failures contain provider and HTTP status, not credentials.
- Report failures contain provider, date, page, and HTTP status.
- Invalid payload shape fails the date; it is not treated as an empty report.
- A partial multi-page response is never persisted.
- Missing numeric values normalize to zero.
- Empty affiliate or campaign dimensions are ignored.
- Token cache lifetime is shorter than the observed JWT lifetime.
- Existing orchestrator retry and sync-log behavior remains the source of truth.
- Webhook failure never rolls back persisted affiliate data.

## Testing

Automated tests must prove:

1. Login sends only the configured email/password and returns
   `data.access_token`.
2. Login fails safely when the response has no access token.
3. Page 1 causes all pages through `meta.totalPages` to be requested.
4. Every report request contains the fixed OTG query contract and bookmaker ID.
5. Affiliate whitespace normalization and campaign composition match the pool
   key.
6. Invalid aggregate rows are skipped.
7. OTG `rvs` is ignored and `revShare` remains zero, including for non-zero
   input.
8. `qualified_cpa` populates both `qftd` and `cpaQualified`.
9. The orchestrator applies the contracted CPA and no RevShare to matched rows.
10. OTG ignores explicit historical dates and syncs only the current São Paulo
    day.
11. OTG tokens use the extractor's 10-minute cache TTL.
12. Inactive `ProviderAccountHouse` associations are skipped by scheduled and
    manual paths.
13. The setup script is dry-run by default and produces the intended final
    provider association state when applied.
