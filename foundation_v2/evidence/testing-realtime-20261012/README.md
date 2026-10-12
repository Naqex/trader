# Testing realtime, recovery and shared UI acceptance

Implemented on 12 October 2026 in the existing HTTP JSON + shared SSE stack.
No new framework, database migration, broker execution or owner-session mutation.

## Accepted behavior

- Expanded Dashboard session cards share one hover/expanded surface, including charts.
- Market Data remains a Testing subpage with the common gutters. Saved history is
  independent of sessions and download-provider connectivity.
- Empty/filtered Market results use the shared icon/title/detail state; filters stay
  available, while an empty table/header/pager does not render.
- Session and dataset revision signals refresh relevant active readers. Current
  reports follow session changes; pinned historical reports retain their scope.
- Same-scope refresh retains content. Transient GET failures show a countdown and
  retry up to five times per recovery episode. Initial errors remain errors while
  retrying. Permanent errors stop; denial discards protected data.
- Offline/hidden pages pause recovery. Reconnection reconciles reads; unhealthy SSE
  permits bounded fallback. Main reader notices have no manual refresh/retry button.
- Preview and real views share UI components. Preview recovery is an explicitly fixed
  visual sample, without network or timers; it does not simulate actual elapsed time.
- Read retries never replay mutations. The existing configured-empty source catalog
  bootstrap is retained with a one-attempt-per-workspace-mount fence.

## Evidence

| Check | Result | Receipt |
| --- | --- | --- |
| Scheduler, shared transport/query/SSE, VI/EN copy | 32 tests passed | `unit-tests.txt` |
| Production Vite build | Passed | Build run against final source into `.runtime/testing-realtime/dist` |
| Per-page preview states, widths and themes | 264 cases passed | `matrix/browser.json` |
| Actual reader components, local GET plus labeled failure fixtures | 14 cases passed | `actual/real-components.json` |
| Disclosure and scoped empty-trade regression | 12 cases passed | `disclosure/focused-browser.json` |
| Market shared empty/filtered, real component fixtures + preview, desktop/mobile, dark/light | 16 cases passed | `market/market-browser.json` |
| Report read recovery, stale retention, fixed scope, validation/denial | 8 cases passed | `../read-recovery-20261012/report-consumers/browser.json` |
| Updated running API SSE + representative VI/EN browser journeys | 7 cases passed, no writes/page errors | `live/live-smoke.json` |
| Axum SSE and PostgreSQL contracts | Disposable database parity passed | `server-parity.json`, `server-notes.md` |

Representative screenshots were reviewed for full-card hover, desktop/mobile empty,
EN countdown and offline/reconnecting notes. Independent agent review approved the
scope after separately running the 28 core recovery/transport tests and reviewing
Market screenshots. Root added and passed two transport tests and two copy tests.

The managed loopback API was replaced only after ownership/idle/schema preflight;
`/health/ready` reports database and command worker ready. Live SSE through Vite
confirms `workspace-events-v1` with sessions/datasets revision/count fields.
Mutation notifications were tested exclusively against disposable PostgreSQL.

## Limits and reproduction

SSE samples metadata every two seconds: eventual invalidation, not instant tick
delivery or a cross-request transaction. Resource metadata scans remain O(n).
Local synthetic query measurements were 4.85 ms/1k and 53.40 ms/10k sessions,
with roughly 207 bytes of resource metadata and no temporary blocks. These are
query-only fixtures, not production capacity or end-to-end API guarantees.

From `foundation_v2/web`, with UI 5180/API 8010 running:

```powershell
node --test tests/readRecovery.test.mjs tests/scopedRead.test.mjs tests/workspaceQuery.test.mjs tests/workspaceEvents.test.mjs tests/testingCopy.test.mjs
$env:TW_UI_EVIDENCE_DIR = '../evidence/testing-realtime-20261012/actual'
node tests/pageStateReal.browser.mjs
node tests/marketSharedStates.browser.mjs
node tests/reportReadRecovery.browser.mjs
node tests/liveReadRecovery.browser.mjs
```

Backend reproduction is documented in `server-notes.md`. These receipts accept
this change only; they do not declare whole-product, broker or production-load acceptance.
