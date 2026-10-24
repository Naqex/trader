# Live trading UI reuse — 24/10/2026

Live MT5 and Replay/Prop now consume the same chart trading dock, Scalper settings, positions-panel frame/tab keyboard behavior, order-entry fields, and SL/TP sections. Removed the independent MT5 dock/resize implementation.

## Component ownership and state

- `ChartTradingDock`: quantity stepper, account popover, resize/collapse/maximize, persisted Scalper preset. `LegacyTradingBar` and `Mt5TradingBar` provide their respective account data and callbacks.
- `ChartPositionsPanel`: tab navigation and table frame. Replay retains its historical/cutoff ledger; `Mt5Positions` renders current broker tickets/requests and ticket details. Missing data is not fabricated.
- `OrderEntryFields` / `OrderProtectionSection`: shared presentation; validation, estimates and execution remain adapter responsibilities.
- MT5 Quick Buy/Sell prepares a Market draft using the selected volume and side's Ask/Bid. Preview must pass for the exact intent within five seconds, followed by explicit confirmation. Account, connection, scope, capability, quote freshness and unresolved-request locks remain in the MT5 adapter.
- Presets are scoped to workspace + MT5 connection/account/symbol, isolated from Replay presets. Unknown pip metadata disables Pips; Ticks/% use declared instrument metadata. No pip inference from digits.
- Protect inputs lock while busy/stale/unavailable or when the ticket disappears. Final receipts select Requests and dismiss old ticket details. Unknown sends persist through reload without automatic resend.

## Verification

- Production build PASS. Existing Vite large-chunk advisory remains.
- 31 focused Node tests PASS: MT5 quick drafts, live permissions/preview/receipts, Scalper arithmetic, order protection and Replay order semantics.
- Replay design-system regression: 18 cases PASS, dark/light at 1440/390; no unexpected writes or page errors.
- New Live browser fixture: PASS on isolated preview and installed UI5180 at 1920 dark, 1440 light, 768 dark, 390 dark. Covers empty/populated ledger, keyboard tabs, pointer/keyboard resizing, maximize/restore without chart remount, details/protect, stale/read-only locks, preset persistence/account+symbol isolation, Buy/Sell drafts, exact preview invalidation/expiry, explicit confirmation and unknown-result reload. Synthetic held protect response verifies busy locking and modal dismissal after completion.
- Existing Live market SSE regression: four widths PASS on installed UI; stable chart geometry/iframe, stale/unavailable locks, picker search/navigation/focus, reconnect; zero mutations/page errors.
- Independent read-only review completed. Modal-persistence finding fixed and covered above.
- No broker order, broker OrderCheck, provider inference, OAuth, terminal restart, migration or backend change performed. All preview/command traffic in browser tests is intercepted synthetic data. This is UI/contract evidence, not broker execution acceptance.

## Local delivery and limits

- UI assets promoted atomically to UI5180; API8010 unchanged; old hashed assets retained for already-open pages. Reload once to load the new bundle.
- Before index SHA256: `d857835c600ef4277e7c2a878bb6974977480e5748322eebb23d2590c0180010`.
- After index SHA256: `6d5e7b169ca4e94e8e068242b8e6c5af33a5a6de1b7be63fce75995b43aa718f`.
- Build, backup, promotion record, full logs and screenshots: `E:/BACKUP-TRADINGWORKSPACE/live-trading-ui-20261024/` (`installed/`, `replay-final/`, `market-regression/`). Unrelated dirty source was excluded from the isolated build and commit.
- MT5 placement remains Market-only. Pending placement, automatic break-even and chart drag-to-modify are not introduced by this UI change. MT5 ticket details show fields supplied by its current snapshot, without invented fees/history.

## Reproduce

From `foundation_v2/web`:

```powershell
node --test tests/mt5QuickOrder.test.mjs tests/legacy-scalper-preset.test.mjs tests/liveTradingModel.test.mjs tests/orderProtection.test.mjs tests/replayOrderModel.test.mjs
$env:TW_LIVE_UI_ORIGIN='http://127.0.0.1:5180'
$env:TW_LIVE_UI_EVIDENCE='E:/BACKUP-TRADINGWORKSPACE/live-trading-ui-20261024/installed'
node tests/liveTradingDock.browser.mjs
$env:CHART_DS_OUTPUT='E:/BACKUP-TRADINGWORKSPACE/live-trading-ui-20261024/replay-final'
node tests/chartDesignSystem.browser.mjs
$env:TW_LIVE_UI_EVIDENCE='E:/BACKUP-TRADINGWORKSPACE/live-trading-ui-20261024/market-regression'
node run_live_market_acceptance.mjs
```
