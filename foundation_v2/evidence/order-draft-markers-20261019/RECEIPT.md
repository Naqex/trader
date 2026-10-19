# Accepted order markers

Opening the order dialog previously projected form draft values onto the chart as order markers. Both the workspace and shared order model now require a position or pending order from the accepted execution state. Form edits, cancellation, and optimistic Quick Buy/Sell submissions cannot create markers.

Validation:
- Focused order model and notice tests: 12 passed.
- Frontend production build: passed.
- Disposable native API, compact storage, PostgreSQL and real TradingView chart: BUY/SELL Limit/Stop passed at 1368, 768 and 390 px in Vietnamese/English. Opening/editing/cancelling forms emitted no markers; cancellation preserved server revision; saved pending orders remained visible after reload; Market execution remained immediate.
- Reviewed desktop dialog, mobile dialog and accepted pending-order screenshots.

Evidence: `native/browser.json`, `native/BUY-limit-1368-menu.png`, `native/SELL-stop-390-form.png`, `native/BUY-limit-1368-pending.png`.

Synthetic fixture only; no owner replay mutations or backend restart.
