# Continuous SL/TP surfaces

Owner request: put the entire SL and TP groups on gray backgrounds to reduce
fragmentation. Existing protection sections now own their control background,
16px padding and field radius. Switch rows, estimates and risk fields inside
are transparent; no wrapper/component or state changes were needed. The same
presentation applies when editing protection, while Auto Break-even keeps its
existing standalone disabled row.

Validation:
- Production build passed, with the existing large-chunk advisory.
- Disposable native/compact Partial TP browser regression: 3 journeys passed
  at 1368px dark Vietnamese, 768px light English and 390px dark Vietnamese.
  Existing checks cover inputs/toggles, risk sizing, target execution, persistence,
  accounting and fork. See `partialTakeProfit/browser.json`.
- Visually inspected desktop owner tab, mobile dark and tablet light evidence;
  groups remain legible and fields align within their shared padding.
- Rebuilt/reloaded the port 5180 preview. Restored the owner's visible SL/TP
  enabled draft (1% initial risk, 20pip SL, 40pip TP); no order submitted.
- Scoped diff review and whitespace check passed. No backend changes.

Before/after: `before.png`, `owner-after.png`.
