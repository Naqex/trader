# Analytics frequency and aggregation correction

27/10/2026. Owner: distinguish counts/totals from averages throughout Analytics;
fix the three frequency plots to show weekday, week number and month categories.

## Change and data flow

The previous implementation plotted raw counts per concrete date/week/month,
while the header averaged over the elapsed civil span including empty periods.
The model now groups dated filtered trades into distinct active dates, ISO
year-weeks and year-months, then produces category means and an independent
active-period-weighted header mean. Numerators/denominators have separate fields
`tradeCount`/`periodCount`; `average` is no longer stored in `count`.

Axes: T2–CN; observed ISO week numbers; T1–T12 (English month abbreviations).
Missing categories are unavailable, not zero. Fractional means remain visible.
Tooltips expose both numerator and denominator. Chart time-basis, filters and
timezone still own grouping; missing PnL does not erase a dated trade, and missing
timestamps remain unallocated with the existing partial indication.

Other Analytics plots retain their count/sum/ratio/mean contracts. The complete
classification and fresh source evidence are in
[the reference](../../../ui/references/fxreplay/analytics-frequency-and-aggregation.md).
Sessions and Prop consume the shared report after their existing scope fences.
Live adapters/calendar and financial return/risk formulas are unchanged.

## Verification and limits

- Scoped candidate: HEAD `71761a5` plus four source and six test overlays;
  unrelated worktree changes excluded. Vite production build passed.
- 86 focused model/chart/calendar tests passed; separate independent review
  reran 58 relevant tests, all passed, and found no remaining source issue.
- Preview and deployed browser checks: 8 cases each at 1920/1440/390px, VI/EN.
  Covers five-trade reference, multi-year fractional averages, 53-week density,
  partial/empty data, demo and an actual saved-session GET without mocked data.
- Real selected session: one dated trade produces 1/day, 1/week, 1/month;
  weekday T2, week 19, month T5. It still dates to 2003, not wall-clock time.
- Reviewed desktop/mobile screenshots. No overlapping frequency ticks/document
  horizontal overflow; only `.fx-content` owns vertical scroll.
- Additional existing `testingCopy.test.mjs`: 1 pass, 1 fail on pre-existing
  English P/L spelling policy. Compared against HEAD: same 19 violations, zero
  newly introduced violations. Locale nonempty/placeholder contracts all pass.
  This inherited copy-test failure is not reported as green or hidden.
- FX UI was read without refresh/navigation; refreshed public bundles were
  fetched without auth, not executed. Client field bindings/axes/demo values
  are confirmed; backend repeated-period denominators remain unverified.

## Evidence and rollback

`E:/BACKUP-TRADINGWORKSPACE/analytics-frequency-20261027/` contains `research.py`,
`public-source.json`, public assets, `fx-rendered.txt`, `build.py`, test/build logs,
`qa.mjs`, preview/deployed reports and screenshots, review notes and promotion.
Served index SHA-256:
`21030c9d28358414b0e4b196ee0d69d2ef5b4f331b68fca69b5dd1f1382bea20`.
Rollback: `ui-before-release/index.html` in the same directory. UI-only atomic
index promotion retained old assets/private branding and the running UI/API
processes. No FX/user-tab refresh, broker calls, simulations or trading writes.
