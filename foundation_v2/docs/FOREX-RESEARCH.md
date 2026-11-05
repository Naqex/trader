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

Registered choices:

| Candidate | Fixed definition |
|---|---|
| `eurusd-h4-donchian20-10-atr14-r025-v1` | The existing Donchian20/10 baseline, with the study's common warmup |
| `eurusd-h4-sma20-80-atr14-r025-v1` | SMA20/80 crossing; needs a preceding full-window difference; exits on loss of direction |
| `eurusd-h4-z20-2-atr14-time6-r025-v1` | Prior20-close population z-score, entry at ±2, exit at zero or the sixth observed H4 close of that position |

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

State roundtrip validation is not a CLI resume implementation. On interruption,
reconcile PID/identity, receipt and existing artifacts first; retain the failed
attempt and do not overwrite it or duplicate a worker. These offline results
cannot grant execution, qualify a prop account or certify an OOS edge.

Tests: `tests/test_forex_h4_candidates.py`, `tests/test_forex_h4.py`; workspace
fixture regression: `tooling/ai-engines/tests/test_forex_research.py`.
