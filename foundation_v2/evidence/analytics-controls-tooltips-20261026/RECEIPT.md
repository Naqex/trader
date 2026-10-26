# Analytics controls and adaptive tooltips

26 October 2026. Owner requested compact report tabs, applied-filter chips without
trigger count badges, the reference chart toolbar, adaptive readable tooltips and
an investigation of small icons looking soft on a 1080p display.

## Behavior and state ownership

Report tabs now size to their labels on desktop, align left and use the existing
gray active surface. On narrow screens three equal targets retain 44px height.
Analytics multi-select triggers keep their names. Draft choices stay in the
dropdown; Apply commits them, and the existing removable gray chip row represents
the applied values. Filter query/model ownership and Apply semantics are unchanged.

The PnL plot has zoom in/out, selection zoom, horizontal pan and reset. Its local
range slices visible samples while retaining original values, labels and trade
IDs. +/- zoom, arrow keys pan and 0 resets when the SVG has keyboard focus.
Changing interval resets the range. Dragging suppresses point selection; ordinary
point clicks retain the inspector. An unavailable curve has a meaningful empty
state and disabled controls, without inventing zero observations.

`ProjectTooltipLayer` and the tooltip branch of `LegacyPopover` share a geometry
helper: try top, bottom, right, left; if none fits, use the largest available area.
Keep an 8px anchor gap and viewport margin, avoid the anchor and point the arrow
to the correct edge. Short text sizes naturally to 320px maximum. Long text uses
a 240px vertical reading column, 13/20 type, authored paragraphs and internal
scroll when needed. Escape/keyboard/touch semantics remain; internal scroll now
keeps the tooltip open, while page scroll dismisses it. Ordinary menus retain
their existing geometry and focus behavior.

The project design-system contract is updated in `ui/compact-system.md`; the
component reference includes a runnable long-definition example. The same controls
and tooltip layer run in sample Analytics. Shared token pins are unchanged.

## Icons and trade-offs

The old 14px info SVG used a 1.6-unit stroke on a 24-unit grid: about 0.93 CSS px
at DPR1. It now uses 16px with a 2-unit stroke: about 1.33 CSS px, centered in the
same 18px control. `TestingIcon` and filter/chevron strokes are strengthened;
existing navigation geometry is retained. No raster scaling, blanket chart-stroke
change or `crispEdges` is introduced. This improves legibility at the tested
DPR1/1.25; the owner's actual browser zoom, monitor scaling and physical display
were not measured, so the cause of every perceived soft icon is not claimed.

## Verification

Runnable scripts, reports, screenshots and private rollback files:
`E:/BACKUP-TRADINGWORKSPACE/analytics-controls-tooltips-20261026/`.

- Scoped production build passed: tracked HEAD plus explicit task overlays and
  the accepted private CSS baseline; unrelated dirty work excluded.
- 17 focused Node tests passed: placement geometry, presentation, view model and
  read-only analytics contracts.
- `qa.mjs`: five final-build cases passed before and after promotion: 1920 dark
  VI DPR1, 1366 light VI, 390 dark VI, 320 light VI, 1920 light EN DPR1.25.
  Checks cover all five tools, keyboard, drag/click distinction, escaped gestures,
  filters/Apply/chip removal, icon geometry, tooltip paragraphs, overflow and axe.
  No page errors or writes. Deployed result: `deployed/qa-report.json`.
- `tooltips.mjs`: 18 cases passed at 1920x940, 1920x360 and 320x480. All four sides,
  short/long content, bounds, anchor clearance, stable layout and internal scroll
  were exercised with isolated synthetic anchors using the actual app controller.
- `dashboard-tooltip.mjs`: three desktop/mobile light/dark VI/EN checks passed
  using app sample data; monthly values, hover/touch, Escape and bounds retained.
- `unknown-curve.mjs`: no finite balance curve leaves no points, shows the empty
  state and disables all five tools. No overflow, errors or writes.
- `catalog.mjs`: long definition is 240px with three paragraphs; ordinary menu
  opens below its trigger, Escape returns focus and choosing Sell closes it.
  Passed on preview and UI5180; `catalog-deployed/report.json` records rollout.
- `actual.mjs`: seven read-only checks passed on preview and UI5180: existing
  session PnL, three tabs, market-time requests, Buy/Sell filters and library
  sorting/options regression. `deployed-actual/report.json` records the rollout.
- Independent source/rendered review found an escaped-drag gesture bug. After
  fixing pointer/button/capture cleanup, the reviewer verified legitimate pan,
  selection zoom and release-outside regression; no remaining blockers. Evidence:
  `reviewer/review.json` and `reviewer/stale-gesture-final.json`. Root inspected
  final desktop and mobile tooltip screenshots.

Failures are retained: internal tooltip scroll originally dismissed its popup;
the shared handler was fixed and the 18-case test rerun. A Dashboard harness had
an obsolete period-sum oracle; it now checks current period averages for this
tooltip scope. Initial catalog assertions counted four rather than three authored
paragraphs and interacted before page scrolling settled; the harness now waits
for stable anchor geometry before opening. Candidate unknown-curve setup initially
lacked its fixture file; supplying the existing fixture allowed the test to run.
The first deployed QA and actual harnesses shared an output filename; QA output
was preserved and the actual journey rerun into its own directory.

## UI rollout and limits

UI5180 index SHA256:
`d8e5c5438fcb299876c6e6dbf8688b5325ab2e8c81e6db49ac53c9d4b5c97169`.
Previous index:
`eea4b3ba2cc9b944c052fa6c229ea0d30871cbab8346f6fcdd394742891e504d`.
`ui-promotion.json` records collision checks and atomic index replacement;
`ui-before-release/` retains rollback, old assets and private branding are kept.
Final served hash/readiness and owned-preview cleanup: `deployed-hashes.json`.

API8010 remains native/compact; no API restart, terminal reconnect, broker request
or owner-data write. Financial calculations are unchanged. This accepts the
requested controls/tooltip slice, not all vendor tooltips, full reference formula
parity, physical-monitor sharpness, broker execution or whole-product acceptance.
