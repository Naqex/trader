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
retain their separate spacing. The shell already identifies Live and demo mode,
so the page heading is accessible-only and ready/demo status is not repeated.
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
- Notes support account/general scope, search and tag filters. Monthly review
  creates an editable note from the displayed recorded monthly total. Tag analytics
  allows overlapping tags; its groups must not be added together as a total.

CSV uses the downloadable 13-column UTC template. It imports 1–500 closed trades,
at most 1 MB. All rows are validated before submission (numbers, dates, text and
label bounds). Import is sequential with explicit progress; a known runtime
failure can resume from the first unsaved row. After partial import the account
and file are locked. Unknown outcomes require ledger reconciliation. Importing
the same file again is a new explicit operation; global deduplication is not
claimed. CSV is a trade-data format, not a full backup of strategy links/revisions.
Export protects spreadsheet text from formula execution and keeps signed amounts.

Share and provider connection are intentionally unavailable. Demo calls the same
surfaces without ledger reads or writes. Shared LegacyModal/FxSelect/date controls
supply focus, keyboard and theme behavior; long dialog bodies scroll while the
header remains available. Financial fixtures remain isolated test evidence.

## Strategies and Practice handoff

Strategy pages reuse the existing Playbook revision API: create a manual draft,
revise, freeze, fork and compare history. Manual notes live under
`rules.manual_notes`; existing executable rules/capability/lineage are preserved.
A manual strategy is guidance for the trader, not an automated strategy runner.
Practice links open session creation with exact strategy ID + revision. Changing
or clearing the selection is explicit; edits never rewrite an existing session.

Evidence: `foundation_v2/evidence/live-strategy-audit-20261020/CHECKPOINT.md`.
