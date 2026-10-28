# Analytics performance receipt — 2026-10-28

Scope: read-only native Router probe for one real Prop replay (`d848723290084cf98e8d03de6cff4dbf`), compact storage, same database/artifacts, baseline binary copied from the active owner runtime, candidate built from this source tree in `E:/BACKUP-TRADINGWORKSPACE/analytics-performance-20261028-candidate`.

Change: the analytics experiments reader previously decoded bars from index `0` through the replay cutoff. It now finds the earliest selected trade entry per dataset, reads only that range through the same immutable cutoff, and carries the absolute index offset through exposure and ideal-week calculations. It does not change filters, provenance, cutoff, revision, dataset hashes, or financial formulas.

Evidence:

- `candidate-receipt.json`: six alternating warm samples for the base analytics endpoint. Exact JSON parity passed. Median 90.802 ms baseline vs 89.218 ms candidate; this endpoint was not the main bottleneck.
- `experiment-error-receipt.json`: the slow experiments request returned the same existing `422 replay_experiment_invalid_source_or_config` because the real fixture's recorded trade time does not match its dataset row. Baseline 25,703 ms router time; candidate 1,778 ms (93.1% lower). The candidate preserves the status and error contract while avoiding the 8-million-row read before the error.
- `source-baseline-*.json`: raw baseline response parity samples.

Validation: focused Rust unit tests for trimmed single-asset and portfolio paths passed; `rust_context` test target passed 3/3. Candidate release API and probe binaries built under `E:/BACKUP-TRADINGWORKSPACE/analytics-performance-20261028-candidate`. The guarded candidate cutover was attempted after owner authorization but stopped before start because all existing scientific capability descriptors were stale; the old native/compact API was then restored and `/health/ready` passed. The candidate was not deployed. The restored launch intentionally omitted the stale scientific descriptor; refreshing that descriptor is a separate runtime configuration task and remains pending.

Limitation: the deployed runtime still needs a guarded, authorized promotion and a real browser recheck. The fixture timestamp mismatch is a separate data/correctness issue; this performance change intentionally does not reinterpret it.


## Follow-up: demand loading and guarded promotion — 2026-10-28

The pending API candidate is now deployed, native/compact on loopback8010. Exact deployed API SHA256: `64887cf9230252e2b888b91fdf9736bc8ac5c684d30adfb3435cda3aca70764d`. The stale scientific descriptor was rebuilt from the existing installation, with Python3.12.10 / PyArrow25.0.1 / Nautilus1.231.0 unchanged. Only dependency-tree fingerprints differed from the previous descriptor; engine/adapter identities were unchanged. Full launcher verification, idle/download checks, old-binary ownership stop, candidate readiness and hash verification passed. Scientific and legacy capabilities, native/compact storage, DB/artifact roots, QDM and the installed AI workflow interpreter were retained/restored. No migration, provider/broker action or dependency installation was performed. Private manifests/descriptors/rollback logs stay under `E:/BACKUP-TRADINGWORKSPACE/analytics-loading-20261028`.

UI behavior/data flow:

- Each report tab mounts on first visit and remains mounted while hidden after that. This avoids constructing all3 reports at entry, while retaining Monte Carlo inputs and completed scenarios on tab revisit.
- Default price-path data is requested when the active Performance RR or Drawdown MAE region approaches the viewport. Nonzero breakeven classification also requests R immediately, because missing R can otherwise remove every row before an observer exists. Scenario requests remain explicit Run actions.
- One request owner uses workspace + analytics path/filters/cutoff + revision + refresh generation. Revisited consumers reuse its result; scope changes abort old reads and hide stale payload/errors. Financial summaries continue using the complete ledger.

Verification:

- `loading-browser.json`:7 fixture journeys passed on scoped production preview and again after promotion on5180, including direct links, keyboard/Back, state retention,390px offscreen loading, delayed stale responses, error/source reset and missing-R/outcome-filter recovery. No JavaScript errors or writes.
- Focused analytics view/presentation/simulation/Prop model tests:38 passed. Existing Prop PnL production-browser regression:8 journeys passed.
- Independent source/test review identified the threshold dependency above; it was fixed and its browser oracle passed before reviewer clearance.
- `loading-real-browser.json`: alternating real Prop read-only runs with the same optimized API,3 samples per UI. Initial-render median1074ms old UI vs1025ms candidate; sample is too small for a stable percentage claim. Old UI mounted3 reports; new UI mounted1. Direct Simulation made no default experiment request. Deployed recheck: Performance1081ms, Simulation1046ms. These are report-render timings, not successful experiment timings.
- Scoped HEAD +2 intended source overlays built on E; unrelated WIP excluded. UI entry was promoted atomically with old assets and rollback index retained. Served index hash verified: `d6966893f3f37df008dcb2925d1c1c961791770b24dc6f49cf6a88625c80fe51`. See `loading-promotion.json`.

Remaining limits: the real replay's existing422 timestamp mismatch persists; this is not successful simulation acceptance. Trade-grid API paging already sends page/size/sort/filter to the backend, which currently projects/caches all selected trades before slicing; it is not SQL-level pagination. Prop Analytics has no separate trade grid to paginate. Full report formulas must not run on a truncated page. This slice removes unnecessary tab mounting/path reads and bounds historical bars; it does not claim large-ledger server aggregation or every possible Analytics optimization complete.
