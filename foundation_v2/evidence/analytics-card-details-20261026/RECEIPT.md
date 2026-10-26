# Analytics page tabs and RR metric details

26 October 2026. Direct owner feedback requested long horizontal report tabs,
readable chart-axis dates, removal of repeated RR card headings and info controls
beside the individual metrics shown in the reference.

## Behavior and data flow

Three equal-width 44px tabs use the existing page strip, with blue text, a subtle
blue active surface and a 2px active indicator. No extra navigation row or bottom
separator was added. The generic compact adapter no longer overrides report-tab
height and selected color; Prop tabs retain their existing recipe. Arrow keys,
Home/End, focus and report/query state ownership remain.

The trade-count summary replaces ambiguous superscript wins/losses such as 0/1
with an explicitly labeled line: 0 wins, 1 loss. It still excludes breakeven from
those two subtotals; breakeven remains separately visible and total includes all
closed trades. Below 360px the summary uses one column to prevent amounts breaking
mid-number; wider screens keep the compact layout.

The three RR cards omit duplicated section headings, retain accessible region
names and place info controls beside each metric. Realized RR and ideal RR pair
average/max with their existing sparklines. The last card pairs its opportunity
count with the existing overall ideal maximum. The latter tooltip explicitly
includes eligible winners and losers; it is not a maximum of recovered losses.

The financial contracts are unchanged: realized RR uses available initial-risk
observations; ideal RR requires a complete one-week window. Opportunity counts
observed losing trades that could have closed at nonnegative net PnL, after fees.
The supplied reference describes a >1.2R criterion, which is not implemented or
claimed here. Tooltip copy describes this app's current values. No source trade,
backend formula, API profile, order, broker or owner-data state was changed.

PnL point tooltips retain full timestamps and baseline context. The visible x
axis omits baseline text, uses compact day/month dates (with years when crossing
years) or local times for a single day, and thins ticks according to plot width.
The last distinct date is preserved when it fits by replacing a colliding tick.
Unknown dates remain absent. Observation-index spacing, values, trade IDs,
timezone/bucketing and all chart-tool interactions remain unchanged; this is not
a continuous calendar axis and no empty dates/observations were invented.
Sample Analytics uses the same components and has incremental coverage.

## Verification

Scripts, JSON reports, screenshots, build and private rollback:
`E:/BACKUP-TRADINGWORKSPACE/analytics-card-details-20261026/`.

- Scoped production build: tracked HEAD plus five intentional source overlays,
  existing dependencies and accepted private CSS baseline; unrelated dirty files
  excluded. No new dependency.
- 15 focused presentation, view-model and read-contract tests passed.
- `details.mjs`: five cases at 1920/1366/1024/390/320, dark/light and VI/EN. Equal
  44px tabs, keyboard/focus, all six metric tooltips, original demo RR values,
  explicit win/loss labels, axis density/spacing and no overflow passed. Desktop
  shows ten date ticks, 390px shows four and 320px shows three. No errors/writes.
- `qa.mjs`: five cases cover zoom/pan/selection/reset/keyboard, drag-vs-inspector,
  escaped-gesture regression, filters/Apply/chip removal, shared info geometry,
  tooltip bounds, axe desktop, dark/light, VI/EN and DPR1/1.25.
- `axis-fixtures.mjs`: intraday Asia/Ho_Chi_Minh conversion, dates crossing years
  and unknown timestamps passed using labeled isolated response fixtures. Unknown
  timestamps do not become chart dates.
- `unknown-curve.mjs`: unavailable curve retains its empty state, no points and
  five disabled tools, with no errors/overflow/writes.
- `actual.mjs`: seven read-only existing-session checks passed: real PnL, three
  tabs, market-time requests, Buy/Sell filters and library regression. Deployed
  results are kept separately from sample QA.
- Independent review passed at desktop1920/mobile390 with source-contract checks,
  screenshots, keyboard navigation, tooltips, zoom and baseline point semantics.
  `reviewer/review.json` records the result. Root reviewed final desktop/mobile
  screenshots and the final date-tick/narrow-summary adjustments.

Failures retained: first rendered check exposed a compact adapter overriding tab
height/color; ownership was fixed in the source adapter. Tooltip harness actions
needed stable scroll geometry, and the English count assertion needed the reused
existing translation. The initial axis fixture mismatched ledger/count fields and
was correctly rejected as analytics_read_model_invalid; corrected fixture fields
passed without weakening product validation. Initial reused QA script paths were
corrected to this slice's artifact root before final checks.

## Local rollout and limits

UI5180 promotion uses collision checks, retained old assets, private-brand
preservation, saved previous index and atomic index replacement. Exact candidate
and served hashes are recorded in `ui-promotion.json` and `deployed-hashes.json`;
`ui-before-release/` retains rollback. The previous served index SHA256 was
`d8e5c5438fcb299876c6e6dbf8688b5325ab2e8c81e6db49ac53c9d4b5c97169`.

No API/terminal restart, broker call or owner-data write. API8010 remains
native/compact. Final read-only checks run on UI5180; only this slice's owned
preview5196 is stopped after process-identity verification. This accepts the
requested presentation slice, not reference formula parity or whole-product and
broker acceptance.
