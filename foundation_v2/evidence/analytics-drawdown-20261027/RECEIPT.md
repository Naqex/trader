# Drawdown research and application — 27/10/2026

## Completed scope

Owner's nine Drawdown comments applied to local port 5180. Source/frontend
reference: `ui/references/fxreplay/drawdown-20261027.md`.

- Default percent; USD selector uses `$` through the existing currency helper.
- Main chart uses gradient vertical columns, horizontal dashed grid, labeled
  axes and real observation/close timestamps in the selected timezone. Keeps
  equity versus closed balance explicit; peak points no longer pad categories.
- Original `https://releases.fxreplay.com/drawdown` link in the main heading.
- Recovery unit in label; episode count has no redundant suffix.
- MAE histogram uses bounded decimal intervals and overflow, with thin zero
  marks for known empty bins. Missing MAE is not a zero observation.
- Winning MAE cards show R in labels and have separate help controls. No parent
  info icon or obsolete lower link. Incomplete winner coverage stays `N/A`.
- Tiny drawdown percentages retain enough precision in summaries and hover
  tooltips to avoid false `-0%`.
- Explicit UI demo fixtures now supply synthetic MAE observations. Real price
  paths, original risk and backend data are not fabricated or modified.

## Data and calculation boundaries

Existing drawdown/episode/recovery calculations remain in `tradingAnalyticsModel`.
The main chart consumes declared account equity if available and applicable;
otherwise it consumes closed balance. It does not infer floating equity from
closed trades. MAE reads matched `initial_stop_distance` observations. The new
histogram changes grouping; winning stats now require the whole winning group.
No broker/execution, replay advancement, API restart or database changes.

FX source was verified through current public imports and rendered demo,
without refresh or bypass. Backend aggregate formulas remain unverified;
the reference records that boundary and local observed-point averaging.
FX's empty-array infinities and inconsistent overflow boundary are not copied.

## Verification

Evidence root: `E:/BACKUP-TRADINGWORKSPACE/analytics-drawdown-20261027/`.

- Scoped HEAD build plus exactly six frontend overlays: PASS. Build log/hash
  and excluded unrelated worktree changes recorded in `build.json`.
- Root-run unit tests: 13 presentation/source-parity tests and 8 focused
  equity/drawdown/recovery tests PASS. Covers decimal boundaries, overflow,
  missing risk, zero MAE, unknown classification, source time, segments and gaps.
- `preview-final2/report.json`: PASS 10/10.
- `deployed-qa/report.json`: PASS 10/10; final tooltip precision release
  `deployed-qa-final/report.json`: PASS 10/10.
- Cases: 1920/1366/768/390/320px; Vietnamese/English; dark/light; demo,
  current real session, labeled equity/MAE fixture, partial MAE, observed zero
  and global no-closed-trades state.
- Fixture oracle: equity max -20%, underwater average -15%, recovery 2 days,
  frequency 2; money switch -$220/-$160; winning MAE mean .4R, min 0, max 1R.
  Asserted original URL, default unit, dates, individual keyboard-activated
  tooltips, zero-bin marks, no document horizontal overflow and one scroller.
- `performance-preview/report.json` and `performance-deployed/report.json`:
  PASS 2/2 each. Prior VI rendered metric text and card alignment preserved
  at 1920px and 390px after extending the shared bar renderer with opt-in props.
- Read-only browser contexts blocked non-GET/HEAD, external origins,
  MT5/Live/events and websockets; zero JS errors and attempted writes.
- Independent source and visual review by `frequency_review`: no blockers.
  Reviewed desktop/mobile, real tiny percentages, and partial coverage tooltip.

Earlier browser attempts remain on E: initial focus triggered a pending scroll
that dismissed a tooltip; the harness now scrolls the actual help control and
settles animation frames before keyboard activation. The first empty case
incorrectly expected a report; corrected to verify the existing global empty
state. No application tooltip or empty-state gate was bypassed.

## Local rollout

Atomic UI index replacement; retained existing API/UI processes, private branding
and old hashed assets for open pages. Promotion verification PASS.

- Current index SHA256:
  `1013af928447ef58fc9f72bf74687c3a454bed2737e5717b103b77c5941a8e93`
- Immediate rollback: `ui-before-final-release/index.html` under evidence root;
  SHA256 `34a91cf9bb762c6aab32c2759430d0d51921302f256d0a7a8594332d424035f5`.
- Original pre-task rollback: `ui-before-release/index.html`; SHA256:
  `b4adce95d0111a3abcb600d5cf3f9fa528a16dea997d0f75fe0d22871f3af0fc`

Build/fixture/rendered local acceptance applies to this Drawdown slice, not
whole-product acceptance or a reproduction of FX's private backend.
