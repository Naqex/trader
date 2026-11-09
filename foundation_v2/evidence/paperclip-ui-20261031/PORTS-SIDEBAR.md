# Dedicated ports and sidebar preference — 31/10/2026

Owner requested service isolation from applications used separately on Windows,
durable port configuration for future work and no automatic Paperclip rail collapse.

## Behavior and ownership

- `foundation_v2/local-services.json` is the shared configuration: preview5218,
  managed CLIProxyAPI17852, Paperclip17860, embedded PostgreSQL17861 and HMR27860.
  Gateway Rust embeds its configured port at compile time; web consumers and the
  root Paperclip launcher use the same JSON. Upstream Paperclip source is clean.
- The existing Windows CLIProxyAPI listener8317 belongs to EasyCLIProxyAPI outside
  the workspace. PID18940, executable and creation identity were unchanged after
  cutover. No config, credentials or lifecycle actions targeted that instance.
  The managed Trader gateway was already separate on17852 and was not started.
- Paperclip launcher checks all three ports and rejects an existing private
  config with different ports. No automatic port increment, unknown-listener
  takeover or external gateway fallback is implemented by the launcher.
- Paperclip follows the saved desktop sidebar preference. Toggling it is shared
  with other pages and persists; mobile retains its responsive navigation drawer.
  Iframe document/search survives route changes.
- Current usage and future service allocation are routed through Trader README,
  `foundation_v2/docs/LOCAL-SERVICES.md` and workspace development/Paperclip docs.

## Runtime cutover

Confirmed zero agents and heartbeat runs before/after cutover. Same organization
and same database/storage/home retained; no engine/provider/broker integration or
Trader API rollout. No schema migration introduced by this port change.

Private rollback files are under workspace
`.runtime/paperclip/instances/trader-ui/backups/port-cutover-20261031/`:
config/owner copies and a stopped-cluster backup of3460files/90,769,968bytes with
SHA256 manifest. No private config or database is committed here.

The embedded package lacked pg_dump/pg_restore, so the initial logical backup
attempt failed. Stopping the exact native server ended its database too, leaving
a stale postmaster marker. The owned cluster was restarted on its old port for
recovery, then stopped successfully with pg_ctl fast/wait; its log confirms
shutdown checkpoint and database shut down. The cold backup was copied after
that clean stop and before changing config ports. A separate restore drill was
not performed. Private config then changed only ports and its metadata timestamp.

Native launcher17464/server26292 now owns17860/HMR27860; PostgreSQL23556 owns17861.
Preview10764 serves5218, manifest in Trader
`foundation_v2/.runtime/paperclip-ui-preview-owner.json`. Paperclip identity is in
workspace `.runtime/paperclip/instances/trader-ui/owner.json`. These are handoff
PIDs; verify current identities before stopping. Old3100/13100/54339 listeners
were absent. Initial preview index is retained privately as
`foundation_v2/.runtime/index-before-ports.html`; old hashed assets were preserved.

## Verification

- Production Vite build PASS, output `.runtime/ai-workspace-preview-ports`;
  existing bundle-size warnings remain. Promoted index `index-Cm1U9Zmn.js` with
  retained older assets to the AI-only preview. No performance benchmark claim.
- `cargo check --offline --lib` PASS. Managed gateway default remains17852;
  no Trader API binary restart or inference test was needed/performed.
- Focused health/navigation tests:6/6PASS. Port shape/uniqueness/HMR relationship
  checked. Launcher rerun reuses the existing instance; preview health returns
  upstream pin42fd568 and version0.3.1 through its fixed GET bridge.
- Native browser QA on5218:8casesPASS at1920/1440/390px, including task dialog
  open/Escape, offline/retry, persistent document/search and desktop sidebar
  expanded/collapsed preference across page transitions. No page errors,
  non-loopback requests, attempted writes or page overflow. Artifacts/report are
  in `ports-sidebar/`. Native theme/language and BODY focus limitation remain as
  documented in the initial receipt; no synchronization/focus-restoration claim.
- Independent scoped review found no blocking source findings. Reviewer did not
  run services or tests. Root reviewed desktop and mobile rendered artifacts.

This is local integration/visual evidence, not complete Trader or autonomous
execution acceptance. Broad audit WIP remains paused and unstaged.
