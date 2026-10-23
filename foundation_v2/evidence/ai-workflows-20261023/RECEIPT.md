# Shared admission + LangGraph pilot

Date: 2026-10-23. Extends the scoped chat/profile foundation (`6581925`). Source
implementation and isolated acceptance only; active API/database/UI not promoted.

## Flow and decisions

HTTP scope/origin validation → immutable input/config/hash → PostgreSQL queued run
→ Rust parent lease → lazy warm LangGraph worker → two parallel analyst calls
(facts/gaps) → join → reviewer call → durable result/events → scoped GET/SSE.

Each model call uses the same Rust admission/transport as chat. A parent holds no
model slot while waiting. The fixed graph is owned by LangGraph; Rust validates
the boundary, quotas, node allowlist and observations. No second OAuth/gateway,
agent engine, arbitrary graph, shell/tool endpoint or broker capability added.
Worker source receives no provider secrets or parent environment. Clean inherited
pipes, owned Windows Job, memory/process limits and bounded protocol frames control
lifecycle/resources; this is not a security sandbox for malicious Python packages.

`ai_run_steps` persists node selection/status/outcome/result/usage separately from
temporary call permits. Config includes role profile/revision and source hash.
Cancellation drops inline child HTTP futures and discards/reaps the incomplete
worker before permits are released. New logical runs may start a replacement;
failed/unknown calls are never retried automatically. No durable graph resume or
LangGraph private checkpoint store is claimed in this pilot.

## Validation

- `postgres.txt`: disposable PostgreSQL with migrations0012/0013, actual HTTP
  handlers, actual owned Python/LangGraph process and synthetic loopback model.
  Chat regression plus role snapshots, parallel branches/join, three distinct
  admitted child calls, idempotent replay, warm process reuse, principal denial,
  chat-history separation, parent without permit, cancellation/unknown, permit
  cleanup, replacement on a new run, quota failure blocking reviewer, and migration
  refusal while AI work remains active. Entire integration passed (6.31s fixture).
  The first attempt failed its stale fixture migration count12 versus actual13;
  correcting the expectation let behavior checks run. No application DB involved.
- `python.txt`: 3 passed using a separate environment installed from the product's
  frozen lock/optional workflow extra. Parallelism enforced by barrier, failed
  branch prevents reviewer, two protocol runs reuse one process without transcript
  leakage. The earlier TradingAgents-env probe also passed; final evidence uses
  the product dependency resolution, not an assumed shared venv.
- `unit.txt`: 12 Rust tests passed, 3 explicitly ignored managed-runtime/PG tests;
  PG acceptance run separately. Includes bounded Responses decoding, split UTF8,
  escaped JSON budget and ignoring reasoning events.
- `process.txt`: 8 Windows ownership tests passed, 1 subprocess fixture ignored;
  includes clean environment, tree reaping on crash/drop/kill and pre-code limits.
- `guards.txt`: 35 launcher/backup tests and19 subtests passed. Source guards now
  include queued/running/cancelling AI runs before backup/restart/migration.
- UI remains covered by the preceding production-build fixture receipt (6 cases,
  VI/EN, three widths, dark/light chat). This slice adds no workflow execution UI.
- `build.txt` / `build.json`: release binaries built in a separate target directory,
  hashes retained for the proposed local cutover. No running binary overwritten.
- `schema-preflight.json`: the release admin performed a read-only check against
  the current local database. Exactly0012/0013 remain pending; checksum validation
  of the preceding ledger passed. No schema or process changed.

No real inference, OAuth/login, account-pool acceptance, chart/MT5 mixed-load test,
real DB migration or active runtime restart. Model quality/effort/tools and whole
platform throughput remain unverified. The 6.31s fixture is test duration, not an
inference performance claim. Conservative caps are described in the architecture
document; they are not measured optimal limits.

## Next boundary

Promote source only through an authorized backup/migration/API/UI cutover. Capture
the active manifest/profile/descriptors first. API8010 currently runs native/compact
from `.runtime/api-builds/ai-managed-20261023/release`; never overwrite these binaries.
Rollback needs the matching pre0012 database backup and old binary/UI, preserving
new AI history separately if any is created after rollout. No automatic down SQL.

Next feature work is a server-built chart/journal context with revision/cutoff and
a typed read-only domain tool, followed by a Quant/TradingAgents workflow on fixed
fixtures and mixed-load evidence. This pilot only reviews caller-supplied text;
future official API/local routes, automation, broker tools and Auto are not enabled.
