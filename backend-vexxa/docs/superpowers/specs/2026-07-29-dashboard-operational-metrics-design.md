# Dashboard Operational Metrics Design

**Date:** 2026-07-29

## Goal

Expose deposits and betting volume consistently in the affiliate dashboard and
the admin affiliate metrics views for every betting house, including
`sportingbet` and `sportingbet-diario`.

## Architecture

Deposits and betting volume are general performance metrics already stored in
`affiliate_data`. They belong in the shared dashboard summary, daily,
per-campaign, and per-house contracts rather than the Pinbet-specific metrics
endpoint.

The existing `pinbet-metrics` endpoint remains responsible only for metrics
whose completeness and interpretation are Pinbet-specific: Net P&L,
withdrawals, and the associated health state.

## Backend Contract

Add `volume: number` to:

- `AggregatedMetrics`
- `ZERO_METRICS`
- `DailyMetrics`
- `CampaignMetrics`
- the daily-per-house repository result
- the admin link-performance response

All aggregations sum the existing nullable `affiliate_data.volume` column. A
missing aggregate is exposed as zero.

The existing `deposit` field remains unchanged. No database migration is
needed.

## Affiliate Dashboard

The dashboard summary endpoint becomes the source for the general operational
cards:

- **Depósitos:** `summary.deposit`
- **Volume:** `summary.volume`

This makes both values respect the selected date range, betting house, and
scope (`mine`, `network`, or `all`).

The daily metrics table adds a **Volume apostado** column sourced from
`DailyMetrics.volume`.

The following cards remain sourced from `pinbet-metrics`:

- Net P&L
- Saques

When a non-Pinbet house is selected, those Pinbet-only values keep their current
zero/not-applicable behavior. This change does not reinterpret Sportingbet NGR
as Net P&L.

## Admin Affiliate Detail

The overview metrics add a **Volume apostado** card using
`summary.volume`.

The daily-per-house table adds a **Volume apostado** column using
`row.volume`.

The campaigns table adds a **Volume apostado** column. The merged campaign/link
row reads the value from the general campaign aggregation and keeps link
performance fallback behavior consistent with the other metrics.

The admin link-performance aggregation also returns volume so rows remain
complete when a campaign is represented by a link even before the general
campaign result is merged.

## Compatibility

- Existing API fields remain unchanged.
- `volume` is additive and defaults to zero.
- No `.env`, database schema, deal, link-pool, commission, balance, or
  withdrawal-rule changes are required.
- Existing Pinbet Net P&L completeness behavior remains unchanged.
- Sportingbet RevShare remains zero and NGR remains ignored.

## Testing

Backend tests must prove that volume is:

1. Returned in a zero metrics response.
2. Summed in the general summary.
3. Summed per day.
4. Summed per campaign.
5. Summed per day and house.

Frontend contract tests must prove that:

1. Deposit and volume cards use the general summary.
2. The affiliate daily table exposes volume.
3. The admin overview, daily-per-house table, and campaigns table expose
   volume.
4. Pinbet Net P&L and withdrawal cards keep using Pinbet-specific metrics.

Run backend tests, typecheck, build, scoped lint and formatting; then run the
frontend and admin contract tests and builds.
