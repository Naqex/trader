# Session presets: database persistence and orange selection

Scope: the existing create-session dialog in Backtesting and Prop Firm. Presets
are workspace/mode-owned drafts in PostgreSQL, reached through four additive
Rust routes. Original105 route contracts remain unchanged. No session, order,
broker or research workflow was added to this task.

## Behavior and state

- Empty/unselected preset trigger is neutral. Selected preset and balance use the
  existing orange action token. Empty menus have no separator; the popup paints
  above the dialog body. Desktop/mobile screenshots were reviewed.
- Create/edit/delete await the database response. Expected revisions reject stale
  writes; request receipts make retries idempotent. Unconfirmed save outcomes block
  further save/create actions until reload. Delete errors retain the confirmation.
- Browser presets are legacy input only. Import uses stable request keys and
  checks the server configuration before removing the original local snapshot.
  Conflicts, corrupted data and concurrent local edits preserve that snapshot.
- Applying a preset keeps the session name/date range. Editing/deleting a preset
  does not revise an already-created replay or Prop session. Presets are shared
  by browsers connected to the same server/workspace, separately for each mode.

## Validation

- [20 focused Node tests](unit.txt): persistence contracts, safe legacy import,
  stale/altered responses, two locales and trading-option regressions. PASS.
- Vite production build: PASS (`.runtime/preset-db-build.log`, local generated log).
- [Disposable PostgreSQL acceptance](../session-presets-20261018/api-pg-final.json):
  real Rust router/auth/receipts, mode/workspace isolation, persistence after new
  AppState, revision conflicts, names and concurrent50-preset admission. PASS.
- [Production UI fixture acceptance](ui/browser.json):4 mode/locale journeys,
  create/edit/apply/cancel/delete, server delete409, clear browser storage/reload,
  uncertain session-create guard, orange styles and empty/mobile layouts. PASS.
  The preset HTTP service in these four journeys is an explicit in-memory fixture.
- [Asset-category regression](groups/browser.json):4 mode/locale journeys including
  legacy import and independent cost/slippage settings. PASS; labeled catalog and
  preset HTTP fixtures, no owner writes.
- [Real local database/browser acceptance](persisted/browser.json):2 journeys,
  one per mode, without HTTP mocks. Create via UI; a fresh browser context reads
  and applies it; edit via UI; another fresh context retains the updated balance;
  delete via UI. Original active presets remain byte-for-byte equal to baseline.
  Only the two captured QA preset IDs were mutated and then soft-deleted. No
  replay/Prop session or trade/step writes were allowed. PASS, no JS errors.

## Local cutover and rollback

[Runtime receipt](runtime/receipt.json): PASS. Only migration0007 was applied.
All21 previous data-table digests,25 replay records and4,142 artifact hashes were
preserved before the subsequent QA preset mutations. API8010 runs native/compact
and reports database ready; UI5180 serves the production build.

The full database/artifact backup was verified before migration; receipt records
its path and manifest hash. Preflight caught a stale scientific engine commitment
and pg_dump17/server18 mismatch. The existing trusted bootstrap refreshed only the
engine commitment, preserving installed dependency/runtime identities; backup used
the already-installed matching18.6 client. Original descriptors/QDM bytes and old
binaries remain unchanged. The active refreshed descriptor is in durable
`.runtime/api-platform/`, independent of this evidence directory.

Do not run pre0007 binaries on schema0007. Rollback requires the matching verified
database/artifact backup. Generated descriptors, binaries, backup internals and
machine-specific cutover scripts are local operational artifacts, not source.

Limits: this verifies local persistence and scoped UI behavior, not remote account
deployment, multi-user administration, provider/broker execution or whole-product
acceptance. Cross-machine reads require connection to the same server/workspace.
