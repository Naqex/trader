# Testing component contract

Testing is the reference consumer for the existing **Gọn đồng bộ** direction. This
contract covers Dashboard, Sessions, Trades, Analytics (Sessions and Prop), Market
Data, session settings/actions, creation forms and application-owned chart controls.
It complements `workspace-patterns.md`; it is not a product progress ledger.

Project color roles are defined in `project-palette.md` and apply across all areas.
Trading chart panes use their separate native TradingView palette; application
controls and report charts retain their project roles.

## Presentation

The current compact size/color/state/motion/layout rules are owned by
[compact-system.md](compact-system.md) and the pinned
[Compact contract](../../../UI-Systems/core/tokens/compact/0.1.1/CONTRACT.md).
These supersede the previous 40px control / 32px metric / neutral-only scope.
`component-interactions.css` maps the generated semantic roles; `testing-standard.css`
now applies action roles across the app; `compact-system.css` owns project adapters.
Route CSS owns composition and documented rich/vendor exceptions, not a new palette.

Market Data history keeps two UTC date columns, dd/mm/yyyy; exact timestamps are
available in details. Unsupported download bytes/speed/ETA stay hidden; a known
zero is not unknown. Row progress omits redundant state prose as requested; errors
and controls remain discoverable. Action placement does not move between states.
Financial colors, chart cutoffs, navigation context and dataset source are unchanged.

## Components and language boundaries

| Owner | Use |
| --- | --- |
| `FxSelect` | Single/multiple, search, disabled choices, select all/mixed, keyboard and native scrollbar |
| `SessionFilter` | Raw session names and full-row multi selection |
| `AnalyticsFilterBar`, `LedgerFilterDrawer` | Draft editing; Apply commits filter scope |
| `TimeFilter`, `DateFilter` | Native typed input plus calendar; ISO values and IANA timezone IDs |
| `SessionSettingsDrawer`, `SessionActionDialog` | Focus management, cancel, immutable facts, duplicate/delete confirmation |
| `TestingSkeleton`, `TestingReadState` | Initial read, unavailable/error/retry and route load failure |
| `TestingWelcome`, `TestingEmptyState`, `TestingPageSkeleton`, `TestingResourceNotice` | Shared viewport onboarding/loading and resource-scoped refresh/stale/error |
| `TestingIcon`, `ChartIcon` | SVG icons; do not replace them with font glyphs |
| `TestingComponentReference` | Internal reference at `?area=testing&ui_reference=1` |

Shell language drives `TestingLocaleProvider`. `testing-copy.json` owns system copy,
including accessible labels, help, validation and enum chips. `testing-enums.json`
owns status families. `Intl` formats displayed numbers and dates for EN/VI; UTC
and filter timezone semantics remain explicit. Do not parse display text into
calculations or change API/CSV identifiers when switching language.

Names, descriptions, symbols, tags, strategies, dataset IDs and hashes are user or
source data: keep them raw. Set `localize:false` on data options or
`localizeOptions={false}` on a data-only select. Translate only the surrounding
system copy. Language switches must retain drafts and exact delete confirmation.

Backtesting is labeled **Backtest**, with **Phiên backtest** for sessions:
testing a trading method against historical market data. Prop firm means a company
providing trading capital, not an investment fund; this product's simulated
source is labeled **Prop Firm**, and its simulated evaluation workflow is
labeled **Thử thách prop firm**. Date filters use **Ngày backtest**. Keep English labels and API
identifiers intact. Do not imply that a simulated result earns real funding.

Use **Mã giao dịch** for the generic instrument/symbol label throughout the
project (short **Mã** in compact labels). **Cặp tiền** applies only to Forex
contexts; metals, indices, stocks and crypto are also valid instruments. Keep
actual identifiers such as EURUSDm and XAUUSDm raw and English labels as Symbol.

Journal and trade-detail entry controls share the 16px notebook glyph in
`TestingIcon`; the ledger entry still opens its existing trade inspector.
New session has a separate SVG plus, never a symbol embedded in translated copy.
The ledger tools/filter boundary uses one short divider, not a navigation divider.
Dashboard omits the partial-scope info icon; its accessible section description
still identifies partial scope, and error/blocked/unknown states remain explicit.

Session archive/restore UI is deferred, including old `manage=archive` links.
Previously archived records remain stored and can be read from All sessions or a
direct link, with replay/duplication unavailable. No data migration is performed.
Deletion still requires the exact session name and revision, and retains the
Prop-linked-session refusal. Demo mutations affect local component state only.

## Data and loading

- Demo uses shared presentation components and labeled fixtures. Demo session
  edits stay local; unsupported data and experiments stay unavailable.
- Owner feedback on a preview applies to the corresponding shared product
  component, including actual data mode. Preview is a review surface, not a
  separate visual implementation. Verify both data paths when changing it.
- Actual reads never use demo as an error fallback. Unknown values are `—`; a
  known zero is `0`. An empty source differs from an empty filtered result.
- Initial reads and lazy route loads show skeletons. Background refresh preserves
  available data; failed refreshes show stale/error state and an explicit retry
  where applicable. Changed scope hides the previous scope immediately.
- Partial/stale scope and provenance must remain discoverable. Avoid redundant
  banners, but never claim that incomplete data is complete.
- Route chunks load on demand. Analytics experiment data waits for Drawdown or
  Simulation; Monte Carlo code loads only when simulation runs.

## Paging contract

Dashboard places Recent Sessions before Performance with a 32px section gap.
Search, asset/strategy filters and sorting apply to the whole catalog, then show
only the first three matching sessions. There is no Dashboard pager or many-session
preview. Actual mode requests page=1/page_size=3; preview applies the same order
and cap locally. Performance uses its independent full analytics scope.

## Per-page state previews

Preview states describe resources, not a universal page replacement. The selector
retains the requested state across Testing navigation, but each route interprets
it using its dependencies; unsupported states fall back to demo. Preview never
reads/writes the real API. Real mode never falls back to fixtures.

| Page | Empty | Error preview | Provider unavailable | Filtered / no trades |
| --- | --- | --- | --- | --- |
| Overview | No sessions: centered Testing welcome with two start actions | Performance fails; saved Recent Sessions remain | Saved sessions and Performance remain | Search has no matches, Performance unchanged / sessions with 0 closed trades |
| Sessions | No sessions: centered shared icon/title/detail, pointing to Overview | Selected session results fail; selector, description and metadata remain | Saved session and report remain | Search inside session dropdown / selected session has 0 closed trades |
| Trades | No sessions: centered shared icon/title/detail, pointing to Overview | Ledger fails; session and trade filters remain | Saved ledger remains | Date filter gives 0 matches / sessions exist with no closed trades |
| Analytics | No sessions: centered shared icon/title/detail, pointing to Overview | Report fails; session and report filters remain | Persisted report remains; experiments are a separate capability | Date filter gives 0 matches / no closed trades to analyze |
| Market Data | No downloaded datasets; import/source guidance in library | Local library read fails; toolbar remains | Provider catalog update/download unavailable, saved datasets remain | Asset search gives 0 matches; clearing search restores data |

Loading fills the remaining content viewport with a page-shaped skeleton. Loading
and empty-state components are reused by the real resource readers. A missing catalog
must not mount dependent Trades/Analytics or imply a known zero. Overview catalog
and Performance errors remain independent. Preview errors have no redundant retry;
actual resource retry stays where it can recover a read.

Refreshing retains same-scope data while a new request is pending; only a successful
read replaces numbers. Failed refresh becomes stale. Scope changes hide old results;
401/403 is denied, not stale. Preview refreshing/stale are deterministic snapshots,
not timers or live requests. Partial reports disclose the reduced readable scope;
unknown durations stay `—`, while known zero trades stay `0`.

The closed-trade ledger does not establish whether there are open positions.
No-trades copy refers to the selected session(s)/cutoff, never to every session in
the workspace unless all sessions were read completely. Preview `no-trades`
zeros all three sample ledgers; `new-session` zeros London only and retains the
other two sessions. Changing session filters can recover those existing results.

Trades and Analytics reuse `TestingTradesEmpty`: centered icon/title/detail below
the retained filters. Known zero hides the empty table/pager or report tabs/charts.
A filter with no matches has different copy; partial zero stays uncertain and
unknown remote counts do not become zero. Background failure keeps same-scope
data, while permission denial clears it.

Aggregate actual Trades uses opt-in `GET /api/v2/replay/trades?page=1&page_size=10`
with `replay-trades-page-v1`. Existing unpaged consumers remain compatible.
The server joins journal tags, applies full-scope filters, returns full facets and
filtered count, sorts stably, then slices. Dates/timezones, inclusive ranges,
overnight times and tag AND/OR semantics match the client model.

Each response carries scope, sources, exclusions, snapshot key and per-row
provenance. Unknown count is null, not zero. Scope/filter/size/sort changes reset
the page. A changed snapshot detected during same-scope refresh resets to page 1;
late aborted responses cannot overwrite the current scope. This is not a
transaction spanning independent requests across concurrent source mutations.
Do not compute full analytics from a page: `advancedAnalytics` rejects paged models.

The existing canonical execution projection still visits execution events on each
request. This is server response paging, not indexed database paging. Add indexed
storage only with measured need and an approved persistence design.

Market Data pages the metadata catalog locally (25 rows by default); it does not
load all bar/tick history. Demo Trades also pages locally. Neither may be described
as server paging. Actual Analytics reads its complete filtered analytics scope.

## Verification

Use Playwright with native scrollbars (`ignoreDefaultArgs: ['--hide-scrollbars']`).
Cover EN/VI, dark/light, desktop/tablet/mobile, keyboard/focus, popup bounds and
scrollbar dragging, applied-vs-draft filters, dialogs/cancel, pagination and fixed
table header/footer. Use labeled fixtures for loading/empty/partial/denied/error,
snapshot changes and out-of-order responses. Actual QA is GET/HEAD/OPTIONS only;
do not mutate saved sessions, data providers or broker state for visual tests.

Focused commands from `foundation_v2/web`:

```powershell
npm run build
node --test tests/tradingAnalytics.test.mjs tests/ledgerFilters.test.mjs tests/tradesPage.test.mjs tests/testingCopy.test.mjs
node tests/testing-standard.browser.mjs
```

Backend contract checks from `foundation_v2`:

```powershell
./.venv/Scripts/python.exe -m pytest -q tests/test_trades_page.py tests/test_dashboard_read_model.py tests/test_replay_analytics.py
```

The browser smoke needs the UI on 5180 and API on 8010; it blocks actual writes.
Independent acceptance evidence lives in
`foundation_v2/evidence/testing-standard-20261006/`. Build and fixture results do
not establish broker authorization or whole-product completion.

Recent session headers expand on non-action clicks, with hover feedback and a
subtle expanded surface. The existing chevron supplies keyboard activation and
`aria-expanded`/`aria-controls`; actions within the header do not expand it.
Header text is not selectable because the header is a disclosure click target;
text in the revealed report remains selectable. Hover colors the entire card,
including the revealed report, using the record-row hover token rather than the
brighter control hover. The expanded surface also spans the whole card. Chart
groups inside this card use spacing without nested panel borders; standalone
report charts keep their existing surfaces. A horizontal divider spans the full
card width above expanded charts. Two dividers run from it to the bottom between
the three chart columns; stacked charts use horizontal dividers instead.
Empty expanded reports use a single left-aligned message; known balance curves
remain visible even if no full ledger is available. The peach list count uses
prose (e.g. "3 phiên trong tổng số 6") for displayed records against the entire
catalog; the displayed set is capped at three after filtering. Actual Dashboard requests
the first three matches from the full server catalog; preview filters its complete
fixture catalog locally. A cold profit sort can still require summaries for many
sessions before selecting three; the small response does not guarantee constant
backend work. Popup search fields share transparent background
against the raised menu surface and the same underline/focus treatment.

Dashboard presets **Tuần trước / Last week** and **Tháng trước / Last month**
use the completed Monday–Sunday week and completed calendar month in UTC.
**Tất cả / All time** removes date bounds; **Tuỳ chọn / Custom** keeps explicit
ISO bounds. Previously saved rolling 7/30/90-day ranges retain their original
bounds and an accurate rolling label when they still match today's range.


## Pointer and keyboard states

Interaction colors are project roles owned by `component-interactions.css`;
component geometry/button roles are owned by `testing-standard.css`.
Never add a catch-all hover rule for every button/link: table headings, text links,
menu options, tabs, price controls and record rows have different semantics.

| Role | Rest | Pointer hover | Keyboard / open |
| --- | --- | --- | --- |
| Record/table row | Canvas | Subtle `--wm-row-hover` | Selection `--wm-row-selected`; selected record remains distinct |
| Secondary toolbar/dialog action | Neutral control surface | `--wm-control-hover` | Focus ring; 1px transparent border stays reserved |
| Inline table/session action | Transparent | `--wm-control-hover`, distinct from row | Same surface while menu open; keyboard focus ring |
| Primary action | Peach | Peach hover | Focus ring; never converted to neutral gray |
| Destructive confirmation | Red, white text | Red hover, white text | Focus ring |
| Text action | Transparent | Underline/foreground only | Focus ring; no filled box |
| Field/select | Field geometry with border | Border strengthens | Focus/open indication retained |
| Disabled action | Muted, native disabled | No hover change | No activation or keyboard tab stop |

Buttons reserve their border geometry and do not gain a visible outline merely
from pointer hover. Focus-visible is an independent keyboard indication, not the
same thing as hover. Text Catalog/Settings actions stay flat and underlined on hover;
New Strategy retains its owner-requested orange. Dashboard quick actions retain
their existing orange hover. Financial markings and native chart controls keep
their established semantics. Table actions use 32px circles on desktop and 44px
on mobile/coarse pointers. Download/progress stay text controls, never oval icon areas.
Row and control tokens are separate so a nested hovered action cannot merge into
its row, including selected rows. Popup option hover uses the control surface;
menus retain their panel border even though their individual items do not.


Denied workspace reads use the shared lock/title/detail state with no retry action;
resource-only denial stays inside the affected report. Discard cached protected
results on 401/403 instead of presenting them as stale. Preview uses the same
component. Overview filtered-empty uses the shared search/title/detail pattern
inside Recent Sessions, retaining the Performance section; Clear filters changes
the query and is not a refresh action. Overview alone keeps the first-session
welcome. Saved market data is independent of whether any sessions exist.

## Read recovery and workspace updates

HTTP JSON supplies scoped read results; the shared workspace SSE stream carries
opaque session/dataset revision tokens. Tokens invalidate relevant readers, not
all routes, and exclude read-command counters to prevent refresh feedback.
The server samples metadata every two seconds; this is eventual refresh, not
tick streaming or a cross-request transaction. Fixed historical report scopes
ignore current-session revision changes.

Initial pending reads use skeletons. A same-scope background refresh preserves
existing content. Transient failure preserves the last successful result and
shows a local retry countdown; a failed initial read remains an error during
retry. GETs time out after 15 seconds, including body download. Automatic retries
use bounded 2/5/10/30/30-second delays with jitter and honor Retry-After. Offline
or hidden pages pause recovery. Permanent errors do not loop; 401/403 discard
protected content. No refresh/retry button is added to the main reader notices.
After five failed attempts, a new focus/online/resource-change opportunity can
start another bounded recovery episode. An unhealthy SSE connection permits a
15-second fallback read only for active, online, error-free consumers.

The shared subnav shows reconnecting/offline without replacing existing reports.
Preview uses the same components and fixed visual recovery samples without
network calls or timers. Market Data empty/filtered results use the shared
icon/title/detail state, retain filters, and omit an empty table and pager.
Dataset gutters match Testing even though its availability is independent of
sessions. Explicit source/download mutations remain separate from read retries;
the existing configured-empty catalog bootstrap is attempted once per workspace
mount and is never replayed by retry.

Refreshing, stale and partial readers use a reserved 24px status slot beside the
section title or within its filter actions. Ready state reserves the same space;
no background status row changes content position. The indicator opens a
viewport-clamped detail popup with recovery countdown, dismissible with Escape or
an outside click. Initial errors sit below the relevant filters and their divider.
Market Data table/header/pager separators span the content viewport while cell
text retains the page gutter. Recent Trades inside a session report keeps its
quieter separators within the report width rather than bleeding to page edges.
The session selector/action toolbar uses spacing to separate it from session
details; it does not add a page-wide divider beneath the selector.

Acceptance evidence: `foundation_v2/evidence/testing-realtime-20261012/README.md`.

## Shell and route template

Header, aside and section navigation are static UI and stay mounted during client
navigation. Do not replace them with skeletons while a report loads. Reserve a
24px connection indicator beside the preview control even when connected; offline
or reconnecting details open in the existing status popup without growing the
subheader. On mobile, section links scroll within their own row and the preview
controls stay inside the viewport, including sections with nested navigation.

A pending report route module uses the page-shaped viewport skeleton. A failed module
uses the shared page error while preserving shell navigation, with no reload
button. Each resolved page has one main landmark; chart/order workspaces own their
main element, while Testing report pages use the shell's main region.

Scope data by workspace and reconcile report selection from the URL on navigation
and Back/Forward. A failed same-scope report read may keep proven session metadata
and its account currency; never invent a unit or turn unknown values into zero.
Catalog-level 401/403 clears protected results and hides action controls. Dataset
availability remains independent of session availability; the default saved-data
filter with no saved datasets is a true empty state, not a failed user filter.

Dashboard detail warnings and download progress read failures use the reserved
resource status. A malformed session summary uses a local error without a retry
countdown. Mutation failures remain explicit action errors and are never retried
automatically. Main and preview reuse these same components; fixture fields must
follow the real API contract, including asset classes.

Audit evidence: `foundation_v2/evidence/testing-overall-audit-20261012/README.md`.

## Opening a replay chart

The chart workspace uses `ChartLoadingState` across lazy module loading, the
initial session read, and native chart initialization. Center a small spinner and
localized caption in the chart viewport; use the existing canvas theme and honor
reduced motion. Keep shell navigation mounted. Do not invent a percentage or show
report skeletons in this workspace; the Sessions picker remains a report page.

The native chart host stays inert and hidden from assistive technology until its
data and theme are ready. Remove the overlay when ready. Session reads have the
shared 15-second deadline, including body download; native initialization retains
its 20-second deadline through data/theme readiness. Errors end loading and expose
the existing error state; native failures retain the fallback-chart link. A
same-session background read keeps the established chart and adds no loading row.

Scoped QA: `foundation_v2/evidence/chart-loading-20261012/README.md`.

## Chart workspace controls and data states

App-owned order fields, dropdowns and popovers consume the Testing palette and
Inter typography. Order dialog fields are 36px high with 8px corners; menus use
12px corners, and touch controls have a 44px minimum. Portaled order dialogs share
the existing control aliases and FxSelect rules rather than inheriting shell
layout. Hover strengthens the neutral border; focus/open fields use one blue
border. Save actions use the orange action token. Readonly prices and unavailable
features retain explicit disabled semantics. Native TradingView candles, grid,
tool density and drawing geometry remain native.

Positions and Journal reuse the shared empty state. Missing execution data is
unknown, not zero positions. Known empty tabs omit tables and pagination. Populated
position tabs reuse the shared pager, reset to page one after changing size, and
keep table scrolling separate from the popup layer. The open panel reserves at
least 260px so its tabs, header, rows and pager remain usable.

Same-session transient read failures keep the previously proven chart and cutoff,
but lock order writes. 401/403 clear protected data and 404 clears the missing
session. Background reads use a reserved account-bar status slot; initial failures
replace the chart viewport. Layout save states use an absolute status slot with
clickable details and an accessible failure alert. Dirty, saving, saved and storage
failure are distinct; none adds a row to chart layout.

On narrow screens the utility rail opens from one compact toggle and closes after
an action, Escape or an outside interaction, including native iframe interactions.
The account popup opens on mouse hover only on hover-capable devices; touch uses
explicit taps and keyboard focus remains supported.

Scoped acceptance: `foundation_v2/evidence/chart-design-system-20261012/README.md`.
