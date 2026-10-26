# Drawdown vertical layout

26 October 2026. Direct owner request: use the reference's normal vertical flow
for this smaller report. This is a layout slice, not financial or broker acceptance.

## Changes and data flow

Drawdown alone uses one column: full-width account drawdown chart, four summary
metrics, full-width MAE chart, then three winning-trade MAE metrics. Reuse the
external group-heading contract; controls and help sit above surfaces. Summary
rows have no enclosing card. Charts have a260px drawing height when populated.
The first metric row uses four columns on desktop and two at850px and below;
winning-trade metrics use three columns and stack at600px and below.

The existing data model still supplies equity/closed-balance drawdown and the
excursion summary. Unit/basis state and formulas are unchanged. Missing MAE stays
empty/N/A. A longer vertical page trades the former compact2:1 desktop grid for
an easier top-to-bottom reading order matching the owner's reference. Mobile
summary values scope the shared typography token to16px to avoid splitting units.

## Verification

Build, scripts, reports, screenshots and private rollback:
E:/BACKUP-TRADINGWORKSPACE/analytics-drawdown-layout-20261026/.

- Scoped build PASS from HEADbf31b5a with two source overlays:FxAnalytics.jsx and
  fx-analytics.css. Accepted private CSS preserved; unrelated WIP excluded.
- qa.mjs PASS candidate and deployed:1920/1366/850/390/320 VI/EN dark/light, plus
  actual existing-session1920. Four blocks stack full width with24px gaps;
  metric row counts, title placement, USD/%, Equity/Balance, tooltip access,
  mobile computed16px, bottom reachability, no page overflow and Performance
  desktop2:1 geometry verified. No page errors or write requests.
- mae-states.mjs PASS: isolated valid-provenance populated fixture gives three
  0.4R winning metrics and a histogram; HTTP503 stays explicit withN/A values.
  No owner records changed. Earlier harness attempts failed because the SVG
  selector also matched the info icon, then because the fixture omitted the
  required schema/provenance; corrected the harness/fixture and reran successfully.
- Independent review ACCEPTED after mobile typography fix:1920/1000/390/320,
  actual-session200 terminal empty/N/A state and a separate populated fixture
  checking equity$-100 ->-10%, balance switch, MAE260px, winning0.8/0.2/1.4R.
  Initial local font-size fix was overridden by shared shell specificity; scoped
  token values now render16px. Reviewer viewed final320 screenshot and verified
  units no longer split mid-word. See reviewer/REVIEW.md and final evidence.
- Browser contexts allow localGET/HEAD only; external, MT5/live/events, writes
  and WebSockets blocked. This does not test broker execution.

## Local rollout

Guarded UI-only5180 promotion checked collisions, retained old hashed assets and
private branding, saved rollback and atomically replaced the index.
Before:fd7ecabce37770d951173d582e525e69be3d7cfec2c7ed99042a95072442bacf
After:42c0cde6cbf3ced14939af4d858164632939134910783a0cbb385e2588155e0f
Served hash matches candidate. Native/compact API8010 PID12616 and executable
SHA25672e297248e818880b8afebad2f5054e2d9114c8a515c6330a3347086c53cd064
remain unchanged; readiness OK. No API/terminal restart. Owned5196 preview stopped
only after process identity verification. Acceptance covers this UI slice only.
