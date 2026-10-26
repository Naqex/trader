# Performance profit-factor gauge and outcome dividers

26 October 2026. Direct owner feedback specifies a blue PF progress ring capped
visually at four, rather than a donut of winning versus losing totals; positive
and negative average amounts; removal of outcome heading rules and a full-height
central outcome divider.

## Data flow and decisions

`profitFactorGauge` in analyticsPresentation.js reads filtered `data.rows`:
positive net PnL is summed as profit and negative net PnL is summed by absolute
magnitude as loss. This is aggregate winning/losing money after fees, not the
ledger's separate `gross_pnl` field before fees. Each amount participates by sign;
the local breakeven threshold does not remove small amounts. The new Performance
PF value and its ring use the same projection. The old generic model and scenario
ratios remain unchanged for their other consumers; this is a scoped display
contract, now explained in the VI/EN info control and display conventions.

Finite PF is profit/loss; the displayed ratio remains uncapped. Ring fill is
min(PF/4,1), with a thin blue SVG stroke from 12 o'clock over a muted track. Four is
an owner-selected visual cap, not an asserted trading-quality grade. No PnL legend,
red wedge or repeated center number remains. No trades/all zero PnL maps to 0,
profits without losses maps to infinity and a full ring, losses only maps to 0.
Missing PnL remains N/A with no progress stroke. The page's existing no-trade
empty state remains; the helper's empty-input result is 0 for contexts with a ring.

Average-win amount uses the same positive color as its bar; average-loss amount
uses the negative color. Outcome headings have no horizontal line. A central
vertical separator spans the full inner card height when columns are beside each
other. At existing stack breakpoints it becomes one full-width horizontal rule
between the two groups, retaining readable row widths. Existing 12 metric help
controls and percentages remain. Sample mode shares the implementation.

## Verification

Runnable scripts/reports/screenshots/build/private rollback:
`E:/BACKUP-TRADINGWORKSPACE/analytics-pf-gauge-20261026/`.

- Scoped build from HEAD fe42ecd plus four intentional source overlays and accepted
  private CSS baseline PASS; no dependencies or unrelated dirty files included.
- Six presentation tests PASS, including direct PF0/1/2/4/19.47 mappings, empty,
  all-zero, all-win, all-loss, missing/invalid PnL and small signed values.
- `gauge.mjs`: six cases 1920/1366/1024/900/390/320, light/dark and VI/EN. Demo
  profit 1730/loss 770 gives PF 2.24675 and 56.168831% ring fill. Checks matching
  amount/bar colors, no legend, heading border 0, exact divider geometry,
  responsive stacking, VI/EN tooltip, no overflow/page error/write PASS.
- `edges.mjs`: isolated existing-session response fixtures render PF 1 at 25%,
  PF 2 at 50%, PF 19.47 at 100%, all-win infinity/full, all-loss 0/empty and all BE 0/empty
  PASS. These are labeled test fixtures; no owner data was mutated.
- Independent review PASS: 10 math cases; rendered 1920VI/1100EN/800EN/390EN/320VI;
  real sample outcome filters (win infinity, loss 0, BE 0); threshold 1000 classifies
  all 20 trades as BE while PF correctly remains 2.25. No blocker/errors/overflow.
- `actual.mjs`: seven read-only existing-session journeys PASS, including actual
  PnL/time basis, all three reports, Buy/Sell filters and library regression.

## Local rollout

UI 5180 promotion checked active hash/collisions, preserved private branding and
old hashed assets, atomically replaced the index and saved rollback under
`ui-before-release/` in the artifact root. Before:
640e18cc267e9fb4d070f05844934a3c7dc2f855c72f725fcb2df352dbf592ec.
Candidate:
f29a0da131abee6d385d22fe8ed475d4a53159f26811bd663b17045ee69bf55f.
Native/compact API 8010 PID 12616 retains executable SHA256
72e297248e818880b8afebad2f5054e2d9114c8a515c6330a3347086c53cd064;
identity/hash/readiness verified before promotion. No API/terminal restart,
broker request, source-row change or saved-data write.

Deployed gauge checks PASS all six cases; existing-session checks PASS all seven
journeys. No errors/write requests. Served index and readiness verified again.
The owned preview5196 was stopped after matching executable, command and creation
identity; rollback and scripts remain under the artifact root.
