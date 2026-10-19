# Partial take profit — 19 October 2026

Scope: native replay engine, durable target allocations, chart/order form and
requested risk/estimate UI refinements. No broker/provider/holdout execution.

## Result and contract

- Up to eight ordered targets with stable IDs, prices and exact instrument lot
  quantities. The UI converts percentage shares once; the final slice receives
  rounding residue. Invalid sums, grids and sub-minimum slices reject.
- A target closes its slice, preserves the residual SL/targets and books its
  allocated fees/P&L. SL closes all residual exposure. Manual partial close
  consumes farthest target allocations first. Scalar TP mirrors the next target.
- Full/compact history, reload, amendments, reconstruction, branch, tick execution
  and analytics retain the same allocation. Compatibility rejects this feature.
- New form SL/TP remain off; seed SL20pip, TP2x enabled SL or40pip. Calculator is
  collapsed, initially1% of initial balance, editable, and only sizes while open.
  These are UX seeds, not a universal trading strategy. Profit/loss use semantic
  colors and currency prefixes. Risk controls share one light background with
  slim28px presets (44px coarse-pointer targets).

## Verification

- Rust: `cargo test --locked --manifest-path foundation_v2/api-rust/Cargo.toml
  --target-dir foundation_v2/api-rust/target/partial-tp --lib replay_core`:
  **30 passed**. Includes both sides, invalid allocation, multi-target gap/fills,
  TP1 then SL with session-cost-v2/slippage/per-lot fees, pending Stop targets,
  manual close resizing, OHLC ambiguity rejection and full/compact restore.
- Python: `pytest foundation_v2/tests/test_replay_quick_orders.py -q`:
  **26 passed**; request bounds and compatibility rejection for market/quick/
  protection included. Contract exporter `--check`: **105 commands passed**.
- Node focused order model/protection/notices/overlay suites: **25 passed**.
  Production Vite build and isolated native release binaries built successfully.
- `final-partialTakeProfit/browser.json`: **3 real native/compact PostgreSQL
  journeys passed**, BUY1368 VI dark, SELL768 EN light, BUY390 VI dark. No page
  errors. Market filled immediately; no draft marker. Reload, keyboard target
  amendment/restore, TP1, branch, residual editor, cancelled removal of last TP,
  TP2 and analytics passed. Exact fixture oracle: .04lot split .02+.02; net1+3.2;
  final balance10004.2 from10000, two unique analytics slices of one source position.
- `final-conditionalOrders/browser.json`: **4 Limit/Stop journeys passed** at
  1368/768/390, VI/EN, dark/light; Market/cancel, explicit SL/TP states and
  automatic risk sizing regressions also passed. No page errors.
- Reviewed desktop, mobile, light/dark form screenshots and separate TP chart
  markers. Failed/earlier attempts remain on disk and are not acceptance evidence.

Browser tests run through `scripts/offline_browser_acceptance.py` using synthetic
CSV, temporary PostgreSQL, native API and real Advanced Charts. All trade writes
were isolated. This is scoped feature acceptance, not whole-product acceptance.

## Local delivery

Owner API8010 uses `api-rust/target/partial-tp/release`, native/compact,
run `5d4c8d2cdd3b4e28b5b3344737bd95fd`. Readiness reports database ready, no Python
command worker required, and replay reads advertise `partial_take_profit:true`.
No migration was required. Installed scientific capability was reverified and
written to `.runtime/api-platform/native-scientific-capability-partial-tp-20261019.json`;
existing legacy-codec capability retained.

The first wrapper restart refused an executable-path ownership mismatch without
stopping the old runtime. The exact recorded conditional-entry binaries were then
used for guarded stop; the new target started with idle/schema guards intact.
Old binaries remain available. New Partial TP sessions require a capable native
binary when restored; Python compatibility does not support their state.

Rebuilt UI5180, reloaded the actual owner tab, verified both switches initially
off, enabled SL/TP and added two targets in an unsaved form. `owner-form.png`
shows currency prefixes, profit/loss colors and aligned TP fields. Cancelled the
draft; no owner order was placed, changed or closed. Owner replay revision30
was unchanged. Current persisted owner state remains outside trading QA scope.
