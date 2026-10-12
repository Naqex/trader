# Workspace read invalidation signals

The existing `GET /api/v2/events` `snapshot` event keeps schema `workspace-events-v1`, download/research projections, and the compatibility `commands` projection. It adds:

```json
{"resources":{"sessions":{"revision":"opaque 64-character equality token","count":0},"datasets":{"revision":"opaque 64-character equality token","count":0}}}
```

Compare resource tokens, never the whole snapshot revision, to refresh session or dataset readers. Read API commands, progress ticks, and changes in another workspace do not affect these tokens. The first snapshot and reconnect carry the complete current token set; clients reconcile reads after reconnect because this channel is not a durable event log. Tokens are not monotonic, ordered event IDs, financial provenance hashes, or authorization proofs.

Session marks include every current replay revision and its tombstone, plus persisted replay activity intervals used by reports. They exclude raw replay payloads, prices, positions, orders, and ledger rows. `count` is non-deleted saved sessions, including archived sessions; the filtered catalog remains the source for displayed session counts. Dataset marks include dataset ID, artifact digest, and a digest of manifest metadata, so manifest-only updates and physical removals are observed. The dataset count includes every saved manifest in the scoped workspace. Query parameters always bind the authorized workspace ID.

Two independent PostgreSQL 64-bit metadata hash sums, mark count, resource count, resource name, and workspace ID are sealed as an opaque SHA-256 token. The aggregate has fixed memory/result size rather than concatenating every record into one large string; it is a practical change fingerprint, not a mathematical collision-free sequence. The scan is O(session metadata + activity metadata + dataset metadata), and manifest digest work scales with manifest size. It performs no canonical analytics computation or full replay payload/ledger deserialization. If these metadata scans become a measured bottleneck, transactional persisted workspace change counters are the next optimization; they require coverage of all native and Python mutation owners rather than an unsafe recent-record shortcut.

The existing shared poller runs every two seconds, one per connected workspace. Updates are therefore near realtime with a two-second sampling window, not instantaneous event delivery. Query work remains subject to the existing pool, statement, and snapshot deadlines. SSE connection budgets remain 8/workspace and 64 total, with latest-value buffering and disconnect cleanup.

## Validation

- `cargo fmt --check` and `cargo check --locked`.
- Focused event unit tests: workspace/resource scoping, token aggregate fields, deterministic empty state, bounded snapshot, latest-value buffering, permit cleanup.
- `tests/run_events_parity.py`: owned disposable PostgreSQL, 16 existing job/checkpoint parity cases, actual Axum socket SSE; no owner DB/provider/broker access.
- New SSE cases: 30-session insertion, old/off-page revision with unchanged timestamps, tombstone deletion, persisted activity, dataset manifest-only edit, add/remove, tenant isolation, command-only snapshot preserving resource tokens, no session IDs/secret replay payloads in stream, current snapshot on reconnect.
- Existing startup migration checks, research/download durable updates, stream admission and disconnect release remain covered.
- Exact resource SQL `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` on 1,000 and 10,000 synthetic session metadata rows is recorded in `server-parity.json`. These local fixture query numbers do not represent end-to-end API latency or a production multi-user capacity promise.

| Synthetic session metadata | Query execution | Resource JSON | Shared block hits | Temp blocks |
| --- | --- | --- | --- | --- |
| 1,000 | 4.85 ms | 206 bytes | 3,017 | 0 |
| 10,000 | 53.40 ms | 207 bytes | 30,146 | 0 |

The benchmark deliberately leaves fixture planner statistics stale. An early ordinary join chose a quadratic join-filter plan under that condition. The final query requires a primary-key lookup of each exact current revision through a bounded lateral subquery and uses two plain aggregates without token sorting. The fixture now asserts full `record_id`/`revision` index predicates and absence of a sort node, so this regression cannot silently reappear in the covered fixture.

Reproduce from `foundation_v2/api-rust` with the product Python environment and an owned fixture PostgreSQL binary directory:

```powershell
cargo test --locked events::tests -- --nocapture
& ../.venv/Scripts/python.exe -B tests/run_events_parity.py --pg-bin <fixture-pg-bin> --output ../evidence/testing-realtime-20261012/server-parity.json
```
