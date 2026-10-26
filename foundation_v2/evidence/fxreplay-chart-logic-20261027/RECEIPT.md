# Analytics chart calculations and display — 27 October 2026

The owner clarified that the task includes formulas, grouping and rendering for
all report charts. This extends the earlier three coverage/tag fixes rather
than treating those fixes as the complete chart audit.

## Applied

- One actual-R resolver joins verified original-stop experiments before report
  grouping. Top RR, hour/session/month and calendar consume the same values.
  Ledger realizedR/original budget remain valid fallbacks; input is not mutated.
- RR/Ideal curves preserve missing trade slots and ordinals, with gaps rather
  than a compressed trend. Statistics average known observations only.
- Radar numeric scale/zero reference makes signed R/returns interpretable.
  Labels moved to the diagonal after independent visual review found north-label
  collisions; negative, all-negative and all-zero aggregates are covered.
- SL/RR comparison accepts ready samples only; stale numeric payloads on
  ambiguous/unsupported rows are excluded from summaries, curves and details.
- Monte Carlo has no invented source defaults. Binary initial WR excludesBE;
  bootstrap retains actualBE. Blank/invalid inputs and arithmetic overflow reject;
  aggregate mean avoids overflow. Fractional monetary means submit without
  rounding money for native HTML step validation. Probability default is rounded
  to its supported0.01 step. VI/EN help explains assumptions.
- Frequency help specifies first/last dated trades, and the calendar regression
  now expects dated unknown-PnL trades in frequency. Display contract corrected.

Full chart matrix, formulas and deliberate FX differences:
[analytics-chart-calculations.md](../../../ui/references/fxreplay/analytics-chart-calculations.md).
Reusable procedure: [verification workflow](../../../ui/references/fxreplay/verification-workflow.md).

## Evidence

Raw root: `E:/BACKUP-TRADINGWORKSPACE/fxreplay-chart-logic-20261027/`.

- Scoped build and **103/103 model tests PASS**, independently rerun103/103.
  Backend price-experiment focused suite **28/28 PASS** in the independent audit.
- `chart-qa-final/report.json`: all three report tabs, chart numeric/geometry
  oracle at1440VI dark/768EN light/390VI dark. RR gaps/ordinal, canonical groups,
  signed/negative/zero radars, MAE, side rings, monthly return, frequency, ready
  scenarios, MC1300 oracle, fractional form validity, changed-config notice,
  mismatched provenance and missing capital. PASS; no writes/page errors.
- `regression-preview-final/report.json`: six Sessions/Prop/Live cases PASS,
  including unknown PnL, bucket gaps, empty/denied, Prop phase fence and mixed
  source tag filters. `real-preview-final/report.json`: existing GET-only scope PASS.
- `final-review.md/json`, `visual-review.md/json`: independent source/visual PASS,
  bound to final candidate;9/9 overlay source hashes match build/main.
- `deployed-chart-qa/report.json`, `deployed-regression/report.json` and
  `real-deployed/report.json`: same final-byte journeys PASS on5180.
- `served-hash.json`, `promotion.json`: reviewed/deployed UI index
  `179761028d30e440915c29cc8e03a24406d609f9b8c1ebcbd958d0044be4d562`.
  Scoped source/result hashes are retained in [manifest.json](manifest.json).

Failures are retained: selector/translation/formatting errors in early harness
attempts; independent radar collision and fractional-step findings; preview
connection refused after an interrupted session. Final attempts supersede these
without relabeling failures. Oracle fixtures remain separate from real-service reads.

## Runtime and rollback

UI promoted atomically with prior index/branding backup in `ui-before-release/`;
old hashed assets retained for open pages. Unrelated dirty source/CSS excluded;
accepted private CSS snapshot retained from the previous verified build.

After interruption, API8010/UI5180/preview5197 listeners were absent. Existing
native/compact API was restored using checked prior binary/config paths and
the guarded idle/schema preflight; no pending migrations. Existing database,
artifacts, QDM, scientific/legacy descriptors and AI interpreter were retained.
API/UI launchers use Windows-owned `Win32_Process.Create`/pythonw with persistent
logs, outside Codex. This installs no recurring service or automation.
Final API readiness and reviewed served UI hash PASS. Preview is stopped separately
using its owned process identity; API/UI continue.

## Limits

FX analytics was demo and populated FX Live samples/Prop/Live chart access were
unavailable. No claim of FX production formula parity or fill/slippage/broker
acceptance. Main local WR includesBE, frequency counts intervening civil periods,
and PF cap4 only affects the ring. Unknown/partial/currency/cutoff/Prop fences
remain. No FX reload, owner trade write, replay advance or broker action was used.
This receipt accepts this chart slice, not the whole Product Completion Plan.
