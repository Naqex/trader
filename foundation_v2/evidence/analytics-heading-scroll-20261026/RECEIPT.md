# Analytics external headings and scroll containment

26 October 2026. Direct owner request: put Performance group titles above cards,
restore group labels and remove the outer session-radar surface. Scoped UI slice;
financial data/model contracts and report selection state are unchanged.

## Behavior and composition

ReportSection optionally renders an external heading and a single content surface.
Expectancy/profit factor, winners/losers, side, sessions, hour/day/month, calendar
and average trade frequency have visible external group headings. Existing info,
partial-data state and hourly selector stay in those headings. Group accessible
names match visible titles. Frequency day/week/month titles, help and averages sit
above each bordered plot. Session radars retain four cards without an outer border.
Outcome cards retain green/red borders. PnL, Drawdown and Simulation retain their
established composition. External headings share a 38px minimum for desktop row
alignment and can wrap on narrow screens. One surface groups each related plot;
no financial adapter, request or calculation was changed.

## Double vertical scrollbar: cause and experiment

At1920x940, active5180 reproduced document scrollHeight1769 while body/root/app
were940 and fx-content was823 with2528px of content. Sessions sibling document
was940. The two monthly radio fieldset legends use absolute sr-only positioning
but had BODY as offsetParent: their1px boxes were at y1768.09 outside the scroll
container. Removing just those legends in an isolated browser reduced document
scrollHeight to940; adding position:relative to their fieldsets independently did
the same while preserving their accessibility. The source fix uses that containing
block. No document overflow hiding or scrollbar suppression was added. Existing
horizontal calendar/table scrolling is retained.

## Verification

Artifacts/scripts, private build and rollback:
E:/BACKUP-TRADINGWORKSPACE/analytics-heading-scroll-20261026/.

- Scoped Vite build PASS: HEAD11b3bda plus FxAnalytics.jsx, fx-analytics.css and
  testing-copy.json; previously accepted private learnIntegration/visual-polish
  CSS reused byte-for-byte. Unrelated ReplayWorkspace WIP excluded.
- qa.mjs PASS on candidate and deployed5180:1920/1366/1024/900/390/320,
  VI/EN, dark/light. Nine group headings outside their borders; three frequency
  headings above plots; four radar cards; twelve outcome infos.22 tooltip checks
  per case, selector interaction and monthly basis values verified. Document stays
 940px, content bottom reachable with no long empty tail, no horizontal page overflow,
  no invalid SVG geometry, JS errors or writes.
- actual.mjs PASS on candidate and deployed: existing-session financial/time
  projection, Performance/Drawdown/Simulation, Buy/Sell filter including empty
  result, and library regression. Seven journeys; no owner data mutation.
- states.mjs PASS on seven local intercepted fixtures: zero, missing capital,
  missing current snapshot, missing risk, empty, missing time and HTTP503. Partial
  state remains explicit. Document stays940px in each state.
- Independent review ACCEPTED. Reviewer used1920/1100/390/320 and existing-session
  Analytics/Sessions. Both legends now have FIELDSET offsetParent. Final hour/day
  body tops equal1393.90625 at1920; mobile headings wrap naturally. Review caught
  initial docs encoding drift, corrected before final review; no blocker remains.
  See reviewer/REVIEW.md, browser.json and final.json.
- All browser contexts allowed localGET/HEAD only; external/broker/live/events
  endpoints, writes and WebSockets were blocked.

## Local rollout

Guarded UI5180 promotion checked collisions, retained old hashed assets and private
branding, saved rollback and atomically replaced the index. Before:
066e0d75cdba7240ee8b84b746e6c200b1e534730a99262743a82841d8559f8f
After:
fd7ecabce37770d951173d582e525e69be3d7cfec2c7ed99042a95072442bacf
Served index matches the candidate. API8010 stays native/compact, PID12616,
SHA25672e297248e818880b8afebad2f5054e2d9114c8a515c6330a3347086c53cd064,
readiness OK. No API or terminal restart. Only owned5196 preview is stopped after
process-identity verification. Scope acceptance does not assert broker or whole
product completion.
