# Live order feedback — 2026-10-24

Scope: dismissible shared chart notifications, stale-quote draft controls, receipt-based MT5 outcome messages. No backend permission or freshness rule changed.

## Behavior and state

- Closing a Live state notification dismisses that episode. The key uses chart/account scope, read status, blocking reason and quote category (past/future/invalid), never age or SSE snapshot timestamp. A different error or a new episode can surface again.
- A valid past quote that is merely stale leaves Buy/Sell and draft checking usable. Clicking Buy/Sell shows the shared bottom-left state notification; checking an already open stale draft closes the ticket and shows that notification. Neither branch calls preview or commands. Read-only, invalid/future time, unavailable connection, unresolved outcomes and pause keep their existing locks.
- Actual send still requires `canAct`, a matching fresh preview and explicit confirmation. Backend guards are unchanged.
- Direct HTTP, pending-result SSE and explicit reconciliation share one receipt mapper. Request/status dedup prevents the same result resurfacing after dismissal. Final fills use actual receipt volume/price; accepted is labelled only as received. Rejection includes broker reason/retcode and ticket/symbol context. Close, protection, cancel and pause/resume have distinct messages. Unknown or reconciliation-required receipts never become a completed-fill notification.
- Dismissing an unknown-result warning does not unlock sending. Reconciliation is also reachable from Trading conditions.

## Verification

- Production build: PASS, 339 modules. Existing chunk-size advisory remains.
- Node: 10/10 PASS (`mt5OrderNotices.test.mjs`, `liveTradingModel.test.mjs`).
- Market browser fixtures: PASS at 1920 dark, 1440 light, 768 dark and 390 dark. Covers dismissal across updates, retry warning with no writes, stale/future/invalid transitions, reconnect and stable chart mounting. Zero mutations.
- Dock browser fixtures: PASS at the same four sizes. Desktop additionally checks synthetic filled receipt actual quantity/price, accepted versus filled, reject reason/code, close, protection, unknown across reload followed by rejected SSE reconciliation, no success for rejection, and no reappearance after dismissal. All POSTs intercepted; zero broker calls.
- Replay regression: PASS at 1440/390 in light and dark; no unexpected requests.
- Independent read-only review: `/root/backend_review`, no remaining critical/material finding after quote-category fix. No broker/API calls by reviewer.
- Visual review: mobile stale notification with enabled Buy/Sell and desktop receipt stack; controls fit and the notification clears the bottom trading bar.
- Promoted isolated HEAD build plus only the four task source overlays to local UI 5180. Unrelated dirty source excluded. Active previous index hash `17ff7560ab5c344def57fc3fe0989336d1fe5acc602b17ff8be871fb69e62970`; new index `cfe14d2712f7b152b2b31ecf76a58f881ecffab8ba04f5d1ed1c715ef3e19b27`.
- Actual local 5180 read-only browser: PASS. Existing quote was eight hours old; Buy enabled, dismissal remained closed across updates, Buy and stale ticket check restored the warning without any POST. Native timeframe/reload, wallet and chart retention checks also passed. No API/terminal restart or broker preview/OrderCheck/OrderSend.

Artifacts and rollback: `E:/BACKUP-TRADINGWORKSPACE/live-order-feedback-20261024/` (browser/dock/replay reports and PNGs, runtime report, isolated source/build, promotion report and `ui-before-verified`).

## Coverage limits

Live shares the Backtest/Propfirm notification component and common command-result presentation. This does not establish complete broker event parity: positions closed outside this app, including broker-side SL/TP triggers, still need an authoritative deal-event feed before automatic outcome toasts can be guaranteed. A close receipt without side information uses a ticket/symbol message rather than inventing the side. Cancel is covered by the pure mapper tests, not a real broker cancellation. Synthetic outcomes prove UI behavior, not broker acceptance or execution performance.
