# MT5 read services — 24 October 2026

Scope: Rust service/admission/evidence, SDK metadata catalog, optional official
Rust MCP client for standard indicators/calendar/event definitions, shared AI
source snapshots and the existing Live symbol picker. No WMREPLAY MCP server,
autonomous tool loop, AI trade permission, tester/file tools or execution rewrite.

## Running result

Owner explicitly authorized API/UI local update and terminal reconnect for …4926.
API8010 runs `E:/BACKUP-TRADINGWORKSPACE/mt5-tools-20261024/rust-target/release`;
UI5180 serves the scoped production build. Native/compact, QDM, existing
database/artifacts, scientific/legacy descriptors and optional workflow interpreter
are retained. No schema migration. Preflight found no active AI/research/API jobs
and no unresolved broker request. Config/ownership and previous UI are backed up
privately on E:; no keys/account backup were added to Git.

Actual account …4926 is connected, requested mode remains `trading`, generation7.
SDK returned355 symbols, all355 with description and broker path. Browser journeys
on the real API at1440/390 verified metadata grouping, description search, and
selecting the MT5 catalog as workflow evidence. No browser API writes, inference,
OrderCheck or OrderSend were used. The authorized connection sync is separate from
these read-only journeys. Cache reads retained capture time/hash/generation.

On two cold reconnect attempts the worker initially returned `mt5_worker_failed`,
then the existing scheduled retry recovered. Three authorized sync attempts moved
generation4→7. Temporary diagnostics recorded no Python exception; the diagnostic
source was restored before the final cold reconnect. Cause remains unconfirmed.
This is not lifecycle/long-duration acceptance. Failed logs are retained on E:.

## Data/state and decisions

UI lazily requests metadata when opening the asset picker; quote streams remain
unchanged. Rust checks saved workspace, account, permission and generation before
and after reads, including60s cache hits. SDK metadata informs display/search,
never order validation. AI gets an explicit sample of up to64 items/24KiB with
total count, truncation, capture time and hash. Internal features use this service
directly rather than communicating with a new project MCP server.

Optional MCP reads additionally verify native login/server/connectivity and the
canonical owned MQL5 folder. Only allowlisted read tools are callable. Calendar
time remains server-local with unknown offset, never guessed UTC/GMT+7. Two cache
misses at once, bounded cache/payload and a12s MCP deadline keep supplementary reads
outside the realtime execution path. See [contract](../../docs/MT5-READ-TOOLS.md).

## Validation boundaries

| Evidence | Result and boundary |
| --- | --- |
| Release binaries | Locked production build passed |
| Rust library | 183 passed,22 ignored; ignored integration gates are separate |
| Disposable PostgreSQL | Scoped account/workspace/generation/cache/revoke/evidence test passed after final guard change; owned disposable cluster only |
| Python | Worker10 and demo-trading25 tests passed; synthetic SDK, no broker effects |
| Node | Metadata/category3 tests passed |
| UI fixture | Production build at390/768/1440; metadata/description search, unknown groups,503 fallback and AI source; zero API writes/broker calls/errors |
| Native MCP | Official rmcp3.7.0 read identity/workspace and38 standard indicators on the real owned terminal before rollout; calendar/event have fixture/schema evidence, no production acceptance |
| Local deployment |355 actual SDK symbols; generation7 cache/provenance and AI catalog source checked; real API browser1440/390 passed and screenshots visually reviewed |
| AI environment | Audit passed,0 errors/warnings; active15,529/65,536 bytes,50,007 bytes reserve; no Codex/global MCP registration |

Native MCP is **not configured on the deployed API after reconnect**. Existing
terminal cold-start cleanup removes settings enabled manually. Indicator evidence
therefore remains hidden until native setup and a correct fresh generation binding
are supplied; the endpoint explicitly returns503 `mt5_mcp_not_configured`.
Automatic native MCP lifecycle/persistence and a project MCP server remain future
work. This receipt does not claim Mentor can currently fetch native indicator
buffers, macro calendar UI, live inference, trading permission or whole-product
acceptance.

## Artifacts and rollback

Builds, logs, browser reports/screenshots, private backup and rollout scripts live
under `E:/BACKUP-TRADINGWORKSPACE/mt5-tools-20261024/`:
`release-final.log`, `rust-final.log`, `postgres-final.log`, `native-smoke.log`,
`browser/report.json`, `runtime.json`, `runtime-browser/report.json`, `rollout.log`,
`runtime-check-final.log` (failed attempt), `runtime-check-post-recovery.log`,
`preflight.json`, `ui-promotion-verified.json`, `private-before/`, `ui-before-verified/`.

UI index SHA256:
`5bcef031f338d71fe46aa47c6bce38c16c2b2266a7cbb184054cc35c144037ea`.
Previous index:
`26a42e72433c2080c4f34da3da5b5a0d444731e4fed8151f5d21d5bb12ad6ff0`.
Old hashed assets were retained for already-open pages.

Rollback uses guarded ownership stop with the **current** manifest and binaries,
then the saved supervisor arguments/binary paths in `private-before/native-owner.json`,
the same native/compact DB/artifact profile and descriptors; restore saved UI index
and mutable CSS atomically. No DB rollback is required for this additive code-only
change. Terminal/native-MCP configuration is private and is not automatically
restored by switching API binaries. Do not stop processes by port/name alone.
