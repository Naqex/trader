# Shared Testing states and realtime audit — 12/10/2026

Scope: owner-requested empty/denied/filtered presentation, shared by preview and
actual readers. No broker operations, session mutation or data migration.
Realtime and automatic recovery below are proposals, not implemented by this change.

## UI changes

- Overview retains its first-session welcome and two entry actions.
- Sessions, Trades and Analytics use the same centered icon/title/detail when
  the session catalog is successfully read and empty. Explicit missing session
  IDs remain missing-resource states. Market Data is independent of sessions.
- Shared denied state at workspace/page boundary; report-only denial stays local.
  Protected cached results are discarded on 401/403, without a retry action.
- Overview filtered-empty uses the shared pattern inside Recent Sessions.
  Clear filters restores the three displayed matches; Performance stays visible.
  The count denominator is the whole catalog, including when filters match zero.
- Existing closed-trade, filtered-trade and incomplete states reuse the same
  presentation. No second styling system or added refresh button.

## Verified source audit

| Resource | Current mechanism | Limit |
| --- | --- | --- |
| Workspace SSE | `web/src/workspaceEvents.js`: one shared fetch stream per workspace/tab, scope-validated snapshots, heartbeat watchdog, capped exponential reconnect with jitter, pause while hidden; 401/403 terminal | This custom fetch client handles reconnect itself; it is not native EventSource |
| SSE server | `api-rust/src/events.rs`: shared workspace snapshot from persisted job/download/command projections, samples DB every 2s, emits changes, heartbeat every 15s, fresh snapshot on reconnect | Near realtime; not one event per trade/tick; current limits 64 connections total and 8/workspace/process |
| Downloads | `DataDeskWorkspace.jsx`: applies scoped snapshots; fallback polling 2s active / 15s idle; failures back off to 30s | Download cooldown re-enables Resume; it does not automatically resubmit a download |
| Research progress | `ResearchWorkspace.jsx`: revision-triggered read; fallback polling around 1.5s/3s | Large results fetched separately |
| Datasets/providers/assets | `WorkspaceQueryProvider.jsx`, `workspaceQuery.js`, `MarketAssetCatalog.jsx`: bounded shared cache, revision invalidation, visibility reconcile; assets fallback every 15s when needed | Pilot metadata resources only; current event revision is download-derived, not universal invalidation |
| Sessions/Trades/Analytics | `useReadRefresh.js`, `DashboardSessions.jsx`: focus/online reconciliation, filter/scope changes and local action reload | No subscription for replay/session revisions; no universal scheduled error recovery |
| Metadata read retry | `workspaceQuery.js`: at most two retry attempts for transient GET failures (network/408/429/502/503/504), exponential delay | No visible countdown; not every reader shares this policy |
| Provider availability | `DataDeskWorkspace.jsx` configured/error/cooldown fields | Missing installation/config/license differs from temporary network failure; cannot be fixed by reconnecting SSE |

`demoMode.js` “Nguồn tải chưa kết nối” is a preview scenario, not the actual SSE
connection indicator. It must not imply saved sessions/reports are unavailable.

## Proposed recovery contract — not yet implemented

| State | Presentation | Recovery |
| --- | --- | --- |
| Initial pending | Skeleton in the dependent region | Bounded request timeout |
| Transient failure, no previous data | Icon + short error description in that region | Schedule read-only retry; show real countdown |
| Same-scope refresh | Keep current content + quiet updating label | Replace only once a newer read succeeds |
| Same-scope refresh failure | Keep last content + stale label | Scheduled read retry; never invent zero/empty |
| Browser offline | Keep content + offline label | Pause network timers; reconcile on online |
| SSE lost | Keep content + reconnecting label | Reconnect with capped jitter; low-frequency read fallback |
| Provider missing/config/auth/license | Local explanatory state; saved data remains accessible | Configuration/authority change needed; no endless timed retry |
| Workspace denied | Shared lock/title/detail; discard protected data | Authority must change before retry |

Tentative read retry intervals: 2, 5, 10, 30 seconds with jitter, maximum five
automatic attempts per failure episode, honor server Retry-After (including HTTP
date), then quietly wait for online/focus or a new revision. Reconnecting SSE is
a separate connection policy; do not share its retry counter with resource GETs.
Only transient read errors enter retry; malformed payload, 401/403, missing config
and validation failures do not. Abort pending reads/timers when scope changes.
Never resubmit create/delete/order/download mutations automatically.

Retain HTTP JSON + SSE. Extend workspace snapshots with bounded session/replay
revision signals, coalesce bursts, and refresh only affected active reads. Chart
history stays paged/on demand; replay commands stay acknowledged HTTP operations.
WebSocket is reserved for an identified bidirectional live-stream need.
SSE should carry revisions/progress rather than every full dataset/ledger.

Before promotion: test missed updates during reconnect, duplicate and out-of-order
revisions, tenant changes, auth revocation, Retry-After, offline/resume, hidden tabs,
server restart, and event storms. Measure update latency, requests, DB query work,
concurrent streams and memory; the current connection caps need a deliberate
capacity decision before scaling beyond them.

Primary references: [MDN SSE](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events),
[SignalR transport specification](https://github.com/dotnet/aspnetcore/blob/main/src/SignalR/docs/specs/TransportProtocols.md).

## Validation

- `matrix/browser.json`: 224 preview route/state/theme/width cases; no page errors,
  API reads in previews or writes. Widths 1710 and 390, dark/light.
- `actual/real-components.json`: 14 actual reader journeys with clearly labeled
  intercepted failure/empty fixtures; GET-only, owner data untouched.
- `focused-browser.json`: shared denied/filter/empty checks and scoped catalog403
  fixtures; includes live SSE HTTP snapshot smoke (not a live mutation benchmark).
- 14 event-hub/cache Node tests passed; production Vite build passed.
- Independent reviewer approved this scoped UI change; desktop/mobile saved
  screenshots reviewed. Whole product and realtime expansion remain outside acceptance.
