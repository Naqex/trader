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
- Closed-trade balance is **Số dư / Balance**, not Equity. Avg. win/loss is a
  realized payoff ratio, not planned Risk/Reward. Recent trade amounts remain
  net P/L; do not relabel money as ROI without a stated return denominator.
- Practice activity uses measured wall-clock intervals. Historical replay dates
  are a separate metric. Legacy entry recording time/type remains unknown unless
  an exact opening event and its recording metadata prove it.

Primary references: [PostgreSQL datetime](https://www.postgresql.org/docs/current/datatype-datetime.html),
[IANA zones](https://www.iana.org/time-zones),
[TradingView time and sessions](https://www.tradingview.com/charting-library-docs/latest/connecting_data/time-and-sessions/).
