# Notes filters — 2026-10-29

Scope: owner screenshots for the Notes filter drawer. Replaces account/tag facets
with exactly Note type → Date range → Days → Month → Year, without Basic/Tags tabs.

## Behavior and data

- Reuses `FilterDrawer` (optional tabs; other consumers retain their default),
  `FxSelect` multiselect and `DateFilter`/`ProjectDateInput`. Inline date mode uses
  a full-width range field and a flat calendar inside the scrolling drawer.
- Filters use the note's `updated_at_utc` converted to the selected timezone,
  consistent with list dates and grouping. No chart cursor/time-source selector.
  Inclusive date bounds; OR within each multiselect, AND across categories/search.
- Years come from actual note timestamps plus the current civil year, including
  an empty journal. Days/months are localized calendar choices, not fake data.
- Four type options match the reference. The current API schema stores General
  notes only; missing `note_type` is General. No review records are fabricated.
- Apply commits draft; Clear All changes draft only; cancel discards it. Escape
  closes the nested picker/menu before the drawer and restores trigger focus.

## Verification

Evidence root: `E:/BACKUP-TRADINGWORKSPACE/notes-filters-20261029`.

| Check | Result |
| --- | --- |
| `node --test tests/liveNoteModel.test.mjs` | 6/6 PASS; type, inclusive bounds, unknown dates, timezone/day/year boundaries, search/grouping |
| Vite production build | PASS; existing >500 kB chunk warning |
| `liveNoteFilters.browser.mjs` | 5 cases PASS; three viewport/theme/language combinations, empty-year fallback, all options, combined filtering, range selection, invalid range, Escape, resize, shared trade drawer tabs |
| `liveNotesLayout.browser.mjs` | 10 cases PASS; empty/populated/search/reset/error/retry, responsive layout |
| `liveNoteFolders.browser.mjs` | PASS at 1920 dark / 1440 light / 390 dark; synthetic folder/grouping regression before final inline-field styling |
| `liveNotesRuntime.browser.mjs` on port 5180 | PASS; real local services, GET-only, empty Notes and controls, no errors or attempted writes |
| Independent review | PASS source/model and rendered desktop/mobile dark/light; no blockers |
| Diff whitespace review | PASS |

Screenshots inspected: `filters/calendar-1920-dark.png`,
`filters/calendar-390-dark.png`, `filters/types-1440-light.png`.
The first visual pass exposed a toolbar style overriding the inline date field;
the scoped selector was corrected and computed style assertions now cover it.

## Local UI rollout

Source: `projects/trader/foundation_v2/web`. Active installed UI remains at
`projects/mt5-tradingview-backtester/foundation_v2/web/dist`; no runtime directory
rename, API restart, migration, terminal or broker action was required.

- Initial served index: `e64f23fb4e5d63bb52ae853b1f3990fa937bfbecb9c2da52f2c641b54797d86e`.
- Final served index: `793a469cd2b3fd726d320bf4898edfc9fdda8403c77379cca958921c4beb98e8`.
- Two guarded UI promotions; old hashed assets and private branding retained,
  mutable-asset collisions checked, entry index replaced atomically last.
- Original rollback index: `ui-before-final/index.html` under the evidence root;
  intermediate rollback: `ui-before-field-style/index.html`.
- Real runtime GET smoke rerun after the final promotion. Owned preview stopped.

This receipt accepts the requested Notes filter slice. It does not claim review
creation support, broker correctness or whole-product completion.
