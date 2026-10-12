# Testing pages and shell audit — 12 October 2026

Scope: Overview, Sessions, Trades, Analytics, Market Data and their shared shell.
Continue the current WMREPLAY direction as a template for other areas. This is a
scoped UI acceptance receipt, not full-product, broker or production acceptance.

## Changes and decisions

- Initial Market Data reads now show one viewport skeleton, rather than a real
  toolbar followed by a duplicate skeleton toolbar. Lazy route loading uses the
  same page-shaped skeleton; chunk failure leaves navigation usable.
- Workspace denial clears protected Market Data and removes import/table actions.
  The Sessions catalog is fenced by workspace. Report selection follows URL
  navigation and browser Back/Forward instead of keeping the preceding session.
- Session selector and summary balance use the same metadata facts. Proven account
  currency survives a report error; unknown currency is explained without an
  invented display unit. Demo dataset categories use the real `asset_class` field.
- Dashboard partial/profit/currency warnings and download progress read errors use
  a reserved status slot rather than inserting background text rows. Invalid
  summaries show a local shared error; misleading manual read retry buttons were
  removed. Mutation errors remain action errors; no automatic mutation replay.
- Static header/aside/navigation remain mounted. Connection state occupies a fixed
  24px subheader slot and uses the shared popup. No shell skeleton is needed.
- Fixed mobile Analytics nested-nav/preview overflow caused by competing `:has`
  selectors. Mobile read errors and countdowns stack at the same gutter. Testing
  report pages have a main landmark without nesting another main in order/chart
  workspaces.

The durable template is in `ui/testing-standard.md`; preview and real readers use
the same product components. Live/Strategy content has not been migrated by this
task. No framework, API contract, schema or backend behavior was changed.

## Verification

Run from `foundation_v2/web`; receipts below are relative to this directory.

| Check | Result | Receipt |
| --- | --- | --- |
| `viewStatePreview.browser.mjs` | 264 PASS; 1710/390, dark/light, all supported Testing preview states; no API calls or writes from previews | `matrix/browser.json` |
| `testingShellAudit.browser.mjs` | 64 PASS; 1440/768/360 dark/light; viewport controls, connection geometry, denial, initial reads, progress error, delayed/failed lazy chunks, order landmark | `shell-market/browser.json` |
| `testingReportsAudit.browser.mjs` | 52 PASS; preview states, URL/Back fixture and three actual service GET smoke checks | `reports/browser.json` |
| `readStatusLayout.browser.mjs` | 38 PASS; no background geometry changes, popup dismissal, filter/error order, full-width grid/dividers | `layout-r2/browser.json` |
| `clientNavigation.browser.mjs` | 6 journeys PASS; mounted shell, history, workspace changes, chart return and reload | `navigation-r2/receipt.json` |
| `reportReadRecovery.browser.mjs` | 9 PASS; transient retry/recovery, stale data and permanent error behavior | `recovery/browser.json` |
| Independent source/visual/interaction review | 16 PASS; 1537/390 dark/light, no new blocking findings | `independent/receipt.json` |
| Focused model/recovery/demo and bilingual copy Node tests | 37 PASS | Command output recorded during task |
| Vite production build and `git diff --check` | PASS | Build output recorded during task |

All fixture requests are labeled and GET-only. Actual smoke reads did not alter
owner sessions. Actual Analytics reports that its required source is blocked;
this check proves honest state rendering, not numerical results or chart/data
availability. Known/zero/unknown financial semantics retain their existing tests.

Earlier runs are not silently treated as success: the initial layout run timed
out while source/HMR and parallel checks were active; an isolated stable rerun
passed without changing that oracle. Navigation's prior empty catalog fixture
could no longer reach the aggregate ledger after the first-session empty flow was
introduced. Its fixture now supplies labeled demo session metadata while retaining
the empty ledger and all navigation assertions. The failed receipt is retained at
`navigation/receipt.json`. An independent timer-only sweep was excluded from
acceptance; final checks wait for the relevant resolved content.

## Limits

No full accessibility certification, heavy-load benchmark, source/provider
integration, user-data mutation, broker execution or production deployment was
attempted. The existing main bundle is about 533.5 kB minified and still triggers
Vite's 500 kB warning; this audit does not claim a bundle/performance improvement.
Download progress retains its existing SSE plus exponentially delayed polling;
the general report GET recovery's five-attempt policy is not a new guarantee for
that separate progress poller. Four unrelated CSS modifications remain outside
this checkpoint.
