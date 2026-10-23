# AI model metadata and stopped-answer continuation — 2026-10-23

## Behavior and ownership

Stop preserves the latest received text, including small deltas before the250ms
checkpoint. Cancelled questions and partial answers remain visible after reload.
Continue targets the same conversation's latest stopped run, hides its transport
instruction and joins new output into the same answer. It makes a new provider
request with the existing context; cancelled internal inference cannot be resumed.
A new prompt after Stop is a new turn retaining the stopped question/partial.
History joins continuation IDs across page boundaries and restores the beginning
of a split answer before enabling send. Existing48KiB/63message/64run limits stay.

Rust holds bounded watch progress, PostgreSQL holds durable run/event snapshots,
and SSE carries offsets/deltas. Terminal snapshots preserve final partial text.
Only a thinking phase is public; private reasoning text is neither stored nor
rendered. Continue validates ownership/latest run under existing admission lock;
request identity includes continuation ID. Replayed keys do not resend inference.

CLIProxyAPI live model IDs stay exact. Optional management metadata supplies
friendly names and advertised discrete effort levels for those exact channel/IDs.
Default sends no override; explicit effort becomes Responses reasoning.effort.
Up to8channels,4parallel metadata reads,2s timeout each, existing30s catalog cache;
no added polling/dependency. Metadata failure falls back to IDs/no effort. Keys
remain server-side; no OAuth, routing, retry or HTTP-pool configuration changes.
WebGPT remains its direct adapter; no new multi-provider fanout.

## Verification

- Rust focused AI suite:17passed,4explicit acceptance tests ignored. Disposable
  PostgreSQL lifecycle acceptance run separately:1passed, runner cleanup exit0.
  Covers short partial cancellation, private reasoning exclusion, continuation
  idempotency/stale-target rejection and merged HTTP conversation projection.
- Node transcript/SSE tests:6passed, including multi-page continuation chains.
- Production UI fixtures VI/EN ×360/768/1440:6passed, checking thinking/partial
  stop, reload, same-answer Continue, preserved composer draft, new prompt context,
  continuation across history page boundaries, and lost POST response + failed
  recovery read followed by retry with the same key/one user bubble. No provider
  calls in fixtures. Final installed UI fixture acceptance also passed6/6.
- Existing run regression:6passed; catalog handoff/race regression:4passed.
- Actual installed UI/API read-only regression:6passed,0writes,0page errors.
  An obsolete test assertion expected routing ID as the displayed model label;
  it was updated to assert the catalog's friendly label. Initial report retained.
- Real installed5180→8010→CLIProxyAPI→Gemini3.8Flash, effort low:2synthetic calls
  passed Stop→reload→Continue→reload.375bytes retained at Stop,7591bytes after
  continuation; one user bubble/one joined answer, no reload submissions. Separate
  test conversation retained; existing profiles/account selection unchanged.
- Optimized Rust release and isolated Vite build passed. Existing638KB main-chunk
  warning remains. Unrelated dirty Replay/CSS excluded from the isolated UI build.

## Local rollout and evidence

All task builds/temp/screenshots/backups/reports are outside Git under
`E:/BACKUP-TRADINGWORKSPACE/ai-chat-continuation-20261023/`:
`browser-final-recovery/report.json`, `installed-final/report.json`, `runs-regression/report.json`,
`catalog-regression/report.json`, `installed-readonly/report.json`,
`installed-catalog.json`, `live-chat-report.json`, `live-stopped.png`,
`live-continued.png`, `ui-promotion-verified.json`, `owner-before.json`.

API8010 was replaced through idle/process-identity guards, native/compact, without
migration or database/artifact replacement. An initial stop using the new binary
paths was correctly rejected; guarded stop with the recorded old paths then
succeeded. Preserved scientific/legacy descriptors and workflow Python path.
API SHA256:5852893c300401d193f25d17109931ef6b8b5780b2d4a90a6a9354cfe717b9ab.
Gateway restarted through its existing managed start;3saved accounts/8models.
UI index swaps preserve old hashed assets and the installed brand.

Rollback: guarded-stop using the current manifest/binary paths, then restart the
previous binaries/descriptors recorded in owner-before.json. Restore the original
ui-before/index.html from this task folder; no database restore is needed. One
page reload receives the new UI. Real Gemini acceptance covers one route/effort,
not all model capabilities, three-account failover, WebGPT or load throughput.
