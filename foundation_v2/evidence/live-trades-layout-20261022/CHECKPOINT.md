# Live Trades layout and shared ledger controls — 2026-10-22

## Change

Trades now places its filter toolbar inside the left working column. Analytics
starts beneath the section navigation and fills the remaining desktop viewport,
matching Calendar. The heading divider aligns with the filter-toolbar divider;
filter chips increase only the left toolbar's height. Below the existing desktop
breakpoint, Analytics stacks beneath the working surface.

Practice and Live use the same LedgerFilterActions and TableColumnControl.
Column reset/selection affects table presentation only; manual and broker schemas
retain separate selections. Tags reuse Live's manual-ledger tag filter, with draft,
Apply and Cancel semantics. Broker fills gain no fabricated tag metadata.

## Validation

- `npm run build`: PASS on final source; existing >500 kB chunk warning remains.
- `node --test tests/live-workspace.test.mjs tests/liveWorkspaceModel.test.mjs tests/liveLedgerModel.test.mjs tests/ledgerFilters.test.mjs`: 22/22 PASS.
- Scratch SSR fixture using the existing esbuild/React runtime: manual columns
  asset/tags/net produced three data cells plus the details action; broker
  asset/net produced two cells. Zero broker columns showed an explicit empty state.
- Browser QA on local 5180: real empty workspace, Basic apply, draft Clear then
  Escape preserving applied filters, clear applied filters, Tags tab initial focus,
  mobile drawer, and Practice column/Tags controls.
- Built-in labeled broker demo: hide Lot (10 to 9 headers), reset to 10; analytics
  remained 2,880 USD / 60 deals. Deselect all showed the column-selection empty
  state; reset restored all 10 columns. No broker or database write.
- At 1920×940: Trades and Calendar Analytics top = subnav bottom = 117px;
  Analytics bottom = viewport bottom = 940px; filter/heading bottoms = 186px.
- At 1368×790: Trades top = 117px, bottom = 790px; dividers = 186px.
- 390×844 and 768×1024: document width matched viewport; Analytics stacked below
  content; toolbar wrapped and mobile Tags dialog remained usable.
- Screenshots cover full 1368 desktop views and 390/768 layouts, plus baseline
  1280. IAB captures at requested 1920 were clipped by its screenshot surface and
  were discarded; the 1920 DOM measurements remain in measurements.json.
- Independent read-only review: no remaining blockers after replacing repeated
  per-cell whole-row formatting with a switch that formats only visible cells.
- Scoped diff check: PASS. Theme restored to dark, viewport override reset, own
  QA tab closed.

## Scope limits

Manual table rendering was checked with an isolated SSR fixture, not a persisted
manual-account browser journey. Broker demo is synthetic UI evidence, not broker
connectivity acceptance. No API, account synchronization, financial calculations,
execution permissions or database behavior changed.
