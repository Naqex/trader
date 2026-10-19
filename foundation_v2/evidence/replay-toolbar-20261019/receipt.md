# Replay toolbar viewport drag — 19 October 2026

Replay now opts into viewport coordinates in the existing ChartFloatingToolbar. Its fixed positioning keeps all current inherited theme/design-system rules while escaping chart clipping. Eight-pixel edge bounds apply to mouse, touch and keyboard movement; document/node resize observations and a window resize listener keep the toolbar visible after viewport or control-size changes. Replay uses a new preference key because old positions were relative to the chart. Other shared toolbar consumers retain chart bounds and their existing preference keys. Toolbar stacking stays below dialogs and popovers.

Validation:

- `npm run build` passed; existing bundle-size advisory remains.
- `node tests/replayToolbar.browser.mjs <owner-replay-url> ../evidence/replay-toolbar-20261019` passed at widths 1368, 768 and 360, with the installed native chart and API reads. All API writes were blocked; no trading or playback was performed. Cases cover viewport corners outside former chart bounds, pointer hit testing over application chrome, keyboard step/clamp, reload persistence, shrink to 360x600, interval popover/Escape focus and mobile touch drag. No page errors or horizontal overflow. Screenshot review covered desktop bottom and mobile top; light/dark captures are included.
- The first test assertion incorrectly assumed chart-canvas began below the native header; its actual bounds start at (0,0). Corrected the oracle to viewport top/left eight-pixel bounds and a bottom edge beyond chart-canvas. The failure report was superseded by the complete successful run, not treated as a product defect.
- Scoped diff review confirms no execution or unrelated workspace changes. The owner's existing tab was reloaded only after checking no edit dialog was open; its rendered toolbar has `is-viewport-floating`.

Order-path audit (source inspection, not new execution tests):

- ChartOrderPanel regular new-order Save and both Quick Buy/Sell request paths explicitly send `execution_timing: current_quote`.
- TradeWorkspace's older Trade draft route (`view=trade&intent=order`) still posts market orders without `execution_timing`; Rust replay_service defaults those requests to `next_bar` and replay_core fills them on replay advance. This is a queued market mechanism, not a limit/stop entry price.
- Current web/native source has no Buy/Sell Limit, Buy/Sell Stop or Stop Limit entry routes/types. SL/TP protect existing positions; they are not pending entry orders.
- Kept compatibility behavior unchanged for owner review. Full-product and broker acceptance are outside this UI change.
