# Grid alignment and dropdown states — 25/10/2026

- Trades time headings use `(Realtime)` / `(Chart)`. Headers and cells share
  alignment: text/time left, numeric right, categorical badges/actions/checks
  centered. Numeric sort icons precede labels; center labels reserve equal icon
  space on both sides. Library body padding no longer inherits asymmetric legacy insets.
- FxSelect, session selectors, portal/order fields and native select keyboard
  states use background/underline instead of bright borders/outlines. Selected
  checks and keyboard navigation remain; native invalid/disabled fields are excluded.
- Data/filter/sort/paging contracts unchanged. Multi-sort remains a proposal;
  current single-key backend paging is preserved.
- Scoped build from HEAD `e07d638` plus nine explicit source overlays; reused
  verified private CSS baseline and excluded unrelated WIP. Build PASS.
- Candidate and deployed UI: 13 checks each, including real Trades/Library at
  1920 dark, 1440 light, 390 dark/light; session/topbar/form/portal/native selects.
  PASS: actual text edges/centers, 44px full-cell headers, middle alignment,
  keyboard sort/focus return, sticky scrolling, no document overflow/page errors/writes.
- Existing synthetic Live regression: 10 account/cashflow/broker/manual/label
  cases passed at 1440 dark and 390 light. No broker requests or mutations.
- Independent source/visual review approved, including final padding/portal/native rules.
- QA initially caught portal focus CSS specificity; fixed and rerun. Earlier
  harness failures came from a tooltip consuming Escape, pending disabled pager,
  in-flight proxy cleanup and an overly exact native-label locator. Final runs passed.
- Evidence/scripts/screenshots: `E:/BACKUP-TRADINGWORKSPACE/grid-alignment-20261025/`.
  UI-only atomic promotion retained old assets/private branding. No API restart.
  Index SHA256: `ee270ab1ff78f3a4d4eee191bfa1752833e9a12d32cd118dff3cd0a9775f85d7`.
  Previous index is retained under `ui-before-release/` for rollback.
