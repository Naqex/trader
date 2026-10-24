# Report charts fit their cards — 2026-10-24

Owner report: inner scrollbars appeared throughout report charts after the shared
chart migration. Scope is the shared ReportLineChart/ReportBars used by Dashboard,
Sessions and Live reports; native trading-chart panning and table scrolling are
separate interactions.

## Reproduction and correction

The served build forced SVG width >=500px inside `overflow:auto` wrappers capped
at 320px high. Read-only measurements reproduced horizontal overflow in all
three Session charts at 1920/1440/390px and vertical overflow in all three
Dashboard charts at 1920px (`before.json`).

The shared component now measures card width with ResizeObserver and draws SVGs
in that coordinate space at a stable plot height. Removed the forced minimum
width and height cap. Horizontal charts grow with their rows, using the page's
existing scroll owner. Dense charts retain every bar; only axis/value label
frequency changes with available space. Numeric horizontal ticks adapt as well.
Full values remain in native titles/accessibility labels. Large-number compact
axis labels are used only if they preserve the original distinct tick labels.

## Verification and rollout

- Scoped HEAD + two intentional source overlays production build passed;
  unrelated ReplayWorkspace/CSS WIP excluded. Existing large-chunk warning stays.
- `deployed.json`: real local Dashboard/Session read-only measurements at
  1920, 1440, 768 and 390px; all populated plots fit without nested overflow or
  document horizontal overflow. Useful chart-element screenshots retained on E.
- `dense-fixture.json`: synthetic 24-month and 24-symbol data, light/dark,
  resize 1920→1440→768→390→1920. All 24 bars per chart retained, no nested scroll,
  no horizontal numeric tick overlap, zero page errors/writes.
  Reusable test: `web/tests/reportChartLayout.browser.mjs`.
- Independent reviewer checked responsive lifecycle and screenshots. Their
  horizontal tick-overlap and compact-label precision findings were fixed and
  accepted on final source review.
- Promoted only UI assets to the existing local 5180 runtime. Preserved private
  branding, retained old hashed assets, saved prior index/mutable CSS on E and
  replaced the entry index atomically. API/MT5 were not restarted or reconnected.

Promoted index SHA256:
`c89195d1d80af2c6c0c2858585193de43aa5267dab22bdcecf00f59c6f540814`.
Build, before/after screenshots, measurements and rollback:
`E:/BACKUP-TRADINGWORKSPACE/chart-fit-20261024/`.
This receipt does not claim broker execution or all-product acceptance.
