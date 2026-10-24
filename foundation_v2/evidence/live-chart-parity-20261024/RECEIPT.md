# Live chart parity — 2026-10-24

Owner request: audit remaining UI differences between Live MT5 and this project's Backtest/Propfirm; synchronize useful shared behavior and retain broker/replay differences. This receipt covers chart UI parity, not whole-product or broker acceptance. The canceled browser-annotation investigation was not resumed.

## Changes and data ownership

- Live uses the native Advanced Charts timeframe toolbar, as Replay does. Supported intervals remain M1/M5/M15/H1/H4/D1. URL selection is authoritative; changing timeframe retains the widget, drawing/layout state and separate candle caches. Reload restores the selected interval. Pending history receives SSE data even before widget readiness; late startup requests cannot overwrite a newer route.
- The shared wallet displays Equity, Realized PnL and Unrealized PnL. Equity/open profit come from the trading snapshot. Booked trading PnL comes from the existing account-scoped `/api/v2/live/status` history, including commission/swap/fee and excluding deposits/withdrawals. The imported history range and last capture appear below the three rows. Missing, stale, incomplete or mismatched history displays unknown rather than a fabricated zero. An explicitly empty valid history or position list yields zero.
- Full history is fetched on wallet opening, cached with the existing ETag helper and React Query, and refreshed every 15 seconds while open; no history polling while closed. Extracted the existing status reader without changing its API behavior.
- MT5 positions, pending orders and requests use the shared pagination footer. Current page clamps when rows shrink and resets on tab/account change. Ticket details and actions retain MT5 semantics.
- Object tree uses the shared side dock rather than a chart-blocking modal. Close/Escape restores trigger focus. Native drawings/indicators remain library-owned.
- Non-order operations now surface errors through shared Notifications; successful receipts use status-appropriate wording. Unknown/reconciliation-required results retain the existing persistent send lock.

## Deliberate differences

Live keeps broker lot constraints, permissions, fresh-quote checks, preview/confirmation, account/server binding, ticket operations and Requests. It does not acquire replay transport/Go To, replay cutoff/news behavior, virtual fills, an invented Closed tab, or unapproved broker commands through chart dragging. Realized PnL covers synchronized broker history, not a fabricated all-time/session total. Live still exposes a finite broker candle window; this change does not add historical pagination.

## Verification

- Independent read-only review found a startup timeframe race; fixed both current-resolution seeding and pre-ready SSE delivery, then re-reviewed with no remaining findings.
- 18/18 focused Node tests PASS: live datafeed, broker/account/quote/confirmation guards, ledger transport semantics and wallet accounting.
- Isolated production build PASS, using Git HEAD plus only scoped overlays. Unrelated dirty ReplayWorkspace, visual-polish, learnIntegration and API acceptance work were excluded. Existing bundle-size warning remains.
- Live market browser suite PASS at 1920 dark, 1440 light, 768 dark, 390 dark: native intervals without iframe remount, history-range wallet, pagination, side dock, keyboard asset search, quote stale/future/invalid states, unavailable/empty data and SSE reconnect. Additional delayed-library + delayed H1 SSE fixture and reload checks PASS.
- Live trading dock browser suite PASS at the same four sizes: lot/scalper persistence, ticket details, resize/keyboard controls, stale/read-only locks, preview invalidation, rejected protection notification, confirmation expiry and unknown-result/reload locking. Preview and command requests were fulfilled only by synthetic fixtures; zero actual broker calls.
- Focused Replay regression PASS at 1440/390 in dark/light: native toolbar separator, wallet gain/loss semantics, Escape/focus and no document overflow. This is not a full design-system/product suite result.
- Reviewed representative desktop/mobile screenshots in both themes. Actual promoted UI on 5180 PASS with real local MT5 read-only data: correct three wallet labels, one on-demand history read, native M1/M5 switch retaining iframe, reload keeping M5, side dock/Escape, no browser errors or API writes. Actual quote remained stale and Buy remained disabled; fresh-tick recovery was exercised by fixture.
- Scoped `git diff --check` PASS.

## Artifacts and promotion

All build/temp/browser/rollback artifacts live under `E:/BACKUP-TRADINGWORKSPACE/live-chart-parity-20261024/`:

- `prepare.py`, `source/`, `dist/`: isolated candidate build.
- `browser/report.json`, `dock/report.json`, `replay/report.json`: labeled fixture checks and screenshots.
- `replay-check.mjs`, `runtime-check.mjs`, `runtime-report.json`: focused regression and real local read-only check.
- `promote_ui.py`, `ui-promotion-verified.json`, `ui-before-verified/`: validated atomic local index/public-CSS promotion and rollback copy. Old hashed assets retained for open pages; existing brand SVG preserved.
- Active index SHA256: `b21b4751820ae1598d6b47b3ac318b419a09ece111675fb8124f6ef5c0a4b5ab`.

No API/MT5 restart, clock changes, execution-policy changes, real preview/OrderCheck or broker orders were performed.
