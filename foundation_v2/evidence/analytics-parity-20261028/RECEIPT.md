# Analytics filters and loading parity — 2026-10-28

## Scope and behavior

- Prop selection now uses the shared Session picker after Tags and before Day. The separate selector/management link is removed. Unbound or missing attempts retain a recovery picker.
- Prop Type and Strategy controls are hidden; their effective filters are neutralized, including stale URL parameters. Other filters retain draft -> Apply, export and URL behavior.
- Attempt identity comes from URL session+attempt, with workspace-fenced report reads. Applying an attempt uses its exact replay binding, cursor and execution event sequence.
- An explicit Session report reads its analytics/journal concurrently with the session catalog. Catalog arrival enriches names/options without repeating analytics. Default selection still waits for the catalog; catalog denial/error still removes the child report.
- No server/schema/financial calculation changes. Full report scope is retained; no current-page-only analytics.

## Measured cause and results

Real GET-only production-build journeys, same replay d848723290084cf98e8d03de6cff4dbf in both source modes, fresh browser contexts, same running native API. Alternating Sessions/Prop within each build; baseline/candidate phases are sequential, not randomized paired benchmarks. Three samples per source/build are diagnostic, not a capacity or tail-latency claim.

Baseline catalog: 271–479ms; analytics started 292–512ms after catalog start. Candidate catalog: 270–282ms; analytics started within 1ms of catalog start. This removes a request waterfall; it does not make catalog SQL faster.

| Build | Source | Median visible Performance (ms) | n |
| --- | --- | ---: | ---: |
| baseline | sessions | 1180 | 3 |
| baseline | prop | 1139 | 3 |
| candidate | sessions | 1049 | 3 |
| candidate | prop | 1037 | 3 |
| deployed | sessions | 1028 | 3 |
| deployed | prop | 1028 | 3 |

Readiness = visible analytics-performance panel; price-path experiments are optional subsequent reads, not included in this readiness definition. Both modes use their own legitimate financial scope (Session latest cursor vs Prop persisted cutoff); raw responses are not asserted identical. Deployed GETs all rendered successfully with no page errors. Existing experiment 422 remains (entry timestamp/candle alignment); this change does not fix simulation data acceptance.

## Verification

- Independent source review by scenario_review: no blocker; reviewed explicit/default scope, workspace fence, draft Apply, hidden filters and fallback picker.
- 36 focused model tests passed (sessionPicker 11 + propAnalyticsModel 8 + tradingAnalytics 17).
- 7 new fixture journeys passed on preview and deployed UI: Prop order/hidden filters, draft Apply/exact scope/Back, unbound/missing/empty, explicit catalog overlap, default waits, denial removes data, 1920 dark/390 light bounded picker/Escape.
- 7 loading regression journeys and 9 Prop objective journeys passed on preview.
- Screenshots inspected at 1920 dark and 390 light. No document overflow; picker remains bounded.
- Initial QA failures were fixture omissions (close_phase_index), localized-copy expectations, and obsolete removed-selector expectations. Corrected the fixture/assertions, reran to PASS; diagnostics remain under E. Initial promotion guard stopped before writes because loading receipt is browser.json rather than report.json; helper corrected. One deployed probe ran before that promotion and failed against old UI; post-promotion rerun passed.

## SQL paging clarification

- API paging describes browser/API response pages; SQL paging describes where backend selection happens. They can coexist.
- Trades: analytics/routes.rs builds the full dashboard/facets, trades.rs filters/sorts and skips/takes rows in memory. Thus server-side API paging exists, SQL paging of trade rows does not exist on this route.
- SQL cursor paging already exists in ai_runs.rs list_workflows/list_conversations/list_runs: workspace+subject scope, ordered timestamp+UUID cursor, LIMIT n+1. Do not claim the whole project lacks SQL paging.
- Pushing trade paging to SQL needs a compatible persisted read model, ordering/indexes and aggregate/facet parity. It is not a switch required for this UI waterfall fix. Large OFFSET can still be costly (PostgreSQL official LIMIT/OFFSET documentation).

## Rollout and reproduction

Scoped build = tracked f968d567 web/ui + the five intentional source overlays recorded in build.json. Unrelated dirty source was excluded. UI promoted via hashed-assets collision checks and atomic index replacement; old assets/private branding retained. No API/terminal restart. See promotion.json for deployed hash and rollback index.

Commands (from foundation_v2/web; set TW_UI_ORIGIN to 5191 preview or 5180 deployed, TW_UI_EVIDENCE_DIR under E):

- node --test tests/sessionPicker.test.mjs tests/propAnalyticsModel.test.mjs tests/tradingAnalytics.test.mjs
- node tests/analyticsParity.browser.mjs
- node tests/analyticsLoading.browser.mjs
- node tests/propAnalytics.browser.mjs
- node E:/BACKUP-TRADINGWORKSPACE/analytics-parity-20261028/probe.mjs

Temporary build/promotion scripts and detailed diagnostics remain in E:/BACKUP-TRADINGWORKSPACE/analytics-parity-20261028. This is scoped analytics UI acceptance, not whole-product/broker acceptance.
