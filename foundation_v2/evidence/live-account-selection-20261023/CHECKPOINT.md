# Account selection and initial balance — 23 October 2026

Scope: native DS checkboxes, selected-account Sync/Delete, and an immutable MT5
first-observed balance. This receipt covers source and isolated runtime evidence;
it does not close whole-product or broker execution acceptance.

## Behavior and data

- Header checkbox selects the current page and supports mixed state. Selection
  survives pagination/sorting. Select all covers the filtered list; search,
  source or account-tab changes clear selection. Deleted rows are pruned.
- The compact selection panel sits above pagination without covering table rows.
  Sync reuses existing requests and skips manual/paused/disconnected/queued rows.
  Delete uses the existing shared confirmation and archive/connector removal.
  Known failures retain only failed targets for retry. Unknown outcomes stop
  remaining writes and lock row/bulk mutations until reload/reconciliation.
- The backend stores `balance_baseline` atomically in the existing JSON snapshot,
  scoped by workspace, connection and worker generation. No migration is needed.
  The first valid observation's amount, currency and timestamp survive sync and
  reconnect/history/permission changes. Existing connections acquire it on their
  next successful sync with the updated runtime; old history is not backdated.
- The opening observation appears separately in Transactions and account details.
  It is never a deposit or part of trading PnL. Partial/missing history stays
  unknown; no opening capital is reconstructed from the current balance.
- No additional polling, SDK calls or dependency. LiveAccounts remains a lazy
  chunk: 24.88 KB minified / 8.44 KB gzip in the final production build.

## Verification

- `node --test tests/liveAccountModel.test.mjs tests/liveAccountActions.test.mjs
  tests/mt5Connections.test.mjs tests/testingCopy.test.mjs`: 19 passed. Covers
  zero/unknown values, separate currency, initial observation vs deposits/PnL,
  partial removal, unknown write stop and HTTP outcome classification.
- `cargo test --locked --lib mt5_connector::tests`: 7 passed.
- Owned disposable PostgreSQL integration passed; see `backend-final.json` for
  the command result and source hashes. Uses the real native router and DPAPI
  credential handling, with no broker login or owner DB/runtime changes. Verifies
  immutable baseline, generation/workspace isolation, summary/full projection and
  reconnect behavior. The initial failed run `backend.json` is retained: its
  fixture incorrectly assumed generation 2 after lifecycle operations advanced
  it to 4; the fixture now reads the current generation from its disposable DB.
- Final production `npm run build` passed. The existing >500 KB main-chunk warning
  remains; this change does not claim whole-app performance acceptance.
- Browser QA used isolated :5192 with 3 synthetic MT5 and 13 manual rows. Native
  checkboxes showed mixed state, selected page count 10 and all-filtered count 16.
  Selection survived a page change; search/source changes cleared it. Manual-only
  selection disabled Sync. Bulk sync sent exactly error `...0004` and connected
  `...0001`, skipped paused/manual, and continued after the synthetic error.
- Bulk Delete confirmation listed all 16 targets; Escape cancelled and returned
  focus to Delete. No actual account deletion was performed in the browser.
  Write execution/failure behavior is covered by focused unit tests above.
- VI/light at 1440 and EN/dark at 390 verified opening event/sidebar amounts and
  selected-account layout. Opening event rendered 10,000 USD at 21/10/2026 21:29
  UTC. EN bulk action uses Delete rather than Clear. Mobile document width stayed
  390px; wide table content scrolls inside its own region, while actions fit.
  Screenshots in this directory are synthetic UI evidence.

## Runtime boundary

The production web build is available on the existing :5180 static preview.
Actual API :8010 was not rebuilt/restarted or promoted. Its existing connections
therefore do not yet record this new baseline. No MT5 terminal restart, credential
change, real broker sync/order or owner-account deletion was performed.
