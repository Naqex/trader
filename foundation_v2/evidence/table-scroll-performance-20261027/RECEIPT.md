# Trades scroll and optional long-table windowing — 2026-10-27

## Scope and behavior

- Confirmed live local GET response: server paging, 14 filtered rows, page 1
  returns 10, page count 2. Source: SessionReports -> /api/v2/replay/trades ->
  FxTradeLedger. Full-scope filtering/sorting/counts and financial values unchanged.
- Trades uses optional layout/paint containment on its existing native viewport.
  No wheel interception, synchronized scrollbars, forced GPU layers or new package.
  Native 10/25/50/100-row pages remain nonvirtual; footer remains outside viewport.
- Added opt-in VirtualTableBody for long fixed-height single-line collections,
  with fixed colgroup, actual header/body/clientHeight measurement, passive/rAF
  vertical updates and no horizontal-only rerenders. Stable ID preserves one
  focused row outside the window. Fixed cells/spacers preserve height and ARIA.
- data-table@0.2.0 extends immutable 0.1.0. Implementation stays product-local.
  Runnable sample: `/?workspace=tenant-a&lang=vi&area=testing&ui_reference=1#virtual-table`.
  Reference uses synthetic 10,000 rows; no full real ledger download was added.

## Evidence and limitations

Artifacts/scripts/raw CDP traces/build/rollback/screenshots:
`E:/BACKUP-TRADINGWORKSPACE/table-scroll-performance-20261027/`.

- Initial diagnosis: isolated Chromium did not reproduce the reported in-app
  stutter. Diagnostic baseline frame p95 ~16.8ms, no frames >25ms in the samples.
- Production baseline/candidate A/B: 4 warmed alternating samples per variant,
  identical real 10-row text and input sequence. Median Paint 5.3485 -> 4.963ms,
  Task 124.4265 -> 123.42ms, Script 20.0815 -> 18.7405ms, Layout 2.2835 -> 2.6565ms
  over each entire 90-wheel sequence. Frame p95 ~16.7–16.8ms for both. Small/noisy
  samples; these do not establish a material user-visible latency improvement.
  Diagnostic categories differ from production A/B; do not combine their totals.
- Build isolated from tracked HEAD with only task source overlays, excluding
  unrelated ReplayWorkspace/CSS WIP: PASS.
- Unit tests: virtualTableModel/tableModel/tradeTableSemantics 15/15 PASS.
- Independent source review: no blocking findings; reviewer reran 12 model tests.
- Preview + deployed QA: 6 cases each PASS (1920 dark, 1440 light, 390 touch;
  synthetic virtual sample and real server-paged Trades for each).
- Virtual: normal 360px viewport mounts 12 rows initially, 19 with far focus pin,
  not 10,000. Checked total 600044px height, exact 60px rows, stable column widths,
  actual middle row position, accessible count/index, horizontal no mutations,
  resize, far jump, focus retention/removal, sorting, filter/shrink/empty,
  ID selection persistence, keyboard paging and touch.
- Native: bounded page reads, cross-page selection, page size 100, diagonal
  scroll, sticky header, footer/outer scroll separation, details focus return,
  metric tooltip and label popup portal. No document horizontal overflow.
- Shared UI registry: PASS, three token pins unchanged. Scoped diff checks PASS.
- Earlier browser attempts retained: parent ref was unavailable in child layout
  effect, so setup moved to passive effect; tooltip test needed scrolling to
  settle before focus. Latest full browser runs passed after fixes.

This release does not prove in-app browser GPU/annotation smoothness. Variable
row heights/expanded rows are not supported by the optional virtual variant.
Browser find/print/sequential Tab see mounted rows; retain native paging for full
traversal. No claim of whole-product performance acceptance.

## Local rollout

UI-only atomic promotion; served index SHA256:
`63d2de5cfbdd1086868d7ad6ccdd9dadb36dab5eb06d60241ff914b4c78648a7`.

Rollback index in artifact `ui-before-release/index.html`; old hashed assets and
private branding retained. No API/MT5 restart or broker/write action. User FX and
local tabs were not refreshed or navigated. QA used separate GET-only contexts.

Re-run browser cases from `foundation_v2/web`:
`node tests/tableScroll.browser.mjs http://127.0.0.1:5180 <evidence-directory>`.
Set process-local `TW_UI_QA_CHROMIUM` to the installed Chromium executable when
the default Playwright browser is unavailable. Unit command:
`node --test tests/virtualTableModel.test.mjs tests/tableModel.test.mjs tests/tradeTableSemantics.test.mjs`.

Primary research: [CSS containment](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Containment/Using),
[scroll-linked effects](https://firefox-source-docs.mozilla.org/performance/scroll-linked_effects.html).
Neither source establishes this app's measured bottleneck; local traces above do.
