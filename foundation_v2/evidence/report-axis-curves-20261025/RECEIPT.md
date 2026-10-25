# Shared report curves, scales and activity scope — 25/10/2026

## Changes

- Shared `ReportLineChart` uses shape-preserving cubic tangents through observed
  Equity values. It retains timestamps, account segments, duplicate-time jumps
  and extrema; it no longer forces a horizontal stop at every monotone point.
- Shared numeric axes expand to round tick multiples. Signed performance stays
  symmetric around zero; count axes use integers; win rate is fixed at 0–100%.
  Responsive tick thinning preserves equal steps and both endpoints.
- Dated month categories use horizontal `MM/YYYY`. Merged session history still
  has at most twelve calendar months, with the full year range in its tooltip.
- Dashboard titles are `Tỉ lệ thắng` and `Thời gian luyện tập`. Only the
  `Giao dịch đã thực hiện` metric loses its icon. Its value still counts completed
  trades, explained by the contextual tooltip.
- Aggregate win rate uses recorded real activity timestamps. Measured practice
  intervals now respect selected source/session and date bounds before union
  and Settings-zone month grouping, in both native fresh and cached reads.
- Historical replay duration stays the cumulative Backtest/Prop counter for the
  selected sessions. The persisted counter has no dated step breakdown, so its
  tooltip explicitly says whole-session; it is not apportioned by trade duration.
- Demo timing now has explicit activity intervals, source kinds and matching
  date/timezone filters. No timing is derived from the five-year market fixture.

## Verification

- Scoped Vite build: tracked HEAD web/UI plus nine intentional source overlays;
  excludes unrelated ReplayWorkspace, API script and dirty/private CSS changes.
  Existing verified private CSS baseline reused. No dependency changes.
- Web: 43 focused tests passed (`reportChartModel`, `demoMode`,
  `sessionPerformance`, `analyticsViewModel`, `dashboardModel`).
- Native: 16 analytics tests passed, including Python oracle parity, timezone/DST,
  clipping and interval union, known zero versus unknown, and separate clocks.
- Candidate and deployed browser: actual demo without response substitution,
  1920 dark VI, 390 light VI touch, 390 dark EN. Twelve merged rows, symmetric
  ticks, horizontal month/year labels, bounded curves, fixed percentage range,
  tooltip hover/focus/tap/Escape, zero values, no nested scroll/errors/writes.
- Desktop source/date journey: Backtest = 140 trades / 14h40m; Prop = 20 / 4h;
  All = 160 / 18h40m; 01/08/2026 = 1h30m measured activity; clearing restores
  18h40m. Chart layout stays shared across sources.
- Dense synthetic browser data: 24 months/symbols, dark/light, widths
  1920/1440/768/390 and resize back. No numeric tick overlap or nested scroll.
- Independent source/render review by `session_report_review`: accepted scoped
  UI promotion; no remaining actionable blocker.

Automation initially failed on two outdated localized locators. They were
corrected against current copy and the complete script rerun successfully.
Oversized mobile section captures included inner-scroll/sticky-header artifacts;
use the final per-chart activity/month/Equity captures for mobile visual evidence.
The first archive preparation used the wrong format; it was repaired before any
build or promotion. No active files were affected by that failed preparation.

## Rollout and limits

Local UI at port 5180 was promoted atomically with old assets and private branding
retained. Served index SHA-256:
`b8f215f1ff8b643291e502fe1ca1d9a7042eb80f611b54b117ca84a6eac9f18d`.

Build, source hashes, browser reports/screenshots, rollback index, promotion guard
and served receipt are under
`E:/BACKUP-TRADINGWORKSPACE/report-axis-curves-20261025/`.

API 8010 was already stopped despite its stale ready manifest. This task did not
restart API/terminals or contact a broker. Native activity-filter correction is
implemented and unit-tested but is not yet verified on a running real service.
UI components apply to real reports as well as demo; real-data integration and
whole-product/broker acceptance are not claimed.
