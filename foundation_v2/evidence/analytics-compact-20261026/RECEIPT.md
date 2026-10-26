# Compact Analytics layout

26 October 2026. UI-only continuation of the accepted Analytics redesign.

## Behavior and ownership

The main PnL plot is 200px high; its complete panel measures 357.59px at 1920x940.
PnL/balance and interval controls share its heading. The complete three-panel R row
fits below it in that reference viewport. Secondary hour/day and side/time-window
views pair; the month matrix stays full width, calendar/frequency use 2:1, MAE and
winning-trade metrics use 2:1, SL/RR pair with Monte Carlo below. Narrow viewports
collapse the groups without reducing readable data text. Panel insets/gaps are 16px.

Native fullscreen expands a panel while retaining its controls and state. Popovers
mount inside the fullscreen ancestor; selecting a trade point exits fullscreen before
opening its inspector. The breakeven editor opens beside its metric, initially focuses
the number input, and closes on one Escape with focus returned to its trigger.

Removed the complete report-level “Phạm vi và nguồn dữ liệu” section. Selected-trade
inspection and export provenance remain available. Report/filter/cutoff ownership and
data formulas are unchanged. The threshold editor updates local classification using
the existing state contract; it does not change monetary PnL or stored trades.

## Verification

Artifacts and runnable QA scripts are retained at
`E:/BACKUP-TRADINGWORKSPACE/analytics-compact-20261026/`:

- Production build passed (`build.log`, scoped source in `source/`).
- 15 focused tests passed: `analyticsPresentation.test.mjs`,
  `analyticsViewModel.test.mjs`, `analytics-story.test.mjs`.
- Tooling doctor passed as a tooling-readiness check only.
- `qa.mjs` / `qa/report.json`: 30 fixture cases, all three tabs, dark/light,
  widths 1920/1366/768/390/320; keyboard, threshold, Monte Carlo, overflow and axe
  checks passed. Errors, console errors and writes are empty.
- `states.mjs` / `states/report.json`: six empty/filter/error/denied/partial/
  experiment-error checks passed.
- `actual.mjs` / `actual/report.json` and `deployed/report.json`: seven read-only
  actual-session checks each, including three tabs, Buy/Sell filters and library
  sort/options regression. No writes or errors.
- Independent review: `reviewer/final-blockers-verified.json` records no overlapping
  R tick labels, R row bottom 934.19px, correct initial focus/Escape behavior,
  fullscreen trade selection and no errors. No remaining review blockers.

These results cover this UI slice, not broker execution or whole-product acceptance.

## Local rollout and recovery

UI5180 serves the built candidate; served index SHA256 verified as
`43c592c2cbd05cf8f6921ae316a575885f0e3051291d6b7fd00e8907f4c5816c`.
`ui-promotion.json` records promotion and retained old assets for existing pages.
Rollback files are in `ui-before-release/`; previous index SHA256 was
`a5911e5d28c1c0c0d2563c6413b5c91d3da50650203f8e046db318ff3ba0474e`.

API8010 was not restarted; `/health/ready` reports database ready and command worker
not required. Existing native/compact runtime and scientific/storage configuration
remain in place. No broker calls, terminal reconnects or owner-data writes occurred.
The owned temporary preview5196 is stopped after identity verification; UI5180 and
API8010 remain running. Final runtime/hash check is in `deployed-hashes.json`.
