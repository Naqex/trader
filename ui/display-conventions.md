# Time, money, search and report presentation

## Page rhythm and visible copy

`page-layout.css` owns the inset from shell navigation to the first component:
24px on desktop, 16px at widths up to 760px. Page wrappers must not add another
top margin or padding at that boundary; loading skeletons use the same inset.
Embedded reports, full-bleed panes with their own toolbar inset and full-screen
chart workspaces retain their own layout. Use 24px between major related sections,
16px within groups and 8px between adjacent controls; larger chart/panel gaps
are deliberate grouping, not accumulated wrapper spacing.

Remove secondary text that does not help an immediate decision or action.
Healthy reports must not show implementation explanations, generic legacy-data
notices, or a second sentence repeating the heading/empty state. Preserve honest
missing values, units, input labels, actionable loading/error/recovery and
consequential partial/stale/permission states. Diagnostics belong in existing
details only when useful; do not replace every removed sentence with a tooltip.

## Time ownership

### Analytics composition and calculation bases

Analytics groups each chart with its summary and controls. Performance follows
profit/loss, realized and ideal R, expectancy/profit factor, outcomes, side,
time-window radars, hour/day/month, calendar and frequency. Drawdown groups the
account path, four summary metrics, MAE distribution and winning-trade MAE.
Simulation groups configured SL, original-risk RR and Monte Carlo separately.
Use shared rounded chart domains and shape-preserving curves; interpolation
does not create price observations. Compact desktop reports use 16px panel insets
and gaps. On wide screens PnL occupies the left two thirds; realized R, ideal R
and profit/breakeven opportunity stack in the right third. The PnL plot fills the
available column height, keeping the two sides aligned. Below 1200px these groups
stack, with the main plot returning to a compact height; below 850px the R cards
also stack. The report tabs have no bottom separator. Hour/day
plots pair; the year/month matrix stays full width; calendar/frequency use 2:1.
Expectancy and winner/loser statistics share a 1:2 row; side and time-window radars
share the next 1:2 row. On screens up to 1200px the side/radar panels each use a full
row, with two radars per row; up to 600px radars stack. Calendar cells put the date
and trade count on one line, then the result below. Frequency pairs each summary
with its small plot. Drawdown pairs its main plot with four summary metrics, then
MAE with winning-trade metrics. Prop objectives pair snapshot metrics with their
existing objectives table on desktop and stack on narrow screens.

SL/RR simulations pair, with Monte Carlo below. Monte Carlo configuration uses a
left column and its results use the remaining width; they stack up to 850px.
Per-trade scenario details stay collapsed until requested and scroll within a
bounded table when opened. Smaller widths collapse groups without scaling down
data text. RR mini curves are 48px sparklines without axis labels; their points
retain tooltips and keyboard access. Other compact plots retain their axes.
Report panels do not show fullscreen controls. PnL shows only the four interval
controls in its heading, with no standalone currency or balance/PnL toggle.
Report tabs use content-width targets aligned left, with a gray active surface;
small screens distribute three equal targets. Filter triggers retain their names
without selected-count badges; applied values appear in the removable chip row.
Its six summary groups pair PnL/balance with inline percent changes, win rate,
trade count with superscript wins/losses, breakeven count and an inline threshold
input with an Apply action. Definitions use the shared SVG info icon, centered
in a consistent control box. Mobile radars use one column.
The PnL plot toolbar exposes zoom in/out, rectangle selection, pan and reset.
Zoom changes only the visible sample window, retaining original trade IDs, labels
and values. Dragging never selects a trade; a plain point click still opens its
inspector. +/- zoom, arrow keys pan and 0 resets when the plot has keyboard focus.
Changing the interval resets the visible window. Tooltip geometry and short/long
reading formats follow the shared project compact-system contract.
Definitions belong in accessible info controls, with no permanent explanatory
paragraphs. Do not render a report-level scope/provenance footer; original fields
remain available in the selected-trade inspector and exports.

Session Analytics requests market time; the trade ledger and research retain
activity time. Projection honors its declared `scope.time_basis`: market uses the
recorded chart close instant; activity uses recorded real closing activity.
`analytics_time_utc` is a view field and must never overwrite raw timestamps or
fill a missing activity timestamp from chart time. Calendar, time groups,
frequency and recovery use that declared basis and the selected display zone.
The current four radar axes are fixed close-hour windows, not named market
sessions. Monthly Analytics is a year/month matrix of totals; dashboard period
averages retain their separate contract. Percent of starting capital is explicit.

Main win rate retains wins/all closed trades, including breakeven. The local
breakeven threshold is an absolute net amount in account currency; it changes
classification and streaks without changing money, curves or saved trades.
RR Simulator win rate excludes breakeven. Undefined denominators show `N/A`.
Realized R joins verified observations per trade, retaining valid ledger/risk
samples when experiments cover only part of the set. The three compact RR cards
omit coverage fractions; unavailable values remain `N/A`. Visible labels use RR,
while the internal R unit and existing calculation contracts stay unchanged.
Sample mode uses the same report components, with deterministic synthetic ideal-RR
and opportunity values scoped to that mode. Add sample sections as they are built;
do not fabricate ready SL/RR simulation results for unfinished sample sections.

Equity drawdown uses the account equity path including floating P/L, resetting
peaks at source segment boundaries and preserving unknown gaps. Sampled/partial
paths are labeled as observed samples. A trade-filtered report cannot present
unfiltered account equity as filtered; use closed balance when that is the only
valid path. Neutral source-kind selection alone does not hide account equity.
Recovery uses elapsed 24-hour days from the prior peak to a verified recovery;
unfinished or missing-time episodes have no invented duration. Funding resets
start a new segment; carry policies and ordinary market losses do not.

SL experiments use the configured distance. RR experiments retain a stop proven
at entry by the opening checkpoint or its immediate synchronous price mark;
later protection edits are not entry proof. MAE/MFE R use this original distance,
not the configured experiment distance. Excluding ambiguous terminal-bar extrema
can make excursion a lower bound. SL/RR outcomes stop at original exposure and
the selected cutoff; unresolved rows stay absent, never zero. Comparison curves
use the same eligible trades and disclose eligible/total coverage.

Ideal R is the maximum costed closeable net P/L divided by original gross risk
over seven elapsed days after entry, ignoring subsequent SL/TP. A numeric result
requires a complete observed window at or before cutoff with a complete boundary
candle. Partial windows remain unavailable; even the best result can be negative.
The opportunity count includes only losing trades with complete coverage whose
best observed net amount is nonnegative. These are recorded OHLC opportunities,
not guarantees of tick execution. Monte Carlo retains seeded, bounded sampling
and stops each path at zero capital; statistics cover all runs, not only drawn paths.

Reference definitions: [FX Replay drawdown](https://support.fxreplay.com/articles/how-to-use-drawdown-analytics)
and [RR Simulator](https://support.fxreplay.com/articles/how-to-use-the-rr-simulator).

Persist instants as UTC ISO timestamps or UTC epoch values. Never rewrite bars,
ledger events or existing records to the owner's display offset. The workspace clock
and Settings use the browser preference `tw-timezone`, an IANA identifier; the default is UTC.
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

The sidebar workspace group shows the current wall-clock date/time including seconds,
updated each second and when returning to the tab. Click it for a searchable timezone menu; selection applies
immediately through the same store as Settings and persists locally. Its UTC offset
is calculated at the current instant, including DST; historical timestamps still use
the named zone's offset at their own instant. Keep the timezone with the workspace
clock rather than individual table footers. A collapsed sidebar uses a clock icon
and shows the full date/time in its menu; the mobile navigation drawer shows the
expanded clock. Chart workspaces without a sidebar retain the clock in their toolbar.
On narrow chart screens the zone name is hidden; the menu and accessible description
retain it. Search styling matches other shared FxSelect menus. The clock is never
the replay cursor or a candle timestamp. Second ticks stay local to the clock;
timezone option offsets refresh by minute, without a global store update per tick.

## Selection and trade labels

Use searchable checkbox lists for independent filter sets (sessions/accounts in
aggregate reports, assets, sides, outcomes, weekdays and labels). Choices within
one set use OR; different sets intersect. In Analytics, an empty asset/side/
outcome/day/label set means no restriction; report kinds retain
their explicit empty-set semantics. Keep one account for an active chart/order,
and one timezone, sort, currency or order type. Navigation uses links, not selects.
DataDesk provider still controls one catalog operation; its filter is intentionally
single until that operation and list filtering have separate state owners.

Analytics filter menus show the search and checkbox list directly, without a
second selection field. Display weekdays as Monday through Sunday (Thứ 2 to
Chủ nhật), preserving their numeric calendar values. The timezone control sits
between time and close-date filters, starts from Settings and commits to the same
browser preference on Apply. Session Analytics time/date filters use chart close
time; aggregate activity reports and the trade ledger use recorded closing
activity. Missing activity is never replaced with chart time. Hour ranges are
inclusive and may cross midnight. The hour/minute popup publishes edits before
outside-click dismissal so direct Apply cannot lose the last keystroke.
Equal applied filter values must preserve the draft across report/route refresh;
reset it only when the applied values themselves change.

Applied chips show readable filter values with per-filter removal and one clear-all
action when filters exist. Group the time endpoints and date endpoints separately.
The current session is report context, not a removable filter. Internal report
kind `app` is displayed as Backtest, not App; the kind filter only narrows the
current report source. Keep the existing net-after-fees breakeven category, separate
from unknown data.

`TradeLabelCell` reads workspace label definitions and revisioned per-trade
assignments from `/api/v2/trade-labels`. Labels are metadata and never change
replay execution or financial results. Blank cells reveal the affordance on
hover/focus. The popup supports search/create, multiple selections and global
rename/color/delete, then refreshes the shared label facets. Renames retain aliases
for existing filters; deleted names stay reserved to avoid reviving old labels.
Journal edits apply only their added/removed label delta to current assignments.
Unknown mutation outcomes require reading again; conflicts never overwrite a
newer assignment. Do not replace confirmed selections with a slower older read.
Analytics uses the same workspace label definitions from journal context, including
unused labels, their colors and selected legacy names. Provisioning default label
metadata does not assign a rating to any existing trade.

Dashboard Backtest/Prop/All keeps one Performance layout and changes only its
source scope. Aggregate projection retains ancestry to deduplicate inherited
fills; an explicit empty source intersection remains empty. Practice activity
uses the same selected sessions. MT5 account selectors share `mt5AccountName`:
verified login, environment and optional owner name; server/currency are details.
Live summary read errors/staleness take precedence over a cached connected label.
Last sync is the last successful data observation, not a connection expiry date.

## Shared controls and financial semantics

- Missing/unprovided/unset presentation uses the short `-`; known zero stays `0`.
  Use `N/A` only for a field that does not apply or cannot have a meaningful
  denominator, such as realized Return on an Open position or R without a risk
  basis. Explain the reason on hover/accessibility when context is insufficient.
  This convention never rewrites stored data or CSV null values.
- Select-all checkbox rows show selected/available counts for the whole available
  set, independent of the search text; disabled and stale IDs do not inflate them.
  Trades omits the footer total and uses a fixed `#` column numbered across pages
  in the current filtered/sorted order, not a persistent trade identity. Other
  footers may show a labeled result total. Timezone metadata uses the Settings
  IANA zone and offsets of the displayed
  observations, including both offsets when those observations cross DST.
- Grid sort icons reserve a stable slot. Left/right headings align their visible
  text with cell text; centered categories balance the icon slot. Money badge
  padding extends into the cell inset so its digits share the numeric text edge.
- Trades multi-sort adds a new column on ordinary click, toggles its direction
  in place on another click, and exposes a separate remove button. Priorities are
  explicit numbers; only the first has `aria-sort`. Active headers use a gray
  background, orange superscript priorities and an inset vertical divider,
  with full-cell hover and stable indicator/clear slots. The orange clear-all
  action replaces `#` while sorting. Clearing all
  restores source order. Full-scope filtering and ordered sorting precede paging;
  nulls stay last at each level and source order breaks equal ties.
- Trade column visibility is stored per workspace/table in browser localStorage,
  shared by aggregate/session/demo views of the same column schema. It survives
  reload on that browser, without cross-device sync. Validate stored IDs against
  current columns and recover malformed/stale preferences. Hiding a sorted column
  removes its criterion; reset restores all columns. Storage denial preserves
  interaction and displays an explicit persistence error.
- Trades includes Open exposure from the same validated session snapshot in its
  table projection, before filtering/counting/paging. Closed metrics and analytics
  exports retain their realized-only contract. Open exits stay missing; estimated
  floating P/L and close costs never substitute for realized Return or known fees.
  Session history reads Open from its requested checkpoint. Forked Open exposures
  remain distinct per selected session; closed-fill ancestry dedup stays intact.

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
  Average Monthly Performance uses horizontal rows, at most twelve calendar months,
  grouping matching months even when only one year is present. Axis labels never
  include a year. There is no year picker/heatmap.
  Preserve the full dated source projection; grouping is presentation, not data loss
  or a last-twelve-month limit. Divide each grouped profit/loss/net total by the
  number of dated months containing trades. Average Daily Performance shows one
  blue net P/L bar per weekday, dividing its total by distinct active local dates
  in Settings timezone. Count breakeven periods; exclude absent periods. This is
  a period mean, not a per-trade mean. Tooltips state the denominator. Weekdays
  without observations retain their category/tooltip and no numeric average.
  Bar axes include zero: positive-only data uses zero to a rounded maximum,
  negative-only data a rounded minimum to zero, and mixed signs symmetric bounds
  about zero. Split monthly axes consider each profit/loss segment, never net alone.
  Keep both bounds and zero visible; thin intermediate ticks in equally spaced
  intervals to fit the plot. All-zero bars show only a centered zero tick, without
  inventing nonzero bounds. Other numeric axes expand to round tick multiples;
  trade counts use whole numbers and win rates stay fixed at 0–100%.
  No-data months stay absent;
  a known zero remains accessible. Category density may thin labels, never bars.
  Equity curves use shape-preserving cubic tangents through each observed point;
  monotone runs do not flatten at every point. Bounded controls preserve real
  timestamps, account segments and observed extrema. Interpolation is visual, not
  new market observations or a replacement for the account Equity ledger.
- Closed-trade balance is **Số dư / Balance**, not Equity. Avg. win/loss is a
  realized payoff ratio, not planned Risk/Reward. Recent trade amounts remain
  net P/L; do not relabel money as ROI without a stated return denominator.
- Trade ledger Return columns use **Lợi nhuận** with the account currency, `%`
  and `R`. Money is net after costs; percentage uses explicit starting capital;
  R retains the source risk denominator. Mixed currencies stay identified per row.
  Net/gross money badges omit currency glyphs; their hover/focus tooltip and
  accessible name retain the row currency. Fees retain their currency context.
  Small nonzero returns use significant digits rather than rounding to zero.
  Gross P/L comes from the closing fill's frozen cost breakdown, with bid/ask
  spread already embedded in fills. Fee debit is rounded gross minus rounded net,
  preserving gross - fees = net; do not re-sum independently rounded components.
  Missing breakdowns stay unknown. SL/TP use the final closing-position snapshot,
  not an inferred opening level. Planned risk and R require a source denominator.
  Entry/exit headings distinguish **Thực tế / Chart**; the shared workspace timezone
  applies to timestamps using Settings, without repeating UTC in each heading.
  Session selection shows the dataset date range, not session creation date.
  Practice chart tooltips use elapsed hours/minutes; axes retain compact hours.
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
