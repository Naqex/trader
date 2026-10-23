# Managed local AI gateway — 23/10/2026

Scoped implementation/verification receipt, not whole-product or provider acceptance.

## Behavior and ownership

AI và Bot → Kết nối can start the pinned local CLIProxyAPI, open Google OAuth
from an explicit user click, cancel sign-in, add an account, and stop/start the
owned gateway. Existing assistant routes, policy, chat lifecycle and design-system
controls are reused. No new dependencies, Windows service or global configuration.

The API owns the gateway/CLI process trees through `owned_process`. It generates a
private fixed loopback config, checks the pinned binary hash, and refuses an
occupied port. It never adopts or stops an externally started gateway. Tokens stay
in the existing private gateway auth directory; browser responses contain only
account counts and a strictly validated Google authorization URL. Cancel/stop
preserve saved credentials. Opening the page never starts OAuth or inference.

Only an active login polls (1.5 seconds); transport failure pauses polling. The CLI
has a five-minute timeout independent of the browser. Idle navigation has no timer.
This adds setup controls; it does not add tool execution or broker authority.

## Verification

- `cargo test --lib ai_ -- --include-ignored --nocapture`: **15 passed**. Includes
  actual product HTTP handlers and the pinned empty gateway: guarded/idempotent
  start, unauthorized requests rejected, management unavailable, crash detection,
  restart/stop cleanup, same-origin/workspace checks, sanitized errors and shared
  assistant regressions. No DB, broker, Google login or inference.
- The HTTP acceptance fixture originally failed with504 because its default
  request budget was10ms. It now explicitly uses the production default30s for
  process startup; the production timeout was not changed.
- `node run_ai_gateway_setup_acceptance.mjs`: passed at1440px vi/dark and360px
  en/light. Explicit-click login, popup/no-opener, blocked-popup fallback, cancel,
  network-error pause/retry, synthetic catalog/model, stop/start/reload, no idle
  polling, inference, overflow or page errors. See `ui/report.json`.
- `node run_ai_provider_acceptance.mjs`: four desktop/mobile, vi/en, dark/light
  scenarios passed. See `provider-regression/report.json`.
- `node run_ai_workspace_acceptance.mjs`: desktop/mobile navigation, lazy loading,
  history/reload and shared chat passed. See `workspace-regression/report.json`.
- Desktop and mobile screenshots were visually reviewed. Google-page and catalog
  fixtures are explicitly synthetic; they do not prove actual OAuth/model access.
- Vite production build and final Rust release build passed. Candidate hashes are
  in `candidate.json`; unchanged admin/research binaries accompany the new API.
- Guarded launcher `-CheckOnly -RuntimeProfile native -ReplayStorageProfile compact`
  passed against the prepared candidate: schema current, no pending migrations.
  This check made no schema, process or provider changes.

## Rollout boundary

After explicit owner permission, the prepared candidate was activated with the
existing native/compact profile. The restart helper initially rejected the old
runtime because it compared its executable paths with the new candidate. No
process was stopped by that rejection. The old runtime was then stopped through
the guarded launcher using its exact recorded old binaries (PID/creation/hash
checks retained), and the normal helper started the new candidate. No migrations.

`node run_ai_gateway_managed_local_acceptance.mjs` passed against actual UI5180 →
API8010 → owned pinned gateway: controls exposed, lazy page/no idle polling, empty
gateway start, real UI stop, credentials unchanged, no page errors. The gateway
is left stopped and CLIProxyAPI selected, ready for owner-initiated Google login.
See `local/report.json` and the reviewed `local/managed-stopped-vi.png` screenshot.

MT5 startup recovery temporarily showed syncing and the previous worker error;
the connection subsequently returned to connected, cleared its error, and advanced
last_synced_at. `local/rollout.json` records sanitized runtime/connection status.
No orders, Google login, token import, model inference or real pool routing were
performed. Actual provider/pool acceptance remains outstanding.
