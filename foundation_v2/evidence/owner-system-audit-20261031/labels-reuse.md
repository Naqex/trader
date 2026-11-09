# Live label catalog — shared state owner

31/10/2026 · baseline `884d04f2` · candidate source pending integration

## Finding and change

`LiveSurfaces` already owns the workspace-scoped catalog used to project row
assignments and to accept CAS mutation receipts. `TradeTagOverview`,
`LiveTagAnalytics`, and `SmartPicksPanel` each created another `useTradeLabels`
reader with its own error/recovery and catalog state. The existing `scopedRead`
deduplicates simultaneous GETs, so three hook readers did **not** mean three
initial network requests in the measured fixture.

The reproduced defect was stale sibling state: updating Breakout from green to
orange through the table picker changed the row catalog, while the overview
badge stayed green. Error/retry recovery also performed duplicate reads.

Pass the existing catalog from `LiveSurfaces` to all three children (through
`Summary` for the overview). No new cache, hook, dependency, persistence or
invalidation contract. The existing workspace identity, refresh/accept methods,
assignment revisions, and unknown/error state remain owned by the parent hook.

Owned production files: `LiveSurfaces.jsx`, `LiveTagAnalytics.jsx`,
`SmartPicksPanel.jsx`, `TradeTagOverview.jsx`. All JSX consumers were searched;
the three children are only mounted by `LiveSurfaces`/its Summary.

## Evidence

Reusable test: `web/tests/liveLabelReuse.browser.mjs`.

```powershell
node tests/liveLabelReuse.browser.mjs http://127.0.0.1:5217 ../evidence/owner-system-audit-20261031/labels-baseline baseline
node tests/liveLabelReuse.browser.mjs http://127.0.0.1:5218 ../evidence/owner-system-audit-20261031/labels-candidate candidate
node --test tests/tagAnalysis.test.mjs
```

Production build UI with fully intercepted synthetic catalog/deal responses.
Only the exact label update POST is fulfilled in-memory. All other mutations
and external origins are denied, websocket connections closed. No owner DB,
broker, provider or runtime service changes.

Baseline completed six journeys across 1920px dark VI and 390px light EN:

| Check | Baseline result | Candidate acceptance |
|---|---|---|
| Cold tag-analysis catalog GET | 1 (inflight dedup already works) | 1; no initial-request speedup claim |
| Expand collapsed Smart Picks | 0 extra GET | 0 extra GET, same available labels |
| Update label green→orange | Sibling overview remains green | Sibling overview immediately orange |
| Catalog error + manual retry | 4 GETs total | 2 GETs total; one failed read + one shared retry |

Baseline: no page errors or blocked unexpected writes. Desktop screenshot was
visually inspected. `tagAnalysis.test.mjs`: 4/4 pass; model/financial calculations
unchanged. Focused `git diff --check`: pass.

Candidate browser validation pending root's isolated integrated build on 5218.
Request counts are diagnostic same-fixture operation counts, not live latency or
whole-product performance claims. No active-runtime rollout performed.
