# Chart time navigation and separate calendar interaction

Status: scoped UI source, fixture, visual and deployed checks PASS (2026-10-28).

## Changed behavior and state

- PnL defaults to All and keeps raw closed-trade observations/cumulative values.
  Day/1 hour/15 minutes select trailing windows ending at the last observation.
  Preset state controls the normalized chart range; manual zoom/brush/pan becomes
  custom and Home/0 restores All. No trade aggregation, new observations or PnL reset.
- Elapsed-time axis chooses day/month/year or intraday ticks from range and plot
  width. Actual text measurement prevents overlap; intraday clocks retain a date
  context. Subsecond detail and DST-fold offsets are supported. Zoom-out stops at
  the original data extent; it does not invent a century-scale domain.
- Chart toolbar remains visible. Existing Prop thresholds and point inspector remain.
- Analytics date cells are display-only, with no hover, tooltip, click or daily
  detail panel. Navigation and metric/capital controls remain functional.
- Live date cells show a circled plus on hover/focus (visible on touch) and open
  a right modal note drawer. Date/trades come from the selected filtered calendar
  data; title/body are component-local drafts. Close/Escape restores focus and
  discards the draft. No note persistence or API writes are implemented.
- Missing/partial Live coverage remains unknown/partial, never a manufactured
  no-trades claim. Shared financial formulas and palette compact0.2.0 are retained.

## Verification

- Scoped HEAD archive + intentional overlays build PASS, dependencies reused.
- 13 unit tests PASS: chartTimeAxis6 + reportChartModel7.
- Candidate: time-axis3, calendar7, Prop PnL9, loading9 and Live drawer4 journeys PASS.
- Deployed5180: time-axis3, calendar7 and Live drawer4 journeys PASS.
- Representative widths390/768/800/1440/1920; drawer VI/dark + EN/light screenshots
  reviewed. Screenshots are retained under the E drive task directory.
- Independent chart and calendar source/screenshot reviews PASS. Reviewers read
  parent browser evidence; chart reviewer separately ran6 time-axis unit tests.
- Native/compact API PID22824 ownership path/hash verified; API/UI processes retained.
  Atomic UI index promotion and served index/palette hash verified. Old assets and
  private branding/mutable files preserved; concrete rollback index in promotion.json.

Failed checks were retained in E:/BACKUP-TRADINGWORKSPACE/chart-time-calendar-20261028:
old fixture selectors/oracles were corrected; real tooltip consistency, CSS title
font, mobile fractional labels and narrow DST fallback defects were fixed and rerun.

## Scope limits

Browser Live checks use labeled GET fixtures and block mutations; there was no
broker action or real note write. Calendar checks include a real read-only Session
report. This receipt is scoped acceptance, not all-product/broker acceptance.

Runtime assets/builds/backups: E:/BACKUP-TRADINGWORKSPACE/chart-time-calendar-20261028.
