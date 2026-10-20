# Local Live journal activation — 21 October 2026

PASS for the explicitly authorized local cutover. The owner approved database
and artifact backup verification, additive migration and restart of API 8010.
The main frontend remains on 5180. No broker execution was enabled.

## Backup and migration

- Stopped only the managed native/compact API and its owned worker tree after
  ownership and idle checks. Saved the previous binaries and owner manifest in
  ignored `.runtime/live-journal-cutover-20261021/` for diagnosis/rollback.
- The first dump attempt used PostgreSQL 17.11 against server 18.6 and was
  rejected. No backup was accepted or schema changed in that attempt. Reused
  the installed PostgreSQL 18.6 tools at `D:/Program Files/PostgreSQL/18/bin`.
- Verified a quiesced backup of **4,142 artifacts plus the database dump**,
  **4,267,576,698 bytes**, at
  `.runtime/api-platform-backups/live-journal-20261021/`.
  The helper verified source stability, file sizes and SHA-256 hashes, including
  the final bundle. `pg_restore --list` read the custom dump successfully
  (115 catalog entries). This is not a full restore rehearsal.
- Built the native release binaries and verified that only
  `0008_live_journal.sql` was pending. Applied exactly that additive migration
  after the backup passed, then restarted through `restart_offline_api.ps1`.
- Native schema check now reports eight migrations and no pending versions.
  The native/compact and download-engine `none` profiles were preserved.

`backup.json`, `dump-check.json`, `before.json`, `after.json` and database count
receipts preserve the scoped evidence. Backup data and dump contents remain
local/ignored; credentials and connection strings are not included here.

## Read-only verification on the main instance

- API readiness: database ready; native command worker not required.
- Journal GET: `live-records-v1`, empty as expected for the new ledger.
- Strategy catalog GET: succeeds (currently empty on this main workspace).
- Every pre-existing public table except the migration ledger retains its
  exact row count. The two new journal tables have zero rows, and the migration
  ledger increases by exactly one. Counts alone are not a full content audit;
  the backup preserves the pre-cutover bytes.
- Execution capabilities remain `locked`; place, modify, cancel and close are
  false. The broker source remains unavailable rather than claiming a connection.
- Browser 5180: Live calendar and trading accounts render; the empty state is
  correct. The create-account dialog opens and is canceled without entering or
  saving financial data. No captured browser console errors.
- Screenshots: `live-main.jpg`, `live-accounts-main.jpg`. The native screenshot
  surface clips the right edge of the page; no full-width visual claim is made.

`smoke.json` records five successful HTTP checks. This activation adds no test
financial records to the owner's database. Populated financial behavior was
already verified in the separate disposable-fixture receipt:
`../live-strategy-audit-20261020/CHECKPOINT.md`.

The main API and frontend remain running. Temporary browser QA tabs were closed.
Existing unrelated source/evidence changes were not staged or reverted.
