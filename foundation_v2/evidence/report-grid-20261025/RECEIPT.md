# Consistent report grid strokes — 25/10/2026

The owner reported alternating bold/faint dashed horizontal lines. Before-change
computed styles already shared the same 1px stroke/color/opacity, but monthly row
coordinates alternated between integer and half pixels (607, 636.5, 666, …).
Default SVG antialiasing spread the stroke differently across physical pixels.

Only `.report-grid` rendering changed: `shape-rendering: crispEdges` and
`vector-effect: non-scaling-stroke`. The smooth Equity curve retains its default
antialiasing. Grid color, dash, data positions, labels, scale and aggregation are
unchanged. The display contract records the common rendering rule.

The owner's monthly question was checked against `MonthlyPerformance.jsx` and
`groupPerformanceMonths`: only months represented by data appear; a known zero
still appears; matching months across years sum profit/loss/net, not averages.
Neither implementation was changed.

## Evidence

- Scoped Vite build: HEAD plus only intentional CSS/contract overlays, previous
  verified private CSS baseline; excludes unrelated WIP. Build passed.
- Before/candidate/deployed screenshots and computed styles:
  `E:/BACKUP-TRADINGWORKSPACE/report-grid-20261025/`.
- Candidate and actual 5180 checks passed for 1920 dark DPR1, 390 light DPR1 and
  390 dark DPR2. Same stroke/color/width across grids; curves remain antialiased;
  12 monthly rows/7 weekdays retained; no browser errors or write requests.
- Parent and independent `session_report_review` compared before/after desktop
  and mobile screenshots. Lines are uniform, without bar/curve/label regression.
- Initial inspection mistakenly waited for visibility of a zero-height SVG line;
  it was changed to wait for its containing SVG, then rerun successfully.

Local UI promotion retained old hashed assets and private branding, with rollback
under the evidence folder. Served index SHA-256:
`9ceff57a42b7c30b09fec581a9e9f29cc2398ce6f3451cde6f1fca9fc6f510e8`.
Only the task-owned candidate preview was stopped. No API/terminal restart,
financial data mutation or broker interaction was performed.
