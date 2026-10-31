# Native Paperclip UI integration — 31/10/2026

Scope: owner requested native Paperclip UI inside Trader, outside-in composition
before custom trading/research engine work. Source is preserved upstream; this
receipt is scoped UI/local-runtime evidence, not autonomy or trading acceptance.

## Source and data

- Paperclip submodule: `projects/paperclip`, upstream
  `https://github.com/paperclipai/paperclip.git`, pinned
  `42fd568cf8f588334cacc6004aa23aff54daa52b`, source version0.3.1, MIT.
- Upstream working tree remained clean. No upstream UI clone or source patch.
- Node24.19.0; pnpm9.15.4 frozen install with scripts disabled. Shared/plugin SDK
  built using the reviewed upstream `scripts/ensure-plugin-build-deps.mjs`.
- Root launcher: `tooling/paperclip/run-local.mjs`; isolated config/database,
  storage and key under root `.runtime/paperclip/instances/trader-ui/`.
- API/UI3100, embedded PostgreSQL54339 on loopback. First-run upstream migrations
  applied to the new Paperclip database only. Trader DB/API untouched.
- Created one empty `Naqex AI` organization through supported API. Verified
  agents and heartbeat runs are both `[]` after QA. No models/jobs were run.
- Telemetry and update checks disabled in config; announcements and heartbeat
  scheduler disabled in process environment. Manual execution APIs still exist;
  this is not an execution-disabled sandbox. No company/workspace data mapping
  or connection to Trader engines, brokers or provider credentials.

## UI behavior

AI opens Paperclip by default. Original task/agent/project navigation, dialogs,
language and preferences belong to Paperclip. Trader retains product navigation
and its existing connections/gateway/model tools. The custom research prototype
remains reachable by its historical URL but is removed from primary navigation.

The shared persistent panel host keeps iframe document/search state across route
changes. Paperclip temporarily compacts the outer desktop rail without changing
the saved Trader preference. Mobile uses the full content width and menu drawer;
an otherwise empty mobile preview-status row is removed for this page.

Health bridge is one fixed GET endpoint; no general URL forwarding, writes,
Trader DB details or raw Paperclip health internals. Error state has explicit
retry and open-separately actions. Hidden iframe is not a paused job scheduler.

## Verification

- Trader production build PASS, output `.runtime/ai-workspace-preview`.
  Existing bundle-size warnings remain; no performance benchmark claim.
- `node --test tests/paperclipBridge.test.mjs tests/clientNavigation.test.mjs`:
  6/6 PASS, including fixed upstream target, denied write, stripped internals and
  offline response.
- Real native UI/API browser QA at5219, against the separate empty database:
  1920 dark/VI host,1440 light/EN host,390 dark/VI host. Native content remains
  English. Native dark/light follows its system/native preference; no host
  preference synchronization contract is claimed.
- Eight browser cases PASS:3 layouts,3 native task-dialog open/Escape checks,
  persistent iframe/search + rail preference, unavailable + retry recovery.
  No page errors, page overflow, non-loopback HTTP requests or attempted writes.
  Tests deliberately do not save a task or configure an agent.
- Actual Paperclip health/index served successfully without framing-denial
  headers, and iframe content loaded/interacted on a separate local origin.
  Authenticated/private deployment and OAuth flows were not exercised.
- Root workspace topology/link validator PASS;5 existing workspace tests PASS.
- Launcher rerun PASS: existing instance reused, owner.json SHA256 unchanged.
- Independent scoped source review found duplicate launcher startup risk; fixed
  with owner/revision checks, unknown-listener refusal and atomic startup lock.
  Re-review found no blocking source findings. Reviewer did not execute tests.
- Root visually reviewed desktop/mobile native pages, mobile dialog and error
  screenshots. Browser report and rendered artifacts are in `browser/` here.

Earlier attempts are not counted as PASS: pnpm11 rejected the frozen patch config
(resolved with upstream-pinned9.15.4); first mobile assertion exposed the58px
outer rail (corrected); initial screenshots caught upstream lazy loading
(now wait for the actual task empty state). Theme test initially assumed host
CSS forced the native app's theme even under Playwright's light emulation; tests
now explicitly exercise each system color scheme and do not claim preference
synchronization. Dialog close returns focus to native BODY, not its triggering
button; the iframe retains focus. This upstream behavior is recorded, not fixed
or described as trigger-focus restoration.

## Local handoff

- Owner preview: `http://127.0.0.1:5218/?workspace=tenant-a&view=ai&area=ai&section=paperclip&lang=vi`.
- Served build entry verified against output: `assets/index-CQ4fqUNb.js`.
- Preview health bridge reports the pinned Paperclip commit/version.
- Replaced only the identified old UI-preview process17000. New preview PID21344;
  manifest `.runtime/paperclip-ui-preview-owner.json` in Trader, stdout/stderr
  `.runtime/paperclip-preview-5218.*.log`. Owned QA preview5219 stopped.
- Native Paperclip server PID18092, launcher24572, PostgreSQL17416 at handoff;
  current ownership is root `.runtime/paperclip/instances/trader-ui/owner.json`.
  Initial startup output retained in exec session53962; launcher is foreground,
  not an installed OS service. Check current identity before any stop/restart.
- Setup/restart boundaries and rollback documented in root
  `tooling/paperclip/README.md`. Original UI preview output retained for rollback.
- No rollout to5180 or API8010; broad Trader audit remains paused. Source changes
  are scoped separately from pre-existing dirty audit/backend/UI files.
