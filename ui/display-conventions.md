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
market-session radars, hour/day/month, calendar and frequency. Drawdown groups the
account path, four summary metrics, MAE distribution and winning-trade MAE.
Simulation groups configured SL, original-risk RR and Monte Carlo separately.
Monte Carlo is shared by Sessions and Prop attempts using their filtered scope;
six main inputs configure paths. The simulator uses its normal distribution,
measured gain/loss deviations as internal defaults. Each user run draws a fresh
seed; the engine records it in the returned config for reproducibility.
Default normal draws use measured gain/loss deviations (negative magnitudes
clamped to zero); win rate excludes breakevens. The section help exposes the
measured deviations and states they stay fixed when editing the centers. It also
explains that clipping shifts the effective mean and zero draws are breakeven,
so branch win rate is not the realized proportion of positive outcomes. Missing
measurements use the explicit assumptions described below;
currencies cannot be mixed, and paths stop at zero balance. The plot connects
trade indices with straight segments and shows at most 30 paths; eight summary
metrics use all runs. No-loss Profit Factor is infinity, never profit divided by
an invented loss of one. It does not evaluate Prop daily limits or pass odds.
Use shared rounded chart domains and shape-preserving curves; interpolation
does not create price observations. Compact desktop reports use 16px panel insets
and gaps. On wide screens PnL occupies the left two thirds; realized R, ideal R
and profit/breakeven opportunity stack in the right third. The PnL plot fills the
available column height, keeping the two sides aligned. Below 1200px these groups
stack, with the main plot returning to a compact height; below 850px the R cards
also stack. Hour/day
plots pair; the year/month matrix stays full width; calendar/frequency use 2:1.
Expectancy and winner/loser statistics share a 1:2 row. Expectancy and PF each
have one surface, stacked with a 16px gap under their shared external heading;
their combined height matches the winner/loser cards. Within the expectancy card, the metric sits on the left and the average win/loss bar and values on the right; up to 420px they stack to keep amounts readable. Side and market-session
radars share the next 1:2 row. Side count and win rate each have one surface,
with no outer border. Above 1500px the two side cards and four radar cards share
the same width, top and bottom, with 16px gaps. At 1201–1500px they form three
aligned columns over two rows. On screens up to 1200px the side/radar panels each use a full
row, with two radars per row; up to 600px radars stack. Calendar cells put the date
and trade count on one line, then the result below. On mobile the date stays
on one line; amounts never wrap digits, and the calendar scrolls internally
when the seven columns need more space.
Calendar navigation permits empty months and year steps. Analytics adds a compact
12-month Year view and read-only daily trade details. Both Analytics and Live use
the same Monday-first grid, navigation and day presentation; each retains its own
data adapter. Analytics keeps dated rows with unknown PnL in both the day count
and frequency. Net/win-rate summaries are unavailable for
incomplete financial data; unknown-time or partial sources also prevent complete
period totals. Average R in daily details weights only known R observations and exposes coverage.
The calendar menu contains net P/L, return (%) and return (R). Daily return (R)
sums each trade's original-risk realized R; any missing R makes it N/A.
Percentage uses pooled source initial capital or day-opening capital: initial
capital plus all earlier local days' net P/L before local chart filters.
Day-opening requires explicit unfiltered full history, complete dates and known
prior P/L; mixed currencies and nonpositive source capitals remain N/A. This is
a closed-trade balance path, excluding floating P/L and cashflows.
Capital radios appear only for percentage, with the precise Day-opening label.
Empty calendar dates show only the date, with no dash or manufactured zero money. Actual dated data keeps known zero and N/A distinct. The percentage definitions are local contracts, not proof of FX backend parity. Live keeps its weekly totals, full-day
coverage/partial semantics, account selection and notes/reviews.
Performance group headings sit above their bordered content, with help and controls
in the external heading. Expectancy/profit factor, winners/losers and side each
retain one visible group heading. Session radars have no enclosing surface; only
the four radar cards are bordered. Frequency has a visible group heading above
three cards; each day/week/month title, help and average sit inside its border,
with the average on the right. On desktop the three cards share the calendar row
height and finish at the same bottom; narrow layouts stack without fixed heights. Averages
use distinct periods with trades; inactive periods do not enter the denominator. Drawdown uses one vertical flow: a full-width account drawdown plot, four summary
metrics in a row, a full-width MAE plot, then three winning-trade metrics in a row.
The drawdown basis is automatic: declared applicable equity when available, otherwise closed balance, with the source named in the heading; no basis switch. Its titles/help/controls sit above the chart surfaces, with no outer surface around
the summary rows. The four metrics become two columns at 850px and below; winning-trade
metrics stack at 600px and below. Prop keeps the shared Performance, Drawdown and Simulation tabs.
In Performance, the full-width orange-outlined objectives table follows Profit and loss/RR and precedes Expectancy & Profit factor. Its three columns are objective, result and status; row buttons reveal reference details. Evaluator scope stays independent of chart filters. Amounts and percentages use evaluator references, with unknown states for incomplete or mismatched-phase snapshots.

Simulation uses three full-width sections stacked in order: SL, RR, Monte Carlo.
Each starts with a short introduction and an explicit Run action. After running,
SL/RR show scenario chips, a chart and an always-open scenario comparison table without a
repeated table heading. Do not insert numeric configuration or summary metrics
between the chips and chart. Run computes all current scenario configurations
sequentially through the existing read-only experiment adapter, with one abort
scope for the batch. Failed scenarios retain successful results and can be retried.
Selecting a cached chip highlights its curve and table row without another read. Added scenarios
compute only missing values; loading and retry stay within that tool.
The current-SL 0% chip cannot be removed. Other chips reserve no remove-button
width at rest and expand on hover or keyboard focus; touch reveals it on focus.
The blue Add scenario action stays available beside the wrapped chip list and
opens the existing centered modal. It accepts multiple unique SL reductions
(whole numbers 0–99%) or positive RR targets up to 100R. Confirm adds and sorts
them, computes uncached values and selects the last entered scenario;
Cancel/Escape discards edits. Removing the last RR hides its old chart/table;
adding a cached RR back restores results without trapping the view in Intro.
Default colors stay stable when scenarios are added or removed. These choices
live with the mounted report, like its simulation result. SL/RR plot cumulative R
against market close dates in the selected timezone, sorted without reordering
the table. Dates use shared `displayDate` (`dd/MM/yyyy`) on axes and tooltips, with
label density reduced on narrow screens. There is no ordinal/Start anchor.
Every computed active scenario has a line using the same color as its chip;
highlight the selected line. The common eligible trade sample aligns all lines
and the ranking. Missing risk/dates or unresolved outcomes stay outside this
sample, with explicit coverage. Every line uses each trade's original-risk
denominator; no capital-percentage denominator is invented. There is no separate
Gốc/Mô phỏng legend or extra baseline. Hover/touch points and keyboard endpoints
identify the scenario, date and R. The table
uses shared DataTable styling and its horizontal rules reach both panel edges;
numeric columns align right. Each completed active scenario has one row: configuration,
win rate, total R, profit, profit factor and average drawdown, with accessible
header help. Unresolved trades stay outside the common sample and its coverage
count remains visible. Profit is unavailable for missing or mixed currencies.
Profit factor divides winning R by absolute losing R; positive winnings with
no losses give infinity. Average drawdown uses peak-to-trough episode depths in
cumulative R, includes an open episode and ends an episode at a new high; display
its magnitude as negative R. Win rate excludes known breakevens.
Results sit below the chart and above the table. Rank completed active SL scenarios
lexicographically by R profit factor descending, drawdown magnitude ascending,
total R descending and win rate descending, after rounding displayed metrics.
When any eligible reduction is below 80%, exclude reductions of 80% or more from
recommendation and best-cell selection. Exact ties retain active scenario order,
matching the reference. RR ranking uses profit in place of total R, followed by
win rate and average winning R. Missing money prevents a complete RR ranking.
One comparable run or no common sample cannot establish a winner. Cache compact
eligible observations and table outcomes within the mounted report scope, not
full experiment payloads. The owner explicitly requested both amber rows to stay
visible: the first reports insufficient source wins/losses (at least five of each)
or states that reliability threshold as conditional guidance; the second reports
actual excluded coverage or confirms complete coverage. Do not invent missing
price data or initial-stop reasons the adapter cannot distinguish.
Horizontal-only scenario tables opt into DataTable `scrollAxis="x"`: contain
horizontal overscroll but allow native vertical chaining to the page, including
when the table has no vertical overflow. Keep the default containment for bounded
and virtual tables; do not intercept wheel events to simulate page scrolling.
Monte Carlo keeps its configuration, summary,
reset and rerun controls. Tables contain horizontal overflow while vertical
scroll belongs to the page. Smaller widths collapse groups without scaling down
data text. Monte Carlo starts at 100 runs of 100 trades. Its editable capital,
mean win/loss and win rate use measured scope data rounded to two decimals;
missing values use explicit assumptions of 10,000 capital, 100 win/loss and 50%
win rate, described in the section help. Missing group deviations use zero;
mixed/unknown account units remain disabled. Reset restores these defaults.
Validate on submit using shared inline field errors, then update errors as the
draft changes. Keep the engine's 250,000-step cap and focus the first invalid
field. Do not show the browser's native validation popup.
Before a successful run, keep the chart frame with only a zero gridline, a
currency-symbol zero tick (USD uses `$`) and one centered `0` on the horizontal
axis; do not invent paths, dots or area fills. Result metrics remain zero until
a run. Results have an accessible group label without a repeated visible
heading between the plot and metrics. The eight metrics use a flat four-column/two-row grid (two columns below
850px), with single full-width/height separators meeting the panel boundary,
without individual rounded cards or gaps. RR mini curves are 48px sparklines without axis labels; their points
retain tooltips and keyboard access. Other compact plots retain their axes.
Report panels do not show fullscreen controls. PnL shows only the four interval
controls in its heading, with no standalone currency or balance/PnL toggle.
Report tabs span the full shell content width, including the page gutters, with
three equal 44px targets.
The selected tab uses blue text, a subtle blue surface and a 2px blue indicator;
a muted project-line baseline spans the full strip below the blue selected indicator. Filter triggers retain their names
without selected-count badges; applied values appear in the removable chip row.
Its six summary groups pair PnL/balance with inline percent changes, win rate,
trade count with a small elevated wins/losses pair (10/8) and a mini info control
explaining the order and exclusion of breakeven, breakeven count and an inline threshold
input with an Apply action. Definitions use the shared SVG info icon, centered
in a consistent control box. Mobile radars use one column.
Session radars retain session names and grid rings without numeric scale labels
or persistent per-session values. Hover, keyboard focus and touch expose each
session's formatted value and unit; unavailable values retain a visible N/A.
Each radar retains its own metric domain; shapes do not imply a shared scale.
The PnL plot toolbar exposes zoom in/out, rectangle selection, pan and reset.
Zoom changes only the visible sample window, retaining original trade IDs, labels
and values. Dragging never selects a trade; a plain point click still opens its
inspector. +/- zoom, arrow keys pan and 0 resets when the plot has keyboard focus.
Changing the interval resets the visible window. Tooltip geometry and short/long
reading formats follow the shared project compact-system contract.
PnL axis labels use compact dates, full years across year boundaries and local
times within a single day. Tick density follows plot width; repeated dates are
thinned, the baseline has no visible text and point tooltips keep full timestamps.
PnL uses elapsed-time spacing when report timestamps are complete and ordered;
its initial-state anchor shares the first observation's time. Missing/reversed
times retain observation order; no daily samples or earlier timestamps are invented.
RR cards omit duplicate section headings. Each metric owns its info control.
The opportunity card pairs its count with maximum ideal RR across all eligible
filtered trades, including winners and losers, as stated in its tooltip.
Expectancy/profit factor and winner/loser groups show their titles outside the
content surfaces. Winners and losers each have one count row;
all six metric rows own their help controls. Best and average win/loss are
percent returns: net PnL after fees divided by the source session's initial
capital, multiplied by 100, matching the trade ledger. Compute each trade's
percentage before taking an extreme or arithmetic mean. A multi-session report
never substitutes an aggregate capital base. A missing/nonpositive denominator
in any trade of a group makes that group's percentage summaries N/A; empty
groups remain N/A. Breakeven classification applies before grouping. Durations
use market entry/exit timestamps; streaks follow the filtered trade order and
breakeven breaks a run. Expectancy remains net money per closed trade (including
breakeven). The Performance profit-factor gauge uses all positive net PnL divided
by the absolute sum of all negative net PnL in the filtered rows, after fees;
the local breakeven threshold does not remove small amounts from that ratio.
No trades or all zero PnL gives 0; profits without losses show infinity; losses
without profits give 0. Missing PnL remains N/A. The number is uncapped; the blue
ring fills by min(PF/4, 1), starting at the top. Four is an owner-selected visual
cap, not a performance grade. There is no PnL legend or split-color donut here.
Other report/simulation ratio contracts remain unchanged. The expectancy comparison bar shows average win/loss amounts without repeated
visible labels; its accessible name identifies each amount. The metric value
omits the per-trade suffix because the label and help define the unit. Its
divider spans the card interior edge to edge; the two metrics stay vertically
stacked at every width. Average-win and average-loss amounts beneath the bar
use the positive and negative chart colors respectively. Winners and losers are separate cards with green/red borders, normal foreground
headings and a 16px gap. They have no combined outer border or central divider.
The Buy/Sell group remains one card; each ring owns a Total trades or Win rate
heading and info control below the external Performance by side group heading. Buy/Sell win rates
are independent percentages, not two shares of a total.
Side counts use a teal Buy / blue Sell donut with percentage labels on sufficiently
large arcs, legends above and no center count. Side win rates use independent
concentric tracks with a gray remainder for each side; missing rates remain N/A.
Side rings use a compact 150px desktop size so the bordered card aligns with the
session radar cards. Between 1201px and 1500px, the two side plots stack alongside
the two-row radar group. Daily plot gridlines run horizontally between weekdays;
the currency remains in money tooltips, without a standalone USD label. Monthly
controls use the compact labels Cộng % phiên / Tổng thể (%), with the full
definitions in their existing help controls. Vietnamese YTD is Tổng năm. Expectancy
bars omit zero-width segments so a single gain/loss segment fills both rounded ends.
Monthly results use separated rounded header/value tiles and one bottom-right
Total, rather than monthly totals across years. Initial/Current selects the capital
basis and Accum./Overall selects sum of source returns versus pooled return.
Current requires a valid account snapshot; it never uses filtered ending balance.
Year and grand totals remain N/A when temporal/financial coverage is incomplete.
Analytics calendar places its metric control above month/year navigation and view
toggles, with no period-total footer. Live weekly totals/coverage remain intact.
Monthly radio fieldsets contain their visually hidden legends within their own
positioned bounds, so only the shell content scrolls vertically.
Trade frequency uses active-period means: weekday T2–CN, ISO week numbers and
calendar months T1–T12. Header average is total trades / distinct active periods,
not the mean of category bars. Empty categories have no bar, not an observed zero.
Tooltips distinguish the mean, trade count and active-period denominator; decimal
means remain visible. See `references/fxreplay/analytics-frequency-and-aggregation.md`.
Hourly controls offer net P/L, average RR, return (%) and win rate. Daily
performance has no metric selector: signed horizontal net P/L bars pair with a
right-hand win-rate column. Each group retains its explanatory info control. PnL interval controls have a visible
1px border; its plot reserves only 8px at the right edge in addition to the card
inset, retaining end-aligned tick labels.
Definitions belong in accessible info controls, with no permanent explanatory
paragraphs. Do not render a report-level scope/provenance footer; original fields
remain available in the selected-trade inspector and exports.

Session Analytics requests market time; the trade ledger and research retain
activity time. Projection honors its declared `scope.time_basis`: market uses the
recorded chart close instant; activity uses recorded real closing activity.
`analytics_time_utc` is a view field and must never overwrite raw timestamps or
fill a missing activity timestamp from chart time. Calendar, time groups,
frequency and recovery use that declared basis and the selected display zone.
The four session radar axes follow the reference's published fixed UTC windows:
Outside session [22,24), Asia [00,09), New York [13,22), London [07,16).
The declared report timestamp remains authoritative (market close for backtests,
activity close for activity reports). Display-zone changes do not change these
UTC groups. Overlapping trades count in each eligible session; group totals
must not be added. This convention has no automatic DST or holiday adjustment.
Each of the four bordered radar cards owns help: win rate, trade count, average
RR and percentage return. Missing rates/RR stay N/A; known points remain visible.
Percentage returns use a fixed source capital pool from the input report, not a
capital sum repeated per trade or a denominator recomputed for each hour/session.

Monthly Analytics is a percentage matrix with localized month names, year YTD
and a bottom Total row. Accumulated session gains means the sum of each source
session's period net P/L / source capital * 100, not a running time total.
Overall gain means period net P/L / combined source capital * 100. Each source
capital counts once, across assets and months; unknown/conflicting/nonpositive
capital stays N/A. A money-weighted aggregate never sums different currencies.
Initial balance uses source starting capital. Current balance requires an explicit
portfolio account snapshot at the report cutoff, excluding floating P/L;
filtered initial+net is not an account snapshot. Without a snapshot for every
source the Current option is disabled, with help explaining the requirement.
Time-group panels show a compact Partial data state when any selected trade lacks
a usable report timestamp or P/L. Charts show the known subset; year/Total values
stay N/A when allocation is incomplete.
Monthly/year/Total values use the same aggregation and capital basis; empty
months show a dash. Dashboard period averages retain their separate contract.
Reference session hours: https://support.fxreplay.com/articles/what-are-the-trading-session-hours-that-fx-replay-takes-into-account-for-analytics

Main win rate retains wins/all closed trades, including breakeven. The local
breakeven threshold is absolute realized R on valid original risk; it changes
classification and streaks without changing money, curves or saved trades.
At a nonzero threshold, missing R leaves classification unknown. Classification
totals/rates stay unavailable while financial values and dated frequency survive.
Zero net PnL remains known breakeven; threshold zero needs no risk denominator.
Profit factor always uses all positive/negative net amounts, independent of threshold.
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
- Sortable grids share multi-sort: add a new column on ordinary click, toggle its direction
  in place on another click, and exposes a separate remove button. Priorities are
  explicit numbers; only the first has `aria-sort`. Active headers use a light orange
  tint, orange superscript priorities and separate inset orange outlines,
  with full-cell hover and stable indicator/clear slots. The orange clear-all
  action has its own border and tint and replaces `#` while sorting. Clearing all
  restores the grid's default order. Full-scope filtering and ordered sorting precede paging;
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
  an interactive category target and explicit tooltip value. Analytics hour/day
  plots may use a thin neutral mark at the exact zero coordinate for observed
  groups with a known zero metric only; absent/unknown groups never get a mark. Weekday win rates
  use green badges for known percentages (including 0%); N/A remains unbadged. Dated month labels
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
  Sessions' three period summary cards show whole-session mean net PnL per active
  day, Monday–Sunday week and dated year-month in Settings timezone. Count each
  period once, including breakeven; exclude periods without closed fills. Missing
  closing dates or PnL make these averages unknown. They do not mean the current
  or latest-trade period totals. The six metric definitions and monthly/weekday
  chart definitions use shared accessible info controls. Session settings show
  persisted initial balance separately from current balance; both are read-only.
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
  Testing Trades defaults to Chart (market time): closed rows use exit time, open
  rows use entry time in Settings timezone. Chart/Realtime are two native radios
  at the top of the Basic filter drawer, never a toolbar selector. Realtime uses
  activity timestamps; missing dates remain unknown. Changing the draft clock
  previews its calendar facets without changing the table or URL. Pending/failed
  previews block Apply, with Retry for failures. Cancel discards the draft;
  Apply commits clock and filters atomically and resets page/details. Clear All
  resets the draft clock to Chart; outside Clear filters resets applied Chart.
  Applied filter groups appear as removable chips; removing one preserves other
  groups. Clear filters retains the selected sessions. Drawer Apply
  commits base and extra filters in one URL update; closing it discards the draft.
  Return info controls sit beside sort controls, with independent focus/touch
  behavior and VI/EN definitions. A read error must not also show a false empty
  ledger; native hidden state takes precedence over table layout styles.
  Session selection shows the dataset date range, not session creation date.
  Practice chart tooltips use elapsed hours/minutes; axes retain compact hours.
  Dashboard practice/win-rate charts use actual local days when both filter bounds
  are present and cover at most 31 inclusive calendar dates; Lifetime, longer and
  one-sided ranges use months. API `chart_period` selects `activity_days`/`days`
  or the existing monthly projections. Never split monthly totals into invented
  days. Missing activity dates stay unassigned; absent periods are not 0% wins.
  Daily axes use locale day/month labels; full ISO dates remain in tooltips.
  Win-rate tooltips retain one decimal place; the percentage axis stays integral.
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
