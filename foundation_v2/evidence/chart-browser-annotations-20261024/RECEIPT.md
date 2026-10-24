# Browser annotation compatibility for native chart — 24/10/2026

## Scope and current acceptance

The reported control is the ChatGPT/Codex browser toolbar's **Chú thích**, not a WMREPLAY note/drawing feature. No application annotation button or editor was added.

Implemented and installed a compatibility candidate. Source/fixture checks pass; the user subsequently reported that actual selection **still fails on the installed candidate**. Earlier temporary trials also failed. Do not classify pointer hit-testing or synthetic API checks as actual browser annotation acceptance.

## Change and state flow

The native chart is a same-origin srcdoc iframe. Its mouse events remain inside its document. When the optional official `document.oai.annotation.isActive()` reports active, the shared chart host disables iframe pointer events and exposes a named top-document annotation target. The confirmed `oaiannotationmodechange` event updates this state; no polling, internal app selectors or mode activation requests are used in production.

Exiting returns native pointer handling. Holding Space temporarily enables chart controls; key listeners cover both parent and iframe documents, with keyup always clearing passthrough even after focus enters an input. Cleanup removes listeners and transient host state. Browsers without the API keep normal chart behavior. This supports the shared Live/Replay chart component without remounting its datafeed or changing trading behavior.

Primary contract: https://learn.chatgpt.com/docs/annotations-extensibility (confirmed state, Space behavior, top-document selection markers). The installed API does not expose `registerSurface`; it is not required.

## Evidence

- Isolated production build PASS, archived from HEAD 5faa192 and overlaid with only the three scoped source files. Existing Vite large-chunk advisory remains.
- Live browser fixture suite PASS at 1920 dark, 1440 light, 768 dark and 390 dark: annotation state, hit-test reachability, Space/input release, mode exit plus existing SSE/asset-picker/quote-state checks. No API mutations or page errors.
- Focused native Replay fixture PASS: desktop/mobile toggles, initially active state and reload, absent API, and unmount cleanup. All writes intercepted; no page errors. Fixture SHA is cleared as in the existing visual suite because the supplied rows are synthetic.
- Broader chart design-system suite was attempted and failed at its pre-existing order/scalper save-button color comparison (`rgb(35, 38, 42)` versus `rgb(255, 173, 124)`). That suite is not reported as PASS; unrelated dirty styling was excluded from this build. No assertion was weakened.
- Independent source review found Space release could stick after focus moved into an input. Fixed and covered in browser tests; no remaining blocking scoped review findings.
- Actual installed Live page: confirmed API active=true, host marker `MT5 · EURUSDm`, iframe pointer-events=none, top-document center hit reaches the chart host. This verifies installed integration state only, not the native annotation editor. User subsequently navigated to the overview; no further navigation was forced.

## Delivery and remaining check

Local UI5180 updated atomically; API8010 and terminals unchanged. Old hashed assets retained. Index before: `8fa7613bd4080374827fdd443cb4cbfe2937bc707d1e8e3eccb8fd4a87252388`; after: `c8f8d21252e251969674c75b0511d71f179a514e1217bd2eca6d8cafdf85060f`.

Builds, backups, scripts, screenshots and reports are under `E:/BACKUP-TRADINGWORKSPACE/chart-browser-annotations-20261024/`. Temporary page diagnostic code was removed by the deliberate reload after installation. The user-owned tab remains open.

Remaining: confirm selecting/dragging an actual chart region opens the ChatGPT/Codex annotation editor on this installed candidate, then exit and confirm native chart interaction. If selection still fails with confirmed parent hit testing, investigate the browser picker boundary; do not add a parallel WMREPLAY annotation feature or claim a broker issue.

Reproduce fixtures from `foundation_v2/web`: `TW_TEST_BROWSER_ANNOTATIONS=1` with `TW_LIVE_UI_ORIGIN`/`TW_LIVE_UI_EVIDENCE` then `node run_live_market_acceptance.mjs`; `CHART_DS_ORIGIN`/`CHART_DS_OUTPUT` then `node tests/browserChartAnnotations.browser.mjs`.

## Follow-up research: local Backtest versus Live

The owner clarified that the working comparison is Backtest/Propfirm **inside this project**, not the external FX Replay site. The external site's top-document canvas cannot explain this local difference.

Read-only runtime comparison on installed UI5180 used a stored tenant-a Replay session and the existing Live route, with all API writes blocked. Both report Advanced Charts, one same-origin srcdoc chart iframe at 1920 x 889, seven canvases inside the iframe, zero top-document canvases, and matching host/nearest-ancestor pointer, transform and stacking styles. Both source paths use TradingViewReplayChart. Three stored Replay records specify chart_engine=legacy (the application maps this to Advanced Charts). No page errors or attempted API writes occurred. Top document has no CSP header or CSP meta. Full comparison and screenshots: E:/BACKUP-TRADINGWORKSPACE/chart-browser-annotations-20261024/research/.

Installed Windows package metadata: OpenAI.Codex 26.1016.8622.0. This is not a claim about update availability or a confirmed regression boundary.

Primary research:

- https://github.com/openai/codex/issues/44627 — open report with same-origin iframe reproductions; mainly macOS. Supports iframe compatibility as a candidate, but cannot by itself explain why local Replay reportedly works while local Live does not.
- https://github.com/openai/codex/issues/49935 — open Windows report that annotations fail while an agent holds browser control. Recovery and underlying cause explicitly remain unverified. Treat as a hypothesis, not a confirmed workaround.
- https://github.com/openai/codex/issues/52941 — Windows CSP overlay failure. Current local top-document policy does not match its restrictive-CSP trigger; do not weaken security policy based on this report.
- https://learn.chatgpt.com/docs/annotations-extensibility — text selection containers do not enable iframe text selection; canvas surface registration is top-document only. This does not establish that every ordinary iframe area annotation must fail.

Next useful isolation is the same installed build and same browser tab, agent not controlling the browser, switching between local Replay and Live and targeting chart versus surrounding chrome. If only Live fails under that matched comparison, collect browser overlay errors at that transition before further application changes. No additional application patch, browser update or security-policy change was made during research.
