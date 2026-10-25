# Analytics composition and bounded experiments

Requested 25 October; integration completed 26 October 2026.

## Scope

Rebuilt Performance, Drawdown and Simulation using the established product palette,
shared controls and chart scale/curve functions. Removed the Data Library table-options
menu; column-header sorting remains. Reference inputs were owner screenshots, visible
FX Replay tooltips and the public [drawdown guide](https://support.fxreplay.com/articles/how-to-use-drawdown-analytics)
and [RR guide](https://support.fxreplay.com/articles/how-to-use-the-rr-simulator).
No subscription gate or private API was bypassed.

Performance groups PnL/balance, verified realized/ideal R, expectancy/profit factor,
outcomes, side, fixed hour-window radars, hour/day/month views, calendar and frequency.
Drawdown separates account equity (including floating PnL) from closed balance, then
shows MAE distribution and winning-trade MAE in original-risk R. Simulation provides
configured SL, entry-SL RR and bounded seeded Monte Carlo. Definitions stay in info
controls; report diagnostics remain in existing details.

## Data and state

Session Analytics requests chart/market time and projects the declared scope without
rewriting raw real-activity timestamps. The ledger/research keep activity time.
Settings owns the display zone. Filters constrain the full source before presentation;
trade-filtered reports use closed balance when account equity has no matching scope.
Tab changes retain experiment results instead of issuing another identical request.

Equity peaks reset only at source segment/funding-reset boundaries. Missing/sampled
observations are retained honestly. The breakeven amount changes outcome classification,
not saved PnL. Main win rate includes breakeven; RR win rate excludes it.
Comparisons use the same eligible trades for actual and simulated curves. Simulator
average drawdown is the mean positive underwater closed-balance observation, zero when
there is no drawdown, and unavailable without initial capital or eligible trades.

RR and MAE use a stop proven at entry, never a later protection edit or configured SL.
Ideal R needs a complete seven-day observed window at/before the selected cutoff.
SL/RR outcomes remain bounded to original exposure. Missing denominators/ambiguous
intrabar results stay unavailable. These bounds deliberately prevent unseen future
prices or invented outcomes; the implementation does not promise exact FX Replay
internals where their public documentation is unspecified.

The native portfolio adapter validates the parent account checkpoint and full-ledger
filters, then reads each selected asset using its own hash/cursor/closing event.
Parent account provenance and dataset-prefixed trade IDs are preserved. Source commits:
`4035cbe`, `50c1ae9`, `1abb0ab`, `2049acd`, `e461334`, `2e326de`, `7561199`.

## Verification

External build, source fingerprints, browser evidence and private read-only projections:
`E:/BACKUP-TRADINGWORKSPACE/analytics-redesign-20261025/`.
Portfolio projector evidence:
`E:/BACKUP-TRADINGWORKSPACE/analytics-reference-20261025/portfolio-real/AUDIT.md`.

- 47 focused frontend tests passed; 15 directly affected tests passed again after the
  market-time request and simulator average-drawdown changes.
- Fixture browser QA: 24 combinations (three tabs, dark/light, 1600/768/390/320px),
  keyboard tab navigation, threshold/config controls, Monte Carlo, axe checks;
  no page/console errors or writes. `qa/report.json`.
- Six state checks passed: empty, filtered empty, read error, permission denied,
  partial and experiment error. `states/report.json`. The first harness used an
  incorrect empty-state label; the failed report is retained separately.
- Independent review passed visual/interaction, equity sign/fallback, mobile radars,
  known/unknown R merge, request time basis and no extra experiment read on tab change.
  `reviewer/actual-market-final.json` plus earlier reviewer reports.
- Backend: Python experiment tests 28 passed; context tests include 266 Python oracle
  projections; activity tests six passed. Final portfolio tests passed synthetic two
  assets, bad hashes/future exclusion/full-parent filters and read-only real checkpoints
  on both market/activity bases. Same-cursor event 2 remains rejected; events 3/4 have
  zero closed rows while event 5 has one. No owner records were changed.

## Runtime acceptance

The final release-context suite passed three tests including all 266 Python oracle
projections (`portfolio-release/context-tests.log`). The portfolio candidate passed
idle/schema/capability preflight; the owned old binaries stopped through the guarded
launcher. API8010 is ready under native/compact with the existing QDM/storage,
scientific/legacy descriptors and AI interpreter retained. Sixteen migrations are
current, none pending; no migration was applied.

- Run: `091038621b924c2eade5cdc81c8632e3`.
- API SHA256: `72e297248e818880b8afebad2f5054e2d9114c8a515c6330a3347086c53cd064`.
- Binaries: `E:/BACKUP-TRADINGWORKSPACE/analytics-redesign-20261025/portfolio-release/backend-target/release`.
- Scientific descriptor: `E:/BACKUP-TRADINGWORKSPACE/analytics-redesign-20261025/portfolio-release/scientific-candidate.json`.
- Guarded rollback: `portfolio-release/backend-before-release/rollback.json`.

Candidate and deployed read-only journeys each passed seven checks: actual net PnL
and market-time month/calendar, all three tabs, Buy/Sell filters, removed library
options with header sorting retained. Actual closed loss remains -2.28 USD, equity
max drawdown -2.28 USD; SL calculates 1/1 while RR remains 0/1 because the original
SL is not verified. Monte Carlo's four draws from this single trade end at 99,990.88
USD from 100,000 USD. No browser writes or page errors. Reports: `actual/report.json`
and `deployed/report.json`; screenshots are alongside them.

UI5180 was promoted with collision checks, retained old hashed assets/private brand,
and atomic index replacement. Served index SHA256 matches:
`a5911e5d28c1c0c0d2563c6413b5c91d3da50650203f8e046db318ff3ba0474e`.
Rollback index/assets: `ui-before-release/`. Fresh readiness/binary/index verification
is in `deployed-hashes.json`. Only the owned 5196 preview is stopped after acceptance;
UI5180/API8010 stay running.

This is scoped Analytics/local runtime acceptance, not whole-product/broker acceptance.
No terminal reconnect, OrderSend, provider install or owner trading-data write occurred.
