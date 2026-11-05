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

The output directory must be new. `manifest.json` pins source revision/files,
protocol, inputs and scenarios; `receipt.json` reports phase, data boundary and
observed tick count. Existing numeric accounting reconciliation is retained.
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

Tests: `tests/test_forex_prop_candidates.py`, `tests/test_forex_h4_candidates.py`, `tests/test_forex_h4.py`; workspace
fixture regression: `tooling/ai-engines/tests/test_forex_research.py`.
