# Chart order line colors — 19 October 2026

Scope: match each dashed Entry/SL/TP line to its on-chart marker border for BUY and SELL. Price-axis label colors and hover selection remain independent.

The native adapter shares one color between its horizontal line and price label. Disable its left extension and set line length to zero, retaining the native axis label. The existing projected marker draws the dashed line from its `--order-border` token, clipped by the chart-pane overlay. Ghost TP/SL handles have no line. Existing price projection, drag preview, revision handling and pointer targets are reused; no execution or data contracts change.

Validation:

- `node --test tests/advancedOrderOverlay.test.mjs`: 6 passed.
- `npm run build`: passed.
- `node tests/orderUi.browser.mjs ../evidence/order-ui-20261019/marker-lines`: 4 passed, no page errors; native chart with synthetic API state and intercepted writes. Covers BUY/SELL, VI/EN, dark/light, widths 390/768/1368, protection changes and axis hover selection. Asserts line/border color equality and native line suppression.
- `node tests/orderUiInstalled.browser.mjs <local-owner-session-url> ../evidence/order-ui-20261019/marker-lines/installed`: passed, no page errors, all owner API writes blocked (3 activity writes). No order or playback operations submitted.
- Reviewed BUY and SELL screenshots after protection movement and installed SELL chart: SL amber, TP teal, entry matches its side-specific border, no duplicate native order line. Native axis boxes retain their existing palette. Reloaded the user's IAB chart to the current build and visually checked it.

This is scoped chart styling acceptance, not backend execution or full-product acceptance. Fixture activity persistence is intentionally blocked and its retry toast is unrelated to the line change.
