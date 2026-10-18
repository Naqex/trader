# Rust-native whole-project optimization — 17 October 2026

Active goal, not completion. User explicitly approved whole-project optimization,
large architecture changes, goal mode and subagent work. Starting product HEAD
`22c91a0` on `Nam`; existing tracked changes in ReplayWorkspace.jsx, learnIntegration.css,
visual-polish.css, api_platform_acceptance.py and historical evidence are unrelated
and must remain unstaged. No owner replay/Prop session or broker is a test fixture.

Product scope/acceptance belongs to the execution extension in the canonical
Product Completion Plan. This file owns implementation evidence and resume details,
not a competing product ledger. API-only architecture is verified in
`docs/API-STACK-DECISION-20261009.md`; 105 frozen command routes plus native routes
outside that manifest must be accounted for, without treating route count as a
percentage of migrated business logic.

Ownership for this run:

- Root: native atomic mutation receipts, routing, dependency/runtime integration,
  overall acceptance and independent review.
- replay-core: pure replay/financial/tick transforms and differential fixtures.
- replay-service: native persisted replay API and projection, integrated with core/data/Prop.
- prop-core: pure Prop lifecycle/money/calendar/paper transforms and differential fixtures.
- data: native verified immutable Parquet reader and bounded/pruned replay reads.
- metadata: playbook/journal/annotation writes and common frozen body schema validation.
- analytics: native financial read models and routes with exact scope/lineage semantics.
- controls: static/local control and education reads, cost/news/instrument validation.
- runtime: native research admission/cancel and checksum schema lifecycle; adapter inventory.
- frontend: measured dependency graph/request/render improvements, existing UI direction.

Nothing is promoted to the running API until contract, isolated PostgreSQL and
meaningful browser checks pass. No automatic full-product or production acceptance.
Native writes use existing api_commands result receipts in the same PostgreSQL
transaction as domain effects; foreground execution does not enqueue a worker task.

Current resume: integrate modules and locked dependencies, run their differential
fixtures, fix failed cases, then route only verified coverage. Parquet dependency
needs explicit flate2-rust_backend (plain flate2 provides no backend when defaults
are disabled). Preserve this failed build as diagnostic, not successful validation.

## Integrated continuation, 17 October 2026 (goal remains active)

Native modules are integrated for replay/Prop, metadata, analytics/context,
control, Notion OAuth, CSV import/repair/delete and provider GET projections.
Owner API8010/UI5180 have NOT been promoted/restarted with this candidate.

Verified scoped evidence:
- Release full-router persisted replay/Prop/analytics/context: 126 cases; newer
  debug strict extension132 cases includes malformed dates, missing/hash errors.
  See replay-service-persisted-acceptance.md and receipt probe SHA values.
- Exact Prop Decimal438 fixtures; independent reviewer added corrupt-phase
  detail/list503 regression (PG result must be inspected before acceptance).
- OAuth11tests including46Python cases, actual socket/multiworkspace callback,
  no redirects/retries, and disconnect generation fence. This last fence is an
  intentional security strengthening versus Python baseline.
- Immutable publication helper in artifact_data reused by research and data
  lifecycle: Windows create-only MoveFileExW WRITE_THROUGH; Unix hardlink + fsync.
  Winner-preservation unit passed. Writer writable-handle sync fixed Windows
  read-only File::sync_all AccessDenied; full reader/writer fixture previously PASS.
- Context262pure cases,48CSV exact bytes,70persisted context/base cases passed.
- Research reference230/OOS80exact cases passed; independent Decimal oracle,
  regime support, native scientific normalization/process orchestration stillWIP.
- Data162CSV+420003row legacy exact codec rerun must inspect latest receipts;
  prior400003row was under10MiB, do not claim it tested old10MiB guard removal.

Latest release router/stdio diagnostic benchmarks: quick p50/p9512.04/21.92ms,
protection11.17/16.17ms(n90,max76.27), step11.67/15.38ms. Python direct-service
has different measurement boundary; no HTTP/UI speedup/capacity claim.

Runtime work: run_api_platform.py native/compatibility profile split, separate
candidate target, Rust admin+research worker roles, PID/creation/executable/hash
manifest and startup-token readiness;22launcher tests passed per lane.
Actual isolated runtime acceptance and rollback still outstanding. API readiness
now snapshots runtime profile perAppState and refuses native-ready if remaining
command manifest nonempty; no command worker required when manifestempty.

Unfinished source must remain failclosed/unpromoted:
- provider_routes/execution.rs implements bounded pinned vendor process lifecycle,
  but publish() is currently provider_publication_initializing and nativeconfigured
  write routes/main startup are not mounted. Need finish publication+full tests.
- research worker has close-delta/ref/OOS dispatch+readyfile; Nautilus stillunclaimed;
  scientific_normalize.rs not yet created. Independent oracle/regime tests pending.
- frontend_latency planned advancedOrderOverlay.js hotpath but quota interrupted;
  inspect diff before assuming any changes. No owner session used.
- probe supports bounded32item concurrent batch on sameRouter/AppState with ordered
  outputs and perrequestelapsed_us; scaling/concurrency harness remainsWIP.

All child agents hit shared usage limit during continuation; root continues from
on-disk ownership. Do not spawn duplicates/retryaccounts to bypass limits.
Root repaired provider execution date replace compileerror. Latest
cargo check --locked --all-targets PASS withWIPwarnings; full cargo test session38104
running at this checkpoint. No backend commit yet; preserve unrelated trackedUI
and historical evidence dirt. Need inspect every receipt, final review/checks,
coherent commits, setup/runtime/UI benchmarks and documentation before goalcomplete.

## Root continuation: streaming publication, recovery and regime verification

Goal remains ACTIVE; owner API8010/UI5180 are unchanged. This section supersedes
the earlier WIP descriptions only where explicit results below establish progress.

- Frontend commit 735effa removes repeated native price writes and recurring
  synchronous marker geometry reads. Production React + real Advanced Charts,
  identical synthetic API, six gestures: price-write median/p95 74/74 -> 12/16;
  layout count91/91 ->21/26. The nine-case browser regression passed. Rendering
  diagnostics only: frontend/DRAG-REVIEW.md and its raw receipts own this evidence.
- Replay snapshot ownership and combined current-quote transition reduce copies
  while retaining financial validation. replay-scaling-owned-after/receipt.json
  passed180 persisted cases. At5000events, diagnostic quick router time646.1 ->
  372.1ms; full stdio762.4 ->487.8ms. Response remains about3.1MB; long-history
  validation/storage/response remain unresolved. Samples are small and boundaries
  differ from Python direct-service. No HTTP/UI speedup or capacity acceptance.
- Independent Decimal validation now covers the230case reference corpus
  (200valid outputs and30rejections);
  reference artifact-tampering test passed. OOS80cases passed. The new regime
  Python differential found the nonobject-segment error mismatch, now repaired:
  runtime/regime-root-fixed/receipt.json passed64cases. Keep regime-root and
  regime-root-expanded failed receipts as diagnostics, not overwritten successes.
- data/streaming-large-root previously passed48metadata cases plus import,
  repair/adoption/corruption/delete workflow, with exact legacy PyArrow hashes for
  2/50003/420003rows; the largest raw source is10907865bytes (>10MiB).

New streaming implementation (still candidate source):
- ArtifactData writes from borrowed or owned row iterators in50000row batches;
  raw-source writes copy/hash64KiB blocks. Buffered callers avoid extra row clones.
- Provider preparation uses per-attempt synced CSV/NDJSON files, one normalized
  row, capped1000gap details and a64KiB CSV-record input bound. It reuses the same
  preview finalization, Decimal conversion, source identity and immutable publish
  rules. Temporary files are removed on every prepared-result exit path.
- Publication drains blocking I/O before releasing ownership after keepalive
  failure; dataset catalog and completed job commit together. Parent raw hash and
  continuation range are checked. No configured provider writes are mounted yet.
- Native repair now attempts the streaming native serializer at every raw size;
  the pinned Python codec is used only if native bytes differ from a historical
  manifest. The420003row native repair test preserves its pinned hash without
  needing the legacy codec; it also checks quarantine/retry/staging cleanup.
- Provider selection filters authorized workspaces before LIMIT1, preventing a
  foreign queued job from starving permitted jobs. Unowned interrupted running/
  pausing jobs become durable paused states before normal admission can resume.
- Fragmented stdout bytes live outside the timer-select future. A canceled read
  therefore retains the prefix of a JSON event. QDM error drain consumes stdout
  to avoid full-pipe deadlock and honors the original process deadline. Export
  normalization streams into an atomic replacement and preserves a valid prior
  file if validation fails. Adapter Windows reparse files are rejected; metadata
  is bounded before allocation.

Validation receipts:
- data/provider-streaming-preview-root: all162Python CSV cases and the valid
  ordered-provider subset have exact preview parity.
- provider/native-streaming-pg-root.json:48metadata cases, provider projections,
  authorized claim/crash pause recovery, immutable orphan adoption, parent append,
  canceled/paused completion rejection and invalid-quality no-catalog effect PASS
  on a disposable PostgreSQL cluster. No real vendor/network process was started.
- data/streaming-validation-root: cargo test --locked --lib,76passed/9ignored,
  including streaming preview/Parquet identity across a50000row-group boundary,
  quoted-record bound, fragmented event cancellation, actual harmless Python child
  full-pipe drain/deadline/reap and large native recovery. Source hashes retained.
- data/streaming-native-and-legacy-root: fresh historical codec + PG rerun PASS,
  including exact2/50003/420003row PyArrow recovery,48metadata cases and local
  import/repair/removal workflow. The PG data workflow took117.82s in debug.

Remaining provider gates before mounting: process-tree ownership across parent
crash/timeout (root-child cleanup alone is insufficient), configured lifecycle
route suite and retry/cooldown/restart tests, Dukascopy bounded catalog refresh,
main/runtime startup integration, and resource measurements on large imports.
Scientific normalization/orchestration and persisted regime/research acceptance
remain open. Runtime lifecycle/rollback, concurrent and real native HTTP/UI
journeys, complete route inventory and independent integration review remain open.

## Root continuation: scientific source validation and streaming resources

- runtime/scientific-normalize-source-root-fixed/receipt.json PASS:209 fill
  normalization cases (200synthetic valid,7rejections,2actual offline Nautilus
  runs). All202 valid source artifacts are accepted by both Python and the
  independent Rust source/evidence validator. Coordinated timestamp/link changes,
  duplicate fill/order links and native isolation/version/signals/range tampering
  are rejected. This does not establish persisted native Nautilus orchestration.
  The earlier scientific-normalize-source-root failure is retained; its fixture
  omitted the dataset artifact hash before the harness was corrected.
- provider/streaming-resources-root/receipt.json PASS identity checks,14 runs
  including warmups,3alternating samples per mode/size. At50003rows:buffered
  median728.04ms/95.73MiB RSS,streamed900.45ms/56.36MiB. At420003rows:buffered
  median5947.48ms/753.22MiB,streamed7320.13ms/57.80MiB. Streaming reduces peak
  memory about92.3% at the larger size, with23.1% more elapsed time. This is a
  bounded-memory trade-off for long data tasks, not interactive/UI speedup.
  Same preview/raw/Parquet identities; owned synthetic files,no PG/vendor/network.
- Atomic Windows Job Object process ownership is being implemented and tested;
  no provider route/runtime promotion is implied by the source change.

Goal remains ACTIVE. Owner API8010/UI5180 unchanged.

## Root continuation: atomic process ownership and scientific dispatch

- Commit ebf2c7f adds the standalone Windows process-tree primitive and only its
  required dependency/module wiring. Its staged dependency set compiled in an
  isolated directory against HEAD; unrelated backend/UI WIP was not committed.
  Six ownership tests PASS:drop/kill child+grandchild, canceled wait, abrupt worker
  termination without destructors, full stdout/stderr, Unicode/quoting/env/cwd,
  pre-execution active-process and memory ceilings, invalid spawn cleanup.
  runtime/owned-process-root also passes three provider stream/drain tests.
- Ownership uses PROC_THREAD_ATTRIBUTE_JOB_LIST plus an explicit stdio handle
  list, kill-on-job-close and no shell. Job handles are never inherited. This
  removes the create-then-assign crash window; all live job members (including
  Windows console hosts) are held and checked in the abrupt-crash fixture.
  Primary reference: https://devblogs.microsoft.com/oldnewthing/20230209-00/?p=107812/
- runtime/scientific-execution-root PASS:6 actual installed Nautilus executions
  on synthetic long/short horizon/SL/TP inputs. Rust owns cancellation/deadline,
  concurrent bounded stdout/stderr drain, scratch cleanup, normalization and
  independent immutable-source/fill validation. Python only supplies the pinned
  engine adapter; no Python control/domain worker is called from this path.
- Native research dispatch now supports pinned Nautilus plus reference/OOS.
  A verified scientific descriptor is required before claiming native-engine
  work. Claim and orphan cleanup filter authorized workspaces before LIMIT.
  The current OOS deadline is shared across source load and every slice.
- runtime/persisted-native-research-root-source-snapshot PASS:86 pure cases,
  11 persisted engine cases (3reference,2reference OOS,6actual Nautilus) plus
  existing14 lease/crash/cancel/publication fences on disposable PostgreSQL.
  Every output file hash is checked before comparing business fields. Generated
  engine IDs and elapsed times differ between independent executions; fill links
  are independently verified, not treated as identical generated IDs.
- Preserve failed predecessor receipts. The first run used a relative fixture
  path; the next selected an OOS source exceeding the worker load budget; the
  third expected the old dataset-source snapshot after changing that snapshot.
  These harness issues were corrected without weakening runtime source budgets.
  Additional authorization/budget fixtures initially lacked their foreign dataset
  FK and conflicted with an old all-tenant-a assertion; both are being corrected.

Completed at this checkpoint:runtime/persisted-native-research-root-oos extends the
persisted suite with an actual native OOS run and authorization/source-budget
fences; runtime/native-regression-root runs all-target check plus full lib tests.
Both suites PASS: persisted receipt has 86 pure/12 persisted cases (7 scientific engine cases including native OOS), plus authorization/source-budget fences; cargo all-target check and lib regression report 83 passed, 14 ignored, 0 failed. Configured provider
routes remain unmounted, runtime lifecycle/rollback, concurrent/native HTTP/UI
journeys, complete inventory and independent integration review remain open.

## Root continuation: native provider routes and real runtime lifecycle

- Bounded explicit Dukascopy catalog refresh is implemented with the pinned
  reqwest client: fixed endpoint, no redirect/proxy/decompression, 2MiB streamed
  response/cache limits, 20s total deadline, single in-flight refresh, monotonic
  60s cooldown/300s after429, normalized/hash-verified atomic cache replacement.
  Refresh failure preserves prior cached instruments; cancellation leaves no
  partial cache. No vendor request was used for acceptance.
- Three local socket catalog refresh tests PASS: valid/replacement/reload,
  simultaneous refresh/cooldown,429/redirect/bad JSON/schema/declared+chunked
  oversize/timeouts, canceled request. Tests use loopback-owned fixture servers.
- Configured provider HTTP lifecycle tests PASS on disposable PostgreSQL:
  admission, idempotency replay/conflict, persisted failed receipts, workspace
  denial, pause/pausing/resume/cancel, source/job cooldown, revision conflict,
  source lock contention, restart snapshots, bounded policy and unsupported QDM
  controls. Fixed duplicate paused-request admission bypassing cooldown.
  provider/catalog-lifecycle-root/pg.json also passes48metadata cases, existing
  provider projections and claim/crash/publication/append fences.
- Native routing now mounts verified provider read/write/refresh and explicit
  unavailable market endpoints. Compatibility retains its queued provider paths.
  Native frozen manifest has zero delegated routes; this is route ownership,
  not proof that absent SDK/provider configurations provide live capabilities.
- main binds before starting a provider worker, validates adapter pins, checks
  worker readiness and owns graceful/forced drain. Dropped worker handles abort
  their task; job objects stop descendants. Interrupted durable jobs are
  recovered paused. QDM graceful drain remains bounded by shutdown budget;
  unexpected termination is crash recovery, not supported user cancel.
- runtime/native-lifecycle-root/receipt.json PASS actual debug HTTP runtime:
  native schema migration, ready without Python command workers, journal write
  and exact idempotent retry, persisted restart, owned API crash/worker cleanup,
  compatibility rollback and return to native. Owner8010/5180 unchanged.
- runtime/native-lifecycle-provider-root-fixed/receipt.json adds PASS configured
  process execution using harmless synthetic protocol fixtures: actual child
  spawn, immutable2row Parquet/hash publication, pause/resume/cancel, rate limit
  cooldown surviving restart. No vendor/network/owner dataset was accessed.
  The preceding provider-root attempt failed because its fixture read a request
  filename as a folder; preserve that failed attempt separately.
- runtime/native-provider-regression-root PASS cargo test --locked --lib --tests:
  lib86passed/15ignored; all unignored integration targets pass. Ignored PG/engine
  tests retain separate explicit receipts. Total command104.98s. All-target check
  PASS. Launcher focused tests remain PASS (latest test count in tool output).

Running: separate release candidate build in api-rust/target/native-candidate;
next, production React + real Advanced Charts against native HTTP in a fresh
synthetic database. Current owner services remain unchanged. Scientific capability
bootstrap/pins, installed provider dependency inventory, concurrent/long-history
performance, current full inventory and independent review remain open. Goal ACTIVE.

## Root continuation: native HTTP/UI, installed provider pins and scaling

- Commit15b7e86 saves the native domain/runtime and required synthetic compile-time
  differential fixtures. It excludes unrelated UI/CSS, owner data and historical
  evidence changes. Release candidate binaries built in a separate target.
- runtime/native-http-ui-root/receipt.json PASS: actual release native HTTP,
  disposable PostgreSQL and production React/Advanced Charts. Twelve alternating
  BUY/SELL→TP drag→close journeys, exact persisted position state, no Python
  command workers, retained iframe/history/scale. Click-to-confirmed-paint median
  45.6ms/sample-p9546.9ms on300synthetic rows. API peak RSS about20.4MiB. Screenshot
  inspected: synthetic candles and chart shell visible; this is not full visual
  acceptance of marker states or real-data/production capacity.
- runtime/native-http-concurrency-root-cost-fixed/receipt.json PASS extends this
  to6000synthetic rows and75protection mutations with exact receipt retry across
  0/500/5000step histories and1/4independent concurrent aggregates. At~5000events,
  full response4.57MB, serial median581.36ms/sample-p95602.46ms, concurrent median
  689.28ms/sample-p95864.02ms. API peak RSS307.3MiB across this workload; PG CPU/RSS
  excluded. Short run is diagnostic, not stable tail/capacity acceptance.
- Preserve predecessor failures: native-http-concurrency-root omitted required
  initialization; root-fixed supplied an incomplete cost model. Both were fixture
  defects correctly rejected with422. The original harness incorrectly derived
  top-level passed from partial checks; subsequent code requires whole-run completion.
  Do not use that predecessor receipt as acceptance.
- runtime/native-http-phase-root PASS repeats HTTP/UI/scaling but inherited
  RUST_LOG=warn suppressed diagnostic info. It is not phase-attribution evidence.
  Running root-logged explicitly enables info and requires actual phase log lines.
- Installed Dukascopy identity now covers package/lock files plus the complete
  installed node_modules file set. Bounded hash enumeration rejects changed,
  added, missing and linked files. Rust and Python yield identical installed hash
  85f8ac02fe964810ff8c90c51a318187d86320928d6b010d301753ea05c26d07.
  No vendor request was made. Native dependency unit test and launcher24tests/
  12subtests PASS; runtime/native-dependency-lifecycle-root/receipt.json PASS actual
  configured synthetic worker publication/pause/resume/cancel/cooldown plus
  restart/crash/compatibility rollback. All-target check PASS.
- Native admin emits all route owners from actual dispatch predicates. Current
  runtime-inventory-current/inventory.json:105native/0delegated; records retained
  scientific/legacy/Node/vendor/tooling exceptions and explicitly unavailable
  market/live connector. Historical inventory is preserved. This is ownership,
  not enabled capability/whole-product acceptance.
- Launcher accepts explicit scientific/legacy codec descriptors; native admin
  verifies scientific identity before launching children. Installed scientific
  bootstrap/admin probe PASS offline. No research job/provider/broker was opened
  by that probe. Scientific compiled/transitive dependency completeness review
  remains distinct from current top-level file identity validation.

Next: attribute long-ledger read/transition/revision/receipt/serialization cost;
remove the measured repeated work with financial/revision/retry parity. Broader
data/research UI, resource/long-duration and independent integration review remain
open. Owner8010/5180 unchanged. Goal ACTIVE.

## Root continuation: phase attribution and serialized replay receipts

- `runtime/native-http-phase-root-logged/receipt.json` PASS with actual phase
  logs enabled. A long-ledger close spent about124ms loading,102ms transitioning,
  161ms saving the revision and151ms saving/serializing the receipt. The API
  still returns the full canonical ledger; changing HTTP to WebSocket alone
  would not remove this repeated work.
- Successful replay results now serialize once to the existing `result_text`
  receipt column and return those exact bytes. Retry and command recovery keep
  the same JSON body and content type; errors retain existing JSONB receipts.
  No schema/financial contract change or ledger truncation.
- `runtime/serialized-receipt-pg-root` PASS:48metadata oracle cases and4persisted
  receipt tests, including large Unicode JSON, exact-byte retry and rollback.
  `runtime/serialized-replay-parity-root/receipt.json` PASS132persisted native
  Router vs Python cases across replay/quick/Prop/analytics/context. All-target
  check and separate release candidate build PASS.
- `runtime/native-http-serialized-root/receipt.json` PASS actual release
  HTTP/production chart, persisted quick/drag/close and25long-ledger protection
  mutations with exact retries plus command-result recovery. At5000steps serial
  median502.23ms/sample-p95525.06ms; four independent aggregates639.19ms/730.09ms.
  Previous phase-logged run:585.99ms/707.03ms median respectively. Full response
  remains4.57MB; peak API RSS289.3MiB (PostgreSQL excluded). Runs were sequential
  diagnostics, not alternating/stable-tail/capacity acceptance. Small UI sample
  median62.3ms on6000synthetic rows, not comparable to the earlier300-row run.
- Harness completion now requires the entire requested run to finish; partial
  UI success cannot mask a subsequent HTTP benchmark failure. Failed predecessor
  attempts remain preserved and excluded from acceptance.

Next: remove remaining measured long-snapshot costs with equivalent persistence
and financial checks; close scientific compiled/transitive identity and broader
data/research/resource acceptance. Children remain quota-errored; root review
does not count as independent integration sign-off. Owner8010/5180 unchanged.
Goal ACTIVE.

## Root continuation 18/10: one installed verification at startup

- Normal scientific startup now validates cheap descriptor metadata in the
  launcher and verifies installed bytes in the long-lived worker before readiness.
  The supervisor checks that worker's nonce/PID/executable before spawning the API.
  This removes duplicate cross-process tree verification without trusting metadata
  as installed-file evidence. Explicit missing descriptors fail closed.
- `../rust-native-20261018/runtime/scientific-startup-root/receipt.json` PASS on
  release binaries with source and binary fingerprints unchanged throughout:
  metadata/full-verification distinction, stale check/setup rejection without
  children, stale worker rejection without API/ready, explicit missing descriptor,
  valid scientific start/drain, native restart/persistence/crash, compatibility
  rollback and synthetic provider pause/resume/cancel/cooldown. No owner runtime
  was touched. The native route manifest delegates zero command routes.
- 24 launcher unit tests PASS; independent startup_review found no blocker.
  Native fixture startup was about 1s, optional scientific startup 20.38s in this
  one local run. These are startup diagnostics, not request latency or capacity.
- Next: compact mutation response and frontend reconciliation, then bounded mixed
  resource acceptance. Snapshot storage/domain validation still scale with replay
  history and need separate implementation. Goal remains ACTIVE.

## Root continuation: move long snapshots and isolate JSON CPU work

- Record load/save/create and the pure core response now move owned JSON values
  instead of cloning the full financial ledger through `json!`. Parsing large
  persisted snapshots and serializing successful replay receipts run on the
  blocking CPU pool. Database ownership, row locks, full financial validation,
  response fields and transaction commit remain unchanged.
- `runtime/native-http-owned-snapshots-root/receipt.json` PASS actual release
  HTTP/production chart.75protection mutations across0/500/5000step histories,
  exact retries, command-result recovery and4browser quick/drag/close journeys.
  At5000steps serial median370.16ms/sample-p95379.81ms; four independent aggregates
  440.22ms/525.22ms. Response remains4.57MB. Peak API RSS233.5MiB; PG excluded.
  Prior serialized-only diagnostic median502.23ms/639.19ms respectively. These
  separate short runs are not alternating tail/capacity acceptance. At500steps
  medians92.68ms/89.92ms; browser click-to-confirmed-paint median61.1ms on6000rows.
  Iframe/history/scale assertions PASS. Full snapshot persistence still scales
  with ledger length and remains a limitation, not a completed optimization.
- `runtime/owned-snapshot-parity-root/receipt.json` PASS132persisted differential
  cases. `runtime/owned-snapshot-receipts-root.json` PASS48metadata cases and5PG
  receipt tests; new8-way simultaneous same-key serialized-JSON test proves one
  durable effect/receipt and byte-identical responses. All-target check/release
  API/debug probe builds PASS.
- Independent READ-ONLY backend_review reported no blocking finding in the3source
  files. Its `metadata/replay-wip-review.json` passes48metadata/4receipt tests plus
  Prop workflow/corrupt-phase guards; the additional5threceipt test above closes
  its advisory concurrency coverage gap. This review is scoped to these changes,
  not whole native integration approval.

Parallel continuation: Data/Research production UI journeys and installed
scientific compiled/transitive identity. Owner8010/5180 unchanged. Goal ACTIVE.

## Root continuation: deletion generation isolation

- Completed DELETE receipt retries no longer clear a dataset removal journal
  while another pending cleanup receipt owns the same workspace/dataset. This
  preserves recovery after reimporting identical bytes under the same dataset ID.
- `metadata/delete-generation-review.json` PASS48metadata cases plus the actual
  Windows PostgreSQL workflow: deleteA, reimport, deny-delete handle, deleteB503,
  retryA preserves B journal exact bytes, unlock and retryB completes cleanup.
- Only disposable fixtures were changed. Owner runtime/data were untouched.
  Data/Research production UI functional acceptance is recorded separately; final
  integrated candidate rebuild/recheck and scientific identity remain in progress.
  Goal ACTIVE.

## Root continuation: scoped native research recovery

- Native lease recovery now shares the workspace/backend eligibility predicate
  with claim. It cannot mutate expired jobs outside the worker's authorization
  or jobs that require an unsupported engine. Explicit compatibility/admin
  recovery retains its global behavior.
- `metadata/research-recovery-scope-review.json` PASS48metadata cases and the new
  persisted regression. Exact foreign/unsupported rows, including lease fields
  and timestamps, remain unchanged; native reference/scientific eligibility,
  empty scope, cancellation and retry exhaustion are covered.
- The explicit worker recovery and recovery inside claim both use this scope.
  This is a bounded review finding closed, not whole integration sign-off.

## Root continuation: production Data/Research journeys and persisted provenance

- `runtime/native-data-research-integrated-root/receipt.json` PASS13checks on the
  rebuilt release API/admin/research worker and production React. Disposable PG
  and synthetic CSV only: validation, preview/import/exact retry, reload, corrupt
  artifact repair, queued cancel, native completion, cross-workspace404, linked
  delete409, unreferenced delete/retry and mobile overflow. The39trade result's
  full metrics equal the Python oracle, persisted result bytes/hash agree, and
  no Python command worker or queued/running command remains.
- Reopened Research quality now reads the job's persisted dataset/hash/snapshot,
  never current mutable catalog claims. Missing quality snapshot stays explicitly
  unknown instead of reporting no dataset. Three focused research-story tests
  PASS; root inspected the completed screenshot. Existing chart styling outside
  this bounded provenance fix is not claimed as newly accepted.
- This attempt pins binary/source hashes before subsequent stored-result binding
  and scientific hash-cache work; it does not establish those later changes.
  Final integrated rebuild/recheck remains required. Owner runtime untouched.

## Root continuation: bind stored results to their requested owner

- GET research job and research analytics/CSV now use one stored-result guard.
  A valid artifact checksum alone is insufficient: canonical path, workspace,
  job, dataset/hash, supported result family, starting balance and protocol/hash
  must agree with the workspace-scoped database row. Completed jobs without
  result identity fail503 instead of presenting an empty successful result.
- `metadata/research-result-binding-review.json` PASS48metadata cases and the
  persisted endpoint regression across legacy/candidate paths and close-delta,
  engine and OOS results. Deliberately corrupted owner/protocol/hash/path bindings
  fail closed. No evidence of a normal-path cross-tenant exploit is claimed.
- Independent reviewer found no new blocker in the scientific cache/startup
  changes after inspecting reliable identity, pathname rechecks, bounds and
  cancellation. Final compiled runtime/performance acceptance remains separate.


## Root continuation: complete scientific installed identity and bounded verification

- Descriptor v2 pins all installed engine/base-Python files, including compiled,
  transitive and bytecode inputs. Native protocols add `engine.dependency_sha256`;
  this is an additive native extension, not an unchanged historical Python
  protocol. Old queued scientific jobs without this pin fail closed and must be
  recreated; completed historical artifacts are not rewritten.
- A bounded 32,768-file process cache trusts only object ID/change stamp/size/mtime,
  reopens the named object, rejects Windows reparse points, and fully enumerates
  both dependency trees on every check. Unknown identity never gets cached and
  uses two byte hashes. Worker preparation verifies bytes before readiness; each
  whole job still verifies before/after, with lease cancellation/deadline checks.
- `runtime/scientific-cached-persisted-root/receipt.json` retains a failed attempt:
  engine-5 exceeded its unchanged 20s budget. A fresh-process diagnostic found
  20.803s cold /16.544s warm verification. Redundant pathname metadata and handle
  queries, rather than engine arithmetic, dominated warm verification.
- `runtime/scientific-cache-optimized-root/receipt.json` passes a fresh-process
  release diagnostic:9.982s first/5.229s warm/5.175s production warm. Cold reads
  893,203,167 bytes across15,552files; warm reads0bytes and verifies all15,552cached
  identities. Same aggregate dependency digest as bootstrap. This is one local
  pair with uncontrolled OS cache, not stable tail/capacity evidence. Eight
  focused dependency tests pass, including restoredmtime, replacement, added
  files, reparse substitution, fallback, cancellation and cache bounds.
- `runtime/scientific-optimized-persisted-root/receipt.json` PASS with frozen
  source:86pure oracle cases,12persisted engine cases including7scientific/OOS.
  Exact financial/artifact parity, result hash, lease/heartbeat/recovery/cancel,
  duplicate worker and holdout-before-read checks pass. The scientific jobs keep
  their20s budget (OOS60s). Six actual adapter cases from the preceding combined
  run also pass; its first timing is warm despite the historical cold fieldname.
- Independent backend_review inspected the final scanner/identity/measurement
  implementation and found no blocking issue. This is a scoped review, not
  whole-product acceptance. Lifecycle/data/research receipts on the predecessor
  release remain useful but must not be relabeled as the next binary build.

Next: remove duplicate optional scientific startup verification and fail closed
for an explicitly missing descriptor; rebuild, verify startup/rollback and
bounded mixed resources. Long replay snapshots still scale with history; mutation
view and compact execution storage remain work. Owner8010/5180 unchanged.
Goal ACTIVE.

## Root continuation 18/10: compact mutation wire contract and chart reconciliation

- Single-asset execution/quick/market/protection/close POSTs now support opt-in
  `response_view=mutation-v1`; full default remains unchanged. The bounded delta
  contains the execution head, at most16 appended events and exact base/result
  revision, sequence, workspace/session/branch/dataset/hash/cursor/cutoff identities.
  Unknown/unsupported views, including create/portfolio, fail422 without replay
  effects. Query representation remains part of the native receipt fingerprint.
- React merges only into the exact base, keeps visible bars and unchanged
  instrument/cost references, and fails closed on mismatched responses without
  retrying a committed command. Initialization-to-market works before React
  renders. Independent review caught a Prop recovery regression in the first
  implementation: suffix-only feeding skipped older unacknowledged marks. The
  final helper recovers those marks from the retained ledger before new ones;
  reviewer confirmed closure.23 focused web tests PASS.
- `../rust-native-20261018/runtime/mutation-view-final-root/receipt.json` PASS29
  checks/30 alternating samples on the final release probe with frozen source and
  binary hashes: all5 mutation routes, quick's two real revisions, exact wire
  retry, full/compact fingerprint conflict, stale/tenant rejection, invalid
  initialization rollback, portfolio/default compatibility and same-state
  persisted/full financial parity. Router-only diagnostic,5 pairs per stage:

  | Base events | Full median | Compact median | Full bytes | Compact bytes |
  |---|---:|---:|---:|---:|
  |2|31.41ms|31.15ms|5,550|3,174|
  |502|54.41ms|48.59ms|341,386|3,208|
  |5,002|233.41ms|193.65ms|3,109,328|3,224|

  These are small local samples, not stable tail/capacity evidence. The first
  attempt failed because its portfolio fixture used two EURUSD datasets; retained
  `mutation-view-root/receipt.json` records that fixture error. The corrected
  predecessor r2 passed28 checks before strict create-query rejection was added.
- `../rust-native-20261018/runtime/mutation-chart-final-root/receipt.json` PASS
  against release native HTTP plus production React/Advanced Charts,6,000bars and
  a seeded5,000-event ledger.12 measured alternating BUY/SELL→TP-drag→close journeys
  (plus warmup), actual compact schema/query asserted. Click-to-confirmed-paint
  median230.6ms/sample-p95263ms;1,148 sampled drag frame intervals have median16.7ms,
  sample-p9516.8ms. Iframe and price scale retained; zero chart history reloads
  during dragging. Headless diagnostic, not manual visual or long-duration verdict.
- Locked release bins/probe build, all-target check and96 Rust lib tests PASS;
 16 fixture-dependent tests are ignored in that lib run and have separate evidence.
  Full history decode/validation/revision persistence and frontend ledger concat
  remain O(history). Next storage boundary is documented in the existing native
  runtime document; no owner storage migration/cutover has occurred. Goal ACTIVE.

## Root continuation 18/10: bounded foreground/background resources

- `../rust-native-20261018/runtime/mixed-resources-final-root/receipt.json` PASS
  with frozen source/release binaries on a disposable cluster. Nine30s blocks
  (quiet/loaded/loaded/loaded/quiet/loaded/loaded/loaded/quiet),286.42s including
  setup/drain;6,000 foreground bars/500 initial steps,50,000 research rows,
  at most2 active research jobs and8 admitted per loaded block.
-270 protection changes,270 exact-byte retries and270 canonical GETs retain
  account/position fields and equal quiet/loaded closing financial state. HTTP
  payloads equal PostgreSQL; stale writes fail409.48 native reference jobs:
  47completed,1queued-canceled. A worker killed while running recovers the job on
  attempt2 and publishes its identity/hash/count-validated artifact. Zero Python
  command workers or pending/running commands remain.
- Protection median77.82ms quiet(n90)/77.73ms loaded(n180), sample-p9593.30/90.17ms;
  no meaningful load regression established by this bounded workload. Every loaded
  block has11–13 running-worker resource samples and14–16 request-sequence boundary
  observations. Running research appears in73/174 loaded resource samples, not
  continuous saturation. Status brackets protection/retry/GET together; it does
  not prove overlap of every individual request.
- Sampled peak RSS: API39.2MiB quiet/38.0MiB loaded, research250.2MiB loaded,
  PostgreSQL descendants190.8MiB loaded (shared pages can be counted repeatedly).
  Observed CPU is a sampled lower bound. Research financial equality here is not
  an independent metric oracle; previous dedicated financial suites supply that.
  This is a short native-reference resource diagnostic, not long-duration soak,
  capacity, scientific-engine saturation or production promotion.
- Independent read-only review's source-drift and insufficient-load gates were
  fixed before the run. The harness re-enumerates/fingerprints all Rust sources
  and binaries at both boundaries, and requires running-worker evidence per loaded
  block. Owner8010/5180, provider/broker and owner data remain untouched.
  Next implementation: validated execution head + append-only events/indexed
  operation IDs, with cold-path full hydration and a verified rollback target.
  Goal remains ACTIVE.

## Root continuation 18/10: bounded BAR execution persistence

- Added opt-in native `TW_V2_REPLAY_STORAGE_PROFILE=compact`, restricted to
  single-asset BAR `mutation-v1` execution/quick/market/protection/close. Default
  snapshot storage, tick, portfolio, step and phase paths remain unchanged. The
  owner database/listeners were not migrated, restarted or switched.
- Migration0005 stores validated per-revision head/context certificates, shared
  immutable events and indexed operation reservations. Core full/incremental
  execution shares financial arithmetic and event validation. Each mutation checks
  the new suffix against its exact admitted head/hash, then commits revision,
  certificate, events, operation IDs and exact-byte receipt atomically. Queue
  reservations survive zero-event revisions. Cold reads/analytics/Prop/history
  hydrate and fully validate the exact revision. This trusts application-owned
  immutable PostgreSQL rows, not protection against a database administrator.
- `../rust-native-20261018/runtime/replay-storage-r5-root/receipt.json` PASS24
  checks/36 alternating samples (6warmups,5measured pairs at each stage), frozen
  source/release-probe hashes. Financial/metadata/Prop/analytics equality, restart,
  history/branch cutoff, retry/stale/workspace denial, queued fill, operation-ID
  scope, dataset pins, immutable SQL triggers and corrupt prefix/event denial all
  pass. Activity additionally covers domain/exact-receipt duplicates, invalid
  intervals, conflicting dates, missing/deleted/cross-workspace admission and no
  financial head/history changes. Router-only diagnostic:

  | Base steps | Full median | Compact median | Full payload | Compact payload + certificate |
  |---|---:|---:|---:|---:|
  |0|30.250ms|38.423ms|10,298B|1,969B +2,823B|
  |500|47.766ms|39.785ms|320,178B|1,985B +2,843B|
  |5,000|193.740ms|46.092ms|3,118,227B|1,992B +2,853B|

  Same small mutation wire in both profiles; retained events are additional shared
  storage, not included in head/certificate sizes. Compact is slower on the small
  prefix, so these numbers do not justify claiming every request became faster.
- The first production-chart candidate passed behavior but confirmed paint was
  median329.7ms: activity interval admission hydrated/validated all history while
  holding the same replay head lock as orders. That receipt remains at
  `replay-storage-chart-root`. Activity now checks only the scoped head and exact
  current revision/deletion state, keeping the existing lock and event/retry rules.
  Observed activity phase median329.2→3.6ms; no financial-state validation is
  needed for a timing interval. Reviewer confirmed the metadata boundary.
- `replay-storage-chart-r2-root` (compact) and `replay-storage-chart-full-root`
  PASS12 warm journeys each on the same final source/release binary, production
  React/Advanced Charts,6,000bars and5,000seeded events. Confirmed paint median
  79.5ms/sample-p9580.9ms compact vs244.9/262ms full. Compact1,236drag frame
  intervals: median/sample-p9516.7ms; zero history reads, retained iframe/scale,
  zero scale displacement during drag. Raw samples/requests/phases and derived
  `replay-storage-chart-comparison-root.json` retain the distinction. First compact
  mutation imports the old full history:1,061ms response vs217ms full; this cold
  cost is excluded from the explicitly warm samples, not hidden as a fast import.
  These serial headless checks are not stable-tail/capacity/soak or aesthetic QA.
- `replay-storage-rollback-final-root` PASS guarded normal stop; final harness
  `replay-storage-rollback-marker-root` PASS with injected guarded-stop rejection
  exercising the exact private-manifest marker fallback. Quiesced DB/artifact
  backup restores into a distinct target;9compact revisions including historical,
  branch and deleted state materialize atomically. Corruption rejects without
  partial conversion. Identity/timestamps/heads/sidecars/Prop/receipt bytes and
  original source DB remain unchanged. Same-schema supervised compatibility reads
  history/analytics and writes queue/step/current quote/protection/close/branch;
  return-to-native reimports the new full head and continues Prop feed. Historical
  older-schema binaries cannot be enabled by a profile toggle or ledger deletion.
- Initial harness failures remain separate: `replay-storage-root` compared transient
  step response events with GET; r2 sent quick-only init fields to market; r3
  compared independently derived Prop operation IDs without verifying each own
  canonical event. Those fixture issues were fixed without weakening financial
  comparisons. Initial rollback pipe-handle hang is recorded in its own
  `INTERRUPTED.md`; exact owned PG/harness processes were stopped.
- Final locked release bins/probe build PASS; Rust lib108PASS/16fixture-dependent
  ignored, admin1PASS; launcher27PASS +12subtests. Independent source reviews found
  and closed cleanup-manifest path mismatch and activity admission concerns.
  `replay-storage-inventory-root.json` reports105native frozen routes and zero
  command-worker delegation; route count alone is not whole-product acceptance.
- Remaining: compact resource/load/soak evidence, cold import/hydration cost,
  BAR step/chart-tail and Prop-feed scaling, phase/tick/portfolio full-history paths,
  frontend retained-ledger growth and broader native/setup acceptance. BAR step
  should reuse incremental `advance_many` with a separate typed step/cursor/tail
  contract; do not weaken the same-cursor16-event order mutation reducer. Goal
  remains ACTIVE; no owner cutover or whole-project completion is claimed.

## Root continuation 18/10: compact storage under bounded mixed resources

- `../rust-native-20261018/runtime/mixed-resources-compact-root/receipt.json`
  PASS on the committed bounded-storage source (`19d78c2`), unchanged source and
  release-binary hashes. Nine30s blocks complete in289.703s including setup/drain:
  270protection changes,270 exact raw-wire retries and270 canonical GETs. Every
  compact SQL head/certificate/contiguous immutable event stream equals the full
  canonical state; final heads are1,703bytes with534events. Stale writes fail409.
- Quiet protection median60.224ms/sample-p9570.046ms(n90); loaded58.307/66.568ms
  (n180). No meaningful load regression is established in this bounded diagnostic.
  Full canonical GET still hydrates history: quiet79.330/92.581ms and loaded
  75.352/89.679ms. Nine cold imports outside timed blocks cost168.0–185.1ms and
  add one event; this run is not an equivalent-workload speedup comparison against
  the previous full-response resource run (534versus533final events, different wire).
- Research47completed/1queued-canceled; killed running job recovers on attempt2
  and publishes validated identity/hash/count. Running research appears in74/178
  loaded resource samples; each loaded block has11–13running samples and14–15
  sequence-boundary observations. Brackets cover protection/retry/GET together,
  not proof every request overlaps active compute or continuous saturation.
- Peak sampled RSS: API40.70MiB quiet/40.97MiB loaded, research251.20MiB,
  PostgreSQL descendants201.03MiB loaded (shared pages may be double counted).
  Sampled CPU is a lower bound. This is not capacity, stable-tail or long soak
  acceptance. Owned fixture processes stopped; owner8010/5180 and data unchanged.
  Next slice remains BAR step/chart-tail plus indexed Prop feed. Goal ACTIVE.

## Root continuation 18/10: bounded BAR step, chart tail and Prop marks

- Added advertised native single-asset BAR/null `replay-step-v1` capability and
  explicit `/step?response_view=step-v1`. Its own revision/cursor/cutoff/sequence
  envelope carries at most1,000 new rows and3,000 contiguous events. Existing
  interval/gap/session-period semantics and financial `advance_many` remain the
  authority; order `mutation-v1` retains its separate same-cursor16-event guard.
  Compact persistence validates the admitted prefix and atomically appends events,
  head/revision and retry receipt. Null execution remains null; the rare final
  no-advance step keeps the fully validated full-storage path.
- Compact Prop feed selects the requested eligible event+predecessor and next
  unacknowledged eligible sequence, rather than hydrating the whole ledger.
  Migration0006 adds the partial index; migration0005 is unchanged. Scope,
  identity/hash/cost/phase, replay-before-attempt lock order, ordered backlog,
  exact retries and shared financial event validation remain enforced. The trust
  boundary remains application-owned immutable PostgreSQL, not arbitrary admin
  tamper resistance over unread history.
- `../rust-native-20261018/runtime/replay-step-r3-root/receipt.json` PASS11checks,
  36samples including6cold/warmup observations. Three-way full-wire/full-storage,
  step-wire/full-storage and step-wire/compact-storage parity covers null/init,
  1/10/1000steps, rolling2000rows, interval/gap/period/end, queue/protective/margin,
  historical/fresh-process reads, invalid/stale/tenant denial and exact retries.
  Alternating warmed Router-only timings (5samples/profile/stage):

  | Base events | Full storage median / sample p95 | Compact median / sample p95 |
  |---|---:|---:|
  |0|20.569 /20.776ms|27.057 /27.469ms|
  |500|37.666 /38.850ms|28.201 /28.482ms|
  |5,000|184.309 /187.867ms|36.059 /36.597ms|

  Both timed profiles use the same step wire (about2.8KB). This isolates storage
  work; it is not a comparison of old full-wire versus new end-to-end UI. First
  compact imports cost28.628/128.203/1,147.630ms respectively and remain separate.
  Exact helper SQL naturally uses partial/primary indexes at506/5006events,
  returning one next mark and one requested/predecessor pair. At5006events,
  next-mark access has4shared-hit blocks, pair8. Coherent acknowledged bindings
  seeded from canonical marks are explicitly not historical API-feed receipts.
  Immutable UPDATE/DELETE denial and selected/predecessor/certificate corruption
  hot/cold fail closed without mutation; trigger bypass is disposable-fixture only.
- Frontend reconciles exact advertised scope/base and retains a2000-row window.
  The committed replay publishes before Prop feed so chart can paint; all further
  writes stay locked until feed finishes. Invalid/late merges require recovery,
  never replaying a committed request. Advanced Charts folds verified tails into
  exact-cutoff authoritative aggregates, including complete day/week/month OHLC
  and volume. Unseeded subscriptions use history; rewind still resets. Review
  exposed superseded-history requests skipping undelivered bars after fast steps:
  fallback now starts from each subscription's last delivered bucket and dedupes
  by resolution+required range. Deferred three-step/minute/month/multiple-reader
  regressions pass. Full client ledger concat remains O(history).
- `../rust-native-20261018/runtime/step-chart-root/receipt.json` PASS release
  HTTP+production React+real Advanced Charts at5,003initial events, source/binary
  unchanged. Fourteen measured step samples (1m/5m, single and10base bars) have
  click-to-subscribed-callback/first-following-rAF median63.5ms/sample-p9565.4ms.
  This is a rendering proxy, not pixel-paint proof. Play executes3real HTTPsteps
  per resolution;21outside-timing canonical OHLC/volume comparisons pass. Ready
  forwards have zero history reads/resets and retain iframe/drawing/fixed scale.
  Eighty-eight measured frame intervals median/p9516.7ms, max16.8ms; too short
  for a long-session smoothness claim. Null-init and injected stale409 preserve
  expected execution/cutoff/revision. Four settling samples60.5–96.1ms remain
  separate. Aggregate cold quick+GET+close+GET setup1,886.26ms is not an isolated
  import request. Practice only; no Prop browser end-to-end/capacity/soak verdict.
  Receipt fingerprints pin the tested working tree, including preserved existing
  UI edits; this is not a clean-checkout-only build/reproducibility verdict.
- Root viewed the final screenshot (deliberate stale/conflict state). Focused web
  tests46PASS; production build PASS. Locked Rust lib112PASS/16fixture-dependent
  ignored and admin1PASS. Independent source review found no further blocker. Failed
  API attempts `replay-step-root`/`replay-step-r2-root` remain: old full step
  persists an explicit null execution; new step initially omitted it. Product
  now preserves that shape, without fixture normalization. Fixture TP hit/spread
  and post-Prop identity expectations were corrected separately.
- Owner8010/5180 and data remain untouched; isolated processes cleaned up.
  Next: hidden/visible trade-history projection, retained-ledger growth,
  broader native/setup and long-duration acceptance. Phase/tick/portfolio retain
  fully validated full-history paths; optimize only where measurements justify
  the additional persistence/contract complexity. Goal remains ACTIVE.

## Root continuation 18/10: bounded trade-history projection work

- Replaced each closed trade's full-ledger entry search with one first-entry Map.
  Existing fields, first matching fill, missing fees, lots and close ordering stay
  exact. Positions retains its React tab/page state when hidden but skips ledger
  projection; pagination and Journal search/calendar reuse the current projection.
  The financial ledger and Prop backlog recovery remain complete and unchanged.
- `../legacy-projection-20261018/benchmark.json`: six equal-input synthetic
  cases, seven alternating samples/candidate after one warmup, exact old/new output
  equality. Projection-only medians:10k events/100closes4.19→0.136ms;
  100k/100closes46.16→1.59ms;100k/1kcloses603.47→2.55ms;
  100k/10kcloses3503.38→5.75ms. Sparse10k/10closes0.585→0.397ms;
  its small noisy tail is not a speedup guarantee. This is not API/click latency.
- Root focused projection/mutation/step tests28PASS. Isolated React component
  browser checks preserve closed tab/page/rows after hiding/replacement/reopen,
  skip hidden projection and reuse Journal results during local changes. No API
  request or owner state access. First browser test counter included React dev
  performance logging's getter inspection; a stack diagnostic identified that
  fixture issue. The probe getter is now nonenumerable, isolating real projection
  calls; no product bypass was added. `../legacy-projection-20261018/browser.json`
  retains final two-case PASS. This is component QA, not whole workspace acceptance.
- Owner requested a stricter AI-quota/performance sweet spot: no speculative
  phase/certificate rewrite or extra broad audit. Finish the already prepared
  Prop connection correctness check, then retain concrete remaining gates in this
  checkpoint rather than opening more parallel work. Goal remains ACTIVE.

## Root continuation 18/10: Prop Play continuity and feed recovery

- New real Prop browser check exposed an existing canonical-location mismatch:
  Prop ignores historical cursor selection, but remembered navigation was keyed
  by each newly committed cursor. The location effect reloaded the same session
  after every successful feed and stopped Play. `rememberSession` now keys Prop
  by canonical session identity; Practice historical navigation is unchanged.
  This fixes actual reload work rather than adding a faster transport.
- `../rust-native-20261018/runtime/step-prop-r3-root/receipt.json` PASS production
  React+Advanced Charts/native HTTP+disposable PostgreSQL, frozen source/binaries.
  Validated Prop bundle is seeded via PostgresStore; replay initialization and
  resume binding use supported native HTTP. A deliberately gated feed proves
  the committed chart publishes first, while step/trade buttons and keyboard
  writes remain locked. Releasing it runs the real financial transaction.
  Play performs3successive real steps/feeds with zero chart-history reads.
- Explicit transport503-before-upstream and stale Prop revision409 retain the
  already committed replay. Reload sends no duplicate step; one subsequent step
  feeds old backlog then new mark exactly once. Final8ledger marks equal8unique
  Prop receipts, phase/binding sequences8 and replay/attempt revisions10 in SQL.
  No automatic retry or production capacity claim. The100-event browser fixture
  run is correctness evidence; its small timings do not replace the5000-event
  performance receipt. First two failed runs retain the Play timeout and released
  successful feed responses; no failed attempt is relabeled PASS.
- Quota steering: finish these coherent commits, avoid speculative phase prefix
  versioning, and do not restart quota-failed agents. Rare phase/tick/portfolio
  full-history paths remain an explicit simplicity/correctness tradeoff. Native
  real-tick/portfolio order lifecycle expansion, final clean-checkout/setup and
  longer integrated resource evidence remain unverified, not completed by this
  slice. No prepared tick/portfolio script landed. Owner runtime/data unchanged;
  all owned fixture processes stopped. Whole optimization goal remains ACTIVE.

## Root continuation 18/10: persisted tick and portfolio financial parity

- `../rust-native-20261018/runtime/tick-portfolio-r7-release-root/receipt.json`
  PASS41 cases with frozen native release probe/source, disposable PostgreSQL
  and generated immutable M1/ticks. Native creation supplies identical IDs once;
  the Python service then maintains independent state throughout all mutations.
  Only top-level record timestamps and Decimal/UTC spelling are normalized.
- Tick BUY/SELL next-minute TP fills retain final100416 balance. Immediate
  BUY/protect/close then SELL/protect/close at the same cutoff retain99991.20,
  exact events/quotes/fees and raw response hashes on every successful retry.
  Empty tick coverage and an unknown pin reject atomically. Current/history and
  fresh-process reads, plus cross-workspace404, pass. No broker/MT5 SDK involved.
- Two BAR assets share one wallet: both open, an inactive asset's SL executes,
  the other closes manually, distinct foreign targets reject, and historical
  cursors0/1/2 plus cold/current reads match the independent Python service.
  Historical reads leave canonical state unchanged. Full-history fallback remains
  intentional for tick/portfolio; these correctness cases do not establish a
  latency/capacity/soak improvement or justify another storage rewrite.
- Fixed three confirmed product gaps: tick initialization now validates the base
  model before resolving the stored tick pin; same-cutoff reopening after a manual
  action uses the most recent complete tick-window quote; historical portfolio
  restoration returns null for an asset not yet initialized at the selected clock,
  rather than falling back to current portfolio state. Missing later checkpoints
  still fail closed. The reopening defect also existed in Python: its oracle and
  validation were repaired alongside Rust, with explicit negative-window tests.
- Python tick/portfolio30PASS; Rust lib112PASS/16fixture-dependent ignored and
  differential4PASS during this slice. Focused final-source logs accompany the
  release receipt. The new native and Python regressions reopen repeatedly without
  advancing time and reject a changed quote window. Debug r6 also PASS41; release
  was rebuilt only after that result. Current inventory reports105native frozen
  routes and zero Python command-worker delegation; route counts are not full
  acceptance. The retained adapters keep their documented technical reasons.
- Failure evidence remains: initial Windows PG pipe inheritance stall is marked
  INTERRUPTED; r2 exposes premature tick-hash validation; r3 exposes missing quote
  windows; r4's foreign-target assertion used coincident asset-local position IDs
  (fixture corrected by priming one asset); r5 exposes historical portfolio state
  leakage. No failed receipt was relabeled. Owned clusters/processes were stopped;
  owner8010/5180/data were untouched and no candidate promotion occurred.
- Quota sweet spot: root-only, focused checks, no new dependencies/transport,
  speculative phase rewrite or additional agents. Remaining whole-goal gates are
  current-release lifecycle/setup/clean-source reproducibility and broader/longer
  integrated resource acceptance; prior scoped receipts remain reusable. Goal
  remains ACTIVE, not complete from these41financial cases.

## Root continuation 18/10: current lifecycle and tracked backend setup

- `../rust-native-20261018/runtime/final-lifecycle-root/receipt.json` PASS19
  current release checks: native start/write/exact retry/drain/restart, API crash
  stopping its worker, compatibility HTTP rollback and native return, synthetic
  provider publication/pause/resume/cancel and durable cooldown. Source and binary
  fingerprints remain unchanged during the run. Native launches only supervisor,
  research and API; no Python command worker. No vendor network or owner runtime.
- `../rust-native-20261018/runtime/clean-source-r2-root/receipt.json` PASS from
  tracked commit73c1043: selected backend sources archived with Git, release bins
  and probe built using `--offline --locked`, then archived lifecycle19checks and
  independent tick/portfolio41cases pass. All436 archived input files remain
  unchanged. Source/command/archive/binary hashes and child receipts are retained.
  This verifies cached-toolchain backend reproducibility, not a fresh dependency
  installation, scientific descriptor setup, frontend build or whole-product QA.
- Initial clean-source attempt built successfully but fixture startup could not
  find the workspace-relative PostgreSQL distribution. Failed receipt/logs remain.
  Lifecycle and financial runners now receive its explicit installed `--pg-bin`;
  no database or dependency installation was added. The archive initially reused
  the candidate target cache; the normal checkout candidate is rebuilt afterward
  to retain its own compile-time file pins. Future clean-source runs use a separate
  `native-clean-source` scratch target; that path-only guard passed CLI smoke.
- Restored checkout release probe bytes differ from the earlier r7 executable;
  no bit-for-bit reproducible-build claim is made. Fresh
  `../rust-native-20261018/runtime/tick-portfolio-r8-checkout-root/receipt.json`
  PASS41 verifies the actual restored binary with frozen source/probe hashes.
- Native product changes from6675877 are unchanged. Existing unrelated UI/source
  modifications remain unstaged. No owner migration/cutover/restart or broker,
  provider, OAuth or holdout authorization was expanded. Goal remains ACTIVE:
  broader/longer integrated UI/resource acceptance and final independent review
  remain distinct from these scoped backend results. Reuse prior valid receipts;
  do not restart quota-failed agents or rewrite unmeasured rare paths.
