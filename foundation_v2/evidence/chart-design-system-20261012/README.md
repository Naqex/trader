# Chart design system alignment — 12 October 2026

Scope: app-owned replay chart controls aligned with Testing. Native TradingView
candles, grid, drawing tools and chart geometry are retained. This receipt is UI
evidence, not financial-engine, broker or whole-product acceptance.

## Result

- Root browser harness: PASS 18 cases across 1440/390px, light/dark, including
  touch controls, modal menu geometry/hover/focus, dropdown Escape hierarchy,
  shared empty/unknown states, keyboard tabs, 27-row pagination and Journal filters.
- Additional responsive run: PASS 17 cases at 768/360px in both themes, saved
  under `responsive/`. The final modal menu radius is additionally asserted as
  12px in the default run; the responsive receipt predates that CSS-only adapter.
- Same-session 503 retains the established native host, bounds and proven cutoff;
  order actions are disabled. A 403 removes protected chart/action content.
- An intercepted synthetic SELL request returns 503 on the first explicit submit;
  the dialog stays open with an action error. A second explicit submit succeeds,
  closes the dialog and locks actions for the queued order. No request reaches
  the backend and no order-fill calculations are verified by this fixture.
- Loading regression: PASS 22 cases, covering route/session/native initialization,
  timeout/failure, historical reopening and the Sessions report skeleton.
- Focused node tests: PASS 36. Vite production build: PASS; existing >500kB chunk
  warning remains. Independent review receipts are under `independent/`.

## Isolation and oracle

`tests/chartDesignSystem.browser.mjs` uses labeled `fixture-chart-ui`, the existing
61-bar chart fixture and 27 synthetic closed fills only to exercise paging. It
loads the real local native chart library. External traffic and all unrecognized
writes are blocked; fixture activity is explicitly aborted and recorded. The two
allowed order requests are fulfilled in-browser only. The owner's session is never
opened or mutated by these tests. Unknown execution is tested separately from an
empty known ledger.

`browser.json`, screenshots and the independent review distinguish final passes
from retained failures. Attempts 1–10 include locator/localization mistakes,
transition sampling, runs overlapping HMR, and genuine portal/mobile popup
defects fixed before final validation. They are not accepted runs.

## Validation commands

From `foundation_v2/web`:

```powershell
node tests/chartDesignSystem.browser.mjs
$env:CHART_DS_WIDTHS='768,360'; $env:CHART_DS_OUTPUT='../evidence/chart-design-system-20261012/responsive'; node tests/chartDesignSystem.browser.mjs
Remove-Item Env:CHART_DS_WIDTHS, Env:CHART_DS_OUTPUT
node tests/chartLoading.browser.mjs
node --test tests/testingCopy.test.mjs tests/scopedRead.test.mjs tests/legacyReplayModel.test.mjs tests/legacy-scalper-preset.test.mjs tests/replayOrderModel.test.mjs tests/advancedChartSave.test.mjs tests/chart-mobile-layout.test.mjs tests/replay-speed-a11y.test.mjs
npm run build -- --outDir ../../.runtime/chart-design-system/dist
```

Independent storage-failure coverage forces only chart layout storage to fail in
an isolated context and tests the status alert, popup containment and dismissal.
No owner browser profile, broker, provider, financial data or backend write is used.

## Existing limitation

The broader palette contrast test fails on `primary on hover` in the light palette
(`contrast-baseline.txt`). This palette file is unchanged by this task; it is a
pinned global snapshot. The old replay-speed source assertion expected a native
select although the current fallback already uses FxSelect; it now checks the
localized fallback selector and native chart slider labels. Full WCAG, native
browser zoom, canonical golden and long-duration product gates remain separate.
