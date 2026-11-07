# Fixed H4 research comparators

`scripts/forex_h4_pilot.py` reuses the offline tick execution, cost, financing
and risk core. It does not connect a broker or call a model. The existing
Donchian pilot remains the default; the native Forex process worker still runs
its registered integration fixture, not an arbitrary strategy search.

## Opt-in study mode

Supply both `--candidate` and `--research-protocol`. The protocol file is hashed
into the run manifest before prices are inspected. The input manifest pins the
absolute CSV paths, SHA256 and date bounds, using `forex-h4-inputs-v1`:

- Warmup: 01–31 December2021, at least81 valid H4 candles.
- Development: 03–14 January2022 or03January–31March2022.
- Other windows, including validation/holdout, are rejected by this runner.
- The legacy default retains its original20–31December warmup contract/hash.

### Registered historical robustness

The period-robustness study uses the same fixed candidates and numerical core
with registered calendar horizons `[3,6]`. Its April–September 2022 window and
February–March warmup require their own frozen registration digest; an arbitrary
date edit or a new content hash does not grant execution. The report reads the
registered horizon labels and rejects missing or mixed worker cutoffs. Annual
registrations retain `[3,6,12]`; no completed annual artifacts are rewritten.

The explicit pair `--study-registration <frozen-registration.json>
--study-registration-sha256 <registered-sha256>` enables the separately registered
Q1/2023 study (warmup November–December2022). Supply the candidate, pinned input
manifest, protocol and current account-spec/hash as well. The omission of this
pair retains the 2022 guards. Only the registered content hash is accepted;
editing a date or recomputing a hash does not register a new experiment.

Before reading CSVs, the runner checks candidate/windows, protocol/spec,
frozen numerical module hashes and declared costs/financing calendar. It writes
an immutable registration/protocol copy and a separate historical-robustness
manifest with `clean_oos=false` and prior exposure unverified. This is not an
unseen-data attestation, economic qualification or broker permission. The raw
data-role key `development` is retained in v1 input JSON for compatibility;
the explicit manifest role describes how this new period is interpreted.

The frozen registration's source files are the baseline. The CLI's registration
plumbing changes separately; the numerical modules remain byte pinned. The new
run manifest pins the actual CLI/registration reader too. Preserve the baseline
and implementation review rather than editing the frozen protocol to match code.

`--preflight-only` runs the same input/spec/coverage/warmup validation and
writes manifest/quality/receipt without simulation or `results.json`. A successful
receipt is `preflight_passed_no_simulation`, not study completion. Use a new output
directory and preserve account-spec/hash arguments when applicable. The full run
already performs these checks; no separate preflight is required on unchanged
inputs simply to repeat them. Data inspection consumes the registered development
prices, so this is not a way to keep a future holdout unseen.

Registered choices:

| Candidate | Fixed definition |
|---|---|
| `eurusd-h4-donchian20-10-atr14-r025-v1` | The existing Donchian20/10 baseline, with the study's common warmup |
| `eurusd-h4-sma20-80-atr14-r025-v1` | SMA20/80 crossing; needs a preceding full-window difference; exits on loss of direction |
| `eurusd-h4-z20-2-atr14-time6-r025-v1` | Prior20-close population z-score, entry at ±2, exit at zero or the sixth observed H4 close of that position |
| `eurusd-h4-pullback20-80-atr14-r025-v1` | SMA20/80 trend filter; prior close on the other side of SMA20, then recross; exits when the averages lose trend direction |
| `eurusd-h4-utc-range00-08-atr14-r025-v1` | Both complete 00:00/04:00 UTC bars define today's range; a close beyond it at 12:00/16:00 UTC emits at most one entry per day; scheduled exit at 20:00 UTC |

The two round-two hypotheses are defined in workspace protocol
`planning/research/PROP-STRATEGY-ROUND2-20261105.md`, using the same CLI with
their own candidate/protocol pins. The range is deliberately fixed in UTC,
not a London-local opening range. Missing range bars skip entries; missing
scheduled exit data defers exit to the next valid candle. An emitted range
entry consumes the day even if risk admission or execution later rejects it.

All use WilderATR14 and initial2ATR stops, the same lot/cost/risk admission and
next-quote fill semantics. There is no same-event reversal, parameter sweep or
automatic sizing optimization. For the time exit, the fill-containing candle
counts when it closes; missing H4 candles do not count, and a new position ID
resets age even if its side matches the previous position.

```powershell
& <existing-python.exe> scripts/forex_h4_pilot.py --input-dir <existing-input-root> --input-manifest <pinned-study-inputs.json> --output-dir <new-output-directory> --candidate eurusd-h4-sma20-80-atr14-r025-v1 --research-protocol <registered-protocol.md> --account-spec <existing-spec.json> --account-spec-sha256 <expected-sha256>
```

Run from `foundation_v2`; omission of account spec uses the old declared cost
scenarios, not verified broker costs. Even with the current spec, historical
financing, commission, server fills and full intrabar coverage are unverified.
`strategy_pass`/`prop_pass` remain false. This runner does not implement The5ers
rules; a different target firm is not selected by changing an output label.

## Evidence and interruption

### Discovery candidates and feasibility probes

The development CLI also accepts the three fixed hypotheses preregistered in
workspace `planning/research/DISCOVERY-ROUND3-20261107.md`: failed prior20 range
rejection, compression6/24 breakout and same-day UTC range rejection. Their
shared `DiscoveryH4State` retains prior bars, WilderATR14, position identity/age
and the range-fade entry-day latch. The original five definitions are unchanged.
New rules share the existing tick execution, cash, risk, sizing and seals;
changing the candidate is not permission to change input windows or costs.

`scripts/forex_signal_screen.py --input-manifest <inputs.json>
--inspection-cache-dir <prepared-cache> --protocol <protocol.md>
--candidate <id> [--candidate <id> ...] --output <new-screen.json>` loads verified
H4 inspection caches for registered development input. It calls the same rules
with a flat position probe and records entry opportunities and lot feasibility.
It does not simulate holdings, fills, exits, PnL, drawdown or a prop account.
Counts are not executed trade counts, and the result never qualifies a strategy.

Probe results, source/protocol/input pins and timing support inexpensive triage.
No opportunities or no sizeable lots require review, not rejection of a whole
strategy family. Initial discovery compares all three new candidates and the
UTC comparator with the tick core regardless of probe outcome; this does not
estimate a true-edge false-negative rate. The workspace discovery reporter
reconciles completed tick outcomes with that same screen binding. Ambiguous
intrabar SL/TP ordering cannot be resolved by these H4 probes.

### Opt-in prop-path observations

A source-bound historical registration may embed canonical `prop_profile`
content. The runner then stages a `ForexPropObserver` per quote window and
commits observations only after execution and risk validate. It measures equity
pre/post-fill on every consumed quote and after declared financing. Initial
entry fills are observed even if a protective stop closes on the same quote.

The adapter supports the registered static USD profile, Prague midnight balance
anchor, equity loss limits and flat/reset phase transitions. Native
`money_oracle`, `calendar_oracle`, lifecycle evaluation and transition commands
remain the rule owners. Native evaluation runs at cash, reset, position,
qualifying-day and breach milestones; cheap comparisons use oracle-derived
thresholds between them. Unsupported profiles are rejected. Each phase's loss
allowances must be at least as broad as the unchanged internal safety brakes.

After an evaluator-approved flat phase pass, the next H1 boundary starts a new
execution/risk account at initial capital, with zero positions/pending orders and
fresh risk/fee accounting; causal indicator history continues while position-age
and per-account day latches reset. If that boundary
is the end of the study, the next phase is not started. No earlier ticks are
replayed. Completed phase accounts are retained and reconciled individually.
Phase profits are not payouts and are not summed into the next phase's balance.

`<scenario>-prop-path.json` and horizon snapshots retain tick DD, headroom,
first breach, qualifying days, native lifecycle state, phase archives and reset
milestones. They are covered by scenario seals. Lifecycle evaluation stops at
its terminal event; account DD observations may include the subsequent close.
CLI mid-scenario resume is still unsupported. Report readers reject missing
calendar fees for prop paths instead of repairing risk/account state post hoc.
These are declared-profile observations, not broker/firm certification or edge.

### Calendar boundaries

The runner posts declared financing even when quotes stop before a cutoff or
the dataset end. Horizons and the final calendar interval exclude events exactly
at their boundary. Quote-free cash events retain the last observed valuation;
they do not create fills, ticks, candles or a forced close. A fee can trigger a
risk halt and pending close; execution still needs a subsequent tradable quote.

Holiday startup can precede the first quote. A new registration may opt into
`pre_quote_flat_financing=explicit_not_applicable_v1`: only a pristine account
without ledger, position, pending order or cash change records zero-debit
non-applicability before its first quote. This creates no price or cash event.
The horizon reader independently binds those exemptions to the declared calendar
and the account's first observed hour; missing, duplicate or later exemptions
fail. Existing anchored financing guards and legacy defaults remain unchanged.

Tick snapshots run generic V2 money/margin contracts and tick lineage checks in
one ordered ledger pass. The parent delegates to the tick validator; it does not
drop margin checks. Full snapshot validation remains mandatory: mutable public
ledger prefixes are not cached as trusted. Changed source pins require a fresh
binding before a future numerical study; completed reports retain their original
source snapshots and are not replayed merely to read their results.

Historical execution with this runner requires a new registration declaring
`calendar_accounting=exclusive_event_clock_v1` and pinning its numerical CLI.
Legacy frozen registrations/artifacts remain readable but cannot execute against
the changed calendar semantics. Source-bound caches/reuse must pass their guards;
do not weaken bindings or rerun a completed annual batch just for presentation.
Older raw results may need the explicitly labeled derived tail report; their
original seals and accounting assumptions are preserved.

New manifests record Python/Pydantic versions and Decimal precision/rounding.
Scenario seals bind these values; the batch controller refuses completed-job
reuse when the current numerical runtime differs or the older run omitted the
runtime binding. Such old evidence remains readable with its original limits.
This is deliberately conservative reuse, not automatic equivalence across engine
or dependency changes. No previously unrecorded environment is reconstructed.

The output directory must be new. `manifest.json` pins source revision/files,
protocol, inputs and scenarios; `receipt.json` reports phase, data boundary and
observed tick count. Existing numeric accounting reconciliation is retained.
New attempts also record a run UUID, event sequence and elapsed time in the
receipt. `events.jsonl` keeps structured phase/progress events with stdlib
rotation (1MiB plus two backups). `failure.json` records error type/code, failed
phase and source locations; exception text/locals are omitted to avoid payload
leaks. Logs are diagnostics, not a second task state or tick archive. A phase's
last-progress timestamp is not a separate process heartbeat.
Canonical QDM timestamps use the guarded ISO parser; other inputs retain the
legacy parser's acceptance/rejection behavior. Hash, date-window, millisecond,
source-order, Bid/Ask and tick-grid checks still apply. A bounded consumed-data
reader benchmark does not establish whole-scenario throughput or strategy edge.
`<scenario>-checkpoint.json` contains execution/risk state; study mode also
writes the final `<scenario>-candidate.json`, with indicator/position age and
builder state and an explicit `cli_resume_supported=false`.

Round two also writes `manual-review-template.json` with a manifest hash,
stable per-scenario signal IDs, signal times, execution status and empty human
decision/reason/time fields. It is explicitly a historical schema example,
not prospective human evidence. `manual_filter_measured=false` and
`risk_override_allowed=false` remain explicit. A real comparison needs human
decisions recorded before outcomes and a separate replay, because skipped
entries change subsequent position and risk state; summing selected original
trade P&Ls is not that replay.

State roundtrip validation is not a CLI resume implementation. On interruption,
reconcile PID/identity, receipt and existing artifacts first; retain the failed
attempt and do not overwrite it or duplicate a worker. These offline results
cannot grant execution, qualify a prop account or certify an OOS edge.

### Reuse a completed scenario after interruption

For new runs, `<scenario>-completed.json` seals a completed result, quality and
checkpoint/decisions/candidate hashes. It is written after final accounting and
the results update, never from an intermediate checkpoint. A subsequent attempt
may use `--reuse-scenarios-from <stopped-attempt>` with a **new output directory**.
For example, a completed reference scenario can be kept when cost-stress fails.

The prior receipt must be failed/completed, or its owning batch terminal must
report failed/cancelled/timed_out after process reconciliation. Inputs, complete
source hashes, candidate, costs/spec/risk, protocol and quality must still match.
Hashes and final snapshot/accounting are verified before copying artifacts.
Changed bindings or a request with no seals fails; it never silently reruns the
whole study. The new manifest/seal records the source attempt and run identity.

This is reuse at a scenario boundary. `cli_resume_supported=false` still refers
to restoring an in-progress simulation; candidate/builder/financing/cursor state
is not restored midway. Legacy outputs without seals remain historical evidence
and are not automatically adopted. Source changes conservatively invalidate
reuse; numeric equivalence across versions is a separate review, not inferred.

Tests: `tests/test_forex_prop_candidates.py`, `tests/test_forex_h4_candidates.py`, `tests/test_forex_h4.py`; workspace
fixture regression: `tooling/ai-engines/tests/test_forex_research.py`.

## Shared quality and H4 warmup inspections

For a new registered study with several candidates, prepare the same pinned
inputs once, then let each worker load the immutable derived inspection:

```powershell
& .venv/Scripts/python.exe scripts/forex_prepare_inspections.py --input-manifest <pinned-inputs.json> --cache-dir <private-cache>
```

Add `--inspection-cache-dir <private-cache>` to the pilot command, or
`inspection_cache_dir` to each job in the workspace batch config. Keep the
preparation log with the new study; this command reads only the explicitly
provided files and does not grant access to a different data window. The first
preparation still performs full quality inspection; a hit rehashes the current
raw file, checks reader/source/runtime/window bindings and the cache checksum,
then restores exactly the quality report and Decimal H4 bars. Missing, corrupt
or outdated entries fail clearly; workers never silently rebuild them. Cache
identity/checksums are integrity evidence, not independent data certification.

Manifests record the cache path, entry digests and helper source. Simulation
still parses every original tick for each cost scenario and checks risk on each
quote. This is not a decoded-tick cache, strategy-result reuse or permission to
skip a scenario. The helper binds the reader/tick/cache source and numerical
runtime conservatively; a source change can require preparing a new entry.
One preparer owns each miss through an exclusive lock. After a crash, reconcile
the PID/log before removing a leftover lock or partial temporary file; never
overwrite an active writer or edit cache contents to pass validation.

The workspace controller also accepts `--parallel-start` for a **new study whose
protocol permits it**. It starts up to `--max-workers` without waiting for one
whole candidate to finish; every worker keeps full preflight/result checks.
The default retains the full-candidate probe, and existing batch bindings cannot
be changed in place. Prepared inspections should exist before parallel dispatch.

The QDM reader reuses only UTC conversion for repeated seconds; milliseconds,
sequence, header/date/order/grid and quote validation remain per record. The
pilot keeps tick counters privately within one atomic window and publishes them
in the validated checkpoint, retaining risk checks on every quote. Failed windows
publish no counters. Snapshot format and recovery boundaries are unchanged.
Reader-source changes invalidate prepared inspections by design: prepare entries
for the new binding rather than editing or adopting old cache JSON.

### Prepared tick cache and one-command batch preparation

When several candidates and cost scenarios replay the same pinned development
quotes, add `--include-ticks` to the preparation command. It writes a lossless,
source-bound Parquet cache for the development role; the preparation step still
parses and validates the original QDM CSV once:

```powershell
& .venv/Scripts/python.exe scripts/forex_prepare_inspections.py `
  --input-manifest <pinned-inputs.json> --cache-dir <private-cache> --include-ticks
```

The cache stores timestamp milliseconds, source sequence, and Bid/Ask decimal
text. Its metadata binds the raw CSV hash, date window, Python/Pydantic/runtime,
PyArrow version and decoder source. Every worker rehashes both raw input and
cache, checks schema/count/range/order/tick grid and reconstructs the same
`BrokerReplayTick` values. It never trusts Parquet metadata as market evidence,
does not deduplicate/downsample/fill quotes, and does not cache mutable strategy
or risk state. A prepared cache is an optimization artifact; raw QDM remains the
source of truth and must stay available for inspection/recovery.

For the workspace batch, put the same `prepared_inputs_dir` in each job and run
the newly registered study with `--prepare-inputs --parallel-start`. The
controller prepares each distinct `(kind, cache, input, hash, window)` once,
writes `input-preparation.json`, shows rate-limited phase progress, then dispatches
workers. A CANCEL/deadline during preparation dispatches no numerical worker;
an observation/projection write error is recorded and does not discard a valid
cache. Completed jobs skip preparation and remain reusable. Do not combine
`prepared_inputs_dir` with individual cache-directory fields, and never change
these bindings inside an existing attempt.

Each pilot receipt now records `phase_wall_seconds`, `phase_cpu_seconds` and
`process_cpu_seconds`; the batch projection includes new-worker CPU coverage and
does not add reused jobs to new computation. These values are diagnostic only:
wall time, CPU time, cache preparation and worker time are separate, and missing
coverage remains unknown rather than zero.

### Core valuation fast path

Floating P/L checks now use a validated Decimal-only net valuation helper that
reuses the already parsed instrument and cost models. It avoids allocating the
full cost-breakdown dictionary on every quote. Protective closes still use the
full accounting path, so event cost breakdowns, rounding, financing and ledger
provenance remain unchanged. Parity covers BUY/SELL, partial positions and
alternate rounding; a source or cost-model change must rerun those parity tests.

### Registered calendar horizons

A registered study may declare `horizon_months: [3, 6]` or `[3, 6, 12]` and exact
`horizon_cutoffs` in UTC milliseconds. Registration validation requires the
first calendar day, exact month boundaries and a final cutoff equal to the
evaluation end. These are nested observations, not independent trials.
The pilot emits `<scenario>-horizons.json` before processing the next hour:
execution/risk checkpoint, pending decisions, candidate/builder state, last
observed quote and accounting reconciliation. It neither closes positions nor
changes risk/sizing at a horizon. A weekend/data gap retains the last real quote;
its age remains explicit rather than inventing a boundary price.

Horizon declarations are included in scenario bindings and the new artifact is
included in completed seals/reuse. Legacy studies without horizons retain their
previous artifact set and binding. `tooling/ai-engines/forex_time_fit.py` verifies
seals, causal cutoffs and accounting and reports horizon observations. This is
not full firm certification. Without `prop_profile`, horizons alone do not
evaluate phase transitions. Registered prop-enabled studies also use the native
lifecycle and actual account reset described above; internal daily risk uses
Europe/Prague. Firm inactivity, exceptions, payout eligibility and historical
broker realism remain outside that declared subset, not inferred from PnL.

### Experimental H1 PnL triage

`scripts/forex_coarse_screen.py` and `forex_coarse_input.py` are an opt-in pilot
restricted to pinned, already consumed Q1/2022 inputs. Observed hourly Bid/Ask
extrema and first/last quotes feed the existing H4 candidate builder, sizing,
bar protection and cost arithmetic. Partial H4 hours still execute pending
actions. Intrahour stops fill at a modeled level, not the first crossing tick;
internal tick-risk stops, prop lifecycle and intrabar DD are not simulated.
Its simplified margin check uses initial capital, not full account risk state.
The distinct `forex-coarse-pnl-v1` schema always requires tick review and grants
no automatic rejection or promotion. It is not a native verified tick dossier.
Prepare its source-bound H1 cache once using `--prepare-only`, then use the same
input manifest/cache/protocol with a new output directory for the coarse run.

The November 7 engineering pilot matched eight current-source tick cases on a
five-day prefix. Eight full-quarter historical comparisons differed by $0.04–
$0.48, all optimistic differences from modeled stops. This supports experimental
triage of the checked rules, not exact fills, calibrated error bounds, unseen
data or prop qualification. A new rule needs its own fixtures and tick review.
The workspace's `COARSE-SCREEN-REVIEW-20261107.md` records the frozen protocol,
source/input pins, comparisons and timings; do not dispatch old completed studies
or relax native registration/cache guards to use the experimental screen.

Hourly preparation updates extrema in place without per-quote temporary maps
or min/max calls. Mid extrema still come from observed mid quotes, not the
average of Bid/Ask extrema at potentially different instants. The preparation
change preserves all hour fields and the 16 consumed-quarter coarse scenarios;
it does not change fills, costs or the native tick engine. Source changes still
produce new coarse-cache bindings. Keep previous attempts intact and prepare
the new binding rather than relabeling an old cache.
