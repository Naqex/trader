# Report activity time — 25 October 2026

Completed scoped source, native fixture, independent source/visual review and
local deployment acceptance. This is not whole-product or broker acceptance.

## Contract

See [REPORT-TIME](../../docs/REPORT-TIME.md). Persist observed UTC separately from
simulated market time. Product reports explicitly request activity basis. PnL,
closed counts, win rate, calendar/filter/facets/default sort use actual close
observations in the Settings timezone. Market open/close and Prop phase/cursor
contracts remain intact. CSV adds both real closing-time fields only for activity
exports. Engine default market and frozen oracle output stay compatible.

Equity uses exact single-account/causal portfolio events, including floating P/L;
trade filters do not fabricate account Equity. Unknown recording gaps split lines.
Session overview and Dashboard expansion share the same Equity/period renderer.

Presentation also includes top horizontal grid, full weekdays, single year context
or explicit multi-year month labels, and a narrow-chart date overlap fix.

## Verification

- Recording Rust tests:8/8; analytics Rust tests:12/12 (including frozen Python and
  CSV oracle); context experiment/journal oracle integration test:1/1.
- Frontend focused final run:57/57 (analyticsViewModel, dashboardModel,
  sessionPerformance, tradingAnalytics, ledgerFilters, demoMode).
- `scripts/report_activity_acceptance.py`: disposable PostgreSQL + native Routers,
  full and compact storage; actual server UTC vs old market timestamps; partial
  closes, idempotency, metadata save, fork inheritance, paged/cache/summary/timezone
  parity and missing legacy coverage. Multiasset true Equity99996 versus incorrect
  raw asset Equity sum199996; fresh portfolio partial=false.
- Scoped production UI build PASS. Browser at1920/390, dark/light, Vietnamese/English;
  top horizontal grid, full weekdays, no chart scroll, real Equity contract, axis
  dates fit; multi-year response fixture explicitly labeled separately.
- Independent review: scoped source and per-card visual PASS.
- Deployed owner read-only journeys: Backtest/Prop/All Dashboard, Session report,
  journal table, request basis, separate real/chart exit columns, unknown states.
  No page errors, no mutation requests. MT5 …4926 connected, requested mode retained,
  error_code=null; no reconnect or broker execution.

## Local rollout and practical limits

API8010 retains native/compact, database/artifacts, QDM, scientific/legacy
capabilities and AI interpreter. Guarded preflight confirms schema16 current and
no pending migration. Old-owned binaries stopped before canonical-source candidate
start. A preliminary clone build failed its retained scientific identity check;
no runtime was started from it. Canonical manifest build/preflight passed.
UI5180 promoted with old hashed assets and branding retained. Runtime hashes and
UI before/after index are in accompanying receipts. Rollback manifests/index and
logs remain under `E:/BACKUP-TRADINGWORKSPACE/activity-report-20261024/`.

The13 existing unique owner closed fills have no verified close observation;
all-time financial totals remain, dated plots stay empty/unknown. Neither opening,
updated nor virtual time was substituted. Safe historical reconstruction requires
validated contiguous revision deltas and ancestry; not implemented or claimed.

Sparse receipts still grow inside revision payloads. No large-history performance
claim; dedicated immutable observation storage needs a separate migration/benchmark.
The fixture PG was stopped and removed. Only owned preview servers are cleaned up.
