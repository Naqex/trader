# Trade filters and session navigation — 12 October 2026

Implemented the owner's 13 browser comments using the existing Testing controls,
palette and component boundaries. Main and demo share the filter drawer, date
input, ledger, session report and status components.

Notes is a With/Without selection backed by scoped journal note presence. No
journal text is returned. Missing legacy presence stays unknown. Filters evaluate
the selected scope before pagination; OR within groups and AND between groups.
Scoped asset choices include session catalog metadata without inventing trades.
Date/year facets remain based on the unfiltered selected scope, with revision
cache reuse. Date range means inclusive close dates UTC. Year/month/hour use the
chosen timezone. The removed weekday and replaced note-search/entry-type controls
cannot continue filtering invisibly through old ledger URLs.

Type uses a separate lifecycle contract. The current financial read model only
contains Closed fills; Pending/Canceled/Open are shown disabled. This task does
not expand the engine to supply other lifecycle states. Year/date choices remain
empty when no actual trade dates exist.

Recent Trades now links to the selected session's Trades page in real and demo
modes. Button links do not underline on hover. Removed the Live unavailable banner,
standalone ledger status icon and Tags column option; Tags filtering remains.
Degraded ledger reads retain a compact text status beside the session selector,
with details/recovery and no new status row. Unknown counts with no readable rows
show the shared incomplete state. Initial errors remain below the filters.

Validation:

- 42 Python tests: paged trades, journal metadata and bounded read projections.
- 10 JavaScript tests: filters, URL contract, note provenance/unknown values.
- Production Vite build passed; existing large-chunk warning remains.
- Primary browser script: `web/tests/ledgerDesignSystem.browser.mjs`, 8 journey
  groups; 390/1710, drawer draft/apply/discard, focus/Escape, date clear, same-session
  links, real chart hover, real API GET, Live unavailable. Reports/screenshots in
  `primary/`. Read-only requests to the owner's session; no writes.
- Independent review PASS: `../trade-filters-20261012/independent/receipt.json`.
  Four isolated contract cases, seven real-component fixture journeys, four demo
  width/theme configurations and six degraded width/theme configurations.
  Visual inspection includes 320/390/1440 and dark/light; stale rows are retained,
  partial status fits inside the viewport. Requests to fixtures were intercepted
  before backend dispatch, external/non-GET requests aborted.

The running owner session has no execution source: aggregate API returns partial
with unknown count, while catalog supplies EUR/USD. This was observed without
initializing or modifying the session. Guarded runtime restart applied no schema
migration and enabled no broker. UI and API are available at 5180/8010.

Early checks exposed asset scope leakage, narrowed date facets, legacy note/weekday
ambiguity, lost degraded warnings and mobile clipping; these were corrected and
the relevant checks rerun. Final evidence is scoped UI acceptance, not complete
product acceptance or a performance/broker benchmark. Existing unrelated CSS and
old artifacts are excluded from this checkpoint.
