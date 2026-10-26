# Analytics overall layout density

26 October 2026. Owner supplied unlocked Performance, Simulation and Prop references
and requested an overall compact arrangement before later work on chart details.

## Behavior and data ownership

Performance retains the PnL-left / three-risk-cards-right hierarchy. R cards now use
48px sparklines with accessible points and tooltips; fullscreen restores axes.
Expectancy/profit factor pairs with winner/loser statistics, side charts pair with
time-window radars, and hour/day charts pair. The month matrix remains full width;
calendar/frequency retain their 2:1 row. Calendar date/count share one line above
the result, and frequency summaries sit beside their plots.

Drawdown pairs its main plot with four metrics, then MAE with winning-trade metrics.
SL/RR scenarios stay side by side; their existing per-trade details remain collapsed
and scroll within a bounded table when opened. Monte Carlo configuration occupies
the left column, results the remaining width. Its inputs, run/dirty/reset state,
seed and calculation contract are unchanged. Prop objectives pair snapshot metrics
with their existing table. These arrangements collapse on smaller screens.

No new dataset, scenario algorithm, financial formula, backend or state owner was
introduced. Existing report inputs and filtered series flow through the same models;
the added sparkline option only changes chart margins/axis visibility. Charts retain
their domain logic. This slice does not claim parity with every newly supplied
reference-chart detail; the owner reserved those for subsequent edits.

## Measured size

Same labeled fixture, dark theme, viewport1920x1000, all data/controls retained.
Heights measure the report content excluding shell/filter/navigation.

| Report | Previous px | Updated px | Reduction |
| --- | ---: | ---: | ---: |
| Performance | 2938.31 | 2215.67 | 25% |
| Drawdown | 638.59 | 526.78 | 18% |
| Simulation after Monte Carlo | 1036.38 | 933.88 | 10% |
| Actual Prop objectives | 398.13 | 298.53 | 25% |

The Prop comparison uses the same two existing bound reports. Narrow views prioritize
readability and vertical scrolling over matching these desktop height reductions.

## Verification

Runnable scripts, scoped source and detailed reports are retained at
`E:/BACKUP-TRADINGWORKSPACE/analytics-density-20261026/`.

- Scoped production build passed (`build.log`); unrelated dirty UI files were excluded,
  retaining the previously accepted private CSS baseline used by earlier releases.
- 15 focused presentation/view-model/story tests passed.
- `qa.mjs`:30 fixture cases (three tabs × dark/light ×1920/1366/768/390/320),
  monetary assertions, charts, Monte Carlo, threshold, axe and overflow passed.
  `baseline/report.json` and `qa/report.json` retain comparable measurements.
- `states.mjs`:six empty, filtered-empty, error, denied, partial and experiment-error
  cases passed. No writes or page errors.
- Independent review checked1920/1366/390, miniature/fullscreen transitions,
  Monte Carlo configured/run/dirty/reset, and actual Prop objectives. A radar label
  readability blocker at900px was corrected by retaining two columns and full-width
  panels below1200. `reviewer/radar-followup.json` confirms240px SVGs and12.8px text
  at900/1100, no overflow or console errors; no remaining blockers.
- Root `breakpoints.mjs` verified900/1100. Its first width selector also included
  the18px fullscreen icon and failed; the corrected radar-only selector passed.
  The failed harness output remains `breakpoints/selector-failure.json`.
- Root visually inspected the desktop hierarchy, radar and Monte Carlo groups,
  plus the actual Prop objectives arrangement.
- `actual.mjs`:seven read-only checks passed on preview and deployedUI5180,
  including three tabs, market-time requests, Buy/Sell filters and library regression.
- `prop.mjs`:two actual bound reports at1920/390/320 passed on preview and after
  promotion. No broker/live requests, owner-data writes or page errors occurred.

## Transient response

The first post-promotion actual-session run received503 from the experiments endpoint
and failed (`deployed/first-503.json`). A direct diagnostic GET subsequently returned
200, readiness stayed healthy, and one sequential rerun passed all seven checks.
No API restart or backend fix was made. The cause of that transient response is
unconfirmed; this receipt does not claim the underlying service issue was fixed.

## Rollout and recovery

UI5180 served index SHA256:
`68d9e3efc1630f87eb036d4381930c9984389df5f161e5f71063746a3d61203d`.
Previous index:
`5f8396921135c44fa1d04253c82df6e042235c15c58172aa199615c0d3f3c46b`.
`ui-promotion.json` records collision checks and atomic index replacement;
`ui-before-release/` retains rollback files and old hashed assets remain available.

API8010 remains native/compact with database ready and command worker not required.
No terminal reconnect, broker action or API restart occurred. The owned preview5196
is stopped after identity verification; UI5180/API8010 remain running. Final hash,
readiness and preview cleanup are in `deployed-hashes.json`.

This accepts the requested layout slice, not broker execution or whole-product status.
