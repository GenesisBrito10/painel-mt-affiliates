# Hide Inactive Agreements Design

## Objective

Prevent the affiliate-facing **Meus Acordos** card from showing a house when the affiliate's only approved agreement for that house belongs to an inactive deal.

## Rules

- The rule applies to `GET /v1/memberships/mine`, the data source used by **Meus Acordos**.
- A house remains visible when the affiliate has a fulfilled request for an active deal in that house.
- A fulfilled standalone or legacy request with `dealId=null` keeps the house visible.
- A link with no fulfilled request history remains visible because it cannot be classified as an inactive deal agreement.
- A house is hidden only when it has fulfilled deal-backed history and every such fulfilled deal is inactive.
- Pending access to a new active deal does not reactivate an old inactive agreement; the affiliate must first be fulfilled in the new deal.
- When one house has links from multiple deals, only the campaigns parsed from fulfilled active/standalone request URLs remain visible. A non-parseable manual request falls back to the house-level rule so legacy integrations are not hidden accidentally.
- The detailed admin affiliate profile applies the same visibility rule to its **Links de afiliado** block.
- Administrative link-request history, database rows, and commissions remain unchanged.

## Architecture

Add a small pure membership-visibility helper in the user application module. `UserController.getMemberships()` and `UserService.getAdminAffiliateProfile()` load the relevant affiliate links and fulfilled link requests, classify visibility first per house and then by the request campaign (`siteid-c`), and map only visible links into their existing response shapes. The frontend and admin apps need no duplicated deal logic because they already render exactly the links returned by these endpoints.

Superbet pool assignment persists the assigned spreadsheet URL in `AffiliateLink.userLink` on both update and create. The one-time repair script derives each current URL from the fulfilled request of the active Superbet Diário deal, updates only mismatched matching campaigns, writes one batch audit, and independently verifies that no mismatch remains.

## Verification

Unit tests cover inactive-only, active, standalone, unknown-history, pending-exclusion, same-house campaign exclusion, Superbet URL persistence, and admin-profile integration behavior. Run the focused tests red/green, then the complete backend, frontend, and admin test/build commands available in each package.
