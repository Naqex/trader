# Live and Market Data UI contract

Live and the Testing Market Data catalog consume `testing-standard.md` and
`project-palette.md`. FX Replay references guide layout only. Source data,
read access and unknown states come from this project's existing adapters.

## MT5 trading surface

`section=terminal` lazy-loads `LiveTradingWorkspace`; the journal reader is not
mounted on this route. It reuses `TradingViewReplayChart` with a separate live
datafeed and chart storage namespace, `OrderEntryFields`, `FxSelect` and
`LegacyModal`. Current-candle updates stream without replay rewinds. Desktop
chart, position ledger and order ticket end at the shell viewport bottom; below
1000px they stack in the content scroll region without overlap.

Terminal identity, symbol specification, quote and action capabilities come from
the managed MT5 API (Demo and Real use the same flow). Missing policy and stale/disconnected data disable sends.
Preview binds exact account/server/symbol/side/volume/SL/TP, expires after five
seconds and can be refreshed inside confirmation. The server independently checks
every command. Confirmation shows the broker account environment and exact account/server; replay fills
and investor journal accounts never supply execution state.

The browser saves the request UUID before POST. Accepted/partial results carrying
`requires_reconciliation` remain locked across reload. Reconciliation only reads
broker evidence and never repeats the send. Definitive pre-submission rejection
(including HTTP 423) clears that local request; ambiguous outcomes remain locked.
Only advertised per-action capabilities enable position actions. See
`foundation_v2/docs/demo-trading.md` for activation, risk and initial limitations.

UI fixture screenshots are explicitly synthetic and do not prove broker execution.

### Overview and chart entry

The Tổng quan tab follows the Sessions composition: rich account selector and
management/refresh actions, account summary with chart entry, connection/margin
facts, then period charts, metrics and recent executions. It shares the existing
report cards, bars and pagination. The separate Trading accounts tab keeps account
management. Selection is scoped to the workspace/connection and carried in the
URL; refresh/catalog reordering never switches an existing selected account.
Overview connection metadata refreshes every ten seconds while visible. Failed
or stale reads display unknown connection/permission state rather than stale
permissions as current facts. Verified trade permission is not symbol/session
availability or authorization to send an order.

The overview separates the current MT5 account snapshot (balance, equity, floating
P/L, used and free margin) from executions in the synced history window. Trading
results use the bound connection's `/live/status` snapshot and show its actual
history start/capture dates. Trading deals (types 0/1) include commission, swap and
fee; deposits/withdrawals are excluded. Counts are executions, not closed trades
or a win rate. Missing fields/coverage remain unknown; a covered empty window is
zero. History is read on entry/account change and explicit refresh, independently
of chart quotes. Revoked/failed reads do not keep another account's metrics.
The cumulative curve is net execution PnL starting at zero, not a historical
balance curve. Month/weekday buckets use UTC. Missing timestamps or costs suppress
the plots instead of inventing zero points. The recent table shows executions,
including entry commissions and partial fills; volume is in lots. It does not
claim that one execution equals one completed trade or use an invented ROI basis.

Recently opened charts are saved only after the renderer is ready. Local storage
is scoped to workspace, connection, login and server; at most six distinct
symbol/timeframe pairs are retained. Entries reopen the current account through
the existing Live route, without replay IDs or order authority. Storage failure
does not block navigation. They are chart shortcuts, not market-session status.
The adapter currently has no broker session schedule; quote age never supplies
an inferred open/close calendar.

Live chart entry uses the shared `ChartLoadingState` across route/lazy-code,
initial market snapshot and renderer readiness. Live owns the overlay; the
advanced renderer reports loading/ready/error and suppresses its duplicate
loader only in this managed mode. Replay retains its default loader ownership.
The lightweight renderer reports readiness after applying its series. Empty,
denied and failed initial reads exit loading; renderer failures expose the
existing fallback. SSE reconnect retains the chart and does not restart the
entry screen. Code preloading starts alongside the market read; no artificial
minimum delay is introduced. Shared chart AI controls use the orange highlight
palette, including the compact menu.

Trading conditions separate three sources: raw MT5 account/terminal permissions
and symbol flags; quote quality calculated against the host clock; and application
send policy. The five-second quote-age limit is application policy, not a broker
session signal. Without a session schedule the session remains unknown. Only an
actual MT5 check/send retcode can report a broker rejection such as market closed.
Stale-price toasts appear on blocked trading attempts, never merely on entry,
reload or repeated snapshots. Buy/Sell stays enabled for valid past quotes, but
stale attempts show a warning without reaching preview or send. Order drafts
remain editable through the order ticket.

## Ownership and presentation

- `testing-standard.css` explicitly opts Live into Testing typography, control
  sizes, pill/circle geometry, focus/hover, peach actions and report colors.
- `LiveWorkspace` owns the existing workspace-local reader, five-second polling,
  loading, unavailable/locked/denied, stale snapshots and compact source disclosure.
- `LiveSurfaces` owns Calendar, Trades, Notes, Tag analysis, Analytics and Accounts.
  Demo calls the same component with `DEMO_LIVE`; it never calls the live reader.
- `LiveBrokerSnapshot` renders account facts, positions, orders, quotes, raw deals
  and separate transactions. Its pagination is local to the synced snapshot.
- `MarketAssetCatalog` remains shared by canonical Market Data and DataDesk.
  Search/group/enabled filters, dates, existing update requests and replay links
  retain their existing data contracts. Update actions are disabled in demo.
  Its own stylesheet supplies button and pager geometry so DataDesk does not
  depend on Testing opt-in or a previously visited Analytics route.
- Shell supplies one main landmark for canonical Live/Market Data. Accounts uses
  `account_tab=connect|transactions` children with the existing continuous peach
  parent underline; selected children use contrast text without a hover fill.

Calendar uses a Monday–Sunday grid, week totals, soft-peach month total and
Analytics side region. Trades uses its deal table plus the Analytics side region.
Notes retains the reference toolbar/group/empty arrangement. Tag analysis keeps
its curve/list/summary arrangement without inventing broker tags. Accounts uses
manual account balances and separate read-only broker facts. At narrower widths, side regions
stack below content; calendars and tables scroll within their own regions.
Structural dividers meet at panel boundaries and span the canonical workspace
width. Content retains its gutter inside panels; interactive calendar cells
retain their separate spacing. Live uses the shared section navigation without
an additional page heading. Journal actions belong to their working surface,
retaining their reader/dialog state and the shared control styles. Account choice
and Basic/Tags filters share one toolbar. On Calendar and Trades that toolbar belongs to the left
region; the Analytics heading starts at the same level on the right. Week totals
use the same border, radius and height as day cells, with count and week label at
the top. Unknown weekly counts/amounts remain dashes, not fabricated zeroes. At narrower
widths the sidebar stacks and the calendar alone scrolls horizontally.
Ready/demo status is not repeated.
On desktop, both Calendar and Trades use the remaining shell viewport: Analytics
starts immediately beneath the section navigation and ends at the viewport bottom.
The filter toolbar is inside the left column, aligned with the Analytics heading;
applied-filter chips expand only the left column. Narrow layouts stack Analytics
below the working surface instead of squeezing the two columns.
Practice and Live share `LedgerFilterActions` and `TableColumnControl`, including
the reset-columns button, column selector, divider, and Basic/Tags drawer triggers.
Live Trades owns separate column selections for manual trades and broker deals;
changing visible columns never changes the deal selection or summary calculations.
Tags use the existing manual-ledger semantics, staged until Apply and discarded
on Cancel/Escape. Broker deals expose no invented tags. Reset columns restores
the source's default columns and does not clear filters or reload account data.
The data-mode selector is owned by the global topbar on all routes. Unsupported
preview routes keep a disabled real-data selector; they must not switch to an
unrelated fixture. On small screens it occupies the second header row.
The fullscreen chart retains its existing hidden shell header; this does not
introduce a preview selector into replay execution.
Basic filters reuse `FilterDrawer` with Practice's native dialog, spacing, footer,
search, Escape and focus restoration. Live owns its distinct side/outcome/date
semantics; unsupported Practice filters are not copied into Live.
Exceptional read states remain visible. Data caveats live in the source/access
disclosure instead of repeated paragraphs beside the calendar and deal table.

## Data and state

`liveWorkspaceModel.js` is the read model. Deal net requires finite numeric
profit, commission, swap and fee. Deposits and withdrawals never enter deal PnL.
Missing fees remain unknown. Deal entries/exits are not paired into complete
trades, so no trade win rate, duration, or equity curve is inferred.

Calendar buckets use the selected IANA timezone. A fully covered empty day can
show zero. Missing feeds, absent coverage bounds, future days and incomplete
boundary days remain unknown when they have no recorded deals. Totals explicitly
cover synced deals only. Percent return requires opening capital and remains
unavailable when that capital is missing. Analytics plots cumulative deal PnL,
not account equity; an incomplete net result stops the cumulative curve.

Filters use draft state; Apply commits it. Clear restores the default scope.
Search, page size and applied filter changes reset local paging. Polling does not
reset a user's selected page. No server paging capability is claimed for an API
that returns the entire synced snapshot.

Errors keep previous data with a stale warning. Denied responses, a locked or
unavailable payload and workspace changes clear account data. A current balance
is never substituted for historical opening capital. Symbols, tickets, account
references and IANA timezone identifiers remain raw when locale changes.

## Persisted manual journal

Live keeps two distinct sources. The configured broker adapter remains read only;
manual accounts, closed trades and notes use the workspace-local native
`/api/v2/live/records` endpoints and migration `0008_live_journal.sql`.
This journal never submits an order or authenticates a broker provider.

- Each write is idempotent and creates an immutable revision. Edits require the
  current revision; conflicts require reloading. Uncertain writes block new
  submissions until the user checks the ledger. Records are corrected by revision,
  not silently deleted.
- Manual account currency and a saved trade's account cannot be changed. Accounts
  are selected separately; amounts in different currencies are never summed.
- Manual net PnL = gross PnL + signed commission + swap + fee. Charges are negative,
  rebates positive. Contract size is not inferred from a symbol. Manual trades
  are closed trades; no floating PnL/equity or deposit/withdrawal ledger is invented.
  Recorded balance = opening balance + recorded net PnL.
- Manual trade count, win rate, profit factor and return use closed records;
  breakeven is within ±1e-12. Broker deals remain raw fills and do not acquire
  inferred trade-level metrics. Missing costs or opening capital stay unknown.
- A trade/note stores both strategy ID and exact revision. Historical links keep
  that revision even after a strategy is revised/frozen. An old revision whose
  name is not in the current catalog uses a version reference, never the new name.
- Account changes clear account-specific tags and basic filters. Same-account
  refresh retains selections; section links preserve `live_account` only in Live.
- Account and strategy selections follow the URL, including Back/Forward. Account
  changes create history entries; strategy filters replace the current entry and
  do not remount the reader or clear other applied filters. Manual strategy/tag
  filters do not hide broker fills when switching sources.
- Notes support manual-account, broker-connection and general scope, search and tag filters. A note has at most one account parent; the API checks broker connection ownership in the current workspace. Switching accounts retains general notes and hides other accounts' notes. Monthly review
  creates an editable note from the displayed recorded monthly total. Tag analytics
  allows overlapping tags; its groups must not be added together as a total.
- Note tag options come from account-scoped notes before text search, so an active
  tag stays visible when search returns no matches. A catalog/read refresh failure
  keeps loaded notes readable in a shared read-only dialog; writes remain blocked.
  Denial clears notes, including any open read-only detail. A new note without a
  selected account defaults to general scope, not the first unrelated manual account. Monthly reviews for a selected MT5 connection retain that connection as their parent.
- Monthly review includes account, timezone, strategy/tag scope and applied filters,
  and pins the selected strategy revision. Unknown monthly PnL cannot create a
  summary. Recorded manual trades and synced broker deals remain distinct in copy.

CSV uses the downloadable 13-column UTC template. It imports 1–500 closed trades,
at most 1 MB. All rows are validated before submission (numbers, dates, text and
label bounds). Import is sequential with explicit progress; a known runtime
failure can resume from the first unsaved row. After partial import the account
and file are locked. Unknown outcomes require ledger reconciliation. Importing
the same file again is a new explicit operation; global deduplication is not
claimed. CSV is a trade-data format, not a full backup of strategy links/revisions.
Export protects spreadsheet text from formula execution and keeps signed amounts.

Share is intentionally unavailable. Demo calls the same
surfaces without ledger reads or writes. Shared LegacyModal/FxSelect/date controls
supply focus, keyboard and theme behavior; long dialog bodies scroll while the
header remains available. Financial fixtures remain isolated test evidence.

## Account connection and cashflows

Connect uses an accounts table with search, source filter, sorting and
shared pagination beside the Add account panel. Manual creation and CSV import
reuse the persisted journal dialogs. CSV imports closed trades into a manual
account; it is not an account-list upload or automatic broker connection.
Search starts as a right-aligned icon and expands into a focused field with a
clear-and-close action. The shared FxSelect checkbox menu filters Manual and
Sync sources; CSV is not a separate account source. Account action icons stay
transparent, including hover. Sidebar and main toolbar share the same header
height and divider position.

The manual-account dialog uses the shared modal, searchable currency select and
UTC date/time picker. Name, currency, Live/Demo/Prop firm type, opening capital and
its effective timestamp are persisted together. New accounts require an explicit
type and amount; editing preserves the existing currency. Legacy records without
the new optional fields remain readable. Transactions date the Initial balance
row from the effective opening timestamp, falling back to creation time for
legacy records. Account-dialog footers have no horizontal divider.

Each table row has a shared action popover, with source/status badges and a
dedicated MT5 sync control. Actions always target that row, even when another
account is selected. Manual accounts support edit, CSV, trade entry, journal,
cashflow navigation, duplicate and archive. Duplication opens an editable manual
account draft containing configuration only; it never copies trades, notes,
connector IDs or credentials. Duplicating an MT5 account also creates a manual
journal, with known snapshot balance proposed as its opening capital.

Manual deletion is an append-only archive revision: the account and its children
are hidden and cannot receive new revisions. MT5 rename changes the local display
name only. MT5 removal deletes the local connector, credentials and synced
snapshot; it never changes the broker account. Both delete paths require a shared
confirmation dialog. Unknown write outcomes require reconciliation before retry.

Transactions uses a separate cashflow table and account-details sidebar. Manual
opening capital has its own Initial balance row, never a deposit; manual funding
and fee CRUD are not supported and totals stay unknown. Broker MT5 balance events
(type 2) are classified by signed profit into deposit/withdrawal; account charge,
commission and tax events keep their signed amounts as fees. Other events retain
their MT5 type. These events never enter trading PnL. Totals describe synced
history, not lifetime, and broker opening balance is never reconstructed from a
partial history. Unknown history stays unknown. Amount and UTC time sort before
tab filtering and shared pagination. The sidebar uses the existing account picker
and action menu, with balance separate from the grouped financial metrics. Shared
info tooltips explain scope and unavailable values without persistent helper copy.
Transactions has no raw broker snapshot disclosure; positions, orders, quotes and
account trading conditions belong to the MT5 trading workspace.

The local MetaTrader 5 connector uses the existing FxSelect, ProjectDateInput,
field/button tokens and account table. The provider picker uses a circular
MetaTrader mark above its label, with token
colors for hover, focus and disabled states. It has no info icon or helper copy;
connection details remain in the form.
The provider tile is labelled MetaTrader; the connection form retains the exact
MetaTrader 5 platform identity. Its 96px tile keeps avatar and label on one center
axis. The accounts search header and Add account heading share a 72px minimum
height so their desktop dividers align in the standard single-row layout.
The Trades page starts with its filter bar. Account creation/import and manual
trade entry remain available from Accounts and its per-row menus.
The Add account panel accepts server, numeric login, investor password and UTC
history start date. Pending submissions lock the form; an unknown network outcome
retries the same request ID. The visible
password clears on submission; an uncertain request retains it only in component
memory until reconciliation or unmount. It is never persisted in browser storage.
Known validation failures require correction and password re-entry.

Accounts show queued/syncing/connected/error/paused/disconnected metadata even
before a first snapshot exists. Actions support full sync, pause/resume, credential
replacement and disconnect/erase credential. Previously synced data remains
readable as stale; disconnected does not mean history deletion. Each account's
history stays scoped to its connection. Trading PnL remains separate from cashflows.

On desktop, Accounts fills the available content viewport: the table and right
panel scroll independently, with shared pagination at the bottom of the table
pane. The bottom source disclosure is removed. Below 1000px the panel stacks and
the page scrolls naturally, so all form controls remain reachable.

The add-account sidebar uses a compact horizontal CSV action and a centered
MetaTrader symbol cropped from the existing brand asset. The connection form
orders start date, platform, server, login and investor password; account naming
is deferred to account management. Only MT5 is supported. Field and sync help
use hover/focus tooltips rather than permanent explanatory copy. The sync guide
uses a question mark; server and login use the shared info icon. Tooltips have
`role=tooltip`, describe their trigger, remain available while hovered, and close
on Escape. They use the app-wide `ProjectTooltipLayer` and the compact tooltip
contract in `compact-system.md`; click remains available for touch. The back
and sync-guide row shares the table header's centerline. Vietnamese field labels are Máy
chủ, Tài khoản and Mật khẩu investor. Password help distinguishes viewing access
from trading access for both demo and real accounts, using the same info-tooltip
pattern as server/login. The password visibility action remains separate.
The provider summary shows the six platform market categories in a compact
two-row layout; these are not a claim about a connected account's instruments.
Back and Cancel use the chart partial-TP text-action treatment: transparent
background, muted text brightens on hover, and a visible keyboard focus ring.
Connection actions sit at the panel bottom when space permits; short panels
scroll without overlapping fields. Existing idempotency, uncertain-request
locking and password-clearing behavior remains authoritative.

The connector is Windows/local-host only and uses an isolated portable terminal
per connection, DPAPI-protected credentials and a serialized background collector.
It rejects effective trading permission and never sends broker orders. See
`foundation_v2/README.md` for operational and verification limits.

Manual entry is labeled Thủ công consistently, including account sources,
dialogs and import guidance. Sortable account and trade-ledger headings use
the shared `wm-table-sort` treatment: full-cell pointer/keyboard target,
inherited muted header text, token hover surface and an inset focus outline.
Static headings share the same resting color. Account headers retain their
60px height and connection-navigation centerline.

The current account is conveyed by `aria-current` on its name button. Account
context does not persist a whole-row selection fill; rows use the shared hover
surface only while the pointer is over them.

MT5 initialization reports only sanitized error categories: authorization,
terminal IPC, timeout, version mismatch or unknown initialization failure.
Historical `mt5_login_failed` records retain a neutral connection message;
they do not prove bad credentials or missing investor access. SDK descriptions
are never forwarded to the client. This classification does not change the
investor/identity/isolation gates or enable broker execution.

Account form/action evidence:
`foundation_v2/evidence/live-account-dialog-20261022/CHECKPOINT.md`.

## Calendar viewport and empty values

Above 1240px, Calendar and its Analytics sidebar fill the available content
viewport. Calendar rows share the remaining height; short windows scroll within
the calendar pane, preserving readable cells and access to selected-day details.
Below this breakpoint the sidebar stacks and the page scrolls naturally.
Days outside the month are disabled and dimmed. Unknown daily amounts render
blank; accessible day labels retain their unknown value. Weekly totals keep
count and week number above the amount in account currency. A covered empty week
shows zero deals/trades and zero money; missing coverage remains unknown. A subtle
vertical rule separates Share from Monthly review using the existing border token.
The toolbar-to-calendar gap is 8px, without a second bottom margin. The Total
column heading uses the primary content color, one step above muted weekday labels
in both themes.
All eight calendar columns, including Total, use equal-width grid tracks. Week
summaries share the daily cells' row height; narrow screens scroll the calendar
horizontally rather than giving Total a separate column ratio.
Before any account is selected, the empty calendar scaffold shows zero trades and
$0 in each week and the monthly footer, matching the reference. Daily cells stay
blank and analytics still asks for an account. This display default does not turn
unknown values from a selected account into zero; account currency replaces USD
once available.

## Strategies and Practice handoff

Strategy pages reuse the existing Playbook revision API: create a manual draft,
revise, freeze, fork and compare history. Manual notes live under
`rules.manual_notes`; existing executable rules/capability/lineage are preserved.
A manual strategy is guidance for the trader, not an automated strategy runner.
Practice links open session creation with exact strategy ID + revision. Changing
or clearing the selection is explicit; edits never rewrite an existing session.

Evidence: `foundation_v2/evidence/live-strategy-audit-20261020/CHECKPOINT.md`.


## MT5 overview and chart journey

The MT5 entry (`view=live&section=terminal`) is an overview, using the Practice
Dashboard action/metric styles and shared DashboardMetric. It has one action,
**Mở biểu đồ**, with no replay/prop creation, Sessions page, or Recent Sessions.
The action opens the Practice-style setup frame (quick-session.css, FxSelect):
account/balance, a permitted MT5 symbol, timeframe, and read-only broker conditions.
There is currently one policy-bound executable demo terminal, not an investor
account selector. A journal connection never grants trading authority.

`surface=workspace` opens the existing fullbleed chart workbench, native
LegacyChartHeader, drawing tools, LegacyObjectTree, OrderEntryFields and
LegacyModal. The order ticket opens over the chart rather than a permanent
standalone terminal sidebar; positions/orders/receipts expand from the bottom.
MT5 header actions only expose implemented live capabilities. Back returns to
the MT5 overview. liveTradingNavigation discards all replay/prop identifiers and
simulation settings in both directions. Opening a chart does not create a record
or unlock execution. Unknown receipts survive navigation and reload.

Data ownership: demo trading snapshot supplies exact terminal identity, balance,
equity, margin, authorized symbol list, quote and instrument constraints. Spread
is Ask minus Bid with a UTC quote timestamp. Missing leverage/specifications stay
unknown. Commission schedule is not inferred from spread or assumed zero; actual
charges belong to synchronized deal history. Application risk/volume limits and
cost reserve are labeled separately from broker specifications. There are no
editable simulated spread/commission switches in MT5 setup.

A rejected symbol can be reset to the terminal's valid default without editing
the URL. Fullscreen targets documentElement so body-portaled dialogs remain in
its subtree. Browser-host OS fullscreen itself needs a normal-browser check;
IAB did not expose a fullscreen element during QA.

Evidence: `foundation_v2/evidence/mt5-overview-flow-20261022/CHECKPOINT.md`.

## Loading and navigation

The Overview requests `summary=true` every ten seconds while visible. It reads
verified persisted account metadata, without loading bars/history or contacting
the SDK. Chart reads poll every two seconds while visible and reuse the persistent
worker. Returning to a visible page refreshes its data; hidden pages stop polling.
Read-only connections can open the chart and inspect positions; the backend and
worker independently deny previews, commands and reconciliation for that access.

Chart CSS, chart controls, broker form, journal sections and record dialogs load
at their owning route/action. Shared filters, modal, select, tooltip, date input
and pagination remain the same components as Testing. Notes and tag analytics
page locally at 10/20/50/100 rows; no server-side history paging is implied.
`lang` explicitly selects VI/EN, survives links and follows Back/Forward. Live
links retain broker, symbol and timeframe but discard replay session/dataset and
cursor settings. Changing section resets shell scroll, not applied filter state.

Audit evidence: `foundation_v2/evidence/live-flow-audit-20261023/CHECKPOINT.md`.

## Trading account controls

Broker names combine MT5, verified account login, environment and optional saved
nickname; generic MetaTrader names are omitted. Read-only access adds a localized
suffix. A commercial account label such as Standard comes from the owner's saved
nickname, never from an assumption about MT5's demo or hedging mode. List and
status summaries project the login from the stored verified binding, with no
additional SDK read or history payload.

Account names are static text; navigation remains in the account action menu.
The sync header is static text beside an icon-only button. Header and row sync
icons reuse the green two-arrow icon and shared tooltip, with transparent hover.
Sync all queues every eligible workspace connection, independently of filtering
and pagination. Paused, disconnected, queued and syncing connections are skipped;
partial failures identify the affected account without stopping later requests.
CSV template access is a short, left-aligned link.

Account rows and the page header use native design-system checkboxes. Header
selection applies to the current page; the selected-account panel can select all
filtered rows. Selection survives pagination and sorting, clears when search,
source filter or account tab changes, and prunes removed accounts. The compact
panel stays in layout flow above pagination so it cannot cover rows or controls.
Selected sync skips manual, paused, disconnected and already queued connections.
Bulk removal reuses the shared confirmation and existing archive/remove APIs;
completed writes are excluded from retries. An ambiguous outcome stops remaining
writes and blocks row/bulk mutations until reload and reconciliation.

MT5 Initial balance is the first valid balance observed by this app after the
baseline feature is active, with that sync's UTC time and currency. It is stored
atomically in the connection snapshot and retained across syncs/reconnects. It is
not the broker account's original capital and is never backdated or reconstructed
from partial history. The separate Initial balance event/sidebar value never
contributes to deposits or trading PnL. Existing connections acquire the baseline
on their next successful sync with the updated backend. A baseline-only summary
can display the observation while unavailable history totals remain unknown.

Selection/baseline evidence:
`foundation_v2/evidence/live-account-selection-20261023/CHECKPOINT.md`.

Connection access uses a native horizontal radio group: Trading on the left,
selected for new connections, and Read only on the right. Reconnecting preserves
saved access. Password labels follow the selected access; demo/real environment
does not change these permissions. Connection errors show a badge, with details
in the shared tooltip rather than a permanent second line.

Owned terminals explicitly use `[Experts] Account=0` so the first login does not
disable the requested trading access after initialization. Read-only terminals
still disable Experts/live trading; identity, credential and generation checks
remain authoritative before operations. MT5's standard `account_info()` has no
broker commercial product field for Standard/Pro/Zero/Raw Spread.

Startup/access evidence: `foundation_v2/evidence/mt5-connection-startup-20261023/CHECKPOINT.md`.

Evidence: `foundation_v2/evidence/live-account-controls-20261023/CHECKPOINT.md`.
