# Chart interaction audit — 15 October 2026

Scope: shared native chart workspace for Backtest and Prop Firm. Baseline was
`2818199`; this receipt covers the subsequent working-tree patch. Existing dirty
artifacts and unrelated product changes were preserved. No ledger acceptance was
changed.

## Reproduced defects and changes

- The previous resize check stopped at 320px. Extending the gesture toward the
  viewport ceiling exposed the remaining defect: after the native chart reached
  its 240px minimum, the in-flow table extended below the viewport. Releasing
  changed it to an overlay and caused a jump. The same overlay now applies during
  the gesture above that boundary. Dragging from maximized initializes the same
  preview bounds. The native iframe remains mounted.
- The replay toolbar could sit beneath the mobile utility rail. Its existing
  clamp now accepts a right inset, shared by pointer, keyboard and observer paths.
  Unchanged coordinates no longer create a new state object/storage write.
- Scalper form had a 24px gap but `display:block`, so the gap had no effect.
  It now uses grid. Its portal modal respects reduced motion; field focus uses
  one border. Closing restores focus to the trigger and clears the background's
  inert state. Modal title IDs use React's per-instance ID.
- Older tests expected a removed mobile utility toggle and retired Rules copy.
  Assertions now follow the current direct rail and trading restriction rows.
  These obsolete assertions were distinct from the reproduced runtime defects.

The prior commit already separated the vertical disclosure icon from maximize
corners and coalesced native/lightweight resize work with animation frames.

## Verification

Runtime: existing localhost Vite dev server on 5180, real local API/datasets,
headless Chromium in isolated browser contexts. API writes blocked for real-data
checks, no playback/trading. Tests never used the owner's browser storage.

- `tests/chartPositionsResize.browser.mjs`: PASS for both real session URLs at
  1710×987/DPR1, 1440×987/DPR1.25 and 390×987/DPR2. Includes continuous movement,
  the minimum-height boundary, pointer at y=0, release into maximized without a
  jump, cancellation, blur, lost capture, viewport changes, keyboard, touch,
  restore/tab retention and canvas backing resolution. Receipts/screenshots:
  `prop-resize-final/` and `backtest-resize-final/`.
- `tests/chartDesignSystem.browser.mjs`: 24 cases PASS across 1710/1440/390px,
  light/dark, intercepted synthetic execution with real chart library. Includes
  order modal geometry, direction/protection update, menus, field states,
  Scalper focus/reduced motion, uncovered replay controls, pagination,
  unknown/empty/stale/denied states and explicit retry after simulated failure.
  Receipt: `design-system-final-r2/browser.json`.
- `tests/chartInteractionAudit.browser.mjs`: PASS on actual Prop and Backtest
  sessions. Dashboard return link; correct backward controls per mode; no default
  Volume study in fresh storage; account popup; Buy/Sell/rail opening the centered
  order modal without widening the dock; five Scalper open/close cycles; mode
  appropriate Go To and news empty state; same native iframe throughout.
  Receipt: `interactions-r4/receipt.json`.
- Native chart pan diagnostic: 90 paced pointer steps per mode. Observed range
  changes, unchanged cutoff and iframe, zero page errors, zero resize events
  during panning. Prop 359 RAF intervals; Backtest 276. Each sample median was
  16.7ms and sample p95 16.8ms, none >50ms. This is a short headless dev-server
  scheduling sample, not paint/GPU FPS, production performance acceptance, a
  before/after speedup, or a memory soak.
- Focused datafeed, cutoff/history, snapshot/save, order model, scalper protection,
  replay intervals and speed accessibility: **39/39 PASS**, `unit-tests.txt`.
- `npm run build`: PASS, `build.txt`. Existing main bundle warning remains
  (~544.6kB minified /158.8kB gzip); no measured loading bottleneck justifies a
  bundling rewrite in this patch. `git diff --check`: PASS.

Root visually reviewed representative dark desktop Scalper, mobile toolbar and
full-height panel screenshots. This is scoped root review and runtime QA, not
independent golden promotion or whole-product acceptance.

## Remaining IAB limitation

Reloading the owner's IAB reproduces native chart timeout. CDP observed initial
iframe navigation to the library-generated `blob:http://127.0.0.1:5180/...`, then
`Network.loadingFailed { type: Document, canceled: true, errorText:
net::ERR_ABORTED }`. The child frame stays at an empty URL with opaque origin.
No chart script console error was recorded. The same page loads in the isolated
Chromium checks above. The exact IAB cancellation policy/cause is not established.

Current official TradingView docs describe `iframe_loading_compatibility_mode`,
but source inspection confirms the installed v23 standalone bundle contains no
such feature, `srcdoc`, or `document.write` loader. No vendor patch, security-policy
change, library download/upgrade or silent engine switch was attempted. Native
IAB acceptance remains open; compatibility needs a supported vendor distribution
or a change in the embedded browser's handling of the iframe navigation.

Primary references consulted:

- https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver
- https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame
- https://www.tradingview.com/charting-library-docs/latest/troubleshooting/
- https://www.tradingview.com/charting-library-docs/latest/customization/Featuresets/

Local evidence from earlier failed attempts remains in this directory. The final
receipts named above supersede only their corresponding focused attempts.
