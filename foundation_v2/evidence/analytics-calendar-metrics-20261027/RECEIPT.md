# Analytics calendar metrics and zero presentation — 2026-10-27

## Delivered

- Weekday known win rates, including 0%, have green badges. N/A remains neutral.
- Calendar menu has net P/L, return (%) and return (R). Initial/day-opening capital
  radios appear only for percentage. Daily details retain count, win rate and
  average R with risk coverage.
- Initial percentage uses each source capital once. Day-opening capital uses full
  earlier local days before local chart filters. Explicit server-filtered,
  truncated, undated or partial history cannot establish opening balances. Missing
  prior P/L, invalid capital and mixed currencies remain N/A.
- Daily R is the sum of each trade's original-risk realized R; missing any R makes
  it N/A. It is not average R. Monthly Current snapshot semantics are unchanged.
- Thin neutral marks at exact zero are opt-in for observed hour/day groups only.
  Missing categories receive no mark. Other chart families retain their semantics.
- DemoReports now preserves scope/time basis and marks actual filter state.

## Reference and verification

Fresh public FX `chunk-ZI3BTXB2.js` confirms the three menu categories and balance
radios. It consumes API-provided daily percentages and riskReward; it does not
prove backend formulas. Local formulas are explicit contracts. FX also combines
open P/L; local Analytics remains closed trades. Prepared FX tabs were untouched.

Evidence root: `E:/BACKUP-TRADINGWORKSPACE/analytics-calendar-metrics-20261027/`

- `public-source.json`, `calendar-source-excerpt.txt`: primary-source evidence.
- `tests.txt`: 44/44 focused tests, including 8 new financial/time/missing cases.
- Independent source review by `frequency_review`: initial DemoPreview scope
  blocker fixed and verified; no remaining source blocker.
- `preview-final/report.json`, `deployed-qa/report.json`: 7/7 cases each.
  Desktop/mobile, VI/EN, dark/light, synthetic arithmetic oracle, partial data,
  demo and recorded real-session response. Metric/basis changes, zero/N/A,
  year/month navigation, no document horizontal overflow and one vertical scroll
  owner verified. Desktop/mobile screenshots visually reviewed.
- `preview-attempt1/`: failed original current-API journey, preserved as failure.
- `promotion.json`: scoped HEAD build plus nine intentional source overlays,
  atomic local UI promotion, old assets/private brand retained; no API restart.

Served index SHA256:
`1679e44ccb3f038d1e1e15cd2c2bae1f284cc283d4a904f4ed32fffe503c4458`.

## Limit

Before UI promotion, API8010 closed HTTP connections without a response; replay
session GETs through both active5180 and preview5197 returned HTTP500. The manifest
supervisor PID6348 was absent; API PID5156 still listened. See `runtime-health.json`.
No API/terminal restart, broker action or runtime configuration change was made.
Browser PASS uses labeled fixtures and a previously captured real-session response;
it does not establish current-data integration or recovery of that service.

Rollback: atomically restore `ui-before-release/index.html` to the active UI dist
index. Existing hashed assets were retained for open pages. Only the owned preview
process was stopped after verification.
