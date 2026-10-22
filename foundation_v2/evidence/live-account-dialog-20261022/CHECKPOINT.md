# Live account form and actions — 22/10/2026

Scope: owner's account-form references, remove footer divider, and separate
manual/MetaTrader account actions. This is scoped acceptance, not whole-product
or broker connectivity acceptance.

## Implemented behavior

- Shared modal/select/date controls; full-width name, currency/type row, opening
  capital and UTC timestamp. Account footer has no horizontal divider. Inline
  errors, pending/disabled states and mobile body scrolling use existing tokens.
- Optional typed account metadata is stored in existing revision JSON, requiring
  no schema migration. Opening date drives the Initial balance transaction.
- Table source/status badges, sync icon and shared ellipsis popovers. Per-row
  trade, CSV, journal and cashflow actions use the clicked account ID.
- Duplicate copies configuration into a new editable manual journal, never
  history/IDs/credentials. MT5 snapshot balance is proposed only when known.
- Manual delete appends an archive revision, hides children and rejects further
  writes or note detachment from an archived parent. MT5 rename/remove affect
  only the local connector; no broker account or order is changed.

## Validation

- `node --test tests/live*.test.mjs`: 27/27 pass (`web-tests.log`).
- Rust live-ledger unit tests: 2/2 pass.
- Real disposable PostgreSQL integration: `live_ledger_pg.py` PASS
  (`ledger-pg.json`), metadata roundtrip, archive/idempotency, workspace isolation,
  child visibility and rejected revisions/detachment.
- Real disposable PostgreSQL integration: `mt5_connections_pg.py` PASS
  (`mt5-pg.json`), rename/remove, isolation, retry and credential/receipt removal.
- Vite production build PASS (`web-build.log`); existing main-chunk >500 kB
  warning remains. Scoped diff whitespace check clean. No whole-repo formatting
  claim: unrelated Rust formatting differences were preserved.
- Independent read-only review by `calendar_review`: no remaining blockers
  after fixing archived-note detachment, unsupported fallback broker actions and
  the popover role declaration.

## Actual browser QA

`browser.json` records real UI journeys against isolated PostgreSQL, Rust API
8021 and preview 5191. No mock fetches or user account mutations were used.

- Create, edit/persist/reopen, duplicate, MT5 rename, inline invalid fields,
  disabled submit, currency/type controls and UTC calendar picker checked.
- Cross-row manual trade and CSV target the clicked account. Cashflow navigation
  shows original opening balance $10,000.25 at 01/10/2026 09:30 UTC.
- Delete dialog opened and canceled; destructive lifecycle is covered by actual
  disposable PostgreSQL integration tests, not a GUI deletion.
- Screenshots reviewed: 1710×987 menus, 1368×790 dark/light forms, 390×844 light
  form/select and 390×650 dark scrolling form. No horizontal document overflow;
  footer reachable and keyboard focus wraps. Escape closes the modal.
- No captured browser warning/error entries. Native 5180 read-only smoke confirms
  new empty form is served; `main-5180-form.png` is the running owner application.

## Runtime and limits

API 8010 was restarted through the owner-checked runtime script with binaries in
`.runtime/api-builds/live-accounts-20261022`. The old owner was stopped using its
recorded executable paths before starting the new paths. Runtime reported ready,
native/compact, schema current (nine migrations, none pending). Preview 5180 serves
the updated build. This feature does not require a migration.

The synthetic MT5 connector stayed paused and had no credentials. Broker login,
sync/resume and execution were not exercised. No external reference form was
submitted. Isolated UI services were stopped via their owner stopfile; temporary
browser tabs were closed and viewport override reset. User data and unrelated
worktree changes were preserved.
