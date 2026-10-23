# Persistent AI chat and model profiles — scoped source acceptance

Date: 2026-10-23. This receipt covers the first foundation slices of
`docs/AI-PLATFORM-ARCHITECTURE.md`, not whole-product or real-provider acceptance.

## Behavior and ownership

Chat selection belongs to each conversation. Feature/role profiles are scoped to
workspace/principal and resolved before a run starts; subsequent changes cannot
mutate that run. Rust owns admission and lifecycle; PostgreSQL owns durable input,
config, result and ordered events. Transports retain OAuth/pool ownership. Closing
the panel does not cancel a run. Reload/reconnect reads its existing ID/events.

Admission caps model calls (global4, gateway3, WebGPT1, workspace3) and the pending
queue (global64, workspace16). Leases fence late writers. Unknown sent outcomes
are interrupted, never replayed automatically. Stream progress is bounded and
coalesced, persisted as deltas rather than quadratic copies. History is paged and
explicitly capped; deletion cascades only after active work ends.

## Evidence

- `unit.txt`: 11 focused Rust tests passed; managed-runtime tests excluded, PG
  integration run separately. No inference or login in this suite.
- `postgres.txt`: disposable PostgreSQL migration and real HTTP/lifecycle test
  passed. Synthetic loopback model: parallel different selections, scoped denial,
  idempotency/restart/default changes, streamed deltas, unknown cancellation,
  stale-owner/progress fencing, competing-instance admission, profile revisions,
  history/delete cascade, queue saturation and idempotent queued cancellation.
- `browser.json`: production UI against isolated API fixtures, 6/6 VI/EN ×
  360/768/1440. Model selection, immutable running config, close/reload without
  inference resubmission, cancellation, history, rename/delete, profile loading,
  dark/light chat and reflow. Root inspected representative screenshots.
- Node `tests/aiRunClient.test.mjs`: 2/2 passed (split UTF8/CRLF, terminal stop,
  oversized/gapped stream repair contract).
- Isolated Vite production build passed; existing large main chunk warning remains.
  Preview5187 uses `.runtime/ai-runs-dist`; user preview5180 kept on baseline UI.

## Scope limits and rollout

No real application DB migration, runtime restart, OAuth, paid inference or broker
action. Existing managed gateway read-only status reported one account/eight models;
catalog readiness is not inference, pooling, streaming or effort verification.
No mixed-load/chart/MT5 impact benchmark yet. Cap values are conservative initial
limits, not measured optimal throughput. LangGraph worker and feature integration
remain the next slice; role configuration alone does not execute a graph.

Migration0012 must be applied with the existing explicit migration/startup procedure
and a scoped backup/rollback plan before deploying this source. Build into isolated
outDir first: active preview reads `web/dist` directly. Keep schema migration and
API/UI rollout coherent; do not put new frontend against old RAM-only backend.
