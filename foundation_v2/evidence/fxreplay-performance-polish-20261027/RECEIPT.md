# Analytics Performance reference corrections — 27/10/2026

Status: **PASS for this owner-assigned slice**, deployed on localhost:5180.
This is not whole-product or broker acceptance.

## Delivered

1. Count donut: teal Buy / blue Sell, legend above, arc percentages, no center count.
2. Per-side win rates: independent concentric tracks with gray remainders.
3. Monthly controls: aggregation left, capital basis right; separated rounded
   header/year/value tiles; one bottom-right Total. Positive values include a sign
   and two decimal places. Missing capital remains unavailable.
4. Monthly title help shortened to the reference meaning.
5. Accumulation help explains the sum of source percentage gains.
6. Overall help explains pooled net PnL divided by the selected source capital.
7. Calendar metric selector moved above navigation and Month/Year controls.
8. Removed Analytics monthly/yearly footer totals.
9. Empty calendar dates contain no result text; known zero and N/A remain distinct.
10. Frequency child titles/help/averages moved inside each bordered card.
11. Frequency plots stretch so calendar and frequency columns finish together on
    desktop. Narrow layouts stack; side rings stack on mobile to keep text legible.

Monthly net values flow from filtered dated trades to source-net buckets, then
`periodReturn` applies the selected valid source capital and aggregation mode.
Changing a radio does not modify stored trades or net PnL. Capital pools remain
independent of client filters. No source of finance is inferred from ring geometry.

Reference and formula limits:
[performance-month-side-calendar.md](../../../ui/references/fxreplay/performance-month-side-calendar.md).
Public FX bundle confirms selection/formatting and sum-of-YTD Total, not backend
creation of the supplied month data. Current Balance uses the project's explicit
report-cutoff snapshot definition, documented in its info control. It is not
claimed to be FX's month-opening or backend formula. Calendar retains its four
local metrics and omits capital radios with no applicable denominator.

## Verification

- Scoped HEAD + task-overlay build, retaining only accepted private branding/CSS
  overlays. Unrelated ReplayWorkspace and active WIP were excluded.
- 105 model tests PASS; two new capital oracles cover unequal source capitals,
  missing/nonpositive capital, initial/current and Accum./Overall combinations.
- Independent reviewer: 24 focused tests PASS, source + visual review PASS.
- Preview and deployed browser suites: PASS 4 viewports (1920 VI dark,
  1440 EN light, 768 EN light, 390 VI dark). All four month radio combinations;
  empty/zero/unknown/partial/undated calendar states; snapshot unavailable;
  one-side rings; Month/Year/day details and built-in demo. No writes/page errors.
- Layout preview and deployed PASS at 1920/1440/390: desktop ring starts aligned,
  calendar/frequency bottoms aligned and only `.fx-content` vertically scrolls.
- Six Sessions/Prop/Live fixture regression cases PASS. Live weekly/account/tag
  semantics retained; mixed/manual values remain 115/25/15 in the labeled fixture.
- Existing actual session GET-only journey PASS; PnL unchanged at -2.28.
- Served index SHA-256:
  `6fe306e4f49146b9a42c808b2a58259b9473751f96cc67217221c5d3a8f7ed95`.

The first added test used exact floating-point equality, then an incorrectly
encoded year filter. Both harness defects were corrected before acceptance.
The initial layout check caught a real 12px vertical overflow caused by a negative
table margin. Removing that vertical margin eliminated the nested scrollbar;
the failed evidence remains in the raw task directory.

## Runtime and preservation

UI-only atomic index promotion; previous hashed assets and private WMReplay brand
retained. UI5180 and API8010 were not restarted. Windows-owned runtime continues
outside Codex; only the task-owned preview5197 was stopped after verification.
Original FX demo tab stayed mounted without refresh/navigation; its dropdown was
closed and its initial selections retained.

Raw scripts, public source text/hash excerpts, all browser reports/screenshots,
independent reviews and rollback index:
`E:/BACKUP-TRADINGWORKSPACE/fxreplay-performance-polish-20261027/`.
`ui-before-release/index.html` is the prior UI rollback entry; old hashed assets
remain available. No broker/execution permissions, terminal state, owner records
or production resources were changed.
