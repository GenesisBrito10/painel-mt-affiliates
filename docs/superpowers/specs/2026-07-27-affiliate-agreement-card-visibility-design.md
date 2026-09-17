# Affiliate Agreement Card Visibility Design

## Goal

Simplify the affiliate dashboard's **Meus Acordos** card so it displays only
the active-house count, total CPA, each house name, and each house CPA.

## Scope

- Remove the card-level `RevShare Médio` statistic.
- Remove the per-agreement `LINK ID` label and identifier.
- Remove the per-agreement `Rev` value.
- Keep affiliate-link identifiers and revshare data unchanged in composables,
  API responses, and component inputs.
- Keep `affiliateId` available for the Vue list key; only its visual rendering
  is removed.

## Verification

A focused Vitest source regression checks that the component still renders
`Meus Acordos`, `CPA Total`, and per-link CPA while no longer rendering Link ID
or RevShare fields. The complete frontend test suite and production build must
also pass.
