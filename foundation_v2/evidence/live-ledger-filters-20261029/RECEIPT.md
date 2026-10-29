# Live Trades shared filters — 2026-10-29

## Change and ownership

Live Trades now renders Training's `FxAnalyticsFilters` ledger branch, including
`LedgerFilterActions`, `LedgerFilterDrawer`, shared chips and column control.
Account selection replaces session selection. Manual strategy remains external
context; clearing drawer filters retains account/strategy context.

`liveLedgerFilters.js` adapts complete broker lifecycles or manual trades to the
existing analytics filter model, then returns the original rows to the table
and sidebar. Filters run before sorting/paging. Notes, assets, side, outcome,
status, local dates/year/month/hour, tag include/exclude AND–OR share Training's
controls and matching rules. Missing broker notes remain unknown.

Apply commits clock/base/extra state together; Cancel discards draft changes.
Changing account/workspace resets scope; polling retains it. Chart uses close
time for closed trades and entry time for open trades. Realtime uses manual
record creation time or actual broker execution time, never snapshot polling.
The drawer previews clock-specific date facets without changing the applied rows.
Two pane-specific CSS rules provide toolbar inset and a full-width owned seam.

## Verification

- 24 focused domain tests passed: shared filter/chip models, Live adapter and
  broker lifecycle reconstruction.
- Scoped production build: tracked HEAD plus task overlays, excluding unrelated
  dirty source. Build succeeds; existing large-chunk advisory remains.
- Synthetic production-browser journeys PASS at 1920 dark, 1440 light and390 dark:
  draft/cancel/apply, focus return, notes, tags, chips, clock preview, clear/reset,
  account switching, unknown broker notes, panel parity with Training and bounds.
- Recorded broker regression PASS at three widths:14closed trades, actual account,
  original risk/entry metadata, open-position exclusion and missing provenance.
- Independent source/test/screenshot review: no remaining blocker in this slice.
- UI promoted atomically to5180; served index SHA256
  `15f6338db684f64575eb4f49294a2332d6052e8c4c4b45311e9250aa21e900ab`.
- Actual GET-only UI/API check PASS:14trades,8Buy trades after Apply, clear restores14,
  full account login and original R available. No page errors or API writes.

Local evidence/build/rollback:
`E:/BACKUP-TRADINGWORKSPACE/live-ledger-filters-20261029/`.
See `preview-qa/report.json`, `broker-regression/report.json`,
`runtime/ui-runtime.json`, screenshots and `promotion.json`.
Initial browser harness failures were translation capitalization, the Training
demo's absent clock radios and the account picker's native button role; assertions
were corrected and all journeys rerun. No product assertion was bypassed.

## Runtime continuation

The owner explicitly authorized the earlier mapping API update and reconnect of
demo account464104926. That rollout and the cold-history issue discovered during
it are recorded separately in the existing trade-mapping receipt. Fixture PASS
does not establish broker execution or whole-product acceptance. No order sent.
