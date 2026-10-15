# Advanced Charts IAB compatibility — 15/10/2026

Scope: owner-requested fix for the iframe blob navigation failure recorded in
`../chart-audit-20261015/CHECKPOINT.md`. This closes that local compatibility issue,
not the full product plan or broker gates.

## Change and boundary

The authorized local CL v23.040 loader allocates a blob containing its generated
HTML. IAB previously canceled the iframe document navigation (`ERR_ABORTED`);
the underlying IAB policy is not established. The installed version lacks the
modern `iframe_loading_compatibility_mode` feature.

The application now requests `charting_library.standalone.js?iframe=srcdoc`.
Vite dev/preview applies `advancedChartCompatibility.mjs` only to this request.
The adapter verifies the distribution SHA-256 and embeds the same generated HTML
in `srcdoc`, escaping HTML attribute delimiters. The existing widget options
remain in `data-widget-options`, which v23 already supports as its hash fallback.
Vendor files on disk, datafeed/cutoff logic, and browser security settings are
unchanged. No global browser API patch is shipped.

The adapter is explicitly version-bound. Unknown distributions fail rather than
receiving an unverified rewrite. Another server hosting dist must apply the same
adapter. A future vendor upgrade should replace this adapter with the supported
upstream mode after equivalent tests. README documents the hosting requirement.

Reference: https://www.tradingview.com/charting-library-docs/latest/customization/Featuresets/
Modern upstream offers about:blank/document.write compatibility. This local
srcdoc adapter is a project integration for v23, not an upstream v23 feature.

## Verification

- Owner IAB Prop session: ready, candles visibly rendered, native header portals
  and bottom Prop Firm Rules present. Reload succeeded; Rules opened and closed.
  Screenshot: `iab-prop.png`. No JavaScript errors observed; an existing vendor
  warning about the Volume smoothedMA override remains outside this fix.
- Temporary IAB Backtest tab: ready; native iframe tree includes EUR/USD OHLC,
  replay controls and expected 16-bar prefix. Temporary tab closed afterward.
- `node --test tests/advancedChartCompatibility.test.mjs tests/advancedChart.test.mjs tests/advancedChartSave.test.mjs`: 16/16 PASS. Adapter tests compare
  original generated HTML with decoded srcdoc, verify datafeed/options for vi/en,
  and reject a changed vendor distribution.
- `tests/chartInteractionAudit.browser.mjs` on real local Prop + Backtest sessions:
  PASS (`receipt.json`). Test context throws on HTML blob creation; chart loads
  through srcdoc with seven canvases. Header controls, dialogs, native pan, causal
  cutoff invariance and reload/resume pass. All API writes blocked, no orders or
  playback sent. This isolated Chromium test complements the actual IAB checks.
- Vite preview loader GET/HEAD smoke on temporary port 5199: PASS; server closed.
- `npm run build`: PASS. Existing main bundle size warning remains.

No vendor upgrade, browser policy change, broker action or product-wide
acceptance is implied by this receipt.
