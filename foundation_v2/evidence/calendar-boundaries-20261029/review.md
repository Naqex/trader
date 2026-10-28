# Independent final review — candidate 3

Result: PASS for the scoped calendar boundary, summary presentation and icon alignment changes. No blocking finding remains.

Candidate index SHA256: 66fd81ffba86bc52f179b5b123a52b6a7f048d7e338b4977d02450c1abc739fd
Base HEAD: e7547ed2699c201258849ddf981b561e1aacf00f
Preview: http://127.0.0.1:5192

## What changed and why it is sound

- The Live pseudo border painter was removed. Only the physical top/left edges paint internal seams; the surrounding shell/sidebar and month footer own exterior edges. Tone and hover change those existing borders instead of adding a second stroke.
- Null summary counts and monetary totals display zero. This formatting does not change the source model, day coverage, write eligibility or percent calculations. The candidate now includes LiveSurfaces.jsx, fixing the prior missing overlay.
- Shared icon/button alignment uses inline flex and centered SVG boxes. The side heading/icon center is within one pixel in every calendar layout test.

## Independent evidence

- Pixel/source probe: 3 cases (1920 dark/light; 1241 dark). Single-pixel top/left strokes in the previously failing gain and neutral-hover crops; no adjacent shell/accent pair remains at the first column. See independent-final3/probe.json and pixels.json.
- Added future-month probe where the model summary is null: all weekly and monthly visible counts are 0 trades and monetary values are $0; switching to percent keeps N/A. Passed in all 3 cases. Results are recorded under summaries in independent-final3/probe.json.
- liveCalendarLines.browser.mjs: PASS 7/7 independently on 5192. Evidence independent-lines3/browser.json. Includes row stretching, hover coverage, focus restoration, month boundary, icon center, no document overflow, 4/6-week months and dark/light responsive layouts.
- liveCalendarPartial.browser.mjs: PASS 4/4 independently on 5192. Evidence independent-partial3/report.json. Preserves partial/unknown days, pooled capital percentages, day/week note drawers, empty state, draft-only edits and keyboard focus restoration.
- paletteMigration.browser.mjs: PASS 4/4 independently on 5192. Evidence independent-palette3/browser.json. Theme values, controls, focus/disabled, status badge contrast, headings and scenario line/hover checks remain sound.
- All independent reports: zero page errors and zero mutation attempts. API fixture routes were fulfilled locally; no broker action occurred.
- HTTP GET independently verified the index hash above and both immutable CSS assets below, all status 200.

Visual inspection covered independent-final3 gain-rest / neutral-hover / focus crops, independent-lines3 desktop light and mobile dark grids, independent-partial3 light grid/drawer, and independent-palette3 mobile frequency panels. Prior failed candidate evidence remains preserved in review-first-candidate.md and independent-final/.

## Source binding

All 12 canonical overlay hashes below independently match current source and the manifest. Eleven candidate files match these hashes directly. TradingViewReplayChart.jsx has the documented exact single URL replacement from /chart-legacy.css?v=compact-0.3.0 to /assets/chart-legacy-428bf8fca5f04107.css; transformed candidate hash is 53b941df37afd76cfe641c2d7948bf93afb9438dd5ffba369dacb7b3804a9f8a. Text comparison confirmed no other change.

| Canonical overlay | SHA256 |
| --- | --- |
| src/LiveSurfaces.jsx | d3f606f7d0ee504c159f7e428f8c4dbb78e5ce986e68923f2f4c5e1cbd24b4a0 |
| src/calendar-view.css | 949914c1e9fa9658c3bb489154ca473564e95fae111932389adad7aab410116c |
| src/live-workspace.css | 263b5a815f9f039b3f39f6ee64419a51c01f318cc11e2f753794524ac6fb1902 |
| src/compact-system.css | c25fa53cc13fbf23c065575e3005d4ca76345ee28d63062d25c796b55b7dcaa9 |
| src/testing-standard.css | 0978c286a8c670e5f6a3e7f7fb10a830006f55dcd920e9e98353a89b0e3127da |
| src/data-library.css | f4233f6abcb0bc350f3ab313cf09f6ed40730cd576c45fc6032802af152462e2 |
| src/fx-analytics.css | 46d74ad526ddeb70e91ba210402bf44dd4aeb33ffdcf4c3a9f7df2c6c04b2b6e |
| src/nativeChartPalette.js | f15afa7c4fe62ee67e61ebd1d8cdd6857faff9d11459a2084445c05ae1eb9524 |
| src/TradingViewReplayChart.jsx | 717f4d8b7a90b0e049e296d641eeb32bfab21b975907a3db58eed4196b9f8667 |
| src/testing-copy.json | a8356ba4a1a09c86ee5a534cf1f2102129d9b95327df180b40a9ef8065ca0533 |
| public/project-palette.css | a7698775e56d18217b550b9454431e6bc2169acb1ae080b052392438f6aa1b81 |
| public/chart-legacy.css | 428bf8fca5f041079b9b2453de208ebd00388aae65add7196174b5c66e6dc76f |

HTTP palette asset SHA256: a7698775e56d18217b550b9454431e6bc2169acb1ae080b052392438f6aa1b81
HTTP chart asset SHA256: 428bf8fca5f041079b9b2453de208ebd00388aae65add7196174b5c66e6dc76f

## Limits

Acceptance is for this exact candidate on 5192 and these scoped presentation changes. It does not establish deployed 5180 acceptance, every page or icon, native widget runtime, backend formula parity with FX Replay, broker execution or full-product completion. Inner horizontal calendar scrolling on narrow screens is intentional; document overflow was absent. Existing reference-controls element captures can include sticky-shell occlusion and are not golden screenshots.

This reviewer did not edit product source, deploy, restart services, operate original FX Replay tabs or call broker APIs. Root owns any subsequent promotion and deployed verification.