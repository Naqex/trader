# Analytics card split — 2026-10-27

## Scope and result

Owner-approved layout change, applied to the local UI at port 5180.

- Expectancy and Profit Factor have separate cards stacked beneath their shared
  heading. Their combined height aligns with the winner/loser cards.
- Side count and side win rate have separate cards. Above 1500px, these two and
  the four session radar cards share equal widths, top/bottom edges and 16px gaps.
- At 1201–1500px they form three columns over two rows. Below that, the side and
  radar groups use separate rows; mobile stacks the cards.
- Removed the former enclosing surfaces. Existing analytics data/state, metric
  props, formulas, accessible labels and help text are unchanged.

## Verification

Evidence root: `E:/BACKUP-TRADINGWORKSPACE/analytics-card-split-20261027/`.

- Scoped build: tracked HEAD `03be1540b2e38bcdb9025e820e9ce40346e97b5b`
  plus only `src/FxAnalytics.jsx` and `src/fx-analytics.css` overlays; build passed.
  Other worktree changes were excluded.
- `preview-final/report.json`: PASS 12/12; `deployed-qa/report.json`: PASS 12/12.
  Widths: 1920, 1501, 1500, 1440, 1201, 1200, 768 and 390px; Vietnamese/English,
  dark/light; demo, current real session and explicitly mocked partial PnL.
- Asserted card counts, equal dimensions/alignment, gaps, absence of enclosing
  surfaces, heading/legend containment, focusable labeled help, one vertical
  scroll owner and no document horizontal overflow. Vietnamese metric text
  matches the pre-promotion baseline for demo, real and partial cases.
- Read-only browser contexts blocked non-GET/HEAD requests, external origins,
  MT5/Live/event endpoints and websockets; zero page errors and attempted writes.
- Independent source and visual review by `frequency_review`: no blockers in
  desktop 1920px and 1440px screenshots. Boundary 1201/1500/1501px checks passed;
  the 1501px screenshot was additionally inspected by the primary agent.
- `git diff --check` passed for the task files.

This verifies the assigned layout and unchanged rendered metric text; it is not
a new financial-calculation audit or broker acceptance test. The prepared FX
Replay tab was not refreshed or navigated.

## Local promotion and rollback

UI-only atomic index promotion; API/UI processes retained and old hashed assets
kept for open pages. Existing private branding and chart CSS were preserved.

- Served index SHA256:
  `b4adce95d0111a3abcb600d5cf3f9fa528a16dea997d0f75fe0d22871f3af0fc`
- Promotion record: `promotion.json` under the evidence root.
- Previous index: `ui-before-release/index.html` under the evidence root.
- Previous index SHA256:
  `1679e44ccb3f038d1e1e15cd2c2bae1f284cc283d4a904f4ed32fffe503c4458`

Rollback can atomically restore that saved index; retained old assets support it.
