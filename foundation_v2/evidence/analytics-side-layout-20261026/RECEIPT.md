# Analytics chart and risk sidebar

26 October 2026. Direct owner request following the compact Analytics rollout.

## Changes

PnL takes the left two thirds of the desktop report; realized R, ideal R and
profit/breakeven opportunity stack in the right third. Both columns align at their
top and bottom. The main curve measures its available height with the existing
ResizeObserver so its SVG coordinates match its display, including fullscreen and
viewport resizing. The opportunity card displays its count and known/total sample;
the ring repeating the same count was removed to match the supplied reference.

Below 1200px the chart and risk group stack; below 850px the three risk cards also
stack. Shared fonts, metrics, chart domains, filters and monetary calculations retain
their existing ownership. Only layout/measurement changed; no stored trades changed.
Removed the pseudo-element line below the report tabs at its owner in page-layout.css.

## Verification and review

Artifacts and runnable scripts:
`E:/BACKUP-TRADINGWORKSPACE/analytics-side-layout-20261026/`.

- Scoped HEAD archive plus intentional overlays built successfully (`build.log`).
- 15 focused presentation/view-model/story tests passed.
- Tooling doctor passed as tooling readiness only.
- Final `qa.mjs` / `qa/report.json`: eight Performance fixture cases, dark/light at
  1920/1366/390/320, layout geometry, tab separator absence, threshold popup,
  accessibility and overflow checks passed. No writes, page errors or console errors.
- Actual session journey on preview5196 passed seven checks across three tabs,
  Buy/Sell filters and library regression (`actual/report.json`). Same read-only
  journey passed after promotion on UI5180 (`deployed/report.json`).
- Independent `reviewer/review.json`: 1920/1366 geometry, SVG dimensions, fullscreen
  restoration and console checks passed. Earlier review additionally tested390 and
  resize1920→1366→390→1920. No remaining blockers.
- Root inspected the desktop fixture screenshot. Actual-session columns measure
  612.78px high at1920x940; final fixture measures620.78px. Both fit below tabs in
  the reference viewport. At1366 the filters wrap and normal vertical scroll remains.

## Local rollout and rollback

UI5180 index SHA256:
`5f8396921135c44fa1d04253c82df6e042235c15c58172aa199615c0d3f3c46b`.
Prior index:
`43c592c2cbd05cf8f6921ae316a575885f0e3051291d6b7fd00e8907f4c5816c`.
`ui-promotion.json` records atomic index replacement, collision checks and retained
old hashed assets. Rollback is `ui-before-release/` under the artifact root.

API8010 retained its native/compact runtime and reports ready. No API/terminal
restart, broker calls or owner-data writes were performed. Only the owned temporary
preview5196 is stopped after process identity verification. Final served hash and
readiness are in `deployed-hashes.json`. UI5180/API8010 remain running.

Acceptance is limited to this layout slice; no broker or whole-product acceptance.
