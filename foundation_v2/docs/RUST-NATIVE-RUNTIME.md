# Rust-native candidate runtime

The 17 October 2026 execution extension in the workspace Product Completion Plan
expands the earlier API-only migration. The candidate runs interactive domain
logic directly in Rust. `compatibility` remains the launcher default and rollback
profile; the owner listener is not switched merely by building this candidate.

On 18 October the owner explicitly authorized migrations0005/0006 and local
cutover. The existing owner database was backed up, migrated and started with
native/compact on API8010; UI5180 serves a production Vite preview. The native
manifest owns supervisor/research/API and readiness reports Python command
workers are not required. All18preexisting table projections remain unchanged
after migration, startup and a read-only browser check of the existing Prop
replay. See `evidence/rust-native-20261018/runtime/owner-cutover-root/receipt.json`.
This deploys the optimized path; it does not enable broker execution or turn the
owner session into a trading test fixture. For future owner restarts retain
`-RuntimeProfile native -ReplayStorageProfile compact` and the prepared scientific
and legacy codec descriptors. The generic wrapper default remains compatibility;
it refuses replacing an active native listener under the wrong profile.

The later 18 October session-preset cutover applied additive migration0007 and
kept all21 existing data-table projections and4,142 artifact hashes unchanged.
See [the scoped checkpoint](../evidence/session-presets-db-20261018/CHECKPOINT.md).
The active scientific descriptor is now
`.runtime/api-platform/native-scientific-capability-partial-tp-20261019.json`;
the installed bootstrap refreshed its engine-code commitment after the Partial TP
contract change, with dependency/runtime identities unchanged. Retain that explicit
path and the existing legacy descriptor on restart. Local backups use the installed
PostgreSQL18 client matching server18; the archived17 client cannot dump it.
Rollback to a pre0007 binary requires its matching pre0007 database backup.

The 23 October local AI-provider update now runs API8010 from
`.runtime/api-builds/ai-provider-20261023/release`, preserving native/compact,
QDM and the existing database/artifact profile without migration. The active
scientific descriptor is
`.runtime/api-platform/native-scientific-capability-demo-trading-20261022.json`,
with `.runtime/api-platform/native-legacy-codec-capability.json` retained.
Read the current manifest before the next guarded stop; earlier binary paths
in this document describe historical cutovers. See
[the AI integration checkpoint](../evidence/ai-provider-integration-20261023/CHECKPOINT.md).

The later 23 October chat-continuation update runs API8010 from
`E:/BACKUP-TRADINGWORKSPACE/ai-chat-continuation-20261023/release-target/release`.
No schema migration; native/compact, QDM, existing database/artifacts and the AI
workflow interpreter remain configured. The preserved scientific descriptor is
`.runtime/api-platform/native-scientific-capability-ai-platform-20261023.json`;
the legacy descriptor is unchanged. Old-owned binaries were used for guarded stop
before starting the new binary directory. See [chat receipt](../evidence/ai-chat-continuation-20261023/RECEIPT.md).

The 24 October Live chart update runs API8010 from
`E:/BACKUP-TRADINGWORKSPACE/live-chart-stability-20261024/rust-target/release`,
retaining native/compact and the same scientific/legacy descriptors without a
schema migration. API8010 and UI5180 were stopped before this restoration;
the existing terminal was not restarted. `.runtime/api-platform` is now a
junction to `E:/BACKUP-TRADINGWORKSPACE/live-chart-stability-20261024/runtime-api-platform`
so canonical ownership paths remain valid while logs/manifests live on E:.
See [Live chart receipt](../evidence/live-chart-stability-20261024/RECEIPT.md)
for the deployed UI hash and read-only stream acceptance.

The later 24 October MT5 read-tools update runs API8010 from
`E:/BACKUP-TRADINGWORKSPACE/mt5-tools-20261024/rust-target/release`.
Native/compact, QDM, database/artifacts, scientific/legacy descriptors and the
existing AI workflow interpreter are retained; no migration. UI5180 was promoted
atomically with prior assets retained. The owner authorized reconnect of account
…4926; SDK metadata and the AI source were checked on the running services.
Native MCP remains optional and unconfigured after terminal restart. See
[read-tools receipt](../evidence/mt5-read-tools-20261024/RECEIPT.md), including the
transient reconnect error and recovery rather than a lifecycle stability claim.

The native flow is `React → Axum → native domain → PostgreSQL transaction and
revision/receipt → HTTP response`. Research and downloads use bounded background
execution. A successful quick market order is already filled at the current
modeled quote; it is not a pending next-bar order. Dragging protection previews
locally and persists once on release. Server rejection restores confirmed state.

Replay index-window reads now stop at the requested row-group offset and convert
only the requested rows to JSON. Immutable timestamp columns are shared across
requests by file object/change identity and row group, retaining at most 32 groups
and 16 MiB of timestamp values. The existing SHA admission and open/finish identity
checks still run; this cache does not authorize workspace access or cache API
responses. Opening and rewinding retain their full response contracts. Paired
measurements and read-only browser regression evidence are in
[the reader checkpoint](../evidence/replay-playback-20261019/reader-api/CHECKPOINT.md).

## Native ownership and retained adapters

`rust_runtime_admin routes` reports every frozen route using the actual dispatch
predicates. Native dispatch owns all 105 frozen routes and requires zero Python
command-worker routes. This does not mean all optional capabilities are enabled:
the native market/live SDK connector is explicitly unavailable, and broker
execution remains gated. See the current source inventory generated by
`scripts/rust_runtime_inventory.py`; the first inventory is historical evidence.

Rust owns replay/financial/Prop state, metadata, analytics, context, OAuth state,
data validation and publication, download lifecycle, research protocols, leases,
recovery and result normalization. PostgreSQL remains the single transactional
authority. Immutable Parquet/results retain their content identities.

Retained components have specific roles outside the interactive domain:

- Nautilus runs through its installed Python binding in an owned, isolated
  process. Rust independently checks source/fill evidence and normalizes results.
- PyArrow 21 is an opt-in legacy codec to reproduce existing immutable bytes.
  New native imports do not silently change old content hashes.
- The existing Node Dukascopy worker or licensed QDM executable supplies external
  transport. Rust owns jobs, pause/resume/cancel support, cooldowns and publication.
- Python setup, supervisor and differential-oracle scripts remain local tooling.
  Native startup does not launch Python command or research services.

Node identity covers the executable, worker, package/lock files and the complete
installed `node_modules` file set. Changed, added, missing or linked files fail
identity checks. The native executor verifies it again before execution. This is
installed-file integrity, not a claim that vendor network access was tested.

## Build and inspect

Run from `foundation_v2` with the existing locked toolchains:

```powershell
cargo build --locked --release --bins --manifest-path api-rust/Cargo.toml --target-dir api-rust/target/native-candidate
$env:TW_V2_RUNTIME_PROFILE = 'native'
.\api-rust\target\native-candidate\release\rust_runtime_admin.exe routes
.\.venv\Scripts\python.exe scripts/rust_runtime_inventory.py --admin api-rust/target/native-candidate/release/rust_runtime_admin.exe --output evidence/<attempt>/inventory.json
```

Use the existing DB/artifact backup and idle guards in
[API-PLATFORM-RUNTIME.md](API-PLATFORM-RUNTIME.md) before any owner cutover or
migration. Candidate binaries and ownership manifests are separate from rollback
binaries. Do not overwrite a running binary or stop a process by port/name alone.

The product-root restart wrapper now forwards explicit profile, storage and local
target options to this supervisor. Compatibility/full remains its default;
native defaults to `api-rust/target/native-candidate/release` and the separate
`.runtime/api-platform/native-owner.json`. From the product root, inspect an
already prepared native target without changing its schema or processes:

```powershell
.\scripts\restart_offline_api.ps1 -RuntimeProfile native -ReplayStorageProfile compact -CheckOnly
```

`-ArtifactRoot`, `-DatabaseName`, `-Port`, `-ManifestPath` and `-BinaryDirectory`
select an explicitly prepared local target. `-DownloadEngine none` disables
provider transport for an isolated target. Existing installed capability files
can be passed with `-ScientificCapability` and `-LegacyCodecCapability`. Omitted
capabilities are not created or enabled by the wrapper. The direct Python
supervisor accepts `--replay-storage-profile full|compact` as well; its explicit
default overrides any inherited storage environment setting.

For an authorized target, remove `-CheckOnly` to start/restart it. Pending schema
versions require `-ApplyMigration -BackupConfirmed` after verifying both DB and
artifact backups and quiescing all jobs. These flags acknowledge a backup; they
do not create one. A check-only invocation refuses pending migrations. The
supervisor's `--check-only --allow-pending-migrations --require-idle` can report
pending versions without applying them. `-Build` uses the same guarded compiler
path as `--build-only`; it refuses overwriting a managed running binary. Building
does not authorize owner cutover. Foreign listeners, another runtime profile,
active jobs/downloads and stale process identities refuse replacement.

Compact revisions require the restored-target materialization procedure below
before compatibility can read them. Switching `-RuntimeProfile` is not a rollback
procedure. Restart-wrapper integration evidence is linked in the execution
checkpoint, separate from prior backend lifecycle acceptance.

For an already installed scientific runtime, prepare and verify its descriptor
without opening a dataset or starting a job:

```powershell
.\.venv\Scripts\python.exe scripts/rust_runtime_adapter_bootstrap.py --output <artifact-root>/.runtime/scientific-adapter-capability.json
.\api-rust\target\native-candidate\release\rust_runtime_admin.exe scientific-capability <artifact-root>/.runtime/scientific-adapter-capability.json
```

Pass `--scientific-capability <path>` to `scripts/run_api_platform.py` together
with `--runtime-profile native`. Normal startup checks descriptor metadata first;
the research worker verifies the installed files before publishing its owned
readiness, and the supervisor starts the API only after that readiness is verified.
`--check-only` and `--setup-only` perform full verification without starting children.
An explicitly configured missing descriptor blocks worker readiness. This
inspects the existing installed engine; it does not
install dependencies or authorize research/provider/broker use.

`scripts/rust_legacy_codec_bootstrap.py --output <path>` prepares the explicit
legacy descriptor; `--legacy-codec-capability <path>` passes it to the native
runtime. Legacy restoration independently verifies it at the codec boundary.

For an existing Node data-worker installation,
`scripts/rust_provider_adapter_bootstrap.py --output <path>` emits the executable,
worker and dependency identities. Explicitly pass those `TW_V2_DUKASCOPY_*`
values plus the existing metadata capability to the selected runtime. No network
request is made by the bootstrap. Missing capabilities remain unavailable.

## Evidence and remaining acceptance

The execution checkpoint is
`evidence/rust-native-20261017/CHECKPOINT.md`. Reusable acceptance entrypoints:

- `scripts/rust_runtime_lifecycle_acceptance.py`: disposable PostgreSQL,
  start/drain/restart/crash, configured synthetic adapter and rollback HTTP.
- `scripts/rust_clean_source_acceptance.py`: archive tracked backend sources,
  build release offline, then run lifecycle and tick/portfolio journeys. Reuses
  installed Python/dependency caches; excludes frontend and fresh installation.
  `--component frontend` instead archives only committed web sources, installs
  locked npm dependencies offline with install scripts disabled into the clean
  temporary tree, then builds production assets. This checks cached setup/build
  independently of dirty source; it does not start a browser or package the
  separately authorized Advanced Charts distribution.
- `scripts/rust_native_ui_acceptance.py`: release native HTTP + production
  React/Advanced Charts, quick BUY/SELL, TP drag, close and persisted checks.
  `--http-benchmark` adds bounded independent concurrent aggregates at increasing
  ledger sizes. `--phase-timings` logs request phases without payloads/identities.
  `--soak-seconds 600 --soak-period-ms 5000` repeats same-cutoff order/drag/close
  journeys with post-GC page-heap, DOM, frame and confirmed-marker/rAF budgets.
  Failure preserves pointer/marker/request diagnostics and a screenshot. This
  is bounded desktop acceptance, not whole-product, touch, capacity or no-leak proof.
- `scripts/rust_replay_storage_acceptance.py`: equivalent full/compact PostgreSQL
  revisions, operation admission, historical hydration, Prop/analytics, immutable
  rows, invalid-prefix denial and alternating history-size samples.
- `scripts/rust_replay_storage_rollback_acceptance.py`: quiesced synthetic bundle,
  separate restored target, atomic full materialization, supervised same-schema
  compatibility HTTP and return-to-native/Prop continuation.
- `scripts/rust_replay_tick_portfolio_acceptance.py`: generated tick and two-asset
  financial lifecycles versus an independent Python service state, exact-byte
  retries, atomic rejects, historical views and fresh-process PostgreSQL reads.
- Persisted domain and financial differential suites listed in the checkpoint.

Current compact BAR interaction measurements are in **Bounded BAR storage
candidate** below; exact commands and raw samples belong to the execution
checkpoint. The earlier full-snapshot path measured around46ms on a300-row
synthetic fixture (12samples), but its response grew to about4.6MB at5,000events.
Those historical measurements explain the compact candidate; they are not its
current latency or a production-capacity result. Tick/portfolio retain full
hydration, with correctness evidence separate from scaling measurements.

Successful replay receipts now retain the exact serialized HTTP JSON in the
existing `result_text` column. Initial response, retry and command recovery use
the same result without another PostgreSQL JSONB parse. Failed replay receipts
and other domain receipts retain their existing storage. Transaction, revision
and idempotency semantics are unchanged; no schema migration is required.
The 5,000-event diagnostic comparison measured serial median 586→502 ms and
four-aggregate median 707→639 ms, with the same full financial response. These
are separate short runs, not an alternating capacity benchmark. Long-history
snapshot reads, domain validation and revision writes still dominate.

Moving snapshots instead of cloning them and isolating JSON CPU work reduced
the subsequent 5,000-event diagnostic medians to 370 ms serial / 440 ms with
four independent aggregates. Financial validation and the full ledger remain
intact. This is still an O(history) snapshot path; the short measurements do not
establish a stable tail latency or production capacity.

Scoped independent reviews, native Data/Research browser journeys and resource
checks are recorded in the checkpoint. Their revision and workload limits apply;
they do not replace the remaining integrated/long-duration acceptance. This
candidate does not change broker, holdout, authorization or deployment gates.

Scientific capability descriptors use `research-scientific-adapter-capability-v2`.
They pin all files under `engine_runtime` (including its isolated environment)
and the installed base Python prefix. DLL/PYD, transitive packages, bytecode and
additional importable modules are included. Bootstrap rejects import paths outside
those roots; adapter processes use isolated mode and a fresh private bytecode
cache prefix. No install or provider request occurs during this inspection.

Native scientific protocols additionally retain `engine.dependency_sha256`.
Admission compares small pinned metadata without spawning Python or hashing the
whole installation. The optional worker verifies installed bytes before publishing
readiness, then verifies identity before and after each complete job. OOS slices
reuse that boundary rather than hashing the installation for every slice. Those
checks honor cancellation and job deadlines. Existing queued scientific protocols
without this field fail closed and must be recreated under the new descriptor;
completed historical results are not rewritten.

A bounded in-process file-hash cache can reuse verified hashes only when the
filesystem supplies a reliable object identity and change stamp. Every check
still enumerates all files and rejects changed, added, missing or linked entries.
On Windows, restoring size/mtime cannot preserve the cached ChangeTime identity.
Unsupported filesystems hash exact bytes without caching. This avoids repeatedly
reading unchanged dependency bytes; it does not bypass installed-file validation.

## Compact replay mutation responses

Replay views and mutation/step responses advertise
`execution_capabilities.partial_close=true`. Clients must require this flag before
sending a partial close: older runtimes do not understand the optional quantity.
`POST orders/close` accepts an optional absolute decimal `quantity` in instrument
lots. Omission closes the entire position (or cancels a pending order); quantities
are only valid for open positions. Both the closed slice and any residual must
meet the instrument minimum and step. Partial closes execute immediately against
the canonical quote, keep TP/SL on the residual, and retain its `original_quantity`
and cumulative `realized_pnl`; old unsplit positions omit those two fields.

A partial close remains a `manual_close` checkpoint with one open position,
`closed_position` for the slice, `previous_position` for validation, and
`open_position` for the residual. Existing full-close ledgers retain their shape.
Fixed commission/minimum fees and financing are allocated by the slice's share of
original volume; per-lot commissions use the closed volume. Existing monetary
rounding applies separately to each fill, so summed rounded allocations can differ
by a cent from a single full close. Analytics records each closed slice once with
a distinct trade ID while retaining the original source position ID.

Single-asset POST requests to `execution`, `orders/quick`, `orders/market`,
`orders/protection` and `orders/close` can opt into
`?response_view=mutation-v1`. The default response is unchanged. Unsupported
views/routes and portfolio compact requests return 422 without changing the replay.
The query is part of the idempotency fingerprint; changing it is a different
representation and cannot reuse the same key with a different fingerprint.

The `replay-mutation-v1` response contains the execution head without its ledger,
at most 16 contiguous appended events, base/result revisions and event sequences,
workspace/session/branch/dataset/hash identity, unchanged cursor/cutoff, Prop
identity and bounded payload changes. First quick execution can advance two real
revisions; a queued order can advance a revision without appending an event.
Neither revision nor event sequence can substitute for the other.

React accepts a delta only against that exact base. It retains visible bars and
unchanged instrument/cost configuration references, appends events to its local
ledger and locks further writes if reconciliation fails. It never resends a
committed mutation to repair a response mismatch. Prop recovery also includes
older unacknowledged marks from the retained ledger, in order, after a failed feed
or reload. Portfolio and legacy snapshots retain the full-response path.

This removes historical bars/ledger from the mutation wire response and receipt.
With default snapshot storage, full reads, validation and JSONB revision writes
still depend on history. The additional storage opt-in below changes those costs
for selected BAR mutations. Frontend ledger concatenation remains history-dependent.
Browser evidence and Router-only comparisons are recorded separately in the
execution checkpoint.

## Bounded BAR storage candidate

The native candidate can opt into `TW_V2_REPLAY_STORAGE_PROFILE=compact` for
`mutation-v1` initialization/quick/market/protection/close requests. Migration
`0005_replay_execution_storage.sql` adds per-revision execution certificates,
append-only events and indexed operation reservations. Snapshot storage remains
the default; tick, portfolio, phase and branch mutations retain the full path.
The forward BAR step extension is described below. The owner database/runtime
was not migrated during those candidate measurements; the authorized cutover
described at the top of this document occurred afterward.

The bounded transition uses the existing financial arithmetic and event validator.
It checks only the new events against the previously validated canonical context.
Operation admission binds the exact head and prefix hash as well as lineage and
requested operation IDs. A queued order reserves its ID even if it emits no event.
PostgreSQL commits the revision, certificate, events, operation IDs and exact retry
receipt in the same transaction. Numeric commitments tolerate JSONB numeric
normalization while preserving strings and financial decimal semantics.

Full reads and analytics hydrate the exact requested revision and fully validate
its canonical ledger. Full writes after a compatibility restore remain authoritative;
the next compact mutation imports that full revision again instead of trusting an
older sidecar. Disposable persisted, production-chart and rollback rehearsals are
recorded in the execution checkpoint. Later resource and owner-cutover evidence
is recorded separately in the final acceptance audit. Cold import/hydration and default full steps remain history-dependent;
the whole product is not thereby constant-time. Importing a large existing full
revision is a one-time cost on its first compact mutation and is reported apart
from warm interaction samples.

Activity interval admission now checks the scoped current revision and deletion
state without reading the financial payload. It retains the head lock and existing
event/retry contract. This prevents a heartbeat from hydrating an entire compact
history while an order waits for the same lock. On the 5,000-event production-chart
fixture, 12 warm journeys measured confirmed paint at median79.5ms/sample-p9580.9ms
with compact storage, versus244.9/262ms with full storage on the same final source.
These serial headless diagnostics do not establish production capacity or stable
tail latency. They preceded the owner cutover documented above.

The later600s/120journey run on the5,000-event fixture passes at confirmed-marker/
rAF proxy sample-p9577.5ms and drag-frame sample-p9516.7ms, with DOMdelta0 and
10.87MiB post-GC page-heap growth within its declared16MiB allowance. Endurance
exposed cumulative automatic price-range padding: already visible levels now
preserve the range, while offscreen levels still expand it. Existing oversized
saved layouts are not inferred/repaired by this change. Failed attempts and
revision/fingerprint limits remain in the checkpoint.

A stored prefix hash alone cannot prove an unread prefix is unchanged. The trust
boundary must include immutable committed PostgreSQL event rows and controlled
restore/import. Validator changes must invalidate prefix admission. Branches import
only the selected revision prefix under the child's lineage and exclude parent
future operation IDs. No owner cutover is implied by this candidate.

Compact storage must also preserve a verified rollback route. Python compatibility
readers consume revision JSONB directly, and both migration ledgers reject unknown
schema versions. A profile toggle alone cannot make historical binaries understand
a new storage format. Before promotion, rehearse quiesced DB/artifact backup and
restore into a new owned target, materialize every compact revision into validated
full payloads there, and require zero compact rows before a pinned same-schema
compatibility build starts. Preserve revision IDs/timestamps, Prop bindings and
committed receipt bytes. Do not remove migration entries to force a downgrade.
Returning to native after compatibility writes must revalidate/import the new full
revision instead of reusing stale sidecars. The original native source stays intact
throughout this recovery rehearsal; subsequent owner switching is recorded at
the top of this document and in the final acceptance audit.

## Conditional replay entries

Native replay views advertise `execution_capabilities.conditional_orders: true`.
The chart order dialog reuses the shared Market/Limit/Stop selector. Market Save
and Quick Buy/Sell execute at the current quote. Limit/Stop Save sends the existing
`orders/market` route with `order_type`, `entry_price` and
`execution_timing: "pending"`. Compatibility rejects these conditional fields;
it does not advertise this capability.

Conditional orders retain the existing `pending_market_order` storage slot with
optional `order_type`/`entry_price` fields and a durable `order_placed` event.
Only one pending order or position per asset is supported. Protection remains
editable; changing the trigger requires cancel/recreate. Orders survive reload,
compact storage and checkpoint reconstruction. Conditional positions record
`entry_order_type`; older runtimes cannot consume these new ledger/state fields,
so preserve a compatible native build when restoring such sessions.

Buy entries trigger on Ask, Sell entries on Bid. A Limit gets its trigger price
or a better opening gap; a Stop gets its trigger price or the worse opening gap,
plus the declared adverse slippage. Margin is checked when the order fills.
Tick execution uses the first crossing executable quote. With BAR data, an
intrabar entry is timestamped at candle end; a possible same-bar protective exit
is rejected because OHLC cannot establish its order. Gap prices that invalidate
submitted protection also reject the step atomically. No intrabar path is guessed.

## Partial take-profit targets

Native replay views advertise `execution_capabilities.partial_take_profit: true`.
Market/Quick and protection requests accept optional `take_profits`: one to eight
objects with stable `target_id`, decimal `price` and absolute decimal `quantity`.
Prices must follow nearest-to-farthest trigger order for the side and meet the
instrument tick grid. Every allocation meets its minimum/step; allocations must
sum exactly to the remaining position. The server mirrors the nearest target in
scalar `take_profit`. Omission or an empty list on a protection amendment returns
to scalar TP; a null scalar removes TP. Compatibility rejects nonempty target
lists explicitly rather than executing a different order.

Each target closes only its allocation. The remainder retains SL and outstanding
targets, cumulative realized P/L and original quantity. SL closes all remaining
exposure. Manual partial closes consume the farthest allocations first; a
sub-minimum tail merges into the previous allocation. Existing per-slice monetary
rounding and original-volume fee allocation apply. Each protective slice is an
existing `protective_fill` checkpoint with a unique analytics trade ID and common
source-position ID. Full/compact history, reconstruction and branching preserve
outstanding targets. Tick quotes can execute several targets in sequence; BAR
execution retains the existing OHLC ambiguity rejection.

No schema migration is required. Sessions containing targets require a native
build that understands them; the Python compatibility engine cannot execute or
validate that new state. Preserve this binary when restoring those sessions.
Scoped evidence: [Partial TP checkpoint](../evidence/partial-tp-20261019/CHECKPOINT.md).
The local owner runtime now uses `api-rust/target/partial-tp/release` with the
explicit scientific descriptor above and the existing legacy-codec descriptor.
Readiness and a form-only check on UI5180 passed; trading writes used disposable
fixtures only. To change binary directories, first use guarded `--stop` with the
manifest's recorded binaries, then start the new target. The restart wrapper
correctly refuses using new binary paths to stop differently owned executables.

## Forward BAR step and chart tail

Native canonical full views advertise `step_view_version: "replay-step-v1"` for
single-asset BAR or uninitialized execution. A client can then opt into
`POST .../step?response_view=step-v1`; it must not probe an older runtime by
resending a committed step after an unsupported response. Tick, portfolio and
historical views retain the full contract.

This response has its own base/result revision, cursor, cutoff and event sequence,
up to1,000 appended native bars and3,000 contiguous execution events, and the new
execution head. It does not relax the same-cursor16-event order response contract.
The existing timestamp/interval/gap/session-period rules and shared financial core
remain authoritative. Compact storage advances the validated prefix and persists
only its new events in the same transaction as revision and retry receipt. An
uninitialized replay advances with a null execution; a final no-advance step uses
the fully hydrated compatibility path to preserve its existing revision behavior.

React validates the exact scope/base and every appended row/event before merging
its2,000-bar window. A mismatch locks writes and requires a read; it never repeats
the committed command. A committed step can paint while Prop consumes its marks,
but further commands remain locked until that feed settles. Retained client ledger
concatenation still depends on history length.
Prop navigation tracks the canonical session identity so each committed cursor
does not trigger a session reload and stop Play. A failed Prop feed retains the
committed replay; reload and the next step consume its unacknowledged marks in order.

Advanced Charts receives the verified native tail directly. Each ready subscription
folds it into an authoritative aggregate seeded at the exact previous cutoff; this
preserves complete day/week/month OHLC and volume even when the bucket begins
before the local window. New subscriptions, stale seeds and incompatible updates
use the existing scoped history reader. Rewinds still reset the datafeed. Ready
forward updates do not require a chart-window fetch or recreate the chart iframe.

Historical playback also retains the widget while moving forward. It verifies
the overlapping immutable native windows before passing their new candles through
the same incremental datafeed. A rewind restores a cutoff-safe native layout,
so drawings saved later cannot remain visible at an earlier time. Panning and
native chart-resolution changes keep playback running; the sync switch controls
whether the chart resolution also changes the replay interval. See the scoped
[playback UX/performance checkpoint](../evidence/replay-playback-20261019/CHECKPOINT.md):
the remaining full historical execution projection still limits playback speed.

### Forward historical API reads

Native BAR views in phase1 advertise `history_view_version: "replay-history-v1"`.
For forward historical playback the web client opts into
`GET ...?response_view=history-v1`, supplying the expected revision, base cursor,
base candle timestamp, every retained execution/portfolio event sequence and the
existing `advance_interval_seconds`. This is a read; it never advances the saved
session or creates execution receipts. Ordinary opens, rewinds, ticks, phase
transitions and unsupported checkpoints retain the full response contract.

The API reads the scoped current revision/deletion marker inside one repeatable
read transaction. A bounded LRU retains at most3 fully validated immutable BAR
revision snapshots, with a conservative96MiB retained-JSON estimate; this excludes
transient requests and other process allocations. A revision change, including
queue-only changes, cannot reuse an older entry. Cold admission uses the full
storage hydrator and existing core/portfolio validators. Both legacy full-snapshot
sessions and compact storage are supported without a migration or writes on GET.

Warm projection borrows canonical ledger prefixes, restores the exact local
checkpoints and uses the shared portfolio checkpoint arithmetic. It serializes
the execution heads, at most1000 new native candles and at most3000 new events
per ledger. Active-chart, per-asset and portfolio ledgers remain individually
identified; they are not treated as one sequence. Uninitialized single-asset views
retain the full API's stored payload cursor and separate selected chart cursor.
Canonical portfolio `has_future_rows` semantics are preserved when viewing a
completed session's past. Cutoffs preceding an asset initialization and other
unsupported projections use the original full reader.

React verifies the same revision, session/workspace/dataset lineage, base cutoff,
each ledger sequence and the visible clock before merging its retained history.
Malformed or stale responses retain the last chart and lock further stepping;
no command is retried. The chart still receives only its verified new native tail.
Cold reads and very large ledgers can remain slower; the cache is not a constant
time or high-concurrency capacity claim. See
[historical API evidence](../evidence/replay-playback-20261019/history-api/CHECKPOINT.md).

Compact Prop feeds select the requested canonical mark and its immediate predecessor
by primary key, then the next unacknowledged eligible mark using migration0006's
partial index. Exact revision certificates, scope, dataset hash, phase/cost binding,
ordering and retry receipts remain enforced. This reader shares the trusted
immutable PostgreSQL prefix boundary described above; cold reads continue full
hydration and validation. It does not authenticate an unread historical prefix
against an administrator who disables its immutability triggers.

Source review/unit tests are separate from persisted and production-chart acceptance;
the execution checkpoint records the measured scope and failed attempts. The owner
runtime was not switched during those fixture runs; the later owner cutover is
documented above.
