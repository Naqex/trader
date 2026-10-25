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
  Grid strokes share one color, dash and 1px width, with pixel-aligned rendering
  so fractional row/tick positions do not alternate between sharp and blurred.
  Horizontal bars fill 60% of their category row, adapting to the available height
  and row count rather than leaving a thin fixed-height bar in a mostly empty row.
  Bar values appear in the shared tooltip on hover, focus or tap, never printed
  over the plot. Keep scale/category labels. Zero has no artificial bar but retains
  an interactive category target and explicit tooltip value. Dated month labels
  use horizontal `MM/YYYY`, never a detached year beside the heading. Session
  summaries follow backtest time; aggregate performance and Journal follow real activity.
  Monthly P/L uses horizontal rows, at most twelve calendar months, summing matching
  months over every year in the selected scope. There is no year picker/heatmap.
  Preserve the full dated source projection; grouping is presentation, not data loss
  or a last-twelve-month limit. Tooltip includes the merged year range. It shows sums
  of positive/negative net trade P/L, not averages. Daily shows one blue net P/L bar
  per weekday, summing matching weekdays across the same selected scope.
  Signed performance axes are symmetric about zero with equally spaced nice ticks;
  mobile may use three symmetric ticks. Other numeric axes expand to round tick
  multiples; trade counts use whole numbers and win rates stay fixed at 0–100%.
  No-data months stay absent;
  a known zero remains accessible. Category density may thin labels, never bars.
  Equity curves use shape-preserving cubic tangents through each observed point;
  monotone runs do not flatten at every point. Bounded controls preserve real
  timestamps, account segments and observed extrema. Interpolation is visual, not
  new market observations or a replacement for the account Equity ledger.
- Closed-trade balance is **Số dư / Balance**, not Equity. Avg. win/loss is a
  realized payoff ratio, not planned Risk/Reward. Recent trade amounts remain
  net P/L; do not relabel money as ROI without a stated return denominator.
- Practice activity uses measured wall-clock intervals. Historical replay dates
  are a separate metric. Legacy entry recording time/type remains unknown unless
  an exact opening event and its recording metadata prove it.
  Dashboard source/session filters constrain both clocks. Activity date filters
  clip measured intervals before union/month grouping in Settings timezone, in
  both fresh and cached reads. Historical replay time remains a cumulative counter
  for those sessions, explicitly described as whole-session: it has no dated step
  breakdown and must not be apportioned from trade durations or wall-clock ratios.

Primary references: [PostgreSQL datetime](https://www.postgresql.org/docs/current/datatype-datetime.html),
[IANA zones](https://www.iana.org/time-zones),
[TradingView time and sessions](https://www.tradingview.com/charting-library-docs/latest/connecting_data/time-and-sessions/).
