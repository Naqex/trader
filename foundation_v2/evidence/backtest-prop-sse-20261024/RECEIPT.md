# Backtest / Prop shared background updates — 24 October 2026

Scope: extend the existing workspace SSE/read-recovery path to Prop reports and
Research. Session catalogs/report readers already subscribed to session revisions.
No broker/provider calls, orders, permission changes or schema migration were used.

## Behavior and ownership

The API emits workspace-scoped opaque `resources.prop` and `resources.research`
fingerprints alongside existing session/dataset signals. Prop fingerprints cover
both session and attempt revisions. Research covers all workspace jobs rather
than only the recent 20 IDs. Financial snapshots, protocols and Prop phase payloads
are not read into the new fingerprints or sent in these signals.

Flow: committed PostgreSQL metadata -> existing shared server sampler -> shared
browser workspace stream -> changed resource token -> coalesced GET -> current UI.
Unchanged snapshots cause no repeated reads. Reconnect reads current state; it
does not replay commands or promise delivery of every intermediate progress event.

Prop and Research opt into one initial reconciliation, avoiding a stale first GET
winning after the first stream snapshot already observed completion. Automatic
reads wait for pending reads/actions, reject aborted/outdated Research responses,
and pause when hidden/offline. Transient read errors use existing bounded retries;
401/403 clear the affected view. A disconnected visible reader has a 15-second
fallback deadline that is not reset by each reconnect attempt.

Play/Step, rewind, simulated orders, Prop financial calculation and the replay
cursor retain their HTTP command ownership. No ReplayWorkspace/chart source was
changed or bundled from unrelated dirty work. Background updates never invoke a
mutation or deliberately reload/advance an active replay chart.

The server still samples metadata every two seconds and shares one sampler per
connected workspace, not one per UI consumer. This is not PostgreSQL push/NOTIFY.
Fingerprint output is bounded, but query work remains O(workspace metadata rows).
No new framework, dependency, transport or parallel authoritative store was added.

## Validation

- Final focused Node run: 59 passed across readRecovery, workspaceEvents,
  propReplaySync, replayStepView and replayHistoryView.
- Rust events unit tests: 3 passed. The separately ignored database measurement
  was run by the disposable-database runner below.
- `native_background_resource_events`: passed against owned disposable PostgreSQL
  and actual HTTP/SSE sockets. Covered Prop session/attempt revisions, Research
  updates outside recent-job IDs, tenant isolation, reconnect, bounded payloads
  and absence of private Prop snapshot content. Owner database was not modified.
- Metadata scan measurement passed at 1,000 and 10,000 replay metadata rows;
  four resource tokens occupied 405 bytes. This is not a Prop-scale or sustained
  load benchmark, nor a constant-time query claim.
- Browser fixture passed at 1440 and 390 px on isolated production UI: changed
  Prop report, unchanged-snapshot quiet traffic, shared stream, initial read race,
  Research terminal changes despite an empty recent-job list, healthy-stream quiet
  traffic, disconnect/reconnect, bounded fallback and denied-data clearing.
  All non-read API methods were blocked/recorded; no mutations or page errors.
  The same browser fixture passed again on deployed UI5180 at both widths.
- Independent review completed with no remaining blockers. Reviewer also ran
  12/12 readRecovery cases after the initial-race and fallback-starvation fixes.
- Locked release build and isolated production UI build passed. Existing Vite
  large-chunk warning remains. Scoped diff whitespace check passed.

The older full `native_jobs_and_sse_durable_http_contract` fixture is not reported
as passing: its missing-migration error-text assertion is stale; a diagnostic
retry also found its completed-result fixture rejected by the current trusted
result contract (503 rather than 200). Its original assertion was preserved.
The new database test explicitly covers this task and does not replace that full
parity suite. This receipt is scoped acceptance, not whole-product acceptance.

## Local deployment

Guarded idle preflight passed, schema15 was current, and the previous exact-owned
API/research processes were stopped before replacement. MT5 terminal processes
were not restarted. API8010 now runs native/compact from
`E:/BACKUP-TRADINGWORKSPACE/backtest-prop-sse-20261024/release`.
Existing scientific/legacy descriptors and provider configuration were preserved.

Read-only runtime verification confirmed ready state, all four resource keys on
the actual SSE endpoint and the served UI hash. API SHA-256:
`a1e9f0ce281586afff9550e4385ce559ad264a4d7f6471d8fcd79dd6995c778c`.
UI5180 index SHA-256:
`d857835c600ef4277e7c2a878bb6974977480e5748322eebb23d2590c0180010`.
The UI build used HEAD plus the four scoped source overlays; previous hashed
assets and brand SVG were retained for open pages. The test-only preview5188 was
stopped; production5180 remains running.

Large artifacts/builds/logs and the prior UI entrypoint are on E: under
`E:/BACKUP-TRADINGWORKSPACE/backtest-prop-sse-20261024/`:
`background-parity.json`, `node-final.log`, `rust-unit.log`, `release-build.log`,
`ui-build-r3.log`, `ui-r2/report.json`, `ui-deployed/report.json`, screenshots,
`rollout.log`, `runtime-check.json`, `ui-promotion-verified.json`,
`ui-before-verified/index.html` and `api-owner-before.json`.
Earlier failed reports remain alongside the successful reruns.

Reproduce the read-only browser fixture using
`web/tests/backgroundUpdates.browser.mjs` with `TW_BACKGROUND_UI_ORIGIN` and
`TW_BACKGROUND_UI_EVIDENCE`. Run the database fixture through
`api-rust/tests/run_events_parity.py --test-name native_background_resource_events`
with the existing PostgreSQL-bin/output arguments and scratch directory on E:.
