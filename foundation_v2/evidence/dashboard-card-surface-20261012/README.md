# Dashboard expanded card surface refinement

Owner review found the large control-hover background visually heavy and the three
nested chart borders distracting. The shared Dashboard card now uses record-row
hover across the full card and a quieter expanded resting surface. Chart groups
inside the card retain padding and border geometry, but their borders are transparent.
Standalone report chart surfaces and chart data/rendering are unchanged.

Validation on 12 October 2026:

- `tests/dashboardSurface.browser.mjs`: 4 dark/light desktop/mobile cases passed;
  hover reaches the chart body, panel dimensions remain stable, keyboard collapse
  works, and no browser errors. Measure hover geometry independently of screenshot
  capture, which can temporarily change scrollbar layout for tall mobile cards.
- `tests/testingEmptyTrades.browser.mjs`: 12 disclosure/scoped-empty regression
  cases passed on preview and actual reader components, with GET-only fixtures.
- Production Vite build passed into `.runtime/dashboard-card-surface/dist`.
- Root reviewed desktop/mobile screenshots; independent review captured dark/light
  chart-body hover and approved legibility, grouping and Dashboard-only scope.

Receipts: `browser.json`, `regression/focused-browser.json`, selected hover images.
These checks concern visual/interaction behavior and do not change realtime or data contracts.
