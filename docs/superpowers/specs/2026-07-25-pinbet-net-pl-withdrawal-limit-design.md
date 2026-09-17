# Pinbet Net P&L Withdrawal Limit Design

**Date:** 2026-07-25
**Status:** Approved in conversation; awaiting review of this written specification

## Objective

Persist the Pinbet operational metrics returned by Smartico and use cumulative
Net P&L to limit withdrawals independently for `pinbet-diario` and
`pinbet-mensal`.

The system must preserve the distinction between:

- the affiliate's current house balance;
- the accumulated Net P&L for that Pinbet operation;
- the gross amount currently available to request;
- the net amount received after the existing withdrawal fee.

Example:

| Value | Amount |
| --- | ---: |
| Current Pinbet balance | R$ 1,000.00 |
| Accumulated Net P&L | R$ 100.00 |
| Gross withdrawal limit | R$ 80.00 |
| Net received after the current 6% fee | R$ 75.20 |

## Scope

This feature covers:

1. Smartico extraction of `net_pl`, `deposit_total`, `withdrawal_total`, and
   `volume`.
2. Daily, campaign-scoped, house-scoped persistence of those metrics.
3. User and network aggregation for Pinbet Diário and Pinbet Mensal.
4. A cumulative withdrawal cap equal to 80% of positive Net P&L.
5. Consumption of that cumulative cap by prior withdrawals.
6. Dashboard cards for the four Pinbet metrics.
7. An explicit explanation of the withdrawal amount in the payments flow.
8. A post-deployment refresh of all currently stored Pinbet dates.

This feature does not change commission generation, CPA rates, RevShare rates,
withdrawal cadence, minimum withdrawal settings, or the existing 6% fee.

## Existing Architecture

Smartico is already integrated through
`SmarticoExtractor`. It requests one day at a time:

- `group_by=afp1` for `pinbet-diario`;
- `group_by=afp2` for `pinbet-mensal`.

The sync orchestrator maps the extracted report to `affiliate_data`. Each row is
already isolated by campaign, betting house, date, campaign name, and provider
account name. Pinbet Diário and Pinbet Mensal are therefore separate data
buckets and must not use a shared source-house alias.

The regular sync re-fetches the current month, so existing current-month rows
are updated idempotently. The production data inspected during design starts on
2026-07-22 for both Pinbet houses.

`DashboardBalanceService` is the source of truth for both displayed balances
and withdrawal creation. The new cap must be calculated there and consumed by
all withdrawal entry points. The frontend must not reimplement the formula.

## Data Model

### AffiliateData

Add these nullable `Decimal(14,2)` fields:

```prisma
netPl           Decimal? @db.Decimal(14, 2)
withdrawalTotal Decimal? @db.Decimal(14, 2)
volume          Decimal? @db.Decimal(14, 2)
```

`deposit_total` is already persisted in the existing `deposit Decimal(14,2)`
field. A second deposit column would duplicate the same source value and is not
needed.

The new fields remain `null` for providers that do not return them. A non-null
value combined with `bettingHouse` equal to `pinbet-diario` or
`pinbet-mensal` identifies Pinbet operational data without adding a redundant
provider marker.

Using nullable fields distinguishes:

- a real Pinbet metric whose value is zero;
- a Pinbet row that has not yet been refreshed after migration;
- a non-Pinbet row where the metric does not apply.

### AffiliateDataChangeLog

Extend the append-only change snapshot with nullable previous/new values for
`netPl`, `withdrawalTotal`, and `volume`. Changes to any of the three values are
material and create a history entry. This is required because Net P&L affects
withdrawal eligibility and the other values are user-visible financial
metrics.

## Extraction and Monetary Normalization

Extend `SmarticoRow` with:

```ts
net_pl?: number
withdrawal_total?: number
volume?: number
```

`deposit_total` remains mapped to `deposit`.

Extend the provider report and sync persistence contracts with optional Pinbet
metrics. Other extractors do not need to synthesize values for unsupported
fields.

Every supplied monetary value is normalized to two decimal places before
persistence. For example:

```text
-68.25999727100134 -> -68.26
```

PostgreSQL `Decimal(14,2)` is the final precision constraint. Missing,
non-finite, or malformed optional metrics are persisted as `null`, and the
extractor emits a warning containing the house dimension, campaign, date, and
field name without exposing credentials.

The sync repository updates all four Pinbet metrics idempotently under the
existing `affiliate_data` composite key.

## Aggregation Rules

### Metric cards

The user-facing Pinbet metrics endpoint aggregates:

- `netPl`: sum of `netPl`;
- `depositTotal`: sum of the existing `deposit`;
- `withdrawalTotal`: sum of `withdrawalTotal`;
- `volume`: sum of `volume`.

It respects the dashboard's selected date range and scope:

- `mine`: the user's own linked campaigns;
- `network`: campaigns in the user's eligible network;
- `all`: own plus network.

When the dashboard house filter is:

- `all`: return separate rows for Pinbet Diário and Pinbet Mensal;
- `pinbet-diario`: return Pinbet Diário only;
- `pinbet-mensal`: return Pinbet Mensal only;
- any other house: return no Pinbet metric rows.

### Withdrawal limit

Withdrawal eligibility does not use the dashboard date filter. It uses the same
effective balance cutover applied to the house ledger.

For each Pinbet house:

```text
accumulatedNetPl =
  sum(own campaign Net P&L since effective house cutover)
  + sum(network campaign Net P&L since effective house cutover)

totalNetPlLimit =
  floorToCents(max(0, accumulatedNetPl) * 0.80)

consumedNetPlLimit =
  sum(effective gross withdrawal cost for this house since its cutover)

remainingNetPlLimit =
  max(0, totalNetPlLimit - consumedNetPlLimit)

withdrawable =
  min(max(0, currentHouseBalance), remainingNetPlLimit)
```

`floorToCents` ensures the allowed amount never exceeds exactly 80% because of
cent rounding.

If cumulative Net P&L is zero or negative, `totalNetPlLimit` and `withdrawable`
are zero.

The confirmed scope is own plus network because the current house balance also
contains the user's eligible network earnings.

### Withdrawal consumption

These statuses consume the cumulative limit:

- `PENDING`
- `APPROVED`
- `PROCESSING`
- `COMPLETED`

These statuses do not consume it:

- `REJECTED`
- `FAILED`

The effective consumed amount follows the existing ledger convention:

```text
max(0, originalAmount - gatewayRefundedAmount)
```

This restores the refunded portion of the cap while preserving any portion
that was not refunded.

## Balance Contract

Keep `PerHouseBalance.total` as the current financial balance after fraud,
adjustments, withdrawals, and refunds. Add:

```ts
netPl: number | null
withdrawalLimit: number | null
withdrawnFromLimit: number
withdrawable: number
withdrawalRestriction:
  | 'PINBET_METRICS_PENDING'
  | 'PINBET_NET_PL_NON_POSITIVE'
  | 'PINBET_NET_PL_LIMIT'
  | null
```

For non-Pinbet houses:

- `netPl` and `withdrawalLimit` are `null`;
- `withdrawable` remains `max(0, total)`;
- `withdrawalRestriction` remains `null`.

For Pinbet houses, `withdrawable` is the cap-limited result.

Global `withdrawableTotal` becomes the sum of each house's `withdrawable` plus
the available bonus balance. `withdrawableNet` continues applying the configured
withdrawal fee to that gross total.

The dashboard's “Saldo disponível” remains the financial balance. “Disponível
para saque” uses `withdrawable`. The two values must not be labeled as if they
were the same.

## Withdrawal Rules Contract

Extend each `/v1/withdrawals/rules` item with enough backend-calculated data to
explain a Pinbet restriction:

```ts
balance: number
availableBalance: number
netPl: number | null
netPlLimit: number | null
withdrawnFromNetPlLimit: number
withdrawalRestriction:
  | 'PINBET_METRICS_PENDING'
  | 'PINBET_NET_PL_NON_POSITIVE'
  | 'PINBET_NET_PL_LIMIT'
  | null
```

`availableBalance` remains the amount that withdrawal creation will actually
use. Existing fields for cadence, minimum amount, CPA count, and enabled state
remain unchanged.

All withdrawal creation paths must read `PerHouseBalance.withdrawable`, not
`PerHouseBalance.total`. The calculation runs inside the existing transaction
and advisory lock so two concurrent requests cannot spend the same Net P&L
allowance.

## Pinbet Metrics API

Add:

```http
GET /v1/dashboard/pinbet-metrics
```

It accepts the existing dashboard query fields:

- `startDate`
- `endDate`
- `bettingHouse`
- `scope`

Response:

```ts
interface PinbetMetricsResponse {
  houses: Array<{
    house: 'pinbet-diario' | 'pinbet-mensal'
    name: 'Pinbet Diário' | 'Pinbet Mensal'
    netPl: number | null
    depositTotal: number
    withdrawalTotal: number | null
    volume: number | null
    health: 'POSITIVE' | 'NON_POSITIVE' | 'NO_DATA'
  }>
}
```

Access control and campaign visibility reuse `DashboardAccessService`. The
endpoint must never aggregate campaigns outside the caller's permitted own or
network scope.

## User Interface

### Dashboard cards

Add a “Saúde da operação Pinbet” section.

When “Todas as casas” is selected, show separate Pinbet Diário and Pinbet
Mensal groups. Each group contains:

- Net P&L
- Depósitos
- Saques
- Volume

When a single Pinbet is selected, show only that house. Hide the section for a
non-Pinbet house.

The final cards use only user-facing labels. They must not display raw JSON or
database names such as `deposit_total`, `withdrawal_total`, or `net_pl`.

Positive Net P&L uses a positive state. Zero or negative Net P&L uses a warning
or negative state. Missing data uses a neutral loading/unavailable state and
must not be presented as a real zero.

### Payments explanation

For a Pinbet withdrawal rule, display:

- current house balance;
- cumulative Net P&L;
- 80% total Net P&L limit;
- limit already consumed by earlier withdrawals;
- gross amount available to request;
- net amount after the configured fee.

Positive example:

> Seu saldo é R$ 1.000,00, mas na Pinbet o saque é limitado a 80% do Net P&L
> positivo acumulado. Por isso, seu limite atual é R$ 80,00.

Non-positive example:

> O Net P&L da Pinbet está em -R$ 68,26. Enquanto o acumulado não ficar
> positivo, não há saldo liberado para saque nesta casa.

Pending-metrics example:

> As métricas operacionais da Pinbet ainda estão sendo sincronizadas. O saque
> ficará disponível após a atualização.

The existing fee remains separate:

> Valor líquido após taxa de 6%: R$ 75,20.

## Safe Migration and Backfill

1. Apply the nullable-column migration before deploying code that writes or
   reads the new fields.
2. Deploy extraction, persistence, calculation, API, and frontend changes.
3. Until a Pinbet row has non-null Net P&L, block that Pinbet withdrawal with
   `PINBET_METRICS_PENDING`. This is safer than treating missing data as zero.
4. Trigger a full current-month sync for `pinbet-diario`.
5. Trigger a full current-month sync for `pinbet-mensal`.
6. Verify, per house:
   - row count and date coverage are unchanged;
   - every current Pinbet row has the new metrics populated when returned by
     Smartico;
   - a representative stored value matches the provider response rounded to
     two decimals;
   - Diário and Mensal campaign sets remain isolated;
   - the dashboard endpoint totals match independent SQL sums;
   - the balance endpoint and withdrawal rules expose the same withdrawable
     value.

No destructive rewrite of existing commission, balance, or withdrawal data is
required.

## Error Handling

- Missing Pinbet metrics do not silently unlock funds.
- A provider field that is malformed does not fail the entire daily sync row;
  it becomes `null`, produces an attributable warning, and yields
  `PINBET_METRICS_PENDING` for the affected withdrawal calculation.
- A negative Net P&L is valid data, not a sync error.
- The calculation clamps all available amounts to zero and never creates a
  negative withdrawal.
- Decimal calculations use explicit cent normalization; no binary floating
  value is persisted directly without normalization.
- Existing non-Pinbet calculations and DTO behavior remain unchanged.

## Testing Strategy

### Extractor

- maps all four Smartico fields;
- rounds `-68.25999727100134` to `-68.26`;
- preserves legitimate zero;
- treats missing/malformed optional values as `null`;
- keeps `afp1` and `afp2` campaign isolation.

### Sync persistence

- inserts and updates the new fields idempotently;
- does not populate them for unsupported providers;
- writes change-history snapshots when they change;
- continues using `deposit` for `deposit_total`.

### Balance and withdrawal

- positive Net P&L allows 80%;
- zero and negative Net P&L allow zero;
- missing Net P&L blocks with `PINBET_METRICS_PENDING`;
- own and network Net P&L are both included;
- Diário and Mensal are calculated independently;
- a balance below the Net P&L cap limits the request to the balance;
- prior active/completed withdrawals reduce the remaining cap;
- rejected and failed withdrawals do not reduce it;
- refunds restore only their effective amount;
- concurrent withdrawal creation cannot exceed the remaining allowance;
- non-Pinbet houses retain their current behavior.

### API and frontend

- metrics endpoint respects date, house, access, and scope;
- “Todas as casas” returns separate Diário and Mensal groups;
- raw provider field names are absent from rendered cards;
- positive, non-positive, and missing-data states render correctly;
- payment explanation uses backend values;
- gross available and net-after-fee values remain distinct;
- displayed availability matches the amount created by the withdrawal service.

## Acceptance Criteria

The feature is accepted when:

1. The four Smartico metrics are stored daily and isolated by Pinbet house.
2. The sample Net P&L is stored as `-68.26`.
3. A user with R$ 1,000.00 balance, R$ 100.00 cumulative Net P&L, and no prior
   Pinbet withdrawals can request at most R$ 80.00 gross.
4. The same user sees R$ 75.20 as the net amount under the current 6% fee.
5. A zero or negative cumulative Net P&L produces zero withdrawable amount.
6. An R$ 80.00 prior withdrawal fully consumes the example allowance until Net
   P&L increases.
7. Dashboard cards expose the four metrics without technical source-field
   names.
8. Pinbet Diário and Pinbet Mensal remain separate in storage, calculation, and
   UI.
9. Non-Pinbet withdrawal behavior does not change.
