# Testing reader layout and expanded chart dividers

Scope: shared Testing UI in `foundation_v2/web`; source and deterministic previews
use the same status/filter/report components. No backend or owner-data changes.

## Behavior

- Expanded Dashboard charts have a full-card horizontal divider and two full-height
  column dividers. At stacked widths, those column dividers become horizontal.
  Chart groups retain their flat surfaces and whole-card hover.
- Market Data table/header/pager lines span the content viewport; text retains
  page gutters. Recent Trades stays inset within its containing session report.
- Initial reader errors appear below their filters/divider. Unavailable catalogs
  preserve disabled controls rather than claiming there are no sessions.
- Refreshing/stale/partial status uses a reserved title/toolbar slot. Its popup
  contains detail/retry countdown; opening it does not shift report content.
  Escape/outside click closes it, and its position is clamped to the viewport.
- Same-scope journal refresh retains the last successful annotations on transient
  failure; denial discards them. Existing bounded read recovery remains unchanged.

## Validation

Local UI: `http://127.0.0.1:5180`; actual GET smoke: API `http://127.0.0.1:8010`.
No session mutations were performed.

| Check | Result | Receipt |
| --- | --- | --- |
| Layout geometry, dividers, popup dismissal, errors below filters at 1563px/390px | 38 PASS | `browser.json` |
| Shared previews, light/dark, desktop/mobile | 264 PASS | `matrix/browser.json` |
| Real reader components with actual GETs and intercepted failure/empty/refresh fixtures | 14 PASS | `actual/real-components.json` |
| Report consumers: retained stale data, retry recovery, initial catalog error placement | 9 PASS | `report-consumers/browser.json` |
| Vite production build | PASS | built into ignored `.runtime/read-status-layout/dist` |
| Independent source/visual/keyboard review | Approved for this scope | `/root/testing_empty_review` |

Representative screenshots: `expanded-1563.png`, `expanded-390.png`,
`market-data-ready-1563.png`, `trade-error-1563.png`, and responsive error captures.
The preview matrix recorded no API requests or writes. Browser receipts recorded
no page errors. Build retains the existing >500kB chunk warning; this UI change
does not claim a bundle-size or performance improvement.

Acceptance covers these UI behaviors only. Fixture failures are explicit test
responses, not proof of every upstream failure. This receipt does not close
whole-product, production, broker, native-zoom, accessibility or long-duration gates.
