# MT Affiliates Logo Replacement Completion

**Date:** 2026-09-17
**Status:** Implemented locally

## Delivered

- Added a transparent horizontal `MT AFFILIATES` lockup to the frontend and
  admin public assets.
- Added a transparent square `MT` monogram for compact logo states.
- Updated both shared `AppLogo` components to use the new assets in login,
  sidebar, mobile header, and admin contexts.
- Updated the image alternative text and intrinsic dimensions for the new
  brand assets.
- Replaced the frontend and admin default brand palette with MT green
  (`#39FF14`), black/graphite surfaces, and white/gray typography.
- Added an `mtgreen` Nuxt UI scale and made dark mode the frontend default.
- Updated the admin theme-reset values to restore the MT Affiliates palette.
- Kept red and amber reserved for error and warning states.
- Kept the legacy Vallex assets in place because other browser-icon and
  manifest references were outside this logo-only change.

## Verification

- Frontend production build: passed.
- Admin production build: passed.
- MT theme contract: 1 file, 2 tests passed after the expected RED state.
- Asset checksums match between frontend and admin.
- `git diff --check`: passed.

## Notes

- The horizontal logo was extracted from the supplied artwork with a
  transparent background.
- The compact mark was derived from the same supplied artwork.
- Existing palettes explicitly saved through the theme API still override the
  frontend CSS defaults; no database theme record was changed.
- No deployment was performed.
