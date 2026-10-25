# Compact sort headers — 25 October 2026

## Behavior and layout

- Shared sortable headers use the existing neutral gray hover token for the active background. Trades priorities use the project's orange highlight token and a 9px superscript beside a rounded-stroke SVG arrow.
- Per-column clear buttons occupy a 24px target within header edge padding; no independent flex spacer remains. A stable 26px indicator slot fits two-digit priorities. Left and numeric headers keep their cell text edge; centered headers balance the indicator space.
- The row-number header shows `#` with no sort, or an orange clear-all `×` when any criterion is active. It never shows both. Number-column width reduces from66px to52px; body row numbers stay unchanged.
- Existing ordered sort callbacks, API query, priorities, disabled state, keyboard activation and primary-only aria-sort remain unchanged. Clear removes its criterion and subsequent priorities close the gap; clear-all restores source order.
- Trade-off: a small fixed indicator/edge allowance remains so toggling sort never shifts column widths. The clear target stays24px wide; no per-column extra box is added.

## Evidence

Artifacts/scripts: `E:/BACKUP-TRADINGWORKSPACE/grid-sort-compact-20261025/`.

- Scoped build PASS (HEAD plus DataTable.jsx, data-table.css, FxTradeLedger.jsx); accepted private CSS baseline retained, unrelated work excluded.
- Node table/model semantics tests **9/9 PASS**, `table-tests.log`.
- Candidate **7/7 PASS**, `candidate/report.json`: real-API baseline/candidate comparison; Trades1920dark/1440light/390dark/light; single-sort Library; labeled demo with10criteria. Existing total table width3732.67px →3166.67px on the same real rows, a566px reduction. Every column width stays equal before/after sort and clear.
- Browser asserts left/center/numeric alignment within1px, no overlap between label/indicator/clear target, superscript position and size, priority10 fits its slot, full-query ordered sorting/toggle/remove/renumber/clear, clear-all keyboard activation, `#` restoration, sticky headers and no document overflow. No page errors or writes.
- Independent reviewer ACCEPT after inspecting desktop/mobile dark/light, priority10 and Library screenshots; no actionable blocker.
- Browser uses isolated contexts, GET/HEAD only; external/live/MT5/events/WebSockets blocked. No API/terminal restart, data mutation or broker action. This is table UI acceptance, not broker or whole-product acceptance.

## Local rollout

- Atomic UI5180 promotion preserves old assets/index and private branding. `ui-before-release/` and `ui-promotion-release.json` retain rollback evidence.
- Current index SHA256: `55da580719dbc6f3b61c1674adf99935c9a3270487a10e8fc7be31fb2ea9ae83`.
- Previous index SHA256: `bc6b3192881f2bff5c58b6dfa0e412715477d4d48011758db2049c8200fc5d90`.
- Deployed browser **6/6 PASS**, `deployed/report.json` (same interaction/alignment checks; baseline comparison is candidate-only). No page errors or writes; served index hash matches the candidate.
