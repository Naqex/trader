# Testing disclosure and closed-trade empty states

2026-10-12. Scoped owner feedback on Overview, Sessions, Trades, Analytics and
Market Data pagination. Shared product components serve real data and preview.

## Behavior

- Overview headers toggle repeatedly without mouse exit or text selection.
  Hover stays on the header; revealed report text remains selectable. Keyboard
  activation and separate action buttons retain their existing roles.
- Page-size label/chevron are centered as a group; measured inner padding was
  15.98px left / 16px right at desktop width.
- Sessions recent-trade table labels the first column Session, without a slash.
- Closed trades are completed positions, not all order/execution activity.
  Zero is scoped to selected sessions/cutoff and never implies no open positions.
- `no-trades` preview has three sessions and no closed trades. `new-session`
  makes only London empty; the two existing sessions retain 20 trades each.
  All Trades retains 40 and an old Analytics session restores its charts.
- Shared icon/title/detail replace empty Trades tables/pagers and Analytics
  charts/tabs while retaining scope/filter controls. Partial zero remains
  uncertain; unknown counts stay unknown. Empty sources do not trigger price-path
  experiments even if the URL carries the simulation tab.

## Validation

| Check | Result |
| --- | --- |
| Preview matrix | PASS 224 cases; five Testing routes, supported states, dark/light, 1710px/390px; no page errors, real API requests or writes |
| Existing actual-component browser suite | PASS 14 cases; local GET smoke and explicitly intercepted failure/empty reads; no writes |
| Focused interaction/scope browser suite | PASS 12 cases; repeated mouse/keyboard disclosure, pagination geometry, labels, new/old/all scopes and actual partial-zero Analytics/Trades fixtures |
| Focused Node contracts/copy/analytics | PASS 29 tests |
| Production Vite build | PASS |
| Independent review | Accepted; reviewer tested disclosure, optical padding, old/all session recovery, inspected empty-state screenshot, and reviewed partial/unknown guards |

Commands from `foundation_v2/web`:

```powershell
node --test tests/demoMode.test.mjs tests/testingCopy.test.mjs tests/tradingAnalytics.test.mjs tests/tradesPage.test.mjs
$env:TW_UI_EVIDENCE_DIR='../evidence/testing-empty-trades-20261012/matrix'
node tests/viewStatePreview.browser.mjs
$env:TW_UI_EVIDENCE_DIR='../evidence/testing-empty-trades-20261012/actual'
node tests/pageStateReal.browser.mjs
node tests/testingEmptyTrades.browser.mjs
node node_modules/vite/bin/vite.js build --outDir ../.runtime/empty-trades-20261012/dist --logLevel error
```

## Evidence limits

Actual local owner session was read, not mutated. Its execution is not initialized;
the successful empty/partial Analytics cases explicitly replace that read with a
valid initialized empty response. They do not claim the actual session is ready
to trade. Fixture tests preserve the API envelope and label interception.

Initial focused test failures were harness mistakes: missing Analytics Apply,
select-all's checkbox role, and retaining a blocked flag in an empty fixture.
They were corrected and the suite rerun; `failure.png` is not accepted evidence.
This is scoped UI acceptance, not a backend throughput benchmark or whole-product
completion. Unrelated dirty CSS was preserved.
