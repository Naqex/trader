# Independent review: neutral palette and Live calendar

Result: PASS for the scoped candidate UI changes. No blocking finding.

Candidate index SHA256: `86eccb94ad821c5b925a4f17241ed3c6d52d085fea712d0167dd53c3e43f2484`
Base HEAD: `0646860ee4004aa5b613ebffaf13fc139cb4f6fd`

## Verified source binding

All 11 canonical overlays below were independently SHA256-verified. Ten candidate files equal their manifest hashes directly. TradingViewReplayChart.jsx is the documented one-replacement build transform: canonical source hash is717f4d8b7a90b0e049e296d641eeb32bfab21b975907a3db58eed4196b9f8667; transformed candidate hash is53b941df37afd76cfe641c2d7948bf93afb9438dd5ffba369dacb7b3804a9f8a. Exact byte-equivalent text comparison after replacing the single /chart-legacy.css?v=compact-0.3.0 occurrence with /assets/chart-legacy-428bf8fca5f04107.css passed. No other text changed.

| Canonical overlay | SHA256 |
| --- | --- |
| `src/calendar-view.css` | `64f4908fcfacac3e7dae190a859e40c9738a04152c25c09fc67f8e9ec1fb2f50` |
| `src/live-workspace.css` | `263b5a815f9f039b3f39f6ee64419a51c01f318cc11e2f753794524ac6fb1902` |
| `src/compact-system.css` | `7d14e01607cd369f3e847309035efb704d29af0d4076113f0a3ef4a50188d3af` |
| `src/testing-standard.css` | `0978c286a8c670e5f6a3e7f7fb10a830006f55dcd920e9e98353a89b0e3127da` |
| `src/data-library.css` | `f4233f6abcb0bc350f3ab313cf09f6ed40730cd576c45fc6032802af152462e2` |
| `src/fx-analytics.css` | `46d74ad526ddeb70e91ba210402bf44dd4aeb33ffdcf4c3a9f7df2c6c04b2b6e` |
| `src/nativeChartPalette.js` | `f15afa7c4fe62ee67e61ebd1d8cdd6857faff9d11459a2084445c05ae1eb9524` |
| `src/TradingViewReplayChart.jsx` | `717f4d8b7a90b0e049e296d641eeb32bfab21b975907a3db58eed4196b9f8667` |
| `src/testing-copy.json` | `a8356ba4a1a09c86ee5a534cf1f2102129d9b95327df180b40a9ef8065ca0533` |
| `public/project-palette.css` | `a7698775e56d18217b550b9454431e6bc2169acb1ae080b052392438f6aa1b81` |
| `public/chart-legacy.css` | `428bf8fca5f041079b9b2453de208ebd00388aae65add7196174b5c66e6dc76f` |

HTTP GET from5191 independently verified index SHA above, project-palette asseta7698775e56d18217b550b9454431e6bc2169acb1ae080b052392438f6aa1b81, and chart-legacy asset428bf8fca5f041079b9b2453de208ebd00388aae65add7196174b5c66e6dc76f. All HTTP200.

## Independent validation

- Reviewed the scoped source diff: shared palette, disabled states, destructive hover, light badge background, native chart tokens, Journal translation, calendar track sizing and boundary ownership. Candle colors/protection-line tokens and financial calculations are unchanged in this diff.
- Reran tests/liveCalendarLines.browser.mjs on5191: PASS7; 1920dark/light,1240dark,1241dark,768dark,390dark/light. Independent evidence: independent-calendar/browser.json.
- Calendar assertions: same-row cell bottoms, opacity1 outside-month boundaries, full-height day15 hover, visible add affordance, gain/loss hover overlays, orange1px four-sided month border, grid/footer adjacency, keyboard focus and Escape restoration, four/six-week months, no document horizontal overflow.
- Reran tests/paletteMigration.browser.mjs on5191: PASS4; 1920and390, dark/light. Independent evidence: independent-palette/browser.json.
- Palette assertions: theme values, neutral/action hover, stable control geometry, focus, selected row, disabled state, aligned frequency headings, status badge contrast, Add scenario hover and distinct line colors/dashes. Minimum measured text contrast4.621:1; minimum status badge contrast4.646:1.
- Both independent reports have errors=[] and writes=[]. Calendar API responses are labeled fixtures; external and broker paths denied. Palette uses labeled demo/local GET data and runs local scenario UI only.

## Visual inspection

Inspected calendar/grid-1920-dark.png, grid-1920-light.png, hover-1240-dark.png, seams-390-light.png, seams-1241-dark.png, four-weeks.png, six-weeks.png; palette/trade-light.png, controls-dark-1920.png, frequency-light-390.png, scenario-light-0.png. Also inspected fresh independent-calendar/grid-390-dark.png and hover-1241-dark.png, independent-palette/trade-light.png and controls-light-390.png. Grid rows and colored boundaries are joined, day hover reaches the lower edge, month strip has the accent edge, light status labels remain legible.

## Limits

This review accepts only the described source overlays and candidate build on5191. It does not prove every page, backend formula parity with FX Replay, production/deployed state, native widget runtime, broker behavior or prior independent calendar percentage semantics. Source boundary and latest visual fixtures were reviewed; financial/data integrations remain separate gates.

The mobile reference-controls element capture includes sticky-shell occlusion and blank capture space; it is not a golden screenshot. Interaction assertions and actual calendar/trade screenshots were used for the affected states. Inner calendar horizontal scrolling at narrow widths is intentional; document overflow was absent.

No product source, service, original FX Replay tab or broker was modified by this reviewer. Historical palette/failure.png was preserved; latest reruns are separately labeled PASS.
