# Analytics PnL and RR reference layout

26 October 2026. Owner requested visual parity for the PnL summary and three RR
cards first, with functional refinements later and incremental sample-mode coverage.

## Changes and state flow

The accepted PnL-left / three-RR-cards-right composition remains. PnL now has the
reference subtitle and four interval controls, without a standalone currency,
balance/PnL toggle or heading info icon. All report fullscreen buttons are removed.
Six summary groups show PnL and balance with inline percent arrows, win rate,
trade count with superscript wins/losses, breakeven count and an inline threshold
input with Apply. Responsive groups wrap without shrinking data text.

The shared report info control now uses the existing centered SVG icon and tooltip
layer, including keyboard and touch access. RR headings use RR terminology and
omit the small coverage fractions. Missing real observations still show N/A.

Existing models own all financial values. The threshold remains local report state
in account currency; applying it changes classifications, not PnL or saved trades.
The filtered balance tooltip retains its reconstructed-balance distinction.
Realized R, ideal complete-week eligibility and nonnegative-net opportunity rules
are unchanged. They are not claimed to match every reference formula; the reference
uses an R threshold and a different opportunity criterion, reserved for later work.

Sample mode renders the same report components. Its deterministic synthetic
ideal-RR and opportunity rows are generated only in demoFixtures.js and joined to
the selected sample trades. Sample reports make no analytics API requests. No
ready SL/RR simulation outcomes or MAE observations were invented in this slice.

## Verification

Scoped source/build, runnable checks, screenshots and private rollback files:
`E:/BACKUP-TRADINGWORKSPACE/analytics-pnl-reference-20261026/`.

- Scoped production build passed, using tracked HEAD plus explicit task overlays
  and the accepted private CSS baseline. Unrelated dirty files were excluded.
- 15 presentation/view-model/story tests passed.
- qa.mjs: 24 labeled fixture cases across three tabs, dark/light and
  1920/1366/390/320 passed, including overflow, threshold invariants, keyboard
  tooltip/SVG centering, chart values, Monte Carlo and axe accessibility checks.
- states.mjs: empty, filtered-empty, error, denied, partial and experiment-error
  cases passed; no owner-data writes or page errors.
- demo.mjs: four final-source cases cover 1920 dark VI, 1366 light VI, 390 dark VI
  and 1920 light EN. Ideal-RR plots, six summary groups, threshold apply/reload,
  interval controls, touch tooltip, percent colors and no analytics API requests
  passed both before and after promotion.
- The first demo harness selected SVG point buttons as interval controls and
  counted a JS asset as an API request. It failed; the selector and request scope
  were corrected. demo/harness-selector-failure.json preserves that attempt.
- actual.mjs: seven read-only checks passed on preview and UI5180, including
  existing session PnL, three tabs, market-time requests, Buy/Sell filtering and
  the data-library regression. No page errors or writes.
- Independent review checked source, demo 1920/1366/390, tooltip semantics,
  threshold invariants and RR data. A filtered-balance tooltip regression was
  corrected before acceptance; no remaining blockers. reviewer/review.json retains
  evidence. Root inspected desktop, mobile and light PnL screenshots.

## Rollout and limits

UI5180 index SHA256:
`eea4b3ba2cc9b944c052fa6c229ea0d30871cbab8346f6fcdd394742891e504d`.
Previous index:
`68d9e3efc1630f87eb036d4381930c9984389df5f161e5f71063746a3d61203d`.
ui-promotion.json records collision checks and atomic replacement; ui-before-release/
retains rollback files, private branding is preserved and old hashed assets remain.

API8010 remains native/compact. No API restart, terminal reconnect, broker request
or owner-data write occurred. The owned preview5196 is stopped after process identity
verification. Final served hash/readiness and cleanup are in deployed-hashes.json.

This accepts the requested visual slice and incremental sample coverage, not full
reference formula parity, broker execution or whole-product acceptance.
