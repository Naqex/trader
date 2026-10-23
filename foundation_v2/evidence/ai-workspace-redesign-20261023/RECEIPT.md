# AI và Bot UI — 23/10/2026

Scope: simplify connection/model management and expose shared Mentor chat as a
page. This is scoped UI and management-route acceptance, not whole AI-platform,
provider inference, pool, performance or trading acceptance.

## Behavior and ownership

- Four VI/EN tabs: Chat, Connections, Models, Bots. Shared Mentor component/harness
  serves the full page and existing side panel; no second inference pipeline.
- Connections lists CLIProxyAPI and ChatGPT Web together. Right-side details use
  the existing modal/focus lifecycle, with actions, saved-session/account count,
  catalog, test result, unknown quota and optional endpoint/management scope.
- Explicit `GET /api/v2/ai/assistant/connections/{provider}` and
  `POST /api/v2/ai/assistant/connections/{provider}/{action}` retain workspace,
  local-origin and no-store guards. Actions cannot change provider/selection;
  legacy account routes remain compatible.
- Models shows effective system/feature defaults and expandable experimental
  evidence-review roles. Saves carry revisions; existing runs keep snapshots.
- Separate lazy-loaded management pages; no idle polling, auto-login or inference.
  Poll only an active login/test. Bot shows an unavailable state without controls.
- Uses existing design tokens, selects and modal. No new dependency or migration.

## Validation

| Check | Result and limit |
| --- | --- |
| Rust `ai_assistant::tests` | 7 passed, 1 ignored; ignored case requires isolated empty gateway store |
| Rust release binaries | Build passed |
| Isolated frontend production build | Passed; existing large-chunk warning remains |
| Production redesign fixtures | 6/6: VI/EN at 1440/768/360, login/cancel mocks, failures, drawer focus, idle reads, lazy pages; desktop CSS zoom200% |
| Production chat/profile regression | 6/6: VI/EN and three widths, mocked submit/cancel/history and profile isolation |
| Actual candidate UI → actual local API | 6/6, no mocked reads, zero writes/page errors |
| Promoted UI5180 → actual local API8010 | 6/6, zero writes/page errors; reload, catalog/defaults, drawer, all tabs, no horizontal overflow |

Runtime read-only check observed one saved gateway account and eight catalog
models. Default provider/model and persisted profiles were unchanged. These
observations do not establish account health, available quota or model quality.
Screenshots reviewed at desktop dark and mobile light, including drawer alignment.

Current runners in `foundation_v2/web/`:

- `run_ai_workspace_redesign_acceptance.mjs`: fixture interaction/visual checks.
- `run_ai_runs_acceptance.mjs`: persistent chat/profile UI fixtures.
- `run_ai_workspace_live_acceptance.mjs`: actual API reads; blocks non-GET writes.

Set `TW_AI_UI_ORIGIN` and `TW_AI_UI_EVIDENCE` for candidate/installed checks.
Older workspace/provider/setup UI scripts describe previous layouts; they are
historical regression sources, not current redesigned-UI acceptance entrypoints.

## Local rollout and recovery

Evidence/builds/backups: `E:\BACKUP-TRADINGWORKSPACE\ui-ai-bot-20261023`.
Passing reports/screenshots: `production-fixtures/`, `production-chat/`,
`candidate-live/`, `live/`. Earlier failed attempts remain separately preserved.
`ui-promotion.json` records candidate and prior index hashes; `ui-before/` holds
the previous index and preserved brand asset. Temporary candidate source was
archived from HEAD and overlaid with scoped UI changes, excluding unrelated dirty
Replay/UI edits. Candidate and promotion scripts are outside source control.

API8010 uses `.runtime/api-builds/ai-workspace-20261023/release`; schema remains13.
The existing managed gateway was restarted after API cutover without login or
inference. Runtime ownership is recorded in `.runtime/api-platform/native-owner.json`.
The restart guard correctly rejected stopping an old runtime with new binary
paths; the old runtime was stopped with its exact owner binaries before starting
the new build. Do not bypass that guard.

UI5180 was promoted by copying verified assets first and atomically replacing
index last. Existing hashed assets remain for open pages; current brand SVG was
preserved. UI rollback: atomically restore the saved index with retained assets.
API rollback: first use the current manifest's exact binary paths to stop, then
start the prior `ai-platform-20261023` build using the existing guarded launcher.
No database rollback is needed for this change.

No real inference, OAuth/login, pool test or broker order was sent. Direct API/local
model adapters, Auto routing, tools and Bot execution remain outside this slice.
