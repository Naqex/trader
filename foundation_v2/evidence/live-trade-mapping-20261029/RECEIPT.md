# Live trade mapping — 2026-10-29

## Implemented and verified scope

- Retains the training `TradeLedgerGrid` presentation and interactions. Full
  verified account login, compact Sync badge and existing full-width separators.
- Reconstructs position lifecycles from the complete snapshot before filters,
  sorting and paging. Opening direction, weighted fills, entry/exit dates, profit
  and every known fee belong to one row. The recorded 28 deals form 14 closed
  trades. Incomplete history/reversals/inventory disagreement remain explicit.
- `live/status` adds a whitelist of account/connection-scoped original placement
  facts from persisted receipts, matched to opening deals. No SDK/broker action.
  Receipt revisions invalidate ETags without loading full history on a304.
- Entry type means Market/Limit/Stop, not deal Entry/Exit. Original SL/TP come
  from exact placement provenance. Missing provenance stays unavailable.
- Live R uses actual fill-price movement / original stop distance, signed by
  opening direction, excluding fees. It is not preview monetary risk or
  net-after-cost R. Recorded reference examples: EURUSD1.27R, BTC1.39R.
- Trades sidebar outcome statistics use only completed trades. Shared curve
  hides visible markers while preserving tooltip/focus targets. Calendar keeps
  its existing deal-based coverage/count contract.
- Product display conventions updated. Independent source/preview review found
  no remaining blocker after excluding open trades from outcome statistics.

## Evidence

Local artifacts: `E:/BACKUP-TRADINGWORKSPACE/live-trades-metadata-20261029/`.

- Frontend domain tests:9 passed (`liveBrokerTrades.test.mjs`).
- Native connector unit tests:8 passed.
- Native Router on an owned disposable PostgreSQL database: passed, including
  placement enrichment, tenant isolation and conditional history reads. No
  collector/login/broker execution. `native-pg-test.json`.
- Production UI build + isolated browser QA: PASS,1920darkVI/1440lightEN/390darkVI,
  missing placement provenance and14closed+1open with entry commission. No page
  errors or API writes. `preview-qa/report.json` and screenshots.
- Existing sidebar/shared Analytics regression:7 cases passed, no errors/writes.
- Candidate native/compact idle preflight: passed;16 migrations current, none
  pending. No process stopped or restarted.

## Runtime gate / resume

**Source and preview complete; owner runtime not promoted.** User confirmation
requested for the necessary API cutover + reconnect of the specifically selected
demo terminal, as required by product AGENTS.md. Existing demo-trading permission
does not grant a terminal restart. No order placed in this task.

Candidate API binaries are in `api-target/release`; scoped frontend is in
`source/foundation_v2/web/dist`. `promote.py` is prepared, not executed; it checks
the served index hash and QA receipt, preserves the prior index/assets and
atomically changes the entry index. `native-owner-before.json` and the exact
supervisor command are saved locally for rollback/resume. Use the runtime skill,
fresh ownership/idle checks and retained native/compact configuration before
cutover. Do not use candidate binary paths to stop the old owned processes.

Initial scientific preflight failed: base Python gained two stdlib bytecode cache
files. The installed bootstrap generated `scientific-candidate.json`; executable,
adapter, engine code, package versions and engine-runtime tree match the prior
descriptor. Only base-Python tree changed (+2files/+9162bytes). The fresh full
verification and candidate preflight passed. The original descriptor is saved;
no scientific package or interpreter was installed or modified by this refresh.

Unrelated dirty source/evidence remains outside this commit and scoped UI build.
