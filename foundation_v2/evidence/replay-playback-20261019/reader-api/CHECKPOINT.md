# Bounded native replay artifact reads — 19 October 2026

The owner requested further optimization of historical replay, including the
remaining full opening/rewind paths. This extends the history-v1 checkpoint;
it does not change the API contract, execution engine or frontend state model.

## Cause and change

The representative owner dataset has about 8 million rows in 50,000-row Parquet
groups. An index request for roughly 2,000 candles previously converted the entire
intersecting group into JSON before slicing it. Timestamp columns were also
decoded repeatedly while projecting the same immutable artifacts.

`ArtifactData::indices_with_stats` now stops its iterator at the requested end
and converts only the requested rows into JSON. Rows before the start still need
native decoding; this is not a universal O(window) random-access reader.
Complete-group consumers retain their existing behavior. A shared LRU retains
up to 32 timestamp groups and 16 MiB of timestamp values, keyed by file object,
device, size, modification/change stamps and group. Open-time SHA admission and
finish-time identity checks remain in place, including on timestamp cache hits.
In-flight Arc references can outlive eviction: 16 MiB is the retained cache budget,
not a process-wide memory limit. No workspace permissions or responses are cached.

The data path remains React → Axum → revision-bound domain projection → immutable
artifacts/PostgreSQL. No new dependency, migration or client synchronization
protocol was introduced. Optional `TW_V2_REPLAY_TIMINGS=1` now attributes historical
projection phases; it remains disabled in the normal runtime.

## Measurements

Same machine, release builds, serial requests, owner revision 92/canonical 3129,
starting historical cursor 2997. Owner API calls were GET-only. No compilation ran
during the measurements below. These small samples diagnose this workload;
sample p95 is not a capacity or stable-tail claim.

| Measurement | Before median | After median | Samples |
| --- | ---: | ---: | ---: |
| Native router, forward history |560.7ms|102.1ms|6 paired, alternating order |
| Native router, full rewind |619.2ms|461.9ms|6 paired, alternating order |
| HTTP + JSON decode, warm forward |571.0ms|97.9ms|5 warm per runtime |
| Browser step through two animation frames |599.9ms|181.9ms|5 matched cutoffs per runtime |

Paired median candidate/baseline ratios are 0.1845 for forward and 0.7362 for
rewind. Every router pair had identical JSON output. HTTP full/delta reconciliation
also matched exactly; final payload digests match across the runtime change.
Forward wire size remains about 9.24 KB; full responses remain about 7 MB.

The first full request in each fresh probe process remained about 2.3s with warm
OS file caches, measured separately from the forward/rewind rows. It still pays
initial artifact hashing and full history projection. Opening/rewind keep their
full contracts, and their ledger decoding/serialization remains a cost. This
change does not claim instantaneous cold opens or smooth high-speed playback.

Raw paired samples and binary identities: `paired-router.json`. HTTP samples:
`http-baseline.json`, `http-candidate.json`. Real browser samples/screenshots:
`../reader-baseline-idle/`, `../reader-candidate-idle/`. The earlier
`../reader-baseline/` run overlapped debug compilation and is excluded.

## Correctness and runtime

- 42 focused replay Rust tests passed, plus the timestamp identity/group/LRU/
  oversized-entry unit test.
- Python/Parquet differential oracle passed both integration tests, including
  null/uint64 values, gaps, cross-group windows, timing/cursor/calendar queries,
  native publication and changed-file rejection with restored mtime. A 20-row
  window in a 50,000-row group now visits 30 native rows, rather than materializing
  all 50,000. See `artifact-parity.json` and `artifact-parity.txt`.
- Disposable PostgreSQL full/compact acceptance passed 22 real-server responses
  reconciled by production JS: financial/cutoff parity, pending orders, revision
  invalidation, tenant isolation, two initialized assets, gaps, null execution,
  restart and unchanged durable-state signatures. See `disposable-acceptance.json`.
- Both idle browser runs passed step/cutoff checks, pan/timeframe/synced playback,
  pause during an in-flight read, rewind/latest, 360/768/1368px toolbar bounds and
  injected 503 recovery retaining the chart. Zero page errors or widget remounts.
  Candidate desktop/mobile screenshots were visually reviewed.
- The final API was activated using idle/schema/capability preflight, guarded
  owned-process stop and restart, retaining native/compact and both existing
  capability descriptors. No schema change or provider action. Old binaries were
  retained locally for rollback. `runtime-candidate.json` records readiness and
  executable identity; its memory snapshot is not a controlled peak comparison.

Reproduce the paired router measurement from the product root, with existing
local database credentials in `TW_V2_DATABASE_URL`:

```powershell
foundation_v2/.venv/Scripts/python.exe -B foundation_v2/scripts/benchmark_replay_reader.py --baseline <baseline-probe.exe> --candidate foundation_v2/api-rust/target/native-candidate/release/examples/rust_replay_mutation_probe.exe --database trading_workspace_v2_exness_history --artifacts foundation_v2/.runtime/exness-market-data --session 6428cf18b3f54a36b2e90207ef12392e --cursor 2997 --samples 6 --output foundation_v2/.runtime/reader-recheck
```

Artifact oracle: `scripts/rust_artifact_parity.py`; isolated API acceptance:
`scripts/rust_replay_history_acceptance.py` (both under `foundation_v2`). Browser:
`node run_replay_playback_acceptance.mjs <unique-label>` from `foundation_v2/web`.
No broker execution, holdout access, owner replay mutation or public deployment
was part of this task.
