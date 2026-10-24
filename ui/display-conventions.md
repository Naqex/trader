# Time, money, search and report presentation

## Time ownership

Persist instants as UTC ISO timestamps or UTC epoch values. Never rewrite bars,
ledger events or existing records to the owner's display offset. Settings owns
the browser preference `tw-timezone`, an IANA identifier; the default is UTC.
`timezone.js`, `dateFormat.js` and `useTestingLocale` are the frontend owners.

- Use `displayDate`/`displayTime` for instants; avoid the host machine's implicit
  zone. Date-only values are civil dates and must not shift to the previous day.
- Use `InstantDateInput` for editable UTC instants and `ProjectDateInput` for
  civil dates/times. Missing or ambiguous DST wall times require an exact value
  entered in UTC; do not silently choose an offset.
- Date filters resolve local day boundaries to UTC, including 23/25-hour days.
  API analytics requests include the named zone, and caches include it too.
- Native chart timezone changes presentation only; bar epochs and exchange
  sessions stay unchanged. D/W/M anchors follow the vendor's UTC bar contract.
- Broker history/import contracts, fixed UTC report intervals and Prop reset
  rules retain their declared zones. They are domain rules, not user preferences.
- Remove redundant UTC suffixes. When a zone is necessary, show the selected
  IANA name or an offset calculated at the displayed instant, not today's offset.

Settings currently offers zones supported by the installed native chart library.
The preference is local to the browser, not synchronized to a user profile.
CSV retains its explicit UTC column contract.

## Selection and trade labels

Use searchable checkbox lists for independent filter sets (sessions/accounts in
aggregate reports, assets, sides, outcomes, weekdays and labels). Choices within
one set use OR; different sets intersect. In Analytics, an empty asset/side/
outcome/day/label set means no restriction and displays All; report kinds retain
their explicit empty-set semantics. Keep one account for an active chart/order,
and one timezone, sort, currency or order type. Navigation uses links, not selects.
DataDesk provider still controls one catalog operation; its filter is intentionally
single until that operation and list filtering have separate state owners.

`TradeLabelCell` reads workspace label definitions and revisioned per-trade
assignments from `/api/v2/trade-labels`. Labels are metadata and never change
replay execution or financial results. Blank cells reveal the affordance on
hover/focus. The popup supports search/create, multiple selections and global
rename/color/delete, then refreshes the shared label facets. Renames retain aliases
for existing filters; deleted names stay reserved to avoid reviving old labels.
Journal edits apply only their added/removed label delta to current assignments.
Unknown mutation outcomes require reading again; conflicts never overwrite a
newer assignment. Do not replace confirmed selections with a slower older read.

Dashboard Backtest/Prop/All keeps one Performance layout and changes only its
source scope. Aggregate projection retains ancestry to deduplicate inherited
fills; an explicit empty source intersection remains empty. Practice activity
uses the same selected sessions. MT5 account selectors share `mt5AccountName`:
verified login, environment and optional owner name; server/currency are details.
Live summary read errors/staleness take precedence over a cached connected label.
Last sync is the last successful data observation, not a connection expiry date.

## Shared controls and financial semantics

- `SearchInput` owns search appearance and Escape clearing; preserve native
  composition and accessibility. `matchesSearch` normalizes Vietnamese accents,
  case and whitespace, matching every query token. Server session search follows
  the same rule. Refreshes retain existing rows and disable stale mutations.
- `formatAmount` renders USD with `$`; other currencies retain their identity.
  Missing or malformed amounts stay unknown, never zero.
- `ReportLineChart`/`ReportBars` own report chart layout, dashed grids and color
  accents. Preserve signed losses and readable mobile axes; label bounded period
  summaries with their displayed/total count rather than hiding the truncation.
  Put compact values inside bars when they fit with padding; otherwise place them
  immediately outside. Tooltips/accessibility retain full amounts. Zero has a
  muted `0` at the baseline and no artificial bar. Month buckets never merge years:
  one year in the heading, or `MM/YYYY` across years. Session summaries follow
  backtest time; aggregate performance and Journal follow real activity time.
  Monthly/daily performance separates sums of positive/negative net trade P/L.
  Multiple-year monthly history uses a year-by-12-month net heatmap, with a year
  selector/cell drilldown to split bars. Preserve the complete calendar projection;
  do not silently reuse a last-12-month slice as an all-history view. More than six
  months in one year use a fixed-height vertical plot. No-data months and recorded
  zero P/L have distinct states; density may thin labels, never data bars.
- Closed-trade balance is **Số dư / Balance**, not Equity. Avg. win/loss is a
  realized payoff ratio, not planned Risk/Reward. Recent trade amounts remain
  net P/L; do not relabel money as ROI without a stated return denominator.
- Practice activity uses measured wall-clock intervals. Historical replay dates
  are a separate metric. Legacy entry recording time/type remains unknown unless
  an exact opening event and its recording metadata prove it.

Primary references: [PostgreSQL datetime](https://www.postgresql.org/docs/current/datatype-datetime.html),
[IANA zones](https://www.iana.org/time-zones),
[TradingView time and sessions](https://www.tradingview.com/charting-library-docs/latest/connecting_data/time-and-sessions/).
