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
