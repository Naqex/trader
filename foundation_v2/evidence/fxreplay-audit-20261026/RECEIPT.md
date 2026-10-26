# FX Replay expanded audit — 26/10/2026

Owner requested continued research of Analytics Sessions/Prop firm, all accessible
FX Live pages and backtest charting, with suitable local adaptations. Hard or
access-limited parts may be deferred. This receipt does not mark the Product Plan,
broker execution or the entire product accepted.

## Delivered

- [Sanitized comparison and decisions](../../../ui/references/fxreplay/analytics-live-charting-audit.md)
  covers all observed sections, calculations, local source ownership, deliberate
  differences, adaptations, omissions and deferred evidence.
- Updated [workflow](../../../ui/references/fxreplay/verification-workflow.md) and
  reference index. Raw AX/PNG/help/menu/calculation records remain local at
  `E:/BACKUP-TRADINGWORKSPACE/fxreplay-audit-20261026/`, with `manifest.json`,
  `context.json`, `calculations.json` and `RESUME.md`.
- R1: preserve null balance observations through model and interval buckets; do
  not take previous balance as unknown endpoint or derive complete DD/recovery
  through missing observations. Existing gap-aware SVG renderer is reused.
- R2: group all timestamped trades, including unknown PnL. Counts/frequency retain
  those rows; financial bucket totals/WR become unavailable. Time and financial
  coverage have separate meaning; VI/EN help describes this.
- R3: tag filtering applies per record in mixed manual/MT5 aggregates. Untagged
  broker deals do not match selected tags; clear restores original scope.

Data flow: source report → Analytics projection → filtered period/stat groups →
shared presentation. Prop still validates phase/session/hash/cursor/event sequence.
Live still owns ledger/account/currency/coverage and broker/manual count semantics.
No schema, API or execution-permission change.

## Verification

| Level | Result | Evidence under raw root |
|---|---|---|
| Scoped build | PASS; HEAD `5ff3f98` plus eight source/test overlays; accepted CSS retained | `build.json`, `ui-build.log` |
| Analytics/Live model regressions | **81/81 PASS** | `model-tests.txt` |
| Chart risk/order/Live boundary tests | **33/33 PASS** | `chart-model-tests.txt` |
| Draft sizing oracle | Initial10000 →4.42/99.89; Current10016 →4.43/100.12 | `chart-sizing-result.json` |
| Independent source review | PASS; three original P2 fixed, 8/8 candidate hashes match | `final-review.json`, `independent-final-verify.json` |
| Preview browser | PASS, six grouped cases | `preview-qa-r6/report.json` |
| Independent visual review | PASS, actual dark/light screenshots | `visual-review.json` |
| Deployed browser | PASS, same six cases on5180; zero page errors/writes | `deployed-qa/report.json` |
| Actual local report | PASS, GET-only current one-trade report, net−2.28 | `real-deployed/report.json`, `analytics-real.png` |

Browser cases: Sessions1920VI/dark,768EN/light,390VI/dark; All/Day gap, unknown-PnL
count/frequency, unknown DD%, empty/denied; Prop1440 phase-fenced report; mixed
Live1920VI/dark and390EN/light, totals115→tag25→clear115→manual15. External
requests/WebSockets/writes blocked; only local session catalog GETs real in
fixture runs. Source and fixture evidence do not prove broker execution.

Failed attempts retained: r1 catalog stub prevented session discovery; r2 empty
selector; r3/r4 localized control selectors; r5 functionally passed but mislabeled
theme and targeted global Day filter. r6 asserts actual shell theme and chart
interval control, with clean screenshots. Independent review caught the evidence
mismatch. Promotion first stopped on Windows JSON decoding before any copy;
deployed-before-promotion correctly failed the gap regression on old build.
UTF-8 helper fix and guarded promotion then passed; failed evidence was retained.

## Local rollout

UI5180 index SHA256:
`8962930af784177c4efb62f0d8f8e64f1ac4769b5df25247494cf4fff3187e50`.
Previous:
`72eb2fb23571239862379878f8764a361bee44eef5d915f4fedfbbb266165aa2`.

`promotion.json` validates preview, real read and independent review gates. Old
hashed assets retained; index atomically replaced. Private branding preserved.
Rollback entry/mutable assets: `ui-before-release/`. UI PID24980/API PID23024
unchanged; no API/terminal restart. Temporary preview5197 is stopped after final
checks using `preview.json` PID/creation identity.

Commit contains only task files; unrelated ReplayWorkspace/API acceptance and
historical screenshots remain outside staging.

## Limits

FX Sessions/Prop were demo, with inconsistent totals; Live scopes were empty.
No FX original document refresh, record save, upload, sync, trade submission or
replay advance. Only accessible backtest chart inspected; FX Prop/Live charting,
simulation backend/intrabar formulas, populated Live partial fills/cashflows and
execution/performance need further evidence. Local real-runtime check is read-only
Analytics; Live tests are labeled fixtures. No broker acceptance asserted.
