# Replay partial-close backend

Offline replay only; no owner DB mutations or runtime restart by this lane.

`orders/close` accepts optional absolute lots (`quantity`). Omitted quantity
preserves full-close/cancel behavior. Invalid over-close, off-step and dust
residuals reject atomically. Residual positions retain original volume, cumulative
realized PnL and TP/SL. `manual_close` checkpoint remains branchable and feedable to
Prop with the residual floating PnL and one open position.

Legacy fixed fees/minimum fee/financing allocate by original volume; session
commissions use closed lots. Each fill rounds money independently. Analytics uses
closed slice volume and unique fill IDs, retaining the same source position ID.

Validation run on 2026-10-19:

- Rust library: 125 passed, 16 explicitly ignored external-fixture tests.
- Rust partial library follow-up: 3 passed (both sides/full vs compact, sizing,
  legacy minimum fee and financing allocation).
- Rust differential corpus: 4 passed; explicit native tick partial BUY/SELL case
  subsequently passed (1 test).
- Session slippage: 6 passed, including partial then protective exit and analytics.
- Disposable PostgreSQL HTTP matrix: 14 scenarios passed; declared/legacy Forex,
  Backtesting/Prop, V1/V2 slippage, compact partial mutation, persisted reload,
  Prop feed preserving residual, final close and branch. See `backend.json`.
- Python compatibility lane reported 151 passed + 8 subtests; its final focused
  partial test file passed 16 tests, including forged basis and cost allocation.

Tests run against an owned temporary PostgreSQL cluster. Guarded cutover and
owner-browser acceptance belong to the root lane, separate from these results.

Release build passed (`cargo build --locked --release --bins`, target directory
`foundation_v2/api-rust/target/session-slippage-20261018`, 1m48s). Candidate hashes:

| Executable | SHA256 |
| --- | --- |
| trading-workspace-api.exe | A7EE074ED35651F5B3076AB534A0BA19FA706423064C3464FA53C40663429538 |
| rust_runtime_admin.exe | 4CAAFECB95A789701793405C9A03A57B1E7CDC8F29B104E22AC183BAF65D16FB |
| rust_research_worker.exe | 46B67CD0C354DEF33ACAD2FE5C694C76B16AA6F376072A7B9DD082D926C16575 |
