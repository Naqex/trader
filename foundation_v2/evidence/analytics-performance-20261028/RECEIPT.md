# Analytics performance receipt — 2026-10-28

Scope: read-only native Router probe for one real Prop replay (`d848723290084cf98e8d03de6cff4dbf`), compact storage, same database/artifacts, baseline binary copied from the active owner runtime, candidate built from this source tree in `E:/BACKUP-TRADINGWORKSPACE/analytics-performance-20261028-candidate`.

Change: the analytics experiments reader previously decoded bars from index `0` through the replay cutoff. It now finds the earliest selected trade entry per dataset, reads only that range through the same immutable cutoff, and carries the absolute index offset through exposure and ideal-week calculations. It does not change filters, provenance, cutoff, revision, dataset hashes, or financial formulas.

Evidence:

- `candidate-receipt.json`: six alternating warm samples for the base analytics endpoint. Exact JSON parity passed. Median 90.802 ms baseline vs 89.218 ms candidate; this endpoint was not the main bottleneck.
- `experiment-error-receipt.json`: the slow experiments request returned the same existing `422 replay_experiment_invalid_source_or_config` because the real fixture's recorded trade time does not match its dataset row. Baseline 25,703 ms router time; candidate 1,778 ms (93.1% lower). The candidate preserves the status and error contract while avoiding the 8-million-row read before the error.
- `source-baseline-*.json`: raw baseline response parity samples.

Validation: focused Rust unit tests for trimmed single-asset and portfolio paths passed; `rust_context` test target passed 3/3. Candidate release API and probe binaries built under `E:/BACKUP-TRADINGWORKSPACE/analytics-performance-20261028-candidate`. The guarded candidate cutover was attempted after owner authorization but stopped before start because all existing scientific capability descriptors were stale; the old native/compact API was then restored and `/health/ready` passed. The candidate was not deployed. The restored launch intentionally omitted the stale scientific descriptor; refreshing that descriptor is a separate runtime configuration task and remains pending.

Limitation: the deployed runtime still needs a guarded, authorized promotion and a real browser recheck. The fixture timestamp mismatch is a separate data/correctness issue; this performance change intentionally does not reinterpret it.
