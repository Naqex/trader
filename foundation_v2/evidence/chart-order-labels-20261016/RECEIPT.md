# Compact protection labels and dashed price lines — 2026-10-16

User reference: `codex-clipboard-0440c7dc-56f2-4e50-85b3-9009ef280beb.png`, inspected locally. Small TP/SL handles sit beside Entry, with dashed horizontal price lines. The owner's current saved TP equals Entry; its previous label showed `TP → 0.00 USD` and repeated quantity.

## Change

- Unset and exactly-Entry-price protections display compact `TP` / `SL` handles, without PnL or repeated quantity. Dragging off Entry restores projected PnL and quantity; Escape restores the compact view.
- Presentation is separate from saved state: a configured zero-distance protection remains configured, keeps its native line and retains full amount/price information in its tooltip. No protection is silently removed or reset. Nonzero distances that round to 0.00 remain expanded; actual Entry PnL remains visible even when zero.
- All three native order price lines use dashed style 2. The fallback canvas primitive uses a [4,4] dash for all three strokes as well. Candle/current-price lines are outside this change.

## Verification

- 11 focused unit tests pass (`node --test tests/advancedOrderOverlay.test.mjs tests/replayOrderModel.test.mjs`), including Buy/Sell, queued/position, SL/TP at Entry, nonzero distances and zero Entry PnL.
- `npm run build` passes, with the pre-existing bundle-size advisory.
- `QUICK_TRADING_OUTPUT=../evidence/chart-order-labels-20261016 node tests/quickTrading.browser.mjs`: PASS, 9 scenario groups, 20 synthetic mutations, no errors. Uses actual native chart and iframe handles with intercepted fixture APIs; no owner/session/provider/broker writes.
- Browser assertions verify compact labels with saved TP preserved, hidden repeated quantity, full tooltip, PnL during drag, Escape restoration, nonoverlap at 1064/1368px, and dashed native style on Entry/SL/TP. Existing rejection, keyboard, scale/inversion, theme and close-order cases remain passing.
- Initial drag regression check moved only 5px and stayed at Entry after tick snapping; that assertion failed. The final test uses 15px to cross a price tick while the labels remain vertically adjacent, and awaits the rendered preview before checking it.
- Visually inspected equal-price Buy at 1064px and Sell at 1368px, plus separated protection lines. Screenshots and detailed browser results are alongside this receipt.
- Independent source review by quick_trade_latency_audit: no blocker; compact vs ghost semantics, retained Entry quantity and native/fallback dashed strokes confirmed. Reviewer did not independently rerun browser tests.

This slice changes chart presentation only. No engine behavior, persisted protection values, Auto-BE or multi-position scope changes.
