# MT Affiliates Default Theme Design

## Objective

Make the default visual theme of the affiliate frontend and administrative
panel match the approved MT Affiliates logo: black and graphite surfaces,
vivid green brand actions, and white or silver text.

## Approved Direction

- Use a dark-first theme in both applications.
- Use `#39FF14` as the primary MT Affiliates green.
- Use near-black and graphite surfaces instead of pure black for readable
  depth between the page, sidebar, cards, and elevated controls.
- Use white for headings and high-emphasis text, with cool light gray for
  secondary text.
- Remove gold and purple as default brand colors and decorative glows.
- Keep red for destructive/error states and amber for warning/pending states
  so semantic feedback remains immediately recognizable.

## Palette

| Role | Default |
| --- | --- |
| Brand / primary action | `#39FF14` |
| Brand hover | `#2ED10F` |
| Page background | `#080A08` |
| Main surface | `#101410` |
| Elevated surface | `#171D17` |
| Border | `#273027` |
| Primary text | `#FFFFFF` |
| Secondary text | `#B8C2B8` |
| Muted text | `#788378` |

The complete green scale used by Nuxt UI will be derived around the approved
primary and hover colors so solid, soft, outline, and focus states remain
consistent.

## Frontend Changes

- Replace the existing gold and violet brand defaults in the CSS tokens with
  the approved green, black, graphite, white, and gray palette.
- Configure Nuxt UI `primary` to use the MT green scale and keep neutral
  components on the zinc/graphite scale.
- Change brand-only gradients, active navigation states, focus rings, and
  authentication-page glows to green variants.
- Update the theme settings page defaults so the `Padrão` action restores the
  MT palette, including the dark sidebar and white active text.
- Preserve the existing runtime theme contract: a palette explicitly saved by
  an administrator continues to override CSS defaults when loaded from the
  API. This change does not mutate production theme data.

## Admin Changes

- Replace the default gold and violet design tokens with MT green tokens while
  retaining compatibility aliases for existing component classes.
- Configure Nuxt UI `primary` and informational brand accents to use the MT
  green scale.
- Apply the same black/graphite surface hierarchy and white/gray typography as
  the frontend.
- Keep status-specific error and warning colors unchanged.

## Scope Boundaries

- No layout, navigation, typography, or component behavior changes.
- No database writes, API changes, deployment, or production theme reset.
- House/operator logos and their own colors remain unchanged.
- Domain-specific charts or badges that encode categories may retain distinct
  colors when changing them to green would erase meaning.

## Verification

- Build both Nuxt applications in production mode.
- Confirm both `AppLogo` assets remain present in the generated output.
- Search the frontend and admin theme sources for legacy gold/purple defaults
  and classify any intentional semantic or category-specific matches.
- Verify contrast for primary buttons, normal text, muted text, borders, and
  focus states on the new dark surfaces.
- Run `git diff --check` and review the final focused diff.
