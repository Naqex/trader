# MT5 overview → setup → shared chart — 2026-10-22

Scope: adapt the existing Practice product journey to MT5. This checkpoint covers
frontend integration and scoped runtime/UI verification, not broker acceptance.

## Behavior and ownership

- Live now enters Tổng quan MT5 with one **Mở biểu đồ** action. There is no Live
  Sessions page, Recent Sessions block, replay/prop creation, or simulated balance.
- DashboardMetric, Practice dashboard styles, quick-session setup styles,
  FxSelect, the existing chart engine/native header, object tree, OrderEntryFields
  and LegacyModal are reused. The ticket is a dialog; the ledger expands below.
- The existing demo controller/API still owns snapshots, preflight, confirmation,
  requests and reconciliation. Opening a chart only changes symbol/timeframe.
  Route generation discards replay/session/dataset/prop and simulation parameters.
- Account identity, balance/equity/margin, allowed assets, prices and constraints
  come from the demo terminal snapshot. Spread is Ask minus Bid. Missing leverage
  or specifications stay unknown. No commission schedule is assumed; actual fees
  belong to deal history. Application risk limits remain separate from broker specs.
- One configured demo terminal is supported. Investor journal connections do not
  grant execution permission. This change does not alter backend policy or migrations.

## Verification

- Production frontend build passed (4.14 s). Existing Vite warning: a minified
  chunk exceeds 500 kB; this is not a bundle-performance acceptance.
- Focused Node tests: **20 passed, 0 failed** across liveTradingNavigation,
  liveTradingModel, liveChartDatafeed, live-workspace and orderProtection.
- Browser QA used an isolated synthetic fixture on 5192, with no broker, SDK or
  database connection. Checked overview → setup → chart → back, symbol EURUSD →
  GBPUSD, M1 → H1, valid order preview, draft/confirmation reset on asset change,
  stale network state, persisted unknown receipt, invalid-symbol recovery and
  responsive/light/dark/VI/EN surfaces. No send command was submitted.
- Checked 360×780, 768×900, 1368×790 and 1920×940 representative surfaces.
  Screenshot filenames identify their viewport; synthetic screenshots are not
  actual account balances or market data.
- Actual 5180/8010 runtime returned `locked`, `demo_policy_locked`,
  `execution_enabled: false`, no account/bars. Its overview and disabled setup
  submission were verified. See actual-runtime.json and actual-overview-locked.png.
- Actual Practice chart regression: existing session still renders the native
  shared header and comparison action. No replay step or order was executed.
- Independent source review found two P2 issues: fullscreen excluded body portals,
  and invalid symbols had no recovery. Both were fixed; final review reported no
  unresolved material source findings in this scope. Fullscreen now targets
  documentElement. IAB OS fullscreen itself remains unverified.

## Evidence and limits

Overview/setup/chart screenshots, unknown-overview.png, practice-regression.png,
network.json and actual-runtime.json are the scoped evidence. Older screenshots
may precede the final rail-spacing adjustment; chart-1368.png is the final desktop
chart reference. Browser sizing/screenshot host behavior is not broker evidence.

Actual terminal connectivity and execution acceptance remain outstanding because
the runtime policy is locked. No order_send, terminal restart or policy unlock was
performed. Unrelated pre-existing worktree changes were preserved and excluded
from this feature commit.

## Owner follow-up: simplify overview

The Live tab now reads **Tổng quan / Dashboard** with the same dashboard icon as
Practice. The overview reuses the Performance heading, metric layout, skeleton
and read-state component. Removed account identity, refresh shortcut, position/
pending-order summary, Manage accounts and Trade analytics links from this page.
Without an account it shows the terminal state instead of four unknown-value
cards. Error retry and invalid-symbol recovery remain available.

Build passed (3.54 s), scoped diff check passed, independent source review found
no material issue. Browser checked actual locked state and isolated synthetic
ready state, including 360 px layout. Follow-up screenshots use `overview-trimmed-*`.
