# FX Replay chart research and analytics application — 27/10/2026

Status: **PASS for the owner-assigned Analytics chart slice**, deployed on
localhost:5180. This is not whole-product, broker or production acceptance.

## Applied

- Matched the public FX chart contracts where the client source exposes them:
  time-based PnL positioning, interval controls, X-axis zoom/pan/reset and
  keyboard controls, chart state that preserves trade selection, and the
  existing Performance/Drawdown/Simulation chart families.
- Fixed risk cards to equal heights and right aligned values.
- Changed the breakeven threshold to realized **R** using valid original risk.
  Missing R stays unknown; financial PnL/frequency data remain visible. Profit
  factor still uses all positive and negative net PnL, independent of threshold.
- Fixed winning MAE classification to use the report outcome and gated calendar
  win rates when classification coverage is incomplete.
- Added model oracles for unequal risk, missing R, irregular timestamps,
  duplicate timestamps, calendar classification coverage, and chart interactions.

## Research boundary

Public FX JavaScript confirms client selection, chart construction, interval
grouping, toolbar flags, and parts of Monte Carlo. Backend supplied scalar
formulas, fees, cutoff rules and production API values remain unverified. The
local model keeps provenance, unknown values and ready/ambiguous scenario states
explicit instead of inventing parity from demo numbers.

## Verification

- Local model build: **110 tests PASS**.
- Independent source/model review: **66 tests PASS**, 10/10 source hashes bound
  to candidate index `1bcdfe2881b8fedbeadfc0719b7d56898a1c437e4cd96818eefabba121d132bd`.
- Browser chart QA: all chart families PASS at 1440, 768 and 390; no page errors
  or writes.
- Toolbar QA: 1920, 1440, 768 and 390 PASS for zoom, brush, pan, reset,
  keyboard, Escape cancellation, missing-risk state and equal card geometry.
- Existing analytics polish and layout QA: PASS; one vertical scroll owner and
  no page horizontal overflow.
- Promoted UI atomically without restarting API/UI ownership or touching the
  original FX demo tab. Previous index is retained at the raw task rollback path.

Raw source, public bundle hashes, screenshots and reports:
`E:/BACKUP-TRADINGWORKSPACE/fxreplay-all-charts-20261027/`.
