# Report presentation follow-up — 25 October 2026

## Behavior and data

- Shared ReportBars hides printed values and exposes the full amount through the
  existing ProjectTooltipLayer on hover, focus and tap. Category and scale labels
  remain visible. Transparent category targets keep zero values reachable without
  drawing a fake bar. Escape, outside interaction and scroll retain existing dismissal.
- Daily performance renders one blue net P/L bar per weekday, including losses.
  Mixed-sign plots include an explicit zero tick. Monthly detail retains separate
  sums of positive/negative net trade P/L after fees.
- The actual demo Gold Swing session contains 120 trades across every month of
  2021–2025. Its activity/recording timestamps remain September 2026. All-history
  monthly view shows 5 × 12 net heatmap cells; selecting a year shows 12 split bars.
  Twelve recorded zero months remain distinct from missing data without printed values.
- Two short demo sessions remain available. Prices, fees, realized R, balance and
  Equity reconcile to the same fixture ledger. No real trades or storage changed.

## Verification

- Focused Node suite: 21/21 PASS (demoMode, sessionPerformance, analyticsViewModel).
- Scoped Vite build PASS from tracked HEAD 3dbfbe5 plus five intentional source
  overlays. Existing ignored stylesheet inputs reused from the prior verified build;
  unrelated ReplayWorkspace/API acceptance WIP excluded. Existing chunk-size advisory remains.
- tests/reportPresentation.browser.mjs PASS on candidate5196 and deployed5180,
  using actual demo fixtures without API response substitution: 1920 dark VI,
  390 light VI with touch, 390 dark EN with mouse. Covered full calendar, year
  drilldown/return, split month values, blue daily series, zero focus/tap, hover,
  Escape/outside dismissal and chart/page overflow. No page errors or mutation requests.
- Initial QA failures retained under E: expansion/layout movement and queued scroll
  correctly dismissed hover hints; group bounds also included angled category text.
  The browser test now awaits disclosure animation, reveals the actual report-hit
  target and flushes queued scroll before interaction. No tooltip lifecycle workaround
  was added to product code. Tooltip screenshots are captured directly before any
  screenshot-triggered scrolling can dismiss them.
- Independent source and rendered review by session_report_review: no blocker.
  Reviewed desktop/mobile matrix, year detail, daily series and shared interaction evidence.

## Local rollout and limits

UI-only atomic promotion retained old hashed assets and private branding. See served.json
and ui-promotion-release.json for before/after hashes. Previous rollback index is kept in
E:/BACKUP-TRADINGWORKSPACE/report-tooltips-20261025/ui-before-release/.

At rollout inspection neither UI5180 nor API8010 was listening despite historical runtime
manifests. Restored only the canonical production UI preview on 5180 and verified its
served index hash. API8010 remains stopped; no API/terminal restart or broker calls were
performed. Source/shared component behavior and deployed demo render are verified;
real-account/backend integration was not revalidated in this UI-only follow-up.

Full logs, failed checks, scoped sources and screenshots remain in
E:/BACKUP-TRADINGWORKSPACE/report-tooltips-20261025/. The owned candidate5196 preview
is stopped after verification; UI5180 stays available. This receipt accepts only this
presentation slice, not the full product or broker execution.
