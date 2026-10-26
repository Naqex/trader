# Analytics strip and summary polish

26 October 2026. Direct owner feedback requested full-width report tabs with a
muted project-line baseline plus blue selected indicator; elevated compact 10/8
counts; an edge-to-edge expectancy divider; removal of /trade and the two
average win/loss captions.

## Behavior and ownership

The tab strip bleeds through the current page gutters to the shell content
edges. It retains three equal 44px tabs, selected blue text/surface and a 2px blue
indicator over the 1px muted baseline. It uses the existing gutter and line tokens,
including the light-theme equivalent. No extra page navigation was introduced.

The total-trade value now pairs with a small elevated wins/losses count (10/8).
A 16px mini info control with 12px SVG explains the order and breakeven exclusion
in VI/EN, using the existing tooltip focus/click/Escape behavior. The label's
existing total-count definition remains. The former note row is removed.

Expectancy shows only its money amount; the label and existing help still define
it as average net PnL per closed trade. Average win/loss captions beneath the bar
are removed; amounts, sign, colors and an explicit accessible name remain. The
expectancy/profit-factor divider extends to both inner card edges. The two groups
stay stacked at every width, avoiding a partial divider in a tablet two-column
layout. This trades a little tablet vertical space for consistent grouping.

Data flow is unchanged: filtered advanced analytics supplies total/win/loss
counts, expectancy and average amounts. No formula, source row, API data or saved
selection was changed. Sample data shares these components. Project display
conventions were updated to the owner's current choices.

## Verification

Artifacts/scripts: `E:/BACKUP-TRADINGWORKSPACE/analytics-strip-polish-20261026/`.

- Scoped HEAD fcf8a4c build plus three source overlays, existing dependencies and
  accepted private CSS baseline PASS; unrelated dirty files excluded.
- `strip.mjs`: 1920/1366/1024/390/320 light/dark and VI/EN. Exact tab-to-content
  geometry, equal target width/44px height, muted baseline, elevated 10/8,
  mini tooltip text, removed note/suffix/captions, accessible bar description,
  edge-to-edge divider, keyboard tab transitions and no overflow PASS.
- `outcomes.mjs`: five VI/EN light/dark/DPR cases, percentage oracles, 14 metric
  tooltips, viewport bounds, single scroll owner and scoped desktop axe PASS.
- `actual.mjs`: seven read-only actual-session journeys PASS: real PnL/market
  time, three report tabs, Buy/Sell filters and library regression.
- Independent review 1920VI/390EN/320VI PASS: screenshots, geometry, mini info
  mouse/keyboard/Escape, captions, divider and zoom. No blocker.
- Two initial strip runs had harness failures: one report-load timeout at 12s,
  one tooltip dismissed by layout/scroll settling on 320px. The final script
  uses a 25s bounded load wait and waits for anchor geometry to settle before
  clicking; all five candidate cases passed without product changes for those
  failures. The original partial output was superseded by the final dedicated
  strip-qa report; screenshot evidence remains under qa/qa-small.

## UI-only rollout

Current served index: 640e18cc267e9fb4d070f05844934a3c7dc2f855c72f725fcb2df352dbf592ec.
Previous index: 319f618f3915399b7245a2b48734c8a0e70ae3db05413d74bdee6a8a43096c0d.
Promotion checked collisions/current hash, preserved private branding and old
hashed assets, and atomically replaced the index. Private rollback is in
`ui-before-release/` under the artifact root.

API 8010 remains native/compact PID 12616 with executable SHA256
72e297248e818880b8afebad2f5054e2d9114c8a515c6330a3347086c53cd064;
identity, readiness and current UI hash verified before promotion. No API or
terminal restart, no broker access and no owner-data write.

Deployed strip checks PASS all five cases; actual-session checks PASS all seven
journeys, with no page errors or write requests. Served index and API readiness
were reverified. The owned preview is stopped after identity verification.
