# Calendar-month totals and centered report scales — 25 October 2026

## Accepted changes

- Monthly P/L uses horizontal rows, at most twelve calendar months. Matching months
  from multiple years are summed (positive net trades, negative net trades, net P/L,
  count), never averaged. Complete dated API buckets remain intact. No heatmap/year
  picker; the shared tooltip gives the merged year range and full amounts.
- Signed month/day axes put zero at the exact midpoint, with equal positive/negative
  extents and equally spaced nice ticks. Narrow horizontal plots use three symmetric
  ticks instead of five. The daily net series remains blue, including losses.
- Year labels move below dated month labels in shared report charts. The heading no
  longer repeats a year. Yearless merged calendar-month rows use their tooltip range.
- Equity uses bounded cubic interpolation through the same observations and timestamps,
  split by account segment; controls cannot invent local extrema. Gold Swing demo
  market holdings are five days rather than minutes, while activity duration and all
  financial values remain unchanged. No real account data is modified.
- Desktop plots fill their common grid row; stacked/mobile plots retain intrinsic
  heights. Flex/min-height owns layout; an absolutely positioned SVG cannot expand
  its own measured box. ResizeObserver recomputes geometry using both dimensions,
  preserving text/marker scale without feedback or SVG affine stretching.

## Verification

24 focused Node tests PASS: reportChartModel, demoMode, sessionPerformance and
analyticsViewModel. Includes symmetric one-sided/zero/mixed domains, calendar grouping
with cancellation/missing/unknown values, immutable source buckets and bounded curve
sampling including duplicate timestamps.

Scoped Vite build PASS from tracked HEAD 3b58ae8 plus six intentional UI/model overlays.
Ignored style inputs reuse the previous verified scoped tree. Existing bundle-size
advisory remains. Unrelated ReplayWorkspace/API acceptance/evidence WIP excluded.

Actual demo browser QA PASS on candidate5196 and deployed5180 with no response
substitution: 1920 dark VI, 390 light VI touch, 390 dark EN mouse. Checks twelve
horizontal merged rows, exact January sums 780/-585/net195 over 2021–2025, centered
axis positions/equal ticks, month-year label placement, blue daily net bars, hover/
focus/touch/Escape/outside, real zero without fake bar, no overflow, bounded curve,
and desktop-height fill versus mobile250/296. No page errors or mutation requests.

Independent source/render review by session_report_review found the initial desktop
blank area below Equity/day. Fixed shared sizing, reran QA, and obtained final review
PASS with no blocker. Source/model review independently ran the three new model tests.

## Rollout and limits

Atomic UI-only promotion preserves previous hashed assets and private branding.
See served.json and ui-promotion-release.json for the served/rollback index hashes.
Rollback index, scoped sources, scripts, screenshots and logs stay under
E:/BACKUP-TRADINGWORKSPACE/report-months-centered-20261025/.

UI5180 remains available. API8010 was already stopped and remains stopped; no API,
terminal or broker restart/calls. Real backend/account integration is not revalidated
in this presentation slice. Only the owned candidate5196 preview is stopped after QA.
