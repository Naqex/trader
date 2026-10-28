# Prop threshold label seam — 2026-10-28

- Replaced all-corner rounded rect with SVG path: 3px top rounding, square bottom corners. Normal label bottom now shares the exact threshold y coordinate (removed previous 1px gap).
- Fill and border use the same opaque green/red. Text is #080808 in both themes; light labels use a 65% report-color / 35% white mix to keep black text readable. Threshold value, line position, underlying financial scope and chart controls are unchanged.
- Collision-displaced labels retain a vertical connector to their actual threshold; coincident limits remain separately readable. Keyboard focus outline/tooltips retained.
- Focused existing browser suite: 8/8 PASS on scoped preview and 8/8 PASS on deployed 5180. Includes 1920 dark, 390 dark, 1440 light, touch/zoom/reset, real Prop GET, trailing/coincident thresholds, stale evaluator suppression, Sessions without reference lines. Label fill=stroke, black text, contrast>=4.5, exact attachment/connector, bounds and non-overlap asserted.
- Visually inspected dark/light/mobile and coincident screenshots. Independent chart_final_review found no source or visual blocker. Reviewer ran 5180 before promotion and saw old markup (getBBox null); that stale-runtime run failed and is not counted as PASS. Post-promotion deployed QA is separate and passed.
- Scoped production build: tracked 66a397e7 + AnalyticsCharts.jsx/fx-analytics.css overlays only. Atomic index promotion preserves old hashed assets and private branding; no API/terminal restart. Hash and rollback path are in promotion.json.

Reproduce from foundation_v2/web (TW_UI_ORIGIN=5191 preview or 5180 deployed, TW_UI_EVIDENCE_DIR under E): node tests/propPnlChart.browser.mjs.

Build/promotion helpers and all screenshots: E:/BACKUP-TRADINGWORKSPACE/prop-label-seam-20261028. This is presentation-only acceptance; no simulation or broker execution was run.
