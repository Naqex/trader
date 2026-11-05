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
