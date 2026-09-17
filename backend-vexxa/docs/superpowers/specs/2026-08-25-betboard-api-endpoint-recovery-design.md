# Betboard API Endpoint Recovery Design

## Context

The Superbet provider account `mjm@afiliadosexternos.com` is active and linked
to an active `AUTO` house, but its last successful use and Superbet sync log are
from 2026-07-01. The configured and hardcoded API host
`api.betboard.com.br` no longer resolves. The provider's current frontend uses
`https://api-affiliates.mgaffiliates.site/api`; live read-only validation against
that endpoint authenticated successfully and returned reports for 2026-08-23
and 2026-08-24.

## Considered Approaches

1. **Normalize the known legacy endpoint (selected).** Keep the extractor port
   unchanged, map the retired Betboard base URL to the current URL for login,
   and use the same current base for report requests. Update persisted/default
   configuration so new and existing accounts no longer advertise the retired
   host. This is the smallest compatible correction.
2. **Refactor provider sessions.** Change `login()` to return a session object
   containing token and base URL, then pass it through every extractor. This is
   cleaner for arbitrary per-account endpoints but unnecessarily changes all
   provider contracts for one retired domain.
3. **Infrastructure DNS workaround.** Add a local DNS/hosts alias for the old
   hostname. This hides the stale application configuration and is brittle
   across environments.

## Design

- Export a pure Betboard base-URL resolver. Empty and known legacy values map
  to `https://api-affiliates.mgaffiliates.site/api`; unrelated custom URLs are
  preserved after trailing-slash normalization.
- Use the resolver during login and the current resolved base for report calls.
  Betboard syncs are sequential in the orchestrator, so the extractor can retain
  the base selected by the latest successful login.
- Change Prisma/default seed references to the current base URL.
- Apply an exact, audited production configuration update only to the named
  provider account after a dry-run and expected-state check.
- Run the existing sync pipeline for the named account and explicit dates
  2026-08-23 through 2026-08-25 so commission rates, provider-account tagging,
  change logs, and stale-UTM handling remain identical to automatic sync.

## Verification

- A focused unit test must fail before implementation because the legacy URL is
  used, then pass after normalization.
- Focused sync tests, the full test suite, lint, and build must pass.
- Production verification must show successful Superbet sync logs, rows under
  the `Vallex 4` UTM campaign, current `5565-*` campaigns mapped to users, and
  no sync errors for the requested period.
