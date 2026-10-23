# Live chart chrome and Notes footer — 2026-10-23

Owner request: align MT5 chart controls with backtest and keep Notes pagination
at the bottom of the viewport. Baseline `ae52dab`.

## Change and boundaries

- Notes uses the remaining viewport height. Only the list scrolls; filters,
  create/search controls and pagination remain in their layout regions. Tested
  with no notes and 35 labeled fixture notes.
- MT5 still uses the same Advanced Charts component/native tools/header as
  backtest. It now reuses trading-bar styles for Buy/Sell, quantity control,
  account summary, Analytics link and collapsible/resizable/maximized ledger.
  Balance, equity and free margin are available in the account popover.
- Quantity in the bar and order ticket shares the existing draft. Buy/Sell only
  selects a side and opens the ticket; existing preview/confirmation, freshness,
  pending-outcome and broker policy checks remain unchanged.
- Live Mentor opens the actual existing AI panel. The right rail includes
  symbol setup, Notes for the selected broker account and trading conditions.
  Theme, indicators, drawings, capture and local layout persistence still use
  the shared chart components.
- Replay stepping/speed and simulated scalper execution do not belong to Live.
  The backtest's placeholder comparison/Pine editor is not added to MT5. This
  is visual/interaction alignment, not a claim of complete feature parity.

## Evidence

Artifacts/backups/builds are under
`E:/BACKUP-TRADINGWORKSPACE/live-chart-parity-20261023/`.

- `node-tests.log`: 23 focused tests passed (readiness, navigation, Live model,
  workspace context).
- `build.log`: isolated production build passed, existing chunk advisory only.
  Built from Git baseline plus scoped task files; unrelated dirty source excluded.
- `fixture/report.json` and `active-fixture/report.json`: four browser cases
  passed on candidate and promoted UI, 1920 dark / 1440 light / 768 dark / 390 dark.
  Tested quantity transfer, opening ticket without submission, account popover,
  keyboard/pointer resizing, bounds/maximize/restore, actual Mentor panel,
  account-scoped Notes navigation, empty/overflow pagination. No JS errors or
  API mutations. Chart/account data in these runs is explicitly synthetic.
- Actual MT5 reads initially rendered the chart and controls successfully.
  Later retries encountered connection `status=error, error_code=mt5_terminal_busy`;
  saved in `actual-connection-busy.json` and `browser-actual-connection-busy.log`.
  No terminal restart or broker mutation was attempted.
- `active-readonly.json`, `active-terminal.png`, `active-notes.png`: final active
  UI verification without fixtures; connection remains locked, order controls
  disabled, actual Notes pagination bottom=940 at viewport height=940.
- Independent source review by `/root/ai_foundation_review` found a desktop
  minimum-height mismatch, repaired using computed chart minimum height. Browser
  QA found a late ResizeObserver callback after account identity remount; fixed
  by capturing DOM nodes and checking connectivity. Focused re-review had no
  remaining source blockers. No whole-product or broker execution acceptance.

Reusable browser QA from `foundation_v2/web`:

```powershell
$env:TW_LIVE_UI_ORIGIN='http://127.0.0.1:5180'
$env:TW_LIVE_UI_EVIDENCE='E:/BACKUP-TRADINGWORKSPACE/live-chart-chrome-ui'
$env:TW_LIVE_CHART_FIXTURE='1'
node run_live_chart_chrome_acceptance.mjs
```

Without the fixture variable, the script reads the configured local demo account;
it still blocks all non-read API calls. It does not preview/send an order or run
inference. Actual-account readiness is a prerequisite for that mode.

## Local promotion and rollback

`ui-promotion-verified.json` records the guarded asset/index promotion. The old
entrypoint is `ui-before-verified/index.html`; old hashed assets remain, so an
atomic entrypoint restore can roll back. Active index SHA-256:
`f1929ba26fe13ae9a5346d90d016491878f64db6c4d0bdb312ab85878efbba7c`.
No database/API/MT5 restart was required. Existing unrelated ReplayWorkspace,
learnIntegration, visual-polish and evidence edits are not included.
