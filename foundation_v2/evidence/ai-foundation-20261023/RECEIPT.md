# AI documents, read-only context and workflow UI

Owner scope (23 October 2026): implement the AI foundation, agent documents,
multi-model workflow UI and read-only data connections now. Defer real-provider
load/pool/performance acceptance. Auto routing, broker execution and new transports
are separate work. This receipt records this slice, not whole-product acceptance.

## Behavior and ownership

- Documents: raw UTF-8 TXT/Markdown, up to 10 MiB each, five references per agent;
  100 documents / 200 MiB per workspace and subject. PostgreSQL stores original
  lossless chunks and a simple full-text index; no new vector service/dependency.
- Agent config stores document references. At admission the backend selects bounded
  excerpts (24 KiB total), with hash, chunk and retrieval-mode provenance. A large
  upload does not mean every byte is sent to the model. Existing inline files work.
- Mentor name/description are disabled; its user-instruction field is hidden.
  Project policy remains server-owned. Create is slimmer and absent in chat history.
- Chat and fixed evidence-review workflow accept explicit source references. The
  backend snapshots at most 120 bars through the replay cursor, anchored journal
  entries at/before it, or validated completed research outputs. Research checksum
  and stored job identity are both checked. Unknown/future journal anchors and
  actual-result fields are excluded. No new holdout or broker reads are opened.
- Sources freeze before enqueue; request identity uses references. Idempotent replay
  returns the existing run without rebuilding its snapshot. Continue retains the
  stopped run's agent/documents/data even after an agent edit. Policy is versioned
  separately; queued calls with a stale policy fail before sending.
- Workflows UI exposes the fixed LangGraph facts/gaps → reviewer graph, per-role
  provider/model/effort, read-only source, history, progress and cancellation. Node
  inheritance is exact role → analyst → feature → system → connection fallback.
- Reload reads state, never auto-submits. Ambiguous POST recovery explicitly reuses
  the original key/body; definitive 4xx errors release the pending draft. Background
  calls leave one global/workspace slot for chat; this is not a fair/token scheduler.

## Validation

All generated artifacts, logs, build targets, backups and screenshots live under
`E:/BACKUP-TRADINGWORKSPACE/ai-foundation-20261023`; none are committed here.

- Release Rust AI unit tests: 19 passed, four environment-dependent tests ignored.
  One parallel run hit the existing 100-ms router fixture deadline during release
  compilation (504); the same final binary passed all tests with one test thread.
  Both logs are retained; this is not a latency/load acceptance claim.
- Disposable PostgreSQL/Python lifecycle test: document 10-MiB boundary, retrieval
  after 64 KiB, lossless download, scope, dedup, referenced-delete guard, invalid text;
  causal chart/journal snapshots, tampered/incomplete research rejection, immutable
  replay; branch/join, per-role snapshots, cancellation, idempotency and warm reuse;
  Continue after an agent edit retains its earlier configuration and scope gates.
- Node client/selection/transcript tests: 14 passed.
- Isolated built UI: six VI/EN × 360/768/1440 cases each for foundation, agents,
  selection and continuation. Includes error/empty states, 422 draft recovery,
  ambiguous-response/reload recovery, disabled Mentor identity and no overflow.
- Independent static review completed; four findings fixed (journal field schema,
  workflow 4xx recovery, document busy state on locale changes, policy version).
- Release build and scoped diff check. Isolated UI bundle excludes unrelated dirty
  ReplayWorkspace/learnIntegration/visual-polish changes.

Logs: `rust-final.log`, `postgres-pinned-continue.log`, `release-final.log`,
`node-final.log`, `foundation-ui2.log`, `agents-ui2.log`,
`selection-regression.log`, `continuation-regression.log`.

## Local rollout

Verified PostgreSQL dump and 4,142 artifact files (4,247,522,786 bytes),
plus UI backup, under the external `backup/` directory. Dump SHA256:
`27e553243385d16d4c8893eeb0b1a0af1b4b86030ec27deb5cc88ace55f03cde`.
Idle/ownership preflight passed. The first restart attempt with the new binary
directory was safely rejected by the old runtime ownership check; nothing stopped
or migrated. The supported launcher then stopped the old runtime using its recorded
binary paths, before migration/start with the new paths. See `stop-old.log` and
`rollout-final.log`; no terminal/broker process was restarted.

Migration `0015_ai_documents.sql` applied successfully; native/compact API ready
on loopback8010, UI on5180. Runtime ID `d941126b132c45fb880c4e7ee90c2116`.
API SHA256 `3435e20277db3cc4f735ccc68781197a19e68d215a269736cd1991e662f9a845`.
UI index SHA256 `902daec4c283aefc5dc600c700ff23b7c917456b246dac5455ce2707f3d86a24`.
UI promotion verified the original index hash, retained old hashed assets and the
existing brand asset, then atomically replaced index.html.

Live local smoke (no inference): Documents, Workflows, Models and Mentor settings
opened without JavaScript errors; documents/sources/workflows/catalog/profiles all
returned200. Source catalog contained six choices. A separate temporary document
round-trip through the actual web proxy uploaded exactly10MiB, downloaded identical
SHA256/bytes, then deleted only its own document; the library returned to empty.
Logs/screenshots: `local-browser/report.json`, `local-smoke.log`, `upload-smoke.json`,
`ui-promotion-verified.json`, `runtime-owner-after.json`.

The existing managed gateway was started again after the API-owned shutdown. Its
public catalog is ready with three credential files and three models; no login,
credential change or inference was performed. The restore probe initially checked
legacy connection-selection readiness rather than transport/catalog readiness;
the probe was corrected. Chat continues to use its durable profile/local selection,
not a newly assigned connection default. See `gateway-restored.json`.

## Remaining acceptance and extensions

Real concurrent chat/workflow latency, quota, pool rotation/failover, memory/CPU and
chart/MT5 impact are deferred by the owner. The fixed review graph does not integrate
the entire TradingAgents strategy/debate graph. Quant support here reads completed
validated outputs; it is not arbitrary Quant tools. Official API/local-model adapters,
Auto routing, autonomous tool loops, bot trading and broker execution are not enabled.
