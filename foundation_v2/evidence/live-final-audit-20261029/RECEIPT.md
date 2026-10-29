# Live follow-up audit — 2026-10-29

Scope: seven Live sections, both account tabs, their read-only UI interactions,
and the reported data/empty-chart regressions. No broker commands, API restart,
terminal reconnect or financial-data edits.

## Findings and changes

- The full Analytics report still counted 28 fills as 28 trades, while Calendar
  and Trades correctly showed 14 completed lifecycles. Reuse `completedLiveTrades`
  for full Analytics and label outcomes, before filtering/aggregation. Retain
  actual opening direction, timestamps, weighted prices, fees and known original
  stop-distance R in the shared report adapter. Same real snapshot now shows
  14 trades, 14.29% wins, zero breakevens and $0.07 expectancy; net stays $1.01.
- Empty or unknown-fee overview history crashed the shared line chart while
  selecting labels for an out-of-range first point. Require candidate indices
  to exist. Render the existing empty state, with no manufactured curve.
- Update the project display contract: completed-trade outcomes are distinct
  from the overview's explicitly labeled execution/fill history.
- Owner clarified that the previous FX $20,001.01 included an additional manual
  account, now removed. This closes that comparison issue without changing MT5.

## Verification

- Scoped production build: tracked HEAD plus task overlays on E; unrelated dirty
  sources excluded. Build passed. Previous hashed assets retained; entry index
  promoted atomically, with rollback saved privately.
- 45 focused Node tests passed: lifecycle reconstruction, calendar aggregation,
  account identity/capital, coverage, ledger filters and separator ownership.
- Production-preview browser checks passed: reconciliation/full Analytics (5),
  Analytics filters and account detail layout (13), Notes (7), overview controls
  and stale/error/disconnected states (5), calendar seams/hover (7), full ledger
  filter panels (4), Live overview ready/empty/unknown-fee charts (6).
- Actual localhost: 16 route/viewport cases, each followed by reload; no page
  errors, broken assets, document overflow or overlapping chart-axis labels.
  Full Analytics count verified at 14. Two further actual chart journeys opened
  the MT5 chart at 1920 dark and 390 light. All used GET-only guards; no writes.
- Reviewed desktop Analytics, loaded overview, mobile transactions, chart empty
  states and the mobile MT5 chart screenshots.
- An additional broad `reportPresentation.browser.mjs` run stopped on the Testing
  Dashboard tooltip assertion expecting `2021–2025`. This run is FAIL, not counted
  above. Its tooltip timeout is outside the Live audit; dedicated Live chart tests
  cover populated, empty and unknown-fee rendering plus label spacing.

## Runtime evidence

Private reports, screenshots, failed attempts and rollback:
`E:/BACKUP-TRADINGWORKSPACE/live-final-audit-20261029/`.
`actual-final/report.json` and `actual-chart/report.json` are the authoritative
post-promotion reports. An earlier promotion attempt stopped on local JSON text
decoding before mutation; its accompanying `actual-after` run still used the old
build and is not post-promotion acceptance.

Final served index SHA256:
`d73228f78c1ab357729e21c18add199c8e2fc9b3f96f3cd37fbff6331f95f850`.

This verifies the audited UI journeys, not order execution, every application
workflow or long-duration stability. Existing broker tag assignment remains
unimplemented; this audit does not introduce a persistence contract for it.
