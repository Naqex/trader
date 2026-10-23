# CLIProxyAPI official management — 23/10/2026

Scope: owner-approved local management panel and persistent gateway configuration.
Native WMREPLAY remains the daily UI; the upstream panel is the advanced admin UI
at its own loopback origin. No iframe/fork, OAuth/account login, provider inference,
paid-provider setup or broker execution was performed.

## Implementation and ownership

- Native connection drawer opens the fixed `http://127.0.0.1:17852/management.html`
  URL in a separate tab with noopener/noreferrer. Runtime returns availability and
  pinned version only. No management key is returned to the native UI or put in URL.
- `managed.yaml` is persistent. Existing provider/routing/model mapping edits are
  preserved byte-for-byte on ordinary restart. The legacy `config.yaml` seeds a
  missing managed file once. New Init creates the managed document directly;
  manual Serve prefers it, with legacy fallback only for older homes.
- First managed start with a verified panel enables local management and creates
  a separate random256-bit `management.key`, inheriting the private home ACL.
  Upstream hashes its copy in YAML. Later starts retain key/config; an authenticated
  v8 management read checks that the key file and service agree.
- Port ownership is checked before any configuration/key mutation. The model-list
  readiness probe retains its300ms budget; bcrypt-authenticated management reads
  have a separate3s budget, only at startup. No extra steady-state polling.
- Managed start checks gateway/panel hashes, version8 config, expected loopback
  host/port/auth-dir, retained app inference key, disabled discovery/remote
  management/pprof/automatic panel updates. Invalid config stays intact for repair.
  These are startup invariants, not a sandbox restricting the trusted administrator
  while editing the running gateway. Native model profiles/admission/tool/broker
  authority remain separate from gateway administration.
- Installer pins the upstream release asset; no background downloader or extra
  service. CopyManagementKey places the key in the Windows clipboard only on an
  explicit helper invocation; it never prints the key. Owner runs this helper for
  initial panel sign-in. Remember password in upstream uses reversible obfuscation,
  not encryption; the panel itself is a trusted admin surface.

## Supply chain and reuse

Gateway remains CLIProxyAPI v8.0.40, commit d946c4fb; executable SHA256
`0fd1f03b80a4acac69515e3737fc9f4445de69221e4750e20a3c70038a3b8443`.
Official Management Center v1.26.7, MIT, release asset `management.html` SHA256
`8c9c6b7d3fb311e6aad5d06e1993e53a2d28389e640448a1bc6304ed20b057b5`
matches the GitHub release digest. Source manifest/license and v8 management/
asset-updater implementation were inspected; no upstream install/build scripts
were run. Compatibility was checked with the actual pinned binary and asset.

Added serde_yaml_ng=0.10.0 (MIT) to preserve/read the upstream YAML document with
a standard parser rather than text patching/custom YAML parsing. Lockfile adds
indexmap2.14.2 and unsafe-libyaml0.2.11; manifests have no build scripts. This is
a small continuation of serde_yaml, not a claim of comprehensive dependency audit.
Only local administrator configuration is parsed, bounded to1MiB. Serialization
passes through JSON text to avoid serde_json arbitrary_precision's private Number
map; the initial real-binary check caught that interoperability failure before
local rollout. The failed synthetic home/debug logs were preserved on E.

## Evidence

All builds, temporary homes, screenshots and backups are under
`E:\BACKUP-TRADINGWORKSPACE\ai-gateway-admin-20261023`.

| Check | Result and scope |
| --- | --- |
| Rust gateway runtime unit tests | 3passed,2explicit acceptance cases ignored by default; management persistence case also run explicitly |
| Rust assistant boundary regressions | 7passed,1explicit empty-store case ignored |
| Pinned gateway management acceptance | Explicit isolated test on17853 passed: occupied port rejected without config/key mutation, auth required on v8/v0, inference key rejected for admin, panel digest unchanged, authenticated routing edit persists after managed restart, key retained, unsafe restart denied without overwriting config, owned listener stopped |
| Official panel browser acceptance | 2/2 at1440/360: synthetic admin sign-in, provider page, no horizontal overflow or page errors; no external/OAuth/write browser requests; separate fresh empty home on17854 |
| WMREPLAY production UI fixtures | 6/6 VI/EN at1440/768/360, management link/target/rel, no default mutation, idle polling and existing drawer/model/chat checks |
| Rust release + isolated production UI builds | Passed; existing frontend large-chunk warning remains; official3.35MB HTML stays outside the app bundle |
| Actual installed UI/API + panel link | `live-final/report.json`: 6/6, zero writes/page errors; actual button opens the official login page with an empty key input; no actual admin/provider login through browser |
| PowerShell helper | Syntax passed; real pinned asset installation passed; CopyManagementKey was not invoked against the user's clipboard |
| Local key ACL | Exactly one inherited access rule, current Windows user only; parent private home protects inheritance; YAML management key verified hashed |

The first panel-mobile test used the wrong menu accessible name; it failed and
was corrected to upstream's Expand sidebar. Screenshots now wait for the upstream
JS route/sidebar transition to settle before capture. Fixture QA is separate from
actual local reads and does not prove upstream model/pool health or throughput.
One final isolated run returned config-conflict during the management readiness
check; its immediate instrumented rerun returned200 and passed. The300ms request
budget was shared with cheap model probes despite bcrypt admin authentication;
the final implementation separates that budget. The failed synthetic home remains
on E; exact latency of that original failure was not recorded.

Current acceptance entrypoints:

- `web/run_ai_gateway_admin_acceptance.mjs`: real pinned panel+gateway, isolated
  empty store and synthetic admin, no OAuth or inference; set TW_AI_ADMIN_EVIDENCE
  to an external directory containing the verified panel asset.
- `web/run_ai_workspace_redesign_acceptance.mjs`: native fixture UI.
- `web/run_ai_workspace_live_acceptance.mjs`: actual read-only native/API/panel
  entry, with TW_AI_UI_ORIGIN and TW_AI_UI_EVIDENCE overrides.
- `cargo test --locked --lib pinned_management_panel_preserves_config_after_restart
  -- --ignored --nocapture` with TW_AI_ADMIN_EVIDENCE set: real-binary persistence.

## Local rollout and recovery

Preflight confirmed native/compact, schema13, no pending migrations or active work.
Only the owned API runtime was stopped via its exact old binary paths. New active
binaries: `foundation_v2/.runtime/api-builds/ai-gateway-admin-20261023-r2/release`.
Scientific/codec descriptors and workflow Python were retained. Gateway was started
with the existing account store; legacy RAM provider/model selection was restored
to its pre-restart value. Persistent model profiles compare equal before/after;
one saved account/eight catalog models remain. No provider or model was promoted.

Config snapshots are in `private-before/` on E with a protected current-user-only
directory ACL. Owner/state metadata and UI promotion hashes are outside that
private folder; they contain no keys. No DB migration occurred. Source candidate
was archived from HEAD plus scoped UI changes, excluding unrelated dirty work.
UI index was replaced atomically after copying hashed assets, retaining the old
assets/current brand. `ui-before/` provides the prior index.

Rollback UI by restoring that saved index atomically. To roll back API, stop with
the current manifest's exact binary paths, restore the protected pre-change config
snapshot while gateway is stopped, and start the prior ai-workspace-20261023 build.
Retain the new management key separately if needed; never print it into logs. Old
source regenerates management-off config, so do not expect panel edits to survive
that rollback. No DB rollback is required. The temporary5188 preview was stopped;
normal UI5180/API8010 and managed gateway17852 remain running.

Limits: upstream panel languages currently exclude Vietnamese. Native controls
are VI/EN; panel source is unchanged. More providers can be configured by the owner
in the panel, but provider inference/capability/quota/pool acceptance remains separate.
The gateway's known metadata egress under --local-model is unchanged; this work
does not claim fully offline operation or a complete egress/security audit.
