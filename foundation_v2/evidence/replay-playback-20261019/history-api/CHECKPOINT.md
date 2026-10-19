# Forward historical API optimization — 19/10/2026

Scoped follow-up to the parent replay playback checkpoint. Product baseline HEAD
was `856529e`; the pre-existing Prop auto-initialization dependency hunk in
`ReplayWorkspace.jsx` remains excluded. This is a local offline runtime update,
not broker execution or full-product acceptance.

## Result and contract

The web client now uses opt-in `replay-history-v1` for forward historical BAR
reads. Each response contains the new candles, exact execution/portfolio heads
and separately identified ledger suffixes instead of resending retained history.
The client verifies revision, base cutoff, session/workspace/dataset lineage,
contiguous sequences, window bounds and the visible replay clock before merging.
Reads never advance the saved session or create execution receipts.

The API checks the current scoped revision/deletion marker in a repeatable read
transaction. A process-local LRU retains at most3 fully validated immutable BAR
snapshots with a conservative96MiB JSON allocation estimate. Queue-only revisions
also invalidate the cache key. Cold admission uses existing hydration and core/
portfolio validation; warm reads borrow the selected prefixes without cloning
the full ledger. Portfolio checkpoint arithmetic and closed-trade cursor mapping
are shared with the full reader. Unsupported schemas, phases beyond1 and cutoffs
preceding initialization retain the full contract. No database migration/import
or stored-user-history rewrite was needed; the reported owner session still uses
legacy full-snapshot revisions despite the runtime's compact-storage profile.

## Equivalent real-session measurements

Owner session `6428cf18b3f54a36b2e90207ef12392e`, tenant-a, revision92,
canonical3129, start cursor2997, two configured assets, same Windows host,
API8010 and production Vite preview5180. The timings below are small serial
diagnostics, not stable tail estimates or capacity/60fps claims.

Direct HTTP comparison alternated full/delta order at the same six consecutive
cutoffs, including JSON decode. Every merged response equaled the full response,
including all ledger entries, pending orders, positions, PnL and candle rows.

| Metric | Full contract on candidate API | history-v1 |
| --- | ---: | ---: |
| Warm median, n=5 | 785.4 ms | 565.1 ms |
| Warm sample p95, n=5 | 973.7 ms | 659.2 ms |
| Payload per one-bar read | about7.0 MB | about9.24 KB |
| First delta after API restart | — | 692.6 ms |

Warm median API latency fell28.1%; payload fell99.87%. The cold delta sample is
labeled separately and excluded from the warm median. Raw alternating samples,
initial full-read timing, revision and final payload digest are in
`http-measurements.json`.

The browser harness measured five one-bar clicks through delivery of
the exact cutoff candle and two animation frames, fresh isolated Chromium
contexts at1368×790. Both runs use the same final production build and API with no
Rust compilation running. `TW_REPLAY_QA_FULL_HISTORY=1` removes only the opt-in
response-view parameter in the browser's outgoing request; the server returns
its normal full contract and the production client accepts that compatibility
response. No response body is mocked or rewritten. The following ordinary run
uses history-v1. The history and artifact-verification caches are warm after the
HTTP diagnostic. All owner-session API writes were blocked, including activity logging.

| Browser journey | Full contract | history-v1 |
| --- | ---: | ---: |
| Median step, n=5 | 1033.9 ms | 659.2 ms |
| Sample p95 | 1149.6 ms | 817.8 ms |
| Widget recreations during five steps | 0 | 0 |
| Maximum sampled parent animation-frame gap | 33.4 ms | 33.4 ms |

Median click-to-candle latency fell about36%. Raw browser data is
`../api-full-contract/measurements.json` and `../api-delta-verified/measurements.json`.
Screenshots from the final journey were inspected; chart geometry and controls
remain intact. This does not claim sustained60fps: steps still take roughly0.6s
to0.8s in this workload. The path still reads native candle/timing windows and projects
multi-asset state; retained client ledger concatenation also grows with history.

## Verification and runtime

- 42 focused Rust tests passed, including partial-TP reconstruction equivalence,
  existing portfolio phase behavior, exact-revision/tenant cache keys and LRU
  eviction.
- 63 focused Node tests passed: history/step transport, wrong scope/base, malformed
  or future rows/events, rolling2000 candles, chart tail delivery, pending history,
  calendar aggregation, saved-layout cutoff and accessible replay controls.
- Disposable PostgreSQL acceptance passed both full and compact storage. It
  covered fills/exits, pending orders with no new event, stale revision/cutoff/
  sequences, tenant isolation, read-only durable-state signatures, cold restart,
  null execution, time gaps, oversized-interval rejection, canonical fallback,
  two initialized assets and completed portfolio future-row semantics. Production
  JS merged22 actual server responses exactly equal to their full counterparts.
  See `disposable-acceptance.json`.
- Production web build passed with the existing large-main-chunk warning.
- Real browser journey passed five steps, start-candle selection with no layout
  shift, continued Play across pan/timeframe/synced interval changes, Space pause
  during an in-flight read, safe rewind, return to latest,360/768/1368px toolbar
  bounds and a503 read retaining the last chart while locking stepping. No page
  errors or attempted non-activity writes occurred.
- The final native/compact candidate was activated via owned-PID stop, idle/schema/
  capability preflight and the guarded restart wrapper, preserving the existing
  scientific and legacy codec descriptors. Readiness passed. `runtime.json`
  records the binary hash/run and one post-diagnostic memory snapshot (about129MB
  working set); it is not a controlled memory comparison or process-wide cap.

Earlier development attempts remain under ignored `.runtime/history-*`: the
transport-only candidate reduced bytes but was slower, and was rejected; an
uninitialized payload-cursor assertion and completed-portfolio flag were caught
by differential tests before the final promotion. An initial pre-cutover browser
run overlapped Rust compilation; its larger1.49s baseline was excluded from this
controlled same-build comparison. A launcher attempt with relative
capability paths failed before startup and was rerun with verified absolute paths.
The final receipt does not count any of those failures as passing evidence.

Reproduce from the product root:

```powershell
cargo test --manifest-path foundation_v2/api-rust/Cargo.toml --lib replay_
foundation_v2/.venv/Scripts/python.exe -B foundation_v2/scripts/rust_replay_history_acceptance.py --probe foundation_v2/api-rust/target/native-candidate/release/examples/rust_replay_mutation_probe.exe --output foundation_v2/.runtime/history-recheck
foundation_v2/.venv/Scripts/python.exe -B foundation_v2/scripts/benchmark_replay_history.py --session 6428cf18b3f54a36b2e90207ef12392e --cursor 2997 --output foundation_v2/.runtime/history-http-recheck.json
```

From `foundation_v2/web`, run the test files listed in the parent checkpoint
plus `tests/replayHistoryView.test.mjs`, `npm run build`, and
`node run_replay_playback_acceptance.mjs api-delta-verified`. For the full-contract
browser control, set `TW_REPLAY_QA_FULL_HISTORY=1` and use another output label.
A rerun overwrites its output
directory; choose another phase label to preserve this acceptance run. No broker,
holdout, provider action, migration or public deployment was performed.
