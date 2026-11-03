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
current local-trust API does not distinguish Owner from Automation. Activation
needs an authenticated restricted principal, owner-approved immutable Demo
grant, durable attempt/risk reservations, final fresh SDK admission, and native
unknown-outcome reconciliation. An `automation=true` field or a Paperclip report
is not that boundary. Real/live stays separately gated.

Read-only native market SSE is a sampled latest-state chart feed, not a durable
tick audit stream; see [its contract](LIVE-MARKET-STREAM.md). An actual observed
forward service needs a separately specified durable source/cursor and lifecycle.
