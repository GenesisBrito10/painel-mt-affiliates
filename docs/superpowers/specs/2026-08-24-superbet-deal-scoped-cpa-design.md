# Superbet Deal-Scoped CPA Design

## Objective

Prevent a Superbet request in a new deal from reading the inviter's CPA from an older Superbet deal.

## Rules

- The behavior is scoped to Superbet requests that have a `dealId`.
- A requester without an inviter receives the current Superbet house-rule default CPA.
- A requester with an inviter remains `PENDING` with `resolvedCpa=null` until the inviter has a `FULFILLED` request with non-null `resolvedCpa` in the same deal.
- Once the inviter is fulfilled in that deal, the inviter's deal snapshot is used by `INVITER_DISCOUNT`. With inviter CPA 105 and discount 5, the requester receives CPA 100.
- Legacy requests without `dealId`, and other betting houses, retain the existing house-scoped behavior.
- Explicit administrative/manual fulfillment remains valid and counts as the inviter having entered the deal.

## Data Flow

1. `LinkRequestService` passes the selected `dealId` to `CpaResolutionService`.
2. For Superbet with an inviter and a `dealId`, `CpaResolutionService` reads the latest fulfilled inviter request from the same deal instead of reading the inviter's latest house-wide `AffiliateLink` CPA.
3. If no matching inviter request exists, resolution returns `hold=true` and the new request is stored without a CPA snapshot.
4. `LinkBackfillService.autoSnapshotOldRequests()` retains the request `dealId` and retries the same deal-scoped resolution every minute.
5. After the inviter is fulfilled, the waiting request receives its CPA snapshot and becomes eligible for the Superbet scheduler.
6. When the scheduler assigns the link, the request snapshot overwrites the active `AffiliateLink` commission so the operational link and request agree.

## Error and Compatibility Behavior

- A fulfilled inviter request with null `resolvedCpa` does not unlock descendants.
- Requests from different Superbet deals never satisfy the same-deal lookup.
- Existing non-Superbet CPA resolution remains unchanged.
- Existing Superbet requests without `dealId` continue to use active real affiliate-link CPA.

## Tests

- Resolver holds when only an old house-wide Superbet CPA exists.
- Resolver calculates 100 from inviter CPA 105 in the same fulfilled deal.
- Resolver ignores a fulfilled inviter request from another deal.
- New request creation forwards `dealId` into CPA resolution.
- Auto-snapshot forwards `dealId` and does not preserve an old Superbet affiliate CPA for a deal-scoped request.
- Superbet assignment overwrites an existing old commission with the request snapshot.

