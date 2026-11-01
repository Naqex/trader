# API/database audit — one owner

Date: 2026-10-31 (Asia/Saigon). Baseline: Trader `884d04f2`.
Scope: read-only source/schema/test inspection. No API calls, DB queries, writes,
restart, migration, benchmark or broker/provider operations performed by this lane.
All latency effects below are hypotheses to measure, not observed speedups.

## Current architecture and boundaries

- Canonical service: `foundation_v2/api-rust`, Axum/Tokio, pooled local PostgreSQL.
  Native route assembly is `api-rust/src/lib.rs:64–88`; compatibility worker paths
  remain explicit rather than being the default owner of native endpoints.
- Source migrations `0001`–`0020`: 20 files, 44 CREATE TABLE statements and 31
  CREATE INDEX statements. Counts describe DDL source, not the active DB schema.
- Record stores: versioned `workspace_records` (replay/playbook/journal/labels),
  versioned `live_records` (accounts/manual trades/notes), immutable compact replay
  prefixes/events, Prop sessions/attempts, MT5 connection snapshots, research jobs,
  AI runs/agents/documents, private note templates/media, note types and trade groups.
- UI read families: replay/session catalogs and dashboard, derived analytics and
  paged Testing trades, Live record catalog + MT5 snapshots, metadata/templates,
  artifact/chart history, research/AI status. Complex derived trade paging is
  currently done after domain projection, not SQL LIMIT over source fills.
- Good existing boundaries worth preserving: server-owned workspace membership
  (`auth.rs`); local-only bind/database connector (`config.rs`, `state.rs`);
  RepeatableRead/read-only report transactions (`analytics/routes.rs:236–245`);
  immutable revision/cutoff verification (`replay_storage.rs`); transaction-bound
  mutation receipts and unknown-commit outcome (`native_mutation.rs`); capped
  revision-keyed projection cache (24 entries/64 MiB, `analytics/routes.rs:16–67`).
- Existing composite primary/unique indexes cover current-head record joins and
  label source-key lookups. There is no evidence here justifying Redis, a new DB,
  more workers, broad new indexes or a multiuser infrastructure layer.

## Findings ordered by practical value

P2 below means a bounded performance/cost risk visible in source. None is a
confirmed owner-runtime latency regression until measured on the same workload.

| ID | Finding and source | Evidence / effect | Smallest candidate and validation |
|---|---|---|---|
| DB-01 / P2 | Saving a new note validates each newly linked trade independently. `api-rust/src/live_ledger.rs:492–503`; `trade_labels.rs:534–574`. | Up to 500 links are allowed. A broker link rereads/deserializes the same connection snapshot then linearly scans deals/positions on every link; a manual link repeats account existence plus trade existence reads. This matters to the owner workflow because the note picker defaults to many links. | Batch links by connection/account inside the existing transaction, verify all exact IDs against one fetched source per group. Preserve rejection of unknown/cross-account IDs and unchanged-link semantics. Test mixed accounts, missing trade, archived account, dedup, 0/14/500 links, stale revision/idempotent retry in the disposable Live PG fixture. Record SQL count and save latency separately. |
| DB-02 / P2 | A scoped Testing trade projection hydrates all workspace replay records before the downstream session filter. `analytics/routes.rs:193–214, 410–444`; `replay_storage.rs:292–348`. | The SQL reads every current replay payload. Each compact replay then reads storage format/prefix/events and verifies history even if a different session is selected. Cold cost grows with unrelated session history. | Filter supported record IDs in the owning read before hydration while keeping global heads/revision and excluded-source semantics unchanged. Do not skip bad-source validation silently or replace aggregation with raw-fill LIMIT. Use existing analytics oracle + disposable PG fixture; compare one-session vs all-session results and reads with unrelated large sessions. |
| DB-03 / P2 | Testing trade notes/tags repeatedly rescan the full journal array per row. `analytics/trades.rs:206–236, 492–503, 534–539`; `analytics/routes.rs:520–531`. | `decorate` loops over all journals and is called while preparing report/facet, again for facets, and again for filtered rows. Work is O(trades × journals) several times before returning a small page. | Build one request-local index by the exact supported `(session_id, trade_id)` source aliases, keeping union/dedup and authoritative-label behavior. Reuse it across projections. Test aliases, multiple notes, empty/null notes, duplicate tags and authoritative empty labels against the current full-response oracle; benchmark the pure projection with identical inputs. No DB migration needed. |
| DB-04 / P2 | Label SQL is indexed/batched, but Rust scans the assignment result for each trade. `trade_labels.rs:773–807`. | `assignments.iter().find(...)` per row yields O(rows × assignments). In the page path `project` is also invoked for report and facet separately, repeating definition/assignment reads. | Index assignment rows by `source_key`, preserving missing assignment revision=0 and authoritative-empty behavior. Consider request-local reuse of label definitions after the local lookup fix. Validate same response, assignment removal, aliases and workspace isolation using existing `trade_labels_pg` fixture. Measure CPU and SQL counts; do not cache across revisions. |
| DB-05 / P2 | Live records returns every active account/trade/note and full note documents in one response; rejects all query parameters. `live_ledger.rs:273–297`; `web/src/liveLedgerApi.js:3–11`. | Source cap is 10,000 records (`live_ledger.rs:468–475`), each note document can be 200 KB. UI pagination does not bound backend transfer or JSON parsing. One user's years of data can be enough to feel this. | First measure bytes/decode and actual reuse/refetch cadence. If material, add an explicit summary/list read contract with kind/account/filter/page and counts; fetch note bodies only on open. Preserve current endpoint during caller migration. This is a contract change, so do it as its own slice; no silent client-side truncation or arbitrary smaller cap. |
| DB-06 / P2 | Dashboard cold summaries are loaded sequentially per visible session, and profit sorting loads a summary for every candidate session. `analytics/routes.rs:80–113, 778–786, 818–825`. | Warm revision-keyed cache helps. Cold date-sort needs up to page_size per-session loads; profit sort intentionally needs all comparable values for a correct global ordering. Source work is amplified by compact replay hydration. | Measure cold/warm navigation and query count first. Prefer revision-keyed summary reuse/materialization only if needed; batch metadata reads where semantics permit. Never sort just the visible page or mix currencies to make this faster. Test profit ordering across pages, mixed currency, unavailable/unknown PnL, mutation invalidation and timezone basis. |
| DB-07 / P2 | Heavy analytics domain projection, cloning and compact-ledger validation run inline in the async request path. `analytics/routes.rs:415–444, 496–554`; `replay_storage.rs:319–348`. | CPU-heavy Rust is still CPU work. It can occupy Tokio workers during large reports while a second owner interaction is waiting. CSV ingestion already uses `spawn_blocking` (`data_routes.rs:84–86`), showing an existing local pattern. | Attribute CPU vs SQL first. If worker starvation is observed, move only owned pure projection work into bounded blocking work, preserving cancellation/resource budgets and transaction snapshot ownership. Do not hold a DB connection across avoidable CPU stages without measuring. Verify parallel lightweight read responsiveness, output parity, memory and cancellation. |

## Validation and financial contracts

- Existing `api-rust/tests/live_ledger_pg.rs`, `trade_labels_pg.rs` and
  `rust_analytics_pg.rs` are deliberately `#[ignore]` and gated to named disposable
  PostgreSQL clusters. Ordinary `cargo test` success does not prove those paths
  passed. Reuse their Python fixture launchers after reviewing their effects;
  never point ignored tests at the owner database.
- Pure response oracles exist in `api-rust/src/analytics/*oracle*.json` and focused
  multi-sort/null/tie tests in `analytics/trades.rs`. Reuse these for DB-03/04.
- Preserve net/gross/fees, source starting balance, unknown vs zero, account
  currency, session lineage/dedup, page totals/facets, stable null-last sorting,
  exact revision/cutoff and workspace identity. Financial performance is not an
  API microbenchmark verdict.
- Active runtime identity, active migration checksums, query plans and measured
  request latencies remain root's baseline work. This receipt claims source audit
  only and does not close U/Y product acceptance.

## Recommended first backend slice

DB-03/04 are small code-only candidates that retain existing API/DB contracts.
DB-01 follows because it improves a recently requested, concrete note workflow.
DB-02/05/06 require more careful scope/provenance parity. Do not add a DB migration
until query plans or a real contract requirement justify it.

## Receipt — DB-01 review, DB-03/04 implementation (2026-11-01)

Source-only, uncommitted, no migration, no owner 5180/8010 runtime or DB touched.

- DB-01 (`live_ledger.rs` `linked_trade_references`): reviewed existing WIP; kept
  as is. Newly added links are grouped; one `mt5_connections` read for all broker
  connections and one current-head `live_records` read for all manual accounts/trades,
  both `workspace_id`-scoped inside the existing transaction + advisory lock.
  Caller order of the first error, archived-account rejection, cross-account and
  cross-workspace rejection, NULL snapshot and unchanged-link skip are preserved.
- DB-03 (`analytics/trades.rs` `JournalIndex`, `routes.rs`): journals are indexed
  once per request by exact `(session alias, trade alias)` JSON value; `decorate`
  visits only matching journals in original order. Unit test compares against the
  previous linear scan (aliases, numeric vs string ids, null/missing source,
  authoritative labels, empty/whitespace notes, tag order/dedup).
- DB-04 (`trade_labels.rs` `project`): assignment rows indexed by `source_key`
  (first row wins, same as the old `find`). `project` is still called separately
  for report and facet, so definitions/assignments are still read twice per page.

Validation:

- `cargo test --locked --lib`: 249 passed (before the DB-03 parity test); then
  `cargo test --locked --lib -- analytics trade_labels live_ledger`: 40 passed.
  Includes `trade_multisort_oracle.json` full-response oracle.
- Disposable PG: `tests/live_ledger_pg.py` → `api-note-link-integration-r2.json`
  PASS, 2/2 tests, validation SELECTs empty/14/500/unchanged = 0/1/2/0;
  `tests/trade_labels_pg.py` → `api-trade-labels-pg-r1.json` PASS, 1/1.
- `tests/rust_metadata_parity.py --extra-test rust_analytics_pg`: r1 failed before
  cargo because the harness `TRUNCATE ... CASCADE` (unchanged from HEAD) is rejected
  by the `tw_replay_execution_immutable` trigger. Harness-only fix: after the Python
  golden phase, create and migrate a second fresh `rust_metadata_<uuid>` database
  in the same disposable cluster and point Rust at it. Trigger/migrations/production
  code are unchanged. r2 → `api-analytics-pg-r2.json` PASS: `rust_metadata_parity`
  1/1 (48 golden cases), `rust_analytics_pg` 1/1 including `/api/v2/replay/trades?page=1`
  before/after restore. That fixture has no journals or label assignments, so it
  proves the DB-03/04 path on PG with empty indexes only; non-empty matching is
  covered by the unit parity test and `trade_labels_pg`.
- rustfmt clean for the changed files except `live_ledger.rs`, which had fmt drift at HEAD and
  was not reformatted. Clippy has no new warnings in the changed code.

Not claimed: latency/CPU improvement, SQL count for DB-03/04, owner runtime behavior.
