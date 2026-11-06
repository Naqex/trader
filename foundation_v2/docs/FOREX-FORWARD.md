# Restartable Forex quote replay

`scripts/forex_forward.py` is an offline consumer of an already exported QDM CSV.
It does not download data, call an AI/provider/API/MT5, register a Paperclip task,
or execute broker orders. It is not an observed-market forward service. Paperclip
continues to own task/run/report state; a checkpoint owns only this reducer's
local execution state.

## Input registration

Use a trusted, operator-prepared JSON file with this shape:

```json
{
  "schema_version": "forex-forward-cli-v1",
  "candidate_id": "fixed-eurusd-h4",
  "strategy_revision": "registered-revision",
  "purpose": "system_fixture",
  "first_day": "20220103",
  "last_day": "20220114",
  "artifacts": {
    "data": {"path": "EURUSD.csv", "sha256": "<registered SHA256>"},
    "seed": {"path": "pilot.json", "sha256": "<registered SHA256>"},
    "instrument_spec": {"path": "spec.json", "sha256": "<registered SHA256>"},
    "cost_model": {"path": "cost.json", "sha256": "<registered SHA256>"}
  }
}
```

The example omits required source entries to stay readable. Add every role/path
in the CLI's `SOURCE_FILES` mapping, each with its separately registered SHA256.
Source entries must resolve to the actual executed files in this checkout.
Paths are relative to the registration directory, or absolute. The enumerated
pins include candidate, coordinator, risk, cash events, fill/cost semantics and
the CLI; they are not a hermetic lock of Python, dependencies, OS or timezone
database. Preserve the existing locked environment and record its version with
experiment evidence. Changed source requires a new registration; editing old
expected hashes does not authorize resuming a different experiment.

- `data`: exact QDM tick format `DateTime,Bid,Ask,Volume`, UTC milliseconds.
  Hashing uses a seekable binary stream and 1 MiB chunks, without loading the
  CSV into RAM. The existing QDM reader independently verifies its digest and
  registered date window. Cold resume also scans the consumed row prefix; this
  intentionally trades startup IO for a simple, verified cursor.
- `seed`: an unconsumed `ForexPilotSnapshot` JSON, including starting balance,
  limits, account/spec/cost configuration and session identity. Use the existing
  initializer; do not translate a spot paper snapshot into Forex.
- `instrument_spec` and `cost_model`: `forward_artifact_json(...)` canonical
  bytes of the corresponding seed execution mappings. The coordinator compares
  these digests to its actual values, not just to filenames.
- Optional `warmup`: canonical JSON array of `CandleState` objects. H4 candles
  must close before session start. Optional `financing`: canonical array of
  `FinancingTerms`. The actual warmup/calendar must match the bound bytes.
- Configuration JSON is bounded to 1 MiB. Artifact names outside this contract
  are rejected. No user-selected module is imported or executed.

The existing fixed H4 candidate remains unchanged: EURUSD/USD, 100000 contract,
0.00001 tick and 0.01 lot grid, $2.50/lot/side commission and declared timed
financing. Other cost shapes/specs are rejected rather than silently mis-sized.
An absent financing calendar means no modeled financing events, **not** verified
zero swap. Hashes establish identity, not data completeness, known-at correctness,
historical broker fees, strategy quality or promotion approval.

### UTC range research replay

The same offline coordinator/CLI also accepts the frozen candidate
`eurusd-h4-utc-range00-08-atr14-r025-v1`, with `purpose: "research"` only.
Add `source:candidate`, pinned to the executed
`trading_workspace_v2/forex_prop_candidates.py`, alongside `SOURCE_FILES`.
The existing spec/cost gates, quote cursor and checkpoint ownership still apply.
Its snapshot retains `PropH4State`: causal range/ATR history, entry-day latch
and position identity. A fixed-candidate checkpoint cannot be relabeled as UTC
range or resumed with different artifacts. Legacy fixed snapshots keep their
original state shape.

Missing range hours skip that day's entries. Restoration preserves pending
orders/exits and consumes a day's entry once; it does not reconstruct candles
from future quotes. Bounded Jan1–Jan3/2023 consumed-data checks compare the full
pilot/candidate/builder/decisions against batch, with two restores per cost
scenario. This establishes software parity in that scope, not new edge evidence.
It does not adapt `mt5_forward_session.py`, authorize broker orders, implement
the prop lifecycle in this stream coordinator, or qualify the strategy for demo.

## Bounded consumption and recovery

From the product checkout, using a private registration and output directory:

```powershell
.\foundation_v2\.venv\Scripts\python.exe -X utf8 .\foundation_v2\scripts\forex_forward.py start --manifest C:\private\registration.json --checkpoint C:\private\session.json --max-quotes 100000 --checkpoint-every 10000
.\foundation_v2\.venv\Scripts\python.exe -X utf8 .\foundation_v2\scripts\forex_forward.py resume --manifest C:\private\registration.json --checkpoint C:\private\session.json --max-quotes 100000 --checkpoint-every 10000
```

`start` refuses an existing checkpoint. `resume` verifies the envelope checksum,
artifact pins and source cursor. Each save uses a file lock, generation CAS,
fsync and atomic replacement. Concurrent stale writers fail instead of
overwriting progress. The checkpoint and its lock cannot alias registered
inputs. A crash can lose only the unsaved batch; replay after its durable cursor
has no external side effects. Checksums detect corruption, not a malicious local
writer able to replace both content and checksum.

The coordinator buffers one open hour. A quote in a later hour confirms the
previous hour has closed; the decision uses only closed H4 candles, and queued
entry/exit fills use a later observed quote. EOF alone does not close the final
hour. Only an independently justified source watermark may use
`--close-before-msc`; the CLI refuses it before the registered source reaches
EOF. A watermark is an operator assertion, not evidence of complete tick coverage.
Missing hours are not synthesized. This runner reports historical replay even
when invoked with wall-clock delays.

A watermark crossing a still-unapplied financing event beyond the buffered
hour is rejected before changing state. It cannot silently publish a later cash
horizon with missing swap. Supply an appropriate later quote, or close only the
hour supported by the source; the runner does not invent a quote to post cash.

Default session bounds are 100000 quotes in one buffered hour, 10000 committed
hours and a 64 MiB serialized checkpoint. Reaching a bound stops progression;
it does not discard history, silently extend the bound, or reset the risk day.
A distinct, explicitly designed rollover is needed for longer continuous use.
This CLI is suitable for bounded system sessions, not an unattended daemon.

Stdout returns JSON with binding fingerprint, generation, counts, EOF and open
buffer state. `execution_capability` and `strategy_qualified` stay false. Stderr
returns a structured failure and exit code 2. The persisted full snapshot retains
pending orders/exits, ATR/history, H4 partial bars, risk anchors/stops and the
financing cursor; resume must produce the same state as uninterrupted playback.

## Next execution boundary

Do not connect this output to the manual broker endpoint as automation. The
native `local-capability` API separates Owner from Automation using an
owner-approved immutable Demo grant, durable attempt/risk reservations, final
fresh SDK admission and native unknown-outcome reconciliation; see
[local capabilities and the durable session client](LOCAL-CAPABILITIES.md).
The historical replay consumer does not issue grants or invoke that client.
An `automation=true` field or a Paperclip report is not authority. Real/live
stays separately gated.

Read-only native market SSE is a sampled latest-state chart feed, not a durable
tick audit stream; see [its contract](LIVE-MARKET-STREAM.md). An actual observed
forward service also needs qualified data coverage and lifecycle; the bounded
capture below supplies a durable requested-range cursor, not those guarantees.

## Bounded observed quote capture

`scripts/mt5_observed_capture.py` records quote pages through the existing native
HTTP/owned MT5 worker path. It does not import the SDK, run the H4 strategy,
consume the offline QDM registration, create grants or send broker commands.
Use a separate private directory per immutable capture registration:

```json
{
  "schema_version": "mt5-observed-capture-v1",
  "api_origin": "http://127.0.0.1:8010",
  "binding": {
    "workspace_id": "tenant-a",
    "connection_id": "<current connection UUID>",
    "generation": 19,
    "login": "<verified demo login>",
    "server": "<verified broker server>",
    "environment": "demo"
  },
  "symbol": "<exact broker symbol>",
  "from_msc": 1793766000000,
  "to_msc": 1793766060000,
  "page_seconds": 10
}
```

These are structural examples, not current account parameters. Read the current
binding before registering; reconnect requires a new capture, not editing an
old generation. A session spans at most 24 hours/10000 pages, each 1–60 seconds
and at most 5000 rows. One invocation commits at most `--max-batches` (default
12, maximum 360). It exits `waiting` if the next interval is not yet closed;
there is no sleep/retry daemon, installed timer or auto boot configuration.

```powershell
.\.venv\Scripts\python.exe scripts/mt5_observed_capture.py start --manifest C:\private\capture.json --owner-secret-file C:\private\owner-secrets.json --state-dir E:\private\capture-session --max-batches 3
.\.venv\Scripts\python.exe scripts/mt5_observed_capture.py resume --manifest C:\private\capture.json --owner-secret-file C:\private\owner-secrets.json --state-dir E:\private\capture-session --max-batches 3
.\.venv\Scripts\python.exe scripts/mt5_observed_capture.py status --state-dir E:\private\capture-session
```

Only a trusted local operator process supplies the existing private Owner secret
file (`owner_bearer`), never its value in arguments/reports or a trading runner's
environment. This client issues only the fixed native GET route, disables
environment proxies/redirects and accepts an exact numeric loopback origin.
The client is not a security sandbox for an agent with arbitrary filesystem/code
access. Keep manifest/secret outside the output directory; pages contain account
lineage and are private. Neither credentials nor secrets are copied into pages.

Each page is fsynced and checksummed before an atomic checkpoint advances the
requested interval. A file lock prevents concurrent writers. Resume validates
every committed page/cursor and the client hash, then re-reads the final committed
window from the broker. Different rows/order/clock/SDK/source/binding stop the
capture with the original prefix retained. After a crash between page and cursor
commit, the uncommitted page is re-read/compared before adoption exactly once.
HTTP/SDK/invalid-data failures leave the last durable cursor intact. A `STOP`
file blocks further reads; remove it only when the operator elects to resume.

The cursor is named `requested_through_msc`. Every page/result retains
`broker_history_unverified`, including empty ranges. Rechecking the final window
detects revisions there; it does not prove older pages can never change or that
the broker supplied all events. Immutable files preserve what was observed, not
an independent market truth. Do not pass this cursor as a verified source
watermark to `forex_forward.py`, or claim it is continuous-market strategy
qualification. The stored page list can be replayed with exact same-ms ordering
for later coverage/consumer work; trade authority remains entirely separate.

## Finite observed-market shadow

The Rust `mt5-shadow` binary supervises `scripts/mt5_shadow_step.py`, reusing
the recorder and existing owned-process Windows Job implementation. It is a
trusted local operator CLI, not an API worker or an unattended service. The
existing API/MT5 worker remains the only SDK owner; no terminal or send path is
added. Paperclip still owns task/run/report management. An ephemeral lifecycle
file is a technical checkpoint, not a second task or permission ledger.

Prepare an immutable private registration outside the new session directory:

```json
{
  "schema_version": "mt5-shadow-session-v2",
  "capture": {"schema_version": "mt5-observed-capture-v1", "...": "same capture fields above"},
  "settle_seconds": 30,
  "stability_policy": "raw_ticks_v1",
  "deadline_msc": 0,
  "source_sha256": {"...": "reviewed mt5_shadow_step.source_pins() values"}
}
```

The example is structural and cannot run as written. The deadline must be at
least `capture.to_msc + settle_seconds*1000 + 2000`, at most `to_msc + 180000`.
Settlement is 30–120 seconds; capture retains its 24-hour/10000-page bounds.
An independent start must be within 60 seconds of the registered beginning and
before its future end. A verified continuation has the bounded settlement
allowance described below; arbitrary historical replay is not a fresh forward.
Only exact EURUSD/EURUSDm is admitted for this fixed candidate adapter. Review
and freeze the eight source/lockfile hashes before starting; a changed source,
binary, interpreter or registration needs a new session, not edited pins.

The reducer accepts at most one binary-float ULP of representation noise when
mapping SDK Bid/Ask to the fixed EURUSD tick grid. Genuine sub-tick prices still
fail. Original capture bytes/hashes are unchanged; normalization applies only
to the Decimal inputs of the reducer. A failed session stays failed and cannot
be relabeled as a fresh forward by replaying its stored ticks.

Build with `cargo build --locked --release --bin mt5-shadow` in `api-rust/`.
The normal `cargo run` still defaults to the API binary. On Windows, using
absolute paths and the existing locked Python environment:

```powershell
& C:\private\bin\mt5-shadow.exe start --manifest C:\private\shadow.json --state-dir E:\private\shadow-session --python C:\private\venv\Scripts\python.exe --owner-secret-file C:\private\owner-secrets.json
& C:\private\bin\mt5-shadow.exe status --state-dir E:\private\shadow-session
& C:\private\bin\mt5-shadow.exe stop --state-dir E:\private\shadow-session
& C:\private\bin\mt5-shadow.exe resume --manifest C:\private\shadow.json --state-dir E:\private\shadow-session --python C:\private\venv\Scripts\python.exe --owner-secret-file C:\private\owner-secrets.json
```

`start` refuses an existing directory. The private DACL is applied before state
is written. Rust holds an OS lock across the session, checks STOP/deadline while
waiting or reading, and bounds each Python step to 90 seconds/384 MiB. It sleeps
until the next due page/settlement, not a tight polling loop. A monotonic budget
also limits the current process lifetime if wall time moves backwards. After a
crash, status uses the lock to distinguish interrupted from running, not PID
alone. Resume requires the same immutable deadline and pins and explicitly
clears STOP; expired sessions cannot restart. The existing Job handle kills
children when the supervisor exits or crashes. No persistent scheduler, startup
entry or API/terminal restart is installed.

The checksummed `lifecycle.json` is atomically replaced after fsync. Capture
pages remain durable before their cursor; `shadow.json` is a deterministic
projection of those pages plus recorded decision observation times. A crash
between these commits replays the prefix without duplicate bars/decisions.
Resume rechecks captured pages against the broker. For read-only HTTP 423
`mt5_connection_not_ready` or HTTP 503 `demo_terminal_busy`, the supervisor waits
10 seconds before retrying the same session/cursor, at most six retries within
60 seconds per consecutive failure episode and always within the original
deadline. The checksummed lifecycle retains the episode start/count/reason,
total retries and last recovery; restarting does not reset an outstanding budget.
Recovery re-audits the entire durable prefix before consuming it, and keeps STOP
and deadline handling active. No reconnect, registration, account switch or
broker-send retry is performed. A changed binding, source or page still fails.
Other HTTP/timeout/generation, source, checksum or revision failures stop and
retain evidence; operators must inspect the reason before explicitly resuming.
When a settled-page audit finds a revision, `audit-failures/` now retains the
actual reread plus a checksummed comparison: original/reread hashes, range,
changed fields, tick counts and a `flags_only` classification when applicable.
The default `raw_ticks_v1` policy still rejects flags-only changes. A new
quote-only registration may explicitly select `ordered_quotes_v1`: ordered
timestamp/source-timestamp/Bid/Ask snapshots and every lineage field must match,
but flags are opaque metadata, not inputs to the midpoint/H1/H4 consumer. This
is not a bit-128 mask or a claim about that undocumented bit. MetaQuotes
[documents complete price snapshots independently of flags](https://www.mql5.com/en/docs/constants/structures/mqltick)
and its [Python example includes flags=134](https://www.mql5.com/en/docs/python_metatrader5/mt5copyticksfrom_py);
neither source establishes bit 128's meaning or raw-tick immutability.

Quote-policy changes retain checksummed original/reread/summary files in
`audit-observations/` (also under `capture/` for cursor/orphan comparisons), with
`accepted_for_quotes=true` only for flags-only revisions. Evidence-write failure
stops processing. All other changes still fail. Raw pages and their hashes are
never normalized or overwritten; no tick is dropped, reordered or deduplicated.
The capture cursor pins the comparison policy; resume and predecessor handoff
cannot change it. Reports expose `stability_policy` and
`raw_flags_stability=not_asserted` for this quote policy. It must not feed a
flag-dependent consumer or be presented as verified broker history, fills,
execution or strategy qualification. Standalone capture CLI remains strict.

Changing the capture implementation invalidates the old client pin; old failed
sessions stay inspectable, not resumable. The offline reprocessor's existing
compatibility guard also rejects that changed capture pin; use saved page pairs
for diagnosis, not rewritten manifests/cursors to manufacture compatibility.
A diagnostic read made after a failure is a later observation,
not proof of the exact reread seen by the original failed invocation.
Preserve each invocation's
stdout/stderr externally when an incident history is needed; lifecycle stores
the latest incarnation, not an append-only incident log. `complete` only means
the finite observation finished, even if warmup/data evaluation is incomplete.

For a focused supervisor check, build `mt5-shadow`, set
`TW_MT5_SHADOW_TEST_BINARY` to that executable and run
`python -m unittest tests.test_mt5_shadow_supervisor -v` from `foundation_v2`.
It uses only synthetic pages on an ephemeral loopback port and dummy credentials;
it verifies recovery without duplicates, old-prefix revision rejection and STOP
during recovery. It does not access MT5 or prove live hour-aligned handoff.

### Observe progress and detect interrupted runs

New supervisors persist an independent `heartbeat_at_msc` every five seconds
during worker calls, polling waits and bounded transport recovery. `phase` records
`worker`, `poll_wait`, `settling`, `retry_wait` or `terminal`. This is supervisor
responsiveness, not proof that the worker, broker or market data are healthy.
`updated_at_msc` remains the last data/progress update; a quiet wait does not
pretend to have captured more ticks. `status` projects `health` without rewriting
the lifecycle: a released session lock reports `interrupted`; a held lock with
heartbeat older than 15 seconds reports `heartbeat_stale`; a held lock past the
original deadline reports `overdue`. Old sessions report heartbeat unavailable,
not fabricated freshness. Heartbeats never change registration, pins or deadline.

For workspace runs, use the maintained read-only observer
`tooling/ai-engines/shadow_watch.py` described in the workspace operations guide.
It prints progress and optionally publishes a dedicated document on the existing
native task. Start it after lifecycle initialization, keep its stdout/stderr and
PID with the invocation, and verify the first native document readback before
leaving a long run unattended. Do not treat an observer/publisher failure as a
reason to restart data capture. A completed finite observation is still distinct
from H1 handoff, data qualification, strategy acceptance and long-term uptime.

### Choose resume or offline reprocessing

For a process interruption with unchanged code/pins and an unexpired deadline,
use `mt5-shadow resume` on the same session. If capture is durable but a reducer
bug needs a code fix, first reuse those pages offline:

```powershell
& C:\private\venv\Scripts\python.exe .\scripts\mt5_shadow_reprocess.py --manifest C:\private\old-registration.json --state-dir E:\private\old-session --output-dir E:\private\new-offline-result
```

The output must be new and separate. The command verifies capture checksums,
binding, cursor and source pins; only the reducer `step` pin may differ. A changed
candidate/capture/dependency contract or an imported predecessor requires a
separate compatibility review. No credentials, native reader or broker calls are
used. Stored-page re-reading verifies local integrity only, not broker stability.
Inputs stay unchanged and concurrent cursor changes fail without publishing.

`reprocess.json` is an offline projection with `continuation_eligible=false`,
not a live lifecycle or an eligible warmup seed. Failed/expired lifecycle history
remains intact. Reprocessing reuses the recorded prefix; a new targeted live
check is justified only for a remaining transport/lifecycle behavior. Do not
repeat an entire market observation merely to verify a calculation fix.

### Shadow bar policy and limits

The reducer uses Bid/Ask mid prices, the same basis as the existing historical
H4 reducer. It excludes a leading partial hour and buffers the trailing partial
hour. Before feeding any full hour it waits the registered settlement delay and
re-reads every overlapping page; rows/order/clock/SDK/source must match. New or
late/backfilled rows block rather than mutate a consumed bar. Empty/quiet hours
or an adjacent/leading/trailing quote gap over 60 seconds block the session;
this conservative policy can reject legitimate quiet trading periods. It does
not infer a market calendar, synthesize missing candles or silently reset the
candidate to skip a gap. A later change to an old page is checked on explicit
resume; the broker is not continuously re-audited after session completion.

These checks produce `stable_observed_sample_max_gap_60s` with
`broker_history_unverified`, **not** a complete-tick watermark or independent
market truth. H4 requires all four accepted hours. Its decision records both
the earliest allowed time and actual first observation time; a later replay
cannot backdate that decision. Closed bars alone feed the unchanged fixed
candidate. Short sessions correctly remain `warming_up`; with no imported
warmup, one 24-hour session cannot produce the 20 prior H4 bars needed for an
entry. Use the optional frozen predecessor below to retain observed warmup
across explicitly started sessions. Do not import stale historical candles.

### Warmup between finite sessions

A v2 registration may include:

```json
"continuation": {
  "state_dir": "E:/private/previous-shadow-session",
  "report_sha256": "<checksum of the previous shadow.json value>"
}
```

Use `capture.checksum(capture.checked(previous_dir / 'shadow.json'))` with the
existing `scripts.mt5_observed_capture` module to obtain the report
checksum; this hashes the canonical report value, not the file envelope. The
predecessor must have a checksummed Rust lifecycle with status `complete`, a
matching registration hash and matching capture/report counters. `init` and a
cold resume verify its capture pages. The successor pins the predecessor report,
retains H4 builder parts, candidate history and ATR, and stores only its own new
hours/decisions plus cumulative counts. It does not copy the predecessor's ticks
into the new session or reissue prior decisions. Its first read must preserve
the previous SDK, broker clock and capture source lineage.

Handoffs must be contiguous at an exact UTC H1 boundary: the next `from_msc`
equals the completed predecessor's `to_msc` and consumed-hour boundary. Account,
generation, symbol, origin, settlement policy, source pins and Python/Pydantic
versions must match. A gap, overlap, unfinished predecessor, changed report or
capture prefix blocks the handoff. Canonical local directories must be separate,
with no links/junctions or nesting. Up to 32 sessions form one bounded chain;
the normal 24-hour limit and start-time/deadline checks still apply to each.

Stop/crash recovery within a partial H1 uses `resume` on the same session, not
a new registration that discards the unfinished hour. A completed session ending
mid-hour remains inspectable but cannot seed another. An hour-aligned handoff
requires explicit timely start after predecessor completion; no scheduler or
automatic rollover is added. A continuation may start up to the registered
settlement plus 60 seconds after its beginning (90–180 seconds total), still
before its future end. Python init verifies the completed predecessor before
capture; adding a `continuation` object alone cannot authorize late reads.
The actual observation time is retained for decisions. A missed window requires
review, not unbounded backdating or changed registration/deadline pins.

Old v1 sessions remain historical evidence. They cannot seed a v2 session or be
resumed with changed source pins; do not edit their registrations/checksums to
upgrade them. There is no owner-data migration. New v2 chains must start with
the reviewed source and registration. The retained seed is a frozen observation,
not an assertion that a broker can never revise older history. Long live chains,
weekend continuity and unattended rollover remain separate operational evidence.

Signals are flat-state advisory evaluations only. There is no simulated
position, EXIT lifecycle, quantity, fill, margin, financing or P&L. Unknown
fees remain `not_modeled`; `execution_capability` and `strategy_qualified`
remain false. This verifies the observed data/lifecycle/consumer path, not a
complete strategy paper trader, continuous multi-day service or profitability.

## Keep raw collection independent of bar quality

New v2 observation registrations may explicitly set
`"projection_policy": "quarantine_v1"`. The default `strict_v1` still stops on
a failed bar-quality check. Do not edit a failed session's original registration
or source pins to switch policies; use reviewed new registrations.

In quarantine mode, a historical reread with changed quotes or a closed-hour
gap over 60 seconds persists a checksummed `quality-hold.json`. Raw capture
continues from its existing cursor. The last valid `shadow.json` stays frozen;
suspect hours do not emit new bars/signals and are not repeatedly recomputed
on every poll. Resume validates the hold's plan and last valid report before
advancing raw capture. The hold records when the changed data was actually
observed, never an earlier retrospective knowledge time.

Lifecycle observations expose `projection_status`, `quality_reason` and
`quality_details` alongside current raw page/tick counters. `complete` with
`projection_status=held` means collection finished, not data acceptance. The
workspace controller keeps that task blocked and cannot hand off its warmup.
A held predecessor is explicitly rejected even if its last valid report exists.
Human inspection/reconciliation is required before a reviewed new projection;
there is no automatic release of a hold or execution of historical signals.

Account/source/SDK/clock changes, corrupt files and revisions to the raw
recorder's most recently committed page remain hard failures. This policy does
not weaken raw capture identity or atomic-commit recovery. Empty/quiet intervals
are not filled, the 60-second bar threshold is unchanged, and no unverified
broker calendar is used to exempt gaps. Test with saved competing observations
and a synthetic clock before requesting another wall-clock hour.
