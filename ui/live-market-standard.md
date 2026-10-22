# Live and Market Data UI contract

Live and the Testing Market Data catalog consume `testing-standard.md` and
`project-palette.md`. FX Replay references guide layout only. Source data,
read access and unknown states come from this project's existing adapters.

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
- Notes support account/general scope, search and tag filters. Monthly review
  creates an editable note from the displayed recorded monthly total. Tag analytics
  allows overlapping tags; its groups must not be added together as a total.
- Note tag options come from account-scoped notes before text search, so an active
  tag stays visible when search returns no matches. A catalog/read refresh failure
  keeps loaded notes readable in a shared read-only dialog; writes remain blocked.
  Denial clears notes, including any open read-only detail. A new note without a
  manual account defaults to general scope, not the first unrelated manual account.
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

Connect uses an accounts table with search, source/status filter, sorting and
shared pagination beside the Add account panel. Manual creation and CSV import
reuse the persisted journal dialogs. CSV imports closed trades into a manual
account; it is not an account-list upload or automatic broker connection.

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
partial history. Unknown history stays unknown. Broker equity, margin, open
positions, pending orders and quotes remain accessible in the read-only snapshot
disclosure on Transactions.

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
