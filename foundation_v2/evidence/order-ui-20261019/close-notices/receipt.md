# Order close notifications — 19 October 2026

Replaced the shared "closed/cancelled simulated order" message with a receipt matching the owner's reference: title, symbol badge, original Buy/Sell side and close quantity/price, then average entry and flat/remaining state. Buy uses the existing positive tokens; Sell uses negative tokens. The existing notification component and design-system surfaces are reused. Close notifications allow a 400px desktop stack, bounded to the viewport; mobile detail text wraps.

Data flow: after a successful close request, `useChartOrder` passes the old and acknowledged execution states to `closeNotice`. It selects the ledger event whose `command_operation_id` matches the submitted operation, then uses `closed_position.quantity`, `fill_price` and `closed_position.entry_fill`. Partial closes use the returned remaining position; pending cancellation has its own title and never displays a fill price or a closed-position summary. Operation IDs distinguish separate close receipts. Older responses without a matching event retain a specific, short state-change message rather than invent execution details. All new copy has VI/EN interpolation contracts.

Checks:

- Production build passed (`build.txt`).
- `node --test tests/replayOrderNotices.test.mjs tests/testingCopy.test.mjs`: 6 passed. Covers side preservation, close fill vs entry, partial/full receipts, wrong-operation rejection, pending cancellation and locales.
- `node tests/orderUi.browser.mjs ../evidence/order-ui-20261019/close-notices/verified`: 4 passed, no page errors. Real native chart with synthetic API state and intercepted writes; BUY/SELL, VI/EN, dark/light, widths 390/768/1368. Exercises partial close, rejected close, full close, pending cancellation and responsive receipt layout. Reviewed desktop Buy/Sell and mobile screenshots. Earlier `fixture/` run passed before desktop width refinement.
- Installed UI/API read-only smoke passed with no page errors and no submitted owner writes. The owner was already flat; no close was performed by QA.
- A read-only GET of the owner's replay session verified that the most recent native `manual_close` receipt matches `closeNotice`, including the exact fill price. Result: `matchedNativeCloseReceipt=true`, status `closed`, side `BUY`.
- Reloaded the owner's IAB tab to the new build after confirming there was no open dialog. No trading/playback action was submitted.

Scope: notification presentation and confirmed-result mapping; no execution, cost, storage or broker behavior changed. Fixture activity retry toasts are expected because writes are intercepted. This is not a full-product acceptance claim.
