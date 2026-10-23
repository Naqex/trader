# Live accounts and transactions layout

Scope: the six owner annotations on account search, source filter, action icon,
broker disclosure, transaction layout and aligned sidebar divider.

## Changes and data flow

- Right-aligned search starts as an icon, expands and focuses its input. Close
  clears the query, returns to page 1 and restores trigger focus. Escape follows
  the shared layer order: dismiss an open tooltip first, then collapse search.
- Source filtering reuses FxSelect multiselect checkboxes. Manual and Sync are
  real sources; CSV imports trades into a manual account, so no fake CSV source.
- Row and sidebar action icons are transparent in base and hover states. The
  sidebar uses the existing menu and selected-account state.
- Removed the raw broker disclosure. Transactions retain typed cashflows, with
  amount/time sorting before tab filtering and page slicing. Summary totals
  remain independent of table filters and pagination.
- Balance is separate from the grouped financial metrics. Shared info tooltips
  carry scope explanations. Unknown initial capital remains unknown.
- Toolbar and sidebar use the same header height. On narrow screens the existing
  stacked layout is retained and the expanded search shrinks beside the filter.

## Verification

- Production build passed. Existing main-chunk warning remains (632.74 kB raw);
  LiveAccounts remains a lazy chunk, about 21.08 kB raw / 7.33 kB gzip.
- 14 tests passed: liveAccountModel, mt5Connections and testingCopy. Added coverage
  checks signed amount/time sorting, unknown values last in both directions, and
  nonmutation of the underlying snapshot.
- Actual localhost:5180, VI/dark, 1920x940: connect search expands right, no-result
  state, X clears/restores focus, Escape closes after tooltip dismissal; Manual
  filter hides MT5, clearing restores it. Menu background is transparent.
- Actual transactions: both divider bottoms = 189px, pagination bottom = 940px;
  all six info controls = 20px; disclosure absent. Menu opens with existing account
  actions; keyboard focus displays shared info tooltip. Actual balance 10,000 USD,
  opening capital unknown, synced funding and net PnL zero.
- Isolated localhost:5192 fixture: 26 synthetic cashflows. Verified amount asc/desc,
  latest-first timestamps, unknown values last, last page of six rows, Deposits tab
  of nine rows and page reset, 20-row page size, summary unaffected by filtering.
- Fixture EN/light at 1440x940 and 390x844: no page horizontal overflow; popup fits.
  At 390px search and filter both occupy y=181..225 after fixing toolbar wrapping.
  Selecting the manual account displays Initial balance 10,000 at its saved UTC
  date, current balance 10,090 and net PnL 90. Account picker and info tooltip work
  in the stacked sidebar. Screenshots reviewed.
- Diff whitespace check passed. No new dependencies or backend changes.

Fixture has no SDK, database, terminal or upstream proxy. No trading or sync
commands were sent. Real terminal credentials, connection mode and broker state
were unchanged. This receipt covers these UI changes, not whole-product or broker
execution acceptance. Temporary fixture stopped; actual VI Transactions left open.

Screenshots: accounts-search.png, transactions-actual.png,
transactions-fixture-en-light.png, accounts-fixture-390-en-light.png,
transactions-fixture-390-en-light.png. Actual measurements: actual-layout.json.
