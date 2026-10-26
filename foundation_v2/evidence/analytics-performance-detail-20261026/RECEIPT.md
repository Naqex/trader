# Analytics Performance detail

26 October 2026. Direct owner feedback: separate winner/loser cards, metric-owned
Buy/Sell help, market-session radars, reference hour/day/month charts and three
trade-frequency cards. This receipt covers this UI slice, not product or broker
completion.

## Behavior and data flow

- Winners/losers are separate green/red bordered cards with normal foreground
  headings, a 16px gap and all twelve existing metric info controls. Buy/Sell
  remains one group with Total trades and Win rate headings and localized help.
- The old four local-hour bands are replaced by the reference's published fixed
  UTC windows: Asia [00,09), London [07,16), New York [13,22), Outside [22,24).
  Axes follow Outside/Asia/New York/London. Overlap deliberately counts a trade in
  both eligible groups; no automatic DST/holiday adjustment is claimed. Report
  time basis stays authoritative: market close for backtests, recorded activity
  for activity reports. The info control explains these choices. Primary source:
  https://support.fxreplay.com/articles/what-are-the-trading-session-hours-that-fx-replay-takes-into-account-for-analytics
- Four bordered radars show win rate, count, average realized RR and percentage
  return. Known axis values remain visible when another rate/RR is unavailable;
  unknown values are never drawn as observed zero. Hourly choices are net P/L,
  average RR, return (%) and win rate. Daily has signed horizontal P/L bars plus
  a right-hand win-rate column and no dropdown.
- advancedAnalytics derives sourceNet per group and a fixed source capital pool
  from the input model before local filtering. Each source capital counts once
  across trades/assets/months. Hour/session return is net P/L / pooled initial
  capital * 100. Monthly accumulated-session gains sums each source's period
  return; overall gain divides total net by combined capital. Neither is a
  running/compounded time return. Mixed currencies cannot yield money-weighted
  aggregate percentages. Missing, conflicting or nonpositive capital is N/A.
- Monthly uses localized month names, YTD and Total rows. Initial uses source
  initial capital; Current uses an explicit portfolio_account.balance snapshot
  at the report cutoff, excluding floating P/L. The read projection and sample
  dashboard propagate that snapshot. Filtered initial+net is never substituted.
  Multi-source Current remains disabled because its source snapshots are absent.
- Three frequency cards pair their own title/help and average with blue bars.
  Existing day/week/month averages still include empty periods between first
  and last observations. Full period dates remain in point tooltips.
- Incomplete dated coverage shows a compact Partial data state on temporal
  panels with a known/total info control. Charts show the known subset; yearly
  and bottom Total aggregates stay N/A rather than implying complete allocation.
  Calendar dates/amounts never split digits on mobile; its labeled region scrolls
  internally when necessary. Sample and actual reports share these components.

## Verification

Scripts, full reports, source hashes, screenshots and private rollback:
E:/BACKUP-TRADINGWORKSPACE/analytics-performance-detail-20261026/.

- Scoped candidate from HEAD f518681 plus eight intentional source overlays and
  previously accepted private CSS baseline: build PASS. No dependency changes.
- 54 focused Node tests PASS: capital aggregation/uniqueness, multi-source,
  missing/conflicting/zero/mixed-currency capital, explicit snapshot requirement,
  undated financial totals, session boundaries/DST/display-zone invariance and
  previous financial/time/curve contracts.
- qa.mjs: six 1920/1366/1024/900/390/320 light/dark VI/EN cases PASS, seventeen
  new metric/help controls per case; selector options, monthly bases, expected
  9.6% initial -> 8.76% current, colors, gaps, no overflow/NaN/errors/writes.
- states.mjs: seven isolated response fixtures PASS: zero, missing capital,
  missing current snapshot, missing risk, empty, undated and HTTP503. Fixtures
  are local interception only; owner records were not changed.
- Independent review ACCEPTED after required fixes. Reviewed math/boundaries,
  three browser widths, snapshot provenance, VI/EN partial coverage, all bottom
  totals N/A and actual keyboard calendar scroll at320. Earlier findings remain
  recorded in reviewer/REVIEW.md; all are resolved on rebuilt candidate.
- actual.mjs: seven existing-session GET-only journeys PASS on candidate and
  deployed UI: actual net/time basis, three report tabs, Buy/Sell filters and
  library regression. External, MT5/live/events and all writes were blocked.
- Tooling doctor PASS is readiness only, separate from product evidence.

## Local rollout

UI5180 guarded promotion retained old hashed assets and private branding, checked
collisions and atomically replaced index.html. Before index:
f29a0da131abee6d385d22fe8ed475d4a53159f26811bd663b17045ee69bf55f
Deployed index:
066e0d75cdba7240ee8b84b746e6c200b1e534730a99262743a82841d8559f8f

Native/compact API8010 PID12616 executable/identity/hash/readiness verified;
executable SHA25672e297248e818880b8afebad2f5054e2d9114c8a515c6330a3347086c53cd064.
No API or terminal restart. Deployed served bytes match candidate; deployed six
responsive cases and seven existing-session journeys PASS. Only the owned5196
preview is stopped after checking its process identity. No broker calls or saved
owner-data changes. Source/fixture/runtime acceptance is limited to this slice.
