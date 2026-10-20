# Live UI follow-up — 21 October 2026

This is a scoped follow-up to the Live/Strategy/Analytics implementation and local
activation receipts. It does not mark the whole product or broker integration accepted.

## Confirmed defects and changes

- Reproduced in the browser: apply Buy, then change strategy → the page remounted,
  cleared Buy and displayed Sell records. Live now treats strategy as a URL filter,
  while Practice/Playbook/Analytics retain resource identity for strategy revisions.
- Account selection is derived from the URL, not a one-time local copy. Account
  changes create history entries; Back/Forward restores the matching currency/data.
  Account-specific basic/tag filters reset when the account changes. A strategy
  change preserves them. Hidden manual strategy/tag filters do not apply to broker fills.
- Note tag choices are derived before text search. A selected tag remains visible
  when it produces no matches; filtered-empty text differs from an empty journal.
- Loaded notes remain fully readable when the strategy catalog cannot load. The
  shared modal supplies focus trapping, Escape, opener restoration and theme styling;
  writes stay disabled. Denied ledger reads clear the loaded records.
- Monthly review records account, timezone, strategy/tag scope and applied filters,
  and seeds the selected strategy revision. Unknown monthly totals cannot create a
  summary. Notes without a manual account default to general scope.
- Outcome filters now use the same ±1e-12 break-even tolerance as closed-trade
  statistics. Tag search has its own no-match state; zero/unknown PnL uses neutral
  text. Tag-bar scale is computed once without spreading an unbounded argument list.

The URL owns account/strategy selection; the reader owns applied/draft filters and
loaded journal data. No server schema, calculation authority, shared UI snapshot,
broker execution capability or owner financial record was changed in this slice.

## Verification

- `node --test --test-concurrency=1 tests/*.test.mjs`: **427/427 PASS**.
  New cases cover Live filter identity and exact break-even boundaries, including
  unknown costs. Full output: `node-tests.log`.
- `npm run build`: PASS. Existing main-chunk warning remains (~603 kB before gzip).
  Output: `build.log`.
- Browser: **15/15 checks PASS**, enumerated in `browser-checks.json`.
  Real disposable PostgreSQL/API on 18011, Vite on 5183; synthetic account/trade/
  strategy fixtures only. No provider/broker connection.
- USD 3 records = net 94; EUR 1 record = net 49. Back/Forward keeps these separate.
  London + Buy retains 2 records = net 196.5 USD. Monthly note persisted through
  navigation with v2 and the displayed scope. Search and tag intersection stayed
  explicit rather than hiding the selected tag.
- Catalog network failure: long note opened read-only, including its fifth line;
  Escape restored the opener. Dark desktop and light 390 px dialog screenshots
  reviewed; mobile body width 390, dialog x=16,width=358 (no page overflow).
- Synthetic 403 ledger response: notes cleared, write actions disabled; retry
  recovered the records. Interception was removed after testing.
- Independent source review by `ui_final_review`: initial four findings fixed;
  follow-up review found no additional user-impacting issue in the reviewed diff.
- Main 5180: final `index-CojGrfe3.js` loaded, empty owner journal rendered, no
  console errors. Main API `/health/ready`: `ok=true`, database ready.
  Main database was read only; no migration/restart was needed for these UI changes.

Screenshots: `strategy-filter-dark.jpg`, `readonly-note-dark.jpg`,
`readonly-note-light-mobile.jpg`. These images use synthetic financial records.

## Limits and continuation

The populated journeys prove the manual journal, not a connected broker. The
broker filter guard was source-reviewed; no broker/provider acceptance is claimed.
Previous Strategy revision/Practice handoff and Analytics fixture evidence remains
in `../live-strategy-audit-20261020/CHECKPOINT.md`; main backup/migration evidence is
in `../live-strategy-activation-20261021/CHECKPOINT.md`.

Source hashes are recorded in `source-hashes.json`. Temporary fixture services and
QA tabs are cleaned up after verification; main 8010/5180 stay running. Existing
unrelated working-tree changes were preserved.
