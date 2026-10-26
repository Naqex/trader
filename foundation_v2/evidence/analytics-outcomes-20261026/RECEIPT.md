# Analytics expectancy and outcome details

26 October 2026. Direct owner feedback: trim the PnL right inset, outline its
interval control, remove repeated headings/counts, add metric definitions in
VI/EN and show winning/losing returns as percentages.

## Behavior, data flow and decisions

- PnL keeps the existing left axis and card inset. Its plot right reserve is 8px
  instead of 20px. Geometry checks found only the shell `.fx-content` scroll owner,
  not a nested report scroll area. We did not remove the normal page scrollbar.
- Interval segmented groups now have a visible 1px border. PnL omits the redundant
  'over time' subtitle; chart controls and series keep their existing behavior.
- Expectancy/profit factor retain one panel with accessible region name and
  individual metric labels. Average win/loss amounts use a horizontal comparison
  bar; the profit-factor ring compares total winning/losing amounts and omits the
  duplicated center value. Outcomes similarly retain their region name and two
  group headings, without a repeated parent heading or repeated heading counts.
- All six rows per outcome group have shared SVG info controls with VI/EN help:
  count, best/worst return, average return, holding time, longest run, mean run.
  Expectancy and profit-factor help explain the actual after-fee and threshold
  semantics; unsupported performance/overfitting rules from the reference are
  not asserted. EN duration uses existing hr/min copy and expectancy uses /trade.
- The advanced analytics model computes each return as net PnL divided by that
  source session's initial capital times 100, then takes the relevant extreme or
  arithmetic mean. Single-session rows may use the model's starting capital;
  multi-session rows cannot use aggregate capital. Missing/nonpositive capital
  in any member makes that group's percentage summaries N/A; empty groups stay
  N/A. Tiny nonzero percentages retain two significant digits, as in the ledger.
- Existing net amounts, expectancy, profit factor, threshold classification,
  market holding durations and filtered-order streak calculations are retained.
  Breakeven ends a run; the final run participates in the run average. The demo
  uses the same components and source-capital calculation. No source trades or
  backend/API/terminal state were changed.
- Narrow screens stack the PF metric/ring to keep legend amounts intact; this
  deliberately uses more vertical space than squeezing numbers into fragments.
  The page remains in the existing PnL-left/RR-right composition on desktop.

## Verification and observed repairs

Artifacts and runnable scripts: `E:/BACKUP-TRADINGWORKSPACE/analytics-outcomes-20261026/`.

- Scoped build: HEAD 78881d7 web/ui plus five intentional source overlays; existing
  dependencies and accepted private CSS baseline. Unrelated dirty files excluded.
- 47 focused model/presentation tests PASS, including mixed capital (wins 1%/50%
  average 25.5%, losses -1%/-50% average -25.5%), missing/zero/negative capital,
  single-source fallback, threshold classification and empty groups.
- `outcomes.mjs`: five cases 1920/1366/390/320, VI/EN, light/dark, DPR1/1.25;
  12 outcome + 2 expectancy tooltips, viewport bounds, percentage oracle, region/count
  deduplication, interval border, single scroll owner, row/page overflow and
  scoped desktop axe serious/critical checks PASS. Color contrast excluded from
  this scoped axe run; screenshots inspected separately.
- `controls.mjs`: five cases of zoom/pan/selection/reset/keyboard, drag versus
  inspector, filters/Apply/chips, tooltip bounds and desktop axe PASS.
- `details.mjs`: five cases including 1024px, RR help, tab keyboard navigation and
  x-axis label spacing PASS.
- `actual.mjs`: seven read-only existing-session journeys PASS, including market
  time, actual PnL, all three reports, Buy/Sell filters and library regression.
- Independent review PASS for financial semantics and rendered 1920VI/390EN/320EN.
  First mobile screenshot showed legend amounts breaking mid-number despite no
  DOM overflow; repaired with a sufficiently specific mobile stacking rule and
  reviewed again. EN plural /trades corrected to /trade in the final build.
- Candidate and deployed outcomes checks each PASS all five cases; deployed real
  session checks PASS all seven journeys. No page errors or write requests.

## Local rollout and recovery

UI 5180 was promoted with collision checks, preserved private branding and old
hashed assets, atomic index replacement and private rollback. Served index:
`319f618f3915399b7245a2b48734c8a0e70ae3db05413d74bdee6a8a43096c0d`.
Previous index:
`6a93a08bb7d6075a9e10ba5297072c4208ff135595a0f9ed67548493e3a3fb09`.

API 8010 remains PID 12616, native/compact, same verified executable SHA256
`72e297248e818880b8afebad2f5054e2d9114c8a515c6330a3347086c53cd064`.
The initial `/ready` probe returned 404 (wrong probe path); the correct
`/health/ready` returned 200 with database ready and command worker not required.
The promotion helper independently enforced the current-index hash. No API or
terminal restart. This slice's preview 5196 was stopped after executable, command and creation-identity verification; its listener is closed.
Rollback index and mutable assets are in `ui-before-release/` under the artifact
root; retain current and old hashed assets when restoring the index.

Scope: these Analytics UI details and their model projections are verified;
this receipt does not close whole-product, broker or reference-formula parity.
