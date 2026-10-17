# Frontend initial-load split

Scope: Dashboard dependency graph and creation/report loading. No visual redesign,
API contract change, owner data mutation, chart mutation, server restart or broker access.

## Change and result

Dashboard previously imported the complete Analytics renderer just to build its
preview data model. Pure model functions now live in `web/src/analyticsViewModel.js`;
the old named exports remain compatible. Prop reports and the creation dialog load
on demand, inside local Suspense boundaries, so they do not replace the page shell.

Vite production-build static Dashboard JavaScript closure:

| Metric | Baseline | Candidate |
| --- | ---: | ---: |
| Raw JS | 770,108 B | 642,365 B |
| Independent gzip sum | 238,933 B | 194,071 B |

These are payload reductions (16.59% raw; 18.78% gzip), **not end-to-end speedup**.
Initial browser script-body totals match the build graph exactly. Gzip sizes sum
independently compressed chunks and do not assert the deployment serves compression.

## Browser evidence and limits

`frontend_navigation_probe.mjs` builds in memory and serves an ephemeral loopback
site. Cold Chromium contexts use frozen GET payloads captured once from the local
API. A frozen SSE snapshot avoids changing data between candidates. Only GET is
served; no owner writes or external requests are permitted. Each sample loads the
real Dashboard component and opens (without submitting) the creation dialog.

Two alternating seven-sample batches per candidate, 28 journeys total:

| Batch | Baseline ready observation median | Candidate |
| --- | ---: | ---: |
| First | 492.1 ms | 482.5 ms |
| Repeat | 526.1 ms | 545.5 ms |

Latency is **inconclusive** under concurrent machine load. Ready observation includes
Playwright scheduling and is not field INP. Baseline cold samples each had a
63–102 ms long task; candidate had one 50 ms task across 14 samples, otherwise no
tasks above the browser's 50 ms threshold. This is diagnostic, not stable tail or
capacity acceptance. No application/browser errors or writes occurred.

After load/animation settlement, dialog background `rgb(8,8,8)`, white text,
`1px solid rgb(61,68,76)` border and 960x850 geometry match in both builds.
Screenshots inspected locally; no new visual direction is being accepted.

## Verification

- Production in-memory builds pass before and after.
- Focused Node regression: 27/27 pass (`focused-tests.txt`).
- Exact original-function comparison: 27 model cases, 3 read projections, 3 filter
  cases pass, including immutable input, null/unknown and report-kind semantics
  (`model-parity.json`, baseline revision 22c91a0a02777396b3f8ccf96239dba2a4ee270f).
- Broad existing Node suite: 291/294 pass. Unrelated existing failures retained:
  `replay-contrast.test.mjs` primary/hover on white; `retry-boundaries.test.mjs`
  asserts a retired `MAX_GET_RETRIES` constant; `workspaceEvents.test.mjs`
  wall-clock heartbeat assertion. Focused SSE rerun passes 7/7. These files were
  not weakened or changed.
- UI tooling doctor ready; product acceptance is not implied.

Commands (from `foundation_v2/web`):

```powershell
node scripts/frontend_bundle_probe.mjs ../evidence/rust-native-20261017/frontend/bundle-candidate.json
node scripts/frontend_navigation_probe.mjs ../evidence/rust-native-20261017/frontend/navigation-candidate-repeat.json
node scripts/frontend_navigation_probe.mjs ../evidence/rust-native-20261017/frontend/navigation-baseline-repeat.json --baseline-source
node scripts/analytics_model_parity.mjs 22c91a0a02777396b3f8ccf96239dba2a4ee270f ../evidence/rust-native-20261017/frontend/model-parity.json
```

Frozen GET payloads and screenshots stay local rather than entering the commit.
The bundle and navigation JSON files preserve raw diagnostic samples; they do not
replace the canonical product plan/acceptance owner.
