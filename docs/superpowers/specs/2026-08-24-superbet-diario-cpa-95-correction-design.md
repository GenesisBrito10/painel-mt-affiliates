# Superbet Diário CPA 95 Correction Design

## Objective

Correct the CPA of already fulfilled, referred affiliates in the active Superbet Diário deal from the obsolete values 100 or 105 to 95, while preserving unrelated Superbet history and preventing the seed from restoring the old discount configuration.

## Confirmed Production Scope

- Betting house: `superbet`.
- Deal: `3a11aa0d-d9cf-467c-bc1a-1fd62f7a7429` (`Superbet Diário`).
- Deal state at preview: active.
- Target request predicate:
  - `dealId` equals the exact deal ID above;
  - `status=FULFILLED`;
  - request owner has `referredById IS NOT NULL`;
  - `resolvedCpa IN (100, 105)`.
- Preview count: 35 requests for 35 unique users.
- Snapshot distribution: 32 at CPA 100 and 3 at CPA 105.
- Every request maps to exactly one active Superbet `AffiliateLink` through the campaign in `LinkRequest.links`.
- Link distribution before correction: 32 at CPA 100, 2 at CPA 105, and 1 at CPA 120.

The correction must not touch:

- the 6 referred requests already at CPA 95;
- the 7 fulfilled requests without an inviter at CPA 105;
- the inactive legacy Superbet deal;
- legacy or standalone requests without this exact `dealId`;
- other links owned by the same user that are not the campaign stored in the targeted request.

## Current Rule and Seed Drift

The production `HouseLinkRule` is already configured with:

- `defaultCpa=105`;
- `fallbackCpa=105`;
- `inviterCpaThreshold=105`;
- `inviterCpaDiscount=10`.

The Prisma seed still contains `defaultCpa=100`, `fallbackCpa=100`, and `inviterCpaDiscount=5` for Superbet. The seed must be aligned with production so a future seed cannot restore the obsolete rule. The resolver itself is already deal-scoped and does not require a new algorithm.

## Financial Impact

At preview time, the 35 mapped campaigns had:

- zero `AffiliateData` rows;
- zero qualified CPAs;
- zero CPA value, deposits, and FTDs;
- no open Superbet withdrawal in `PENDING`, `APPROVED`, or `PROCESSING` for the 35 users.

There were historical `COMPLETED` and `FAILED` withdrawals for some users, but none derives from these new campaigns because the campaigns have no metrics. Historical withdrawal rows must remain unchanged.

Before applying, the script must repeat the metric and open-withdrawal preview. If an open withdrawal exists, application aborts. Any non-zero metrics must be reported with the direct CPA delta before the transaction; they do not broaden the target predicate.

## Implementation

### Seed and regression test

- Update only the Superbet entry in `prisma/seed.ts` to 105/105/105/10.
- Update the Superbet CPA resolver fixture and regression expectation to prove that an inviter snapshot of 105 produces CPA 95 with discount 10.
- Preserve the existing configurations for Betnacional, Hiperbet, Esportiva, and every other house.

### Operational script

Add a one-off script that is dry-run by default and applies only with `APPLY=1`.

The script must:

1. Load the exact active deal and current Superbet rule.
2. Select the exact request predicate and require 35 requests and 35 unique users.
3. Parse each request URL into its campaign ID and require a one-to-one active link owned by the same user.
4. Preview request/link distributions, campaign metrics, and open withdrawals.
5. Abort before writes on any count mismatch, mapping ambiguity, inactive deal, wrong live rule, or open withdrawal.
6. Start a serializable transaction and repeat/lock the target request and link rows.
7. Update the 35 `LinkRequest.resolvedCpa` values to 95.
8. Update only the 35 mapped `AffiliateLink.cpa` values to 95.
9. Insert one `CommissionLog` CPA entry per changed link with the actual old value, new value 95, and source `SCRIPT`.
10. Insert one batch `AuditLog` containing the deal, exact target counts, before distributions, request IDs, link IDs, metric impact, and operation identifier.

`inviterCpa`, `resolvedRuleApplied`, assignment logs, links, statuses, fulfillment timestamps, and historical financial rows remain unchanged. The batch audit explains the corrective override without rewriting historical calculation metadata.

## Verification

After application, use an independent new database connection to verify:

- zero target requests remain at CPA 100 or 105;
- the 35 approved target requests are at CPA 95;
- their 35 mapped links are at CPA 95;
- all previously correct referred requests remain at CPA 95;
- all no-inviter requests remain at CPA 105, matching the pre-transaction baseline;
- the inactive legacy deal is unchanged;
- exactly 35 new CPA `CommissionLog` rows exist for the operation window/source;
- the batch `AuditLog` exists with the expected operation identifier;
- open-withdrawal counts and campaign metrics match the pre-transaction impact report.

Code verification includes the focused resolver test, full backend test suite, lint comparison against the baseline for touched legacy files, build, and `git diff --check`.
