# Chart order marker alignment — 2026-10-16

## Symptom and change

The owner's actual IAB session displayed an already-set TP at exactly the Entry price, alongside an unset SL. Previous placement separated only unset protections, so the set TP overlapped Entry. Read-only inspection confirmed this state; no owner order data was changed.

Visible marker dimensions now determine horizontal columns for every vertically adjacent marker, whether set or unset. Entry retains the right column; equal-price markers read TP, SL, Entry with 8px gaps. Distinct price levels share the right edge when they have enough vertical separation. Price and vertical coordinates are unchanged.

The same placement runs during RAF drag previews. The captured marker retains its furthest-left column until release to prevent threshold oscillation, then normal placement resumes. The Entry close button reserves its width while unavailable, avoiding pending-state layout shifts. Actual IAB observation after HMR showed the three boxes separated without overlap.

## Validation

- `node --test tests/advancedOrderOverlay.test.mjs tests/replayOrderModel.test.mjs`: 10 passed.
- `npm run build`: passed; existing bundle-size advisory remains.
- `QUICK_TRADING_OUTPUT=../evidence/chart-order-alignment-20261016 node tests/quickTrading.browser.mjs`: 9 scenario groups, 20 synthetic mutations, no errors (see receipt.json).
- Browser regression covers set TP == Entry plus unset SL for Buy and Sell at 1064/1368px, checks pairwise nonoverlap at rest and during a short captured drag, and verifies Escape rollback. Existing valid/invalid drag, rejection, scale/inversion, theme, resize and close-dialog scenarios also pass.
- Screenshots include equal-price Buy/Sell at both widths and separate protection levels. The movable replay toolbar is placed clear of fixture labels for legible visual QA; this changes test preferences only.
- Independent read-only review by quick_trade_latency_audit: no remaining blocker; confirmed placement during drag/sync, retained drag column, unchanged price/Y, reserved X width.

## Limits

Browser mutation tests use intercepted synthetic replay state with the actual native chart and DOM handles. This slice changes visual placement only; it does not add engine capabilities, alter persisted prices, or claim new backend latency improvements. Auto-BE and multi-position remain deferred.
