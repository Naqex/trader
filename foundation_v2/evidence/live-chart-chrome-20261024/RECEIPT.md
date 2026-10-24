# Live chart chrome — 2026-10-24

Scope: owner-requested removal of the bottom Demo label, consistent wallet/header presentation, duplicate separator removal, and clearer stale-quote feedback. Browser annotation investigation was canceled by the owner and was not resumed.

## Behavior and data

- Live continues to read MT5 balance, equity and free margin. These amounts are neutral; only realized/unrealized PnL receives gain/loss colors in the shared wallet.
- Removed the redundant bottom account-mode badge. Order dialogs retain their existing account/mode checks.
- Live timeframe has a separator from the symbol. Camera/Mentor has one separator; Replay retains its camera/Editor separator.
- Stale-price copy explicitly says order submission is paused, and mobile positioning avoids the floating utility rail.
- Quote-age, identity and permission gates are unchanged. Fresh valid snapshots unblock the existing controls when all other gates pass; no order is queued or automatically sent.
- Read-only wallet popovers now close with Escape while focus stays on the trigger. Nested popup Escape still stops before parent dialog handlers.

## Verification

- Isolated HEAD build with only scoped source overlays: PASS. Unrelated dirty ReplayWorkspace/learnIntegration/visual-polish changes were excluded.
- Updated `web/run_live_market_acceptance.mjs`: PASS at 1920 dark, 1440 light, 768 dark, 390 dark; wallet semantics, Escape, stale/future/invalid quotes, unavailable/empty states, reconnect, timeframe/search navigation and stable chart geometry. No API writes, no browser errors.
- Focused Replay regression using the existing chart-design-system fixture: PASS at 1440/390 in dark/light, including positive realized/negative unrealized PnL and wallet Escape. This was not a full chart-design-system suite run.
- Screenshots reviewed for Live desktop light/dark, mobile stale message and Replay wallet. Independent review identified a nested-dialog Escape ordering issue; fixed and re-reviewed with no remaining findings.
- Promoted local UI on port 5180. Actual MT5 read-only browser journey: PASS, stale-price gate visible, Buy disabled, badge removed, wallet neutral, no API writes or browser errors. Fresh-price recovery was proven by fixture, not a live broker tick during market inactivity.
- `git diff --check`: PASS. Broker order acceptance and the whole-product plan are outside this receipt.

## Artifacts and local promotion

Build, temporary files, screenshots, reports and rollback copy: `E:/BACKUP-TRADINGWORKSPACE/live-chart-chrome-20261024/`.

- `browser-final/report.json`: Live fixture checks.
- `replay-browser-final/report.json`: focused Replay regression.
- `runtime-report.json`: actual local read-only verification.
- `prepare.py`, `replay-check.mjs`, `runtime-check.mjs`, `promote_ui.py`: reproducible local checks/build/promotion.
- `ui-before-verified/`: previous index and mutable public CSS. Existing hashed assets retained for open pages.
- Active index SHA256: `926fc2113802a49a68b85ea448370f6e14f83e905df2280c3583fe21e9db3149`.

No API/MT5 restart, clock changes, execution-policy changes, preview/OrderCheck or broker orders were performed.
