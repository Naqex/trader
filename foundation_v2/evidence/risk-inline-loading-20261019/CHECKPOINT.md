# Inline risk fields and stable replay loading

Scope: frontend only, following the owner's request to remove the risk-sizing
disclosure, slim the percentage presets and investigate duplicate chart loading.

## Behavior and state

- Enabled SL shows risk fields directly, without a summary/title or expand step.
- Six percentage choices share equal widths, 4px gaps and 24px height within a
  centered row up to 360px wide. Coarse pointers retain 44px touch targets.
- Default risk remains 1% of initial balance. Risk edits calculate lot quantity;
  manually entered lots become authoritative and update the displayed risk.
  Side/type selection preserves that choice. No execution API contract changes.
- Route/session loading and chart-library initialization are sequential phases.
  The previous overlay changed from viewport to chart bounds, and aria-hidden/inert
  did not visually hide the native library's own loading UI. The native host is
  now visually hidden until ready; loading keeps the same viewport bounds and
  covers the fixed Replay toolbar. Background reads retain an already ready chart.

## Verification

- `chartLoading-final/browser.json`: 22 passing staged loading/error/readiness
  cases at 1440/390px in dark/light, including toolbar occlusion, hidden native
  host while data is pending, timeouts and same-session background refresh.
- `conditionalOrders/browser.json`: 4 passing native API browser journeys for
  BUY/SELL Limit/Stop, including inline risk sizing and manual-lot synchronization.
- `partialTakeProfit/browser.json`: 3 passing native Partial TP journeys with
  24px risk presets, target execution, accounting and reload/fork regressions.
- `node --test foundation_v2/web/tests/replayOrderModel.test.mjs foundation_v2/web/tests/orderProtection.test.mjs`:
  14 passed, including sizing-method preservation across side/type transitions.
- `npm run build`: passed; existing large-chunk warning remains.
- Scoped `git diff --check`: passed.
- Visually reviewed mobile dark, tablet light and full-viewport loading evidence.
- Rebuilt Vite preview and reloaded actual owner tab at port 5180. Confirmed SL/TP
  initially off, inline fields after enabling SL, equal approximately 56.67x24px
  presets, manual 0.01 lots producing $2 risk, and 0.5% producing 0.25 lots/$50.
  Cancelled the test draft without submitting an order. Owner session order state
  was not changed. No backend restart or migration.

Proof: `owner-inline-risk.png`, `chartLoading-final/data-pending-1440-dark.png`.
Browser engine tests use disposable PostgreSQL and synthetic datasets, separate
from the owner's session. Staged loading tests use labeled synthetic read responses.
