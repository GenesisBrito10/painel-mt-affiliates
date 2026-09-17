# Sportingbet Analytics Sync Design

**Date:** 2026-07-29

## Goal

Replace the OTG Sportingbet metrics source with the
`/agency/sportingbet-analytics` endpoint for both `sportingbet` (monthly) and
`sportingbet-diario`, preserving the current commission rules while populating
click, deposit, and betting-volume metrics.

## Scope

- Change only the shared `OtgExtractor` and its tests.
- Keep the existing login endpoint, token handling, current-day date scope,
  provider account configuration, sync orchestration, and persistence model.
- Do not change the link pools, deals, database schema, dashboard contracts, or
  frontend.

Both Sportingbet houses already use the `otg` provider, so changing the shared
extractor updates both crons without duplicating provider implementations.

## Request Contract

For each requested date, call:

`GET /agency/sportingbet-analytics`

with these query parameters:

- `initialDate=<YYYY-MM-DD>`
- `finalDate=<YYYY-MM-DD>`
- `scope=CAMPAIGNS`
- `sortBy=affiliate`
- `sortDirection=asc`
- `page=<current page>`
- `pageSize=10000`

The extractor interface still receives `bookmarkerId`, but this endpoint does
not use it. The parameter remains in the interface for compatibility with the
shared sync orchestration.

The response rows are read from `data.rows`. Pagination is driven by
`data.meta.totalPages`; even with a page size of 10,000, all reported pages must
be fetched.

## Field Mapping

Each valid row requires a non-empty `affiliate` and `campaign`. Affiliate
whitespace is removed and the stored campaign identity remains:

`<NormalizedAffiliate>::<TrimmedCampaign>`

| Analytics field | Stored metric |
| --- | --- |
| `clicks` | `clicks` |
| `registrations` | `registrations` |
| `ftd` | `ftds` |
| `cpa_qual` | `qftd` and `cpaQualified` |
| `deposits` | `deposit` |
| `bet_amount` | `volume` |
| `ngr` | ignored; `netPl` remains `null` |

`withdrawalTotal` remains `null` and `revShare` remains `0`. Raw `cpaValue` and
`totalCommission` are set to `0`; for linked campaigns, the existing sync
orchestrator continues calculating both values from the affiliate link's
contracted CPA and RevShare rates. Sportingbet RevShare is configured as zero.

Non-finite or non-numeric metric values map to zero, matching the existing
extractor behavior.

## Validation and Failure Behavior

- HTTP errors fail the complete report with the date, page, and status.
- Invalid JSON fails the complete report.
- `data.rows` must be an array.
- `data.meta.totalPages` must be a non-negative integer.
- Page 1 may return an empty row array with `totalPages=0`, producing an empty
  report.
- A malformed or failed later page rejects the complete fetch; partial data is
  never returned to persistence.

## Testing

Update the OTG extractor tests to prove:

1. Login behavior is unchanged.
2. The analytics endpoint receives the expected query parameters, including
   `pageSize=10000`.
3. All pages reported by metadata are fetched.
4. Typed Sportingbet campaign identity remains unchanged.
5. Clicks, registrations, FTD, qualified CPA, deposits, and betting volume map
   to the existing domain fields.
6. NGR is ignored, Net P&L stays null, and RevShare stays zero.
7. Invalid values become zero.
8. Later-page failure rejects the whole report.
9. A valid empty report returns an empty array.

## Security

No access token or provider credentials are added to source code, tests,
fixtures, logs, or documentation.
