# Replay chart opening — 12/10/2026

Scope: redesign the chart loading state requested from Dashboard's Continue
session action. This receipt is scoped UI evidence, not full-product acceptance.

## Behavior and implementation

`ChartLoadingState` centers a 26px spinner and localized caption on the existing
chart canvas. The same component covers cold lazy-route loading, the initial
session GET, and native initialization until data/theme readiness. Shell stays
mounted. Sessions picker retains its report skeleton. Native host is inert and
aria-hidden until ready; default spinner motion respects reduced motion.

Initial session reads reuse `scopedRead` with a 15-second deadline, including
body download and scoped cancellation. Native's existing 20-second deadline now
continues beyond onChartReady to data/theme readiness. Errors remove the spinner;
native errors retain the accessible fallback chart link. Established charts stay
mounted during same-session background reads without an extra status row.
No progress percentage, framework, chart engine or replay mutation was added.

## Validation

From `foundation_v2/web`:

```powershell
node tests/chartLoading.browser.mjs
node --test tests/testingCopy.test.mjs tests/scopedRead.test.mjs
npm run build -- --outDir ../../../.runtime/chart-loading/dist
```

Root browser report: `browser.json`, 22 cases PASS, zero page errors or unexpected
requests. Desktop 1440px and mobile 390px, dark/light,
default/reduced motion, three loading stages, real local native ready, session
network failure and deadline, library failure, stalled dataReady deadline,
same-session background read and Sessions picker regression. Root visually
inspected desktop-dark native pending and mobile-light initial pending images.
Copy/scoped-read tests: 9 PASS. Vite build PASS (existing large-chunk warning;
output outside source, under workspace `projects/.runtime/chart-loading/dist`).

Independent source, browser and visual review: `independent/receipt.json`.
Initial read/picker checks: 5 PASS. Native recorded stages: 22 PASS, including
20 actual Tab traversals while native iframe exists but dataReady is pending.
Reviewer inspected both widths/themes and error fallback. No blocking finding
remains in the reviewed loading scope.

Retained root failed attempts: `attempt-1.json` used the untranslated fallback
label; `attempt-2.json` changed cursor to its already-normalized value, so no read
started; `attempt-3.json` awaited a hidden legacy control after the background
read. Corrected oracles use the localized link and actual response/URL completion.
Independent initial failure is also retained in `independent/browser-attempt1.json`.

## Data boundaries

Browser tests use the established labeled `fixture-chart-ui` synthetic 61-bar
prefix in `visual-chart-fixture`, rendered by the real local native library.
They set dataset_sha256 to null for readiness; historical window paging and
financial correctness are outside this receipt. API reads are intercepted.
Known activity telemetry POSTs for exactly this fixture are aborted before
backend dispatch and recorded as blockedSyntheticActivity; all other mutations
or external requests fail the test. No owner session, cursor, orders or broker
data was changed. Native failure recovery may still use the existing fallback
link; this task does not introduce automatic replay mutation retries.
