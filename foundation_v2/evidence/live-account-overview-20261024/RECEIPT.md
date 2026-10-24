# Live account overview — 24/10/2026

Owner request: use the Sessions layout for Live overview, selecting an account
instead of a replay session. The tab stays Tổng quan; Trading accounts owns management.

## Implemented

- Rich searchable account picker, management/refresh actions, account summary and
  chart entry, connection/margin facts, period charts, metrics and recent executions.
- Existing report bars, metric cards, tokens, pagination and chart routing reused.
- Connection/workspace/login/server/currency scope protects report identity.
  Explicit selection survives reload. Catalog reordering preserves the current
  implicit account; a removed explicit account requires another selection.
- Visible overview catalog refreshes every 10 seconds. Stale/failed account reads
  show unknown connection/permission values; these are never market-session facts.
- PnL includes execution costs and excludes deposits/withdrawals. UTC buckets and
  a cumulative PnL curve do not invent a balance curve, ROI basis or closed-trade
  counts. Missing time/cost suppresses plots; synced empty history is known zero.

## Verification

- 9 Node model/navigation tests passed.
- 17 synthetic GET-only browser scenarios passed: desktop/mobile, light/dark,
  English, account switch/reload/currency isolation, pagination, reordering,
  empty/missing/denied/partial/stale/error data and long names.
- Existing 11 chart browser cases passed, including slow entry, one loader,
  reconnect retention, renderer switching, unavailable library and lightweight mode.
- Real local read-only browser checks: 2 candidate widths/themes and 1 deployed
  desktop route passed. No write requests or browser errors. Real history currently
  has no executions in its synced window; nonempty reports are fixture evidence.
- Independent review closed account-refresh switching, stale metadata and volume
  unit findings. An initial browser oracle used a desktop-only pagination button;
  the test now uses the shared Previous control on mobile.
- Scoped production build and diff check passed. No unrelated WIP included.

Artifacts/rollback: `E:/BACKUP-TRADINGWORKSPACE/live-account-overview-20261024/`.
Final browser evidence: `browser-final/`, chart regression: `chart-regression/`,
actual reads: `real-5194/` and `real-5180/`; promotion: `ui-promotion-verified.json`.
Served index SHA256: `cfe5e7467a0f3b7fec379406075e56953b1a091db3d93cbfed95afb78f6922d1`.

UI-only atomic index promotion on 5180; previous hashed assets and private branding
retained. Owned preview stopped. No API/terminal restart, reconnect, order check,
order submission, migration or new broker authority.
