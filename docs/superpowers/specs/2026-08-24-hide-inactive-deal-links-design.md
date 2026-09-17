# Hide Inactive Deal Links Design

## Objective

Keep link-request history available to administrators while hiding links from inactive deals in the affiliate-facing "Meus Links" tab.

## Approved Rules

- The rule applies only to `GET /v1/link-requests?mine=true`.
- A request linked to a deal is returned only when `deal.active=true`.
- A legacy or standalone request with `dealId=null` remains visible.
- The filter applies to every request status because an inactive deal must not appear in the affiliate tab.
- Administrative listings and the inviter-facing "Deal Requests" tab retain the full history.
- No rows are deleted or updated.

## Architecture

`frontend/app/pages/links.vue` already loads "Meus Links" with `mine=true`, and every deal-backed `LinkRequest` already has a `dealId`. The backend will therefore add a Prisma relation filter in `LinkRequestService.buildListWhere()` for this query only. No frontend or schema change is required.

## Test Coverage

- `mine=true` adds the requesting user and active-deal-or-no-deal predicate.
- An administrative list without `mine=true` does not add the active-deal predicate.

