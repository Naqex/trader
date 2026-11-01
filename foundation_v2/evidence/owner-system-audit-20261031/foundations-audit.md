# Foundations audit — 31/10/2026

Baseline: Trader `884d04f2`, clean product worktree at read. Scope: source review of token ownership/imports, compact adapters, states, icons, overlays and UI Reference. No runtime restart, backend write, migration or broker call. Local5180 browser attempt failed with `ERR_CONNECTION_REFUSED`; findings below are source findings, not a passed live visual review.

| ID | Finding and location (web/src unless stated) | Evidence / action |
|---|---|---|
| F01 | Reference displays shared36/32/32 geometry while product adapter uses32/28/24; `TestingComponentReference.jsx:29-42,106-108`, `product-ui-profile.css:3-13` | Deterministic source mismatch. Read effective `--wm-*` dimensions, preserve immutable `--ds-*` pin. |
| F02 | Light checkbox tick has contrast2.89:1; `compact-system.css:34-41`, `public/project-palette.css` | Tick `#121212` on `#9C4400`; dark8.83:1. Add paired local on-check foreground, retain background. |
| F03 | Checkbox/multiselect drawing only matches `.fx-content`; portal spans have no check/mixed glyph; `compact-system.css:27-43`, `fx-select.css:21`, `LegacyModal.jsx:57-66` | Extend same drawing to `.wm-ui-portal`, including disabled and keyboard focus. Check shell and modal with identical states. |
| F04 | Reference version says0.1.1; palette pin is0.3.0 and product density has its own adapter; `TestingComponentReference.jsx:123`, `ui/project-ui.json` | Avoid a second hardcoded version source; identify reference as product interface and immutable pin in docs. |
| F05 | Reference explains row hover vs selection but has no explicit cross-state QA; `component-reference.css:52-57`, `TestingComponentReference.jsx:127` | Retain selected row hue on hover and test nested icon action separately, with no layout shift. |
| F06 | Shared `wm-button.is-icon` geometry only applies under shell; modal reference icon button is a normal text-button shape; `compact-system.css:65-69`, `LegacyModal.css:16` | Extend exact shared icon/label layout to portal wm-button. Avoid generic all-button overrides. |
| F07 | Compact guide still states36px controls,32px icon action,32px gutters,48px rows; `ui/compact-system.md:12-35` | Update effective product profile to32/28/24/44; keep44px coarse-pointer targets and documented chart exceptions. |
| F08 | Lucide already used with semantic AppIcon map and SVG2px strokes; `AppIcon.jsx`, `ChartIcon.jsx`, `TestingIcon.jsx` | Keep existing bundle; custom chart drawing geometry is intentional. New icon package would duplicate an existing standard. |
| F09 | Multiple legacy CSS files retain10/11px text, hardcoded colors and high specificity | Static candidates only: later source rules may override. Require computed-style/route evidence before mass replacements; do not treat search counts as visible defects. |

Bounded implementation F01–F07: TestingComponentReference.jsx, component-reference.css if needed, compact-system.css, ui/compact-system.md, focused reference browser test. Global token snapshots unchanged.

## Candidate source changes

- F01/F04: Reference dimensions resolve effective product tokens, refresh on resize/pointer/theme changes, and identify Trader rather than a stale hardcoded palette version. Shared pin unchanged.
- F02/F03: local `--wm-on-check` pairs the highlight background; same native/visual checkbox drawing in shell and body portals, including mixed/disabled/focus. Unchecked portal background has the same canvas fallback.
- F05/F06: added mixed/locked/multiselect portal examples and selected+hover coverage; portal `.wm-button.is-icon` uses the shared hitbox/SVG geometry.
- F07: main compact table and form/menu guidance match incumbent32/28/24/44 desktop profile; touch remains44px and table48px. Old specific chart/tab exceptions remain separately documented.

Validation so far: JSX parse via installed esbuild PASS; `node --check tests/owner-foundations.browser.mjs` PASS; scoped `git diff --check` PASS. A labeled Chromium CSS fixture loaded current source CSS and confirmed both shell/portal check backgrounds,16px glyph and paired marks in dark/light. This is not an actual-page/whole-product verdict. Candidate browser script awaits isolated preview; screenshots must be reviewed before visual acceptance.

## Status — 01/11/2026 (foundations lane)

| ID | Status | Basis |
|---|---|---|
| F01 | Fixed | Reference reads effective `--wm-*` (`productSizeTokens`), refreshes on resize/pointer/theme; browser 32/28/24 desktop, 44/44/16 at 390, gutter 20px at 768. |
| F02 | Fixed | `--wm-on-check` paired foreground; contrast dark 8.83:1, light 6.48:1 (was 2.89:1). |
| F03 | Fixed | Shell and `.wm-ui-portal` share checked/mixed/disabled/focus drawing; portal checkbox and multiselect mark match shell colour, 16px. |
| F04 | Fixed | Hardcoded `0.1.1` replaced by product label; doc names `annam-compact@0.3.0` pin plus Trader profile. |
| F05 | Fixed | Selected row keeps background on hover, height unchanged; nested icon action has its own hover. |
| F06 | Fixed | Portal `.wm-button.is-icon` uses shared hitbox/SVG geometry; measured 28px desktop, 44px narrow. |
| F07 | Fixed | `ui/compact-system.md` matches 32/28/24/44 desktop profile, 44px touch, 48px touch rows. |
| F08 | No change by decision | Existing Lucide/AppIcon map remains the standard. |
| F09 | Open, deferred | Static candidates only; needs per-route computed-style evidence before any replacement. Not touched. |

Validation: `npx vite build --outDir $env:TEMP\owner-audit-build-fdn --emptyOutDir` PASS (existing >500 kB chunk warnings). Isolated `vite preview` 5221 on that build (stopped after run); `TW_UI_ORIGIN=http://127.0.0.1:5221 node tests/owner-foundations.browser.mjs` PASS 4/4 (dark/light × 1440/390), 0 page errors, 0 blocked writes. API now returns labeled 503 fixtures, events 204. Screenshots in `foundations/` inspected: controls light-1440/dark-390, portal light-1440/dark-390. Scope is the UI Reference fixture, not owner runtime or whole-product acceptance.
