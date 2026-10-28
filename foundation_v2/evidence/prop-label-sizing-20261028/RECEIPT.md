# Square, content-sized threshold labels — 2026-10-28

- User requested four square corners, compact balanced sizing, and persistence in the project design system. Labels now use square SVG rects. Browser SVG text measurement determines width, plus 6px on each side; the previous per-character estimate left excess space for Vietnamese glyphs.
- Measurements are taken in layout effect after DOM rendering, keyed by actual text. Equality-guarded state avoids repeated updates; locale/reference/size transitions remeasure. Color, height, connector, threshold value and interaction remain from the preceding accepted slice.
- ui/compact-system.md owns the threshold-label pattern; ui/display-conventions.md references it. Radius0 is scoped to threshold labels, not a global card/badge migration.
- Independent scenario_review: no blocker in source/hooks/docs. Prior chart reviewer attempt was unavailable due to model capacity; not counted as a review pass.
- Existing focused browser QA extended for square geometry, measured width and equal side padding. Preview9/9 and deployed9/9 PASS, including Vietnamese/English, dark/light, desktop/mobile, touch, exact real Prop evaluator values, coincident/trailing/stale thresholds and no references on Session charts. Screenshot inspected.
- Scoped build = tracked33ebba37 + intentional AnalyticsCharts/fx-analytics source overlays. UI-only atomic index rollout; old assets/private branding retained, no API restart. See build.json/promotion.json for hashes and rollback.
- Reproduce: TW_UI_ORIGIN=5191 preview or5180 deployed, TW_UI_EVIDENCE_DIR under E, node tests/propPnlChart.browser.mjs from foundation_v2/web.
- SQL paging was discussed only; no backend/schema/paging changes made.

Full temporary evidence/build scripts: E:/BACKUP-TRADINGWORKSPACE/prop-label-sizing-20261028.
