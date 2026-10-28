# Live Analytics filters and account details — 2026-10-29

## Changes

- Reuse the shared Analytics filter bar with the Live subset: assets, side,
  outcome, tags, accounts, weekday, timezone, date range and Apply.
- Draft account selection survives polling. Apply reuses the existing Live
  account aggregation adapter; missing data and mixed currencies stay unavailable.
- Remove the legacy Live toolbar from Analytics. Give the page one gutter owner
  and let the three report tabs reach the pane edges.
- Account transaction details keep picker gutters and joined summary rows, with
  each value column drawing the complete vertical seam.

## Verification

- Scoped production build from tracked HEAD plus the four intentional source
  overlays. Unrelated dirty source and evidence excluded.
- `node --test tests/liveCalendarAccounts.test.mjs tests/analyticsViewModel.test.mjs`:
  12 passed.
- `node tests/liveAnalyticsLayout.browser.mjs <origin> <evidence>`: 10 cases passed
  on both candidate `http://127.0.0.1:5192` and deployed `http://127.0.0.1:5180`.
- Browser checks use labeled synthetic GET fixtures: 1920 dark, 1440 light,
  390 dark; asset draft/Apply/chip removal, account aggregation, empty/recovery,
  mixed-currency unavailable state, tab alignment and full-height summary seams.
- Reviewed representative desktop/mobile screenshots. No browser errors or API
  mutations. This does not certify real broker data or financial parity.

Artifacts and rollback are under
`E:/BACKUP-TRADINGWORKSPACE/live-analytics-layout-20261029/`:
`scoped-build.json`, `review.md`, `qa-final/`, `deployed/`, `promotion.json`,
`verified-ui-before/index.html`.

Promoted index SHA-256:
`919da805fc5faf663e55b0ae7b2729a754b46867908f53a1968ee9df028f118e`.
Entry index replaced atomically; existing assets and private branding preserved.
API, UI and MT5 processes were not restarted.
