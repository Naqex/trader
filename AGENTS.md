# Naqex Trader

When this repo is checked out inside the workspace, `../../AGENTS.md` also applies.
A standalone checkout uses this file and the repository README; workspace planning is optional.

## GitHub workflow

Use the workspace's `../../tooling/github-workflow/README.md` when available:
small-team workflow, optional issues, one task branch/PR per coherent objective,
not per chat or result. Standalone: small single-writer edits may use main only
if repository policy allows; otherwise use a short task branch and PR. Keep
required checks/protection; no admin bypass. PRs need change/reason, validation
and material limits, not repeated agent identity tables. Substantive AI commits
keep `AI-Tool` + `AI-Model-Requested` trailers (raw configured ID or `unknown`).
Issues, when needed, live in `Naqex/workspace`; link existing PLAN/evidence.
Preserve worktrees/WIP and publish child source before workspace pins. Archived
instructions/template: `docs/archive/github-workflow-20261109/` (reference only).

## Authoritative context

- Start/run instructions: `README.md`; current product source is `foundation_v2/`.
- Product completion plan: `../../planning/trader/PRODUCT-COMPLETION-PLAN.md`
- Start/resume and state ownership: `EXECUTION-ENTRYPOINT.md` beside that plan, then its current ledger/receipts. Generated `STATE.json` and narrative `RESUME.md` do not replace the ledger.
- UI scope/quality: `../../planning/trader/TRADER-UI-MASTER-PLAN.md`
- Project UI contract/config: `ui/`

U1 checkpoints and old design/exploration prompts are historical references. Open them only for relevant decisions or regressions; do not restart accepted work from an old status snapshot.

## Current UI gate

The owner delegated UI direction and acceptance to agents. Continue the chosen Naqex Trader direction with independent review + runnable visual/interaction QA; do not wait for owner aesthetic approval or treat implementation/build success as accepted UI. Product Plan owns scope; Naqex Trader owns its UI quality contract. Broker/data/cost/deploy gates remain separate.

The owner retired `projects/mt5-tradingview-backtester-figma-make` and `projects/mt5-tradingview-backtester-gemini-sketch` on 01/10/2026. Do not use or recreate these checkouts as a prerequisite for product work. New design exploration requires an explicit task; ordinary UI work stays in the main repo.

## UI worker preparation

Use `.agents/skills/trading-ui-qa/SKILL.md` for web UI QA. Playwright scripts/CLI are the default, selective screenshots/traces cover visual/canvas checks, and computer use is a scoped fallback for gaps. The parent workspace's `tooling/ui-qa/qa.mjs doctor --plan <canonical-product-plan>` checks the handoff; it never starts the product or marks acceptance. Product Plan is the single user handoff. Tooling fixture PASS is not product/Figma/broker PASS.

## Shared UI layers

- Global foundations: `../../UI-Systems/` (relative to this project root)
- Trading-domain contracts: `../../UI`
- Project-specific UI: `ui/`

The project may consume shared contracts but should not copy or mutate shared global files as a side effect of an ordinary feature task.

## Implementation rules

- Follow owner-approved PATH-2 (`planning/trader/FOUNDATION-ADR-0001-PATH2.md` in the parent workspace). Reuse clean domain logic/tests; legacy Flask is reference, not a constraint to restore. Do not reopen the chosen stack without the ADR's revisit evidence.
- Reuse current routes, stores, contracts, and chart capabilities before adding new frontend frameworks.
- Preserve Vietnamese-first UI and explicit units/scope/state semantics.
- Apply the spacing and visible-copy rules in `ui/display-conventions.md`; do not add persistent implementation or legacy-data notices to healthy reports.
- Visual changes require browser/screenshot QA at representative widths and must test error/empty/stale/unknown states where relevant.
- Generated code must be reviewed against the actual repository; do not paste a generator's preferred framework wholesale.

## Safety gates

For local API/UI rollout, runtime health/recovery or an owned terminal reconnect,
use `.agents/skills/mt5-runtime-operations/SKILL.md`. A copy/layout-only fix does
not require an API or terminal restart. Runtime skill invocation does not grant
broker execution or change the authorization gates below.

- Standing owner authorization (02/11/2026): during assigned Trader work, agents
  may build, update/promote local UI/API/adapters, restart project-owned local
  services and MT5 terminals, and reconnect existing accounts without asking
  again. This explicitly overrides earlier per-action approval requirements for
  those local operations. Preserve account identity/access mode, runtime/data
  ownership and rollback; reconcile active jobs and unknown broker submissions
  before interruption. Unrelated terminals/services remain outside this grant.
- Local maintenance/reconnection does not authorize OrderCheck/OrderSend,
  strategy execution on broker accounts, new accounts/providers, data migrations,
  data deletion or remote/production deployment; their separate gates remain.
- Never enable live broker execution without explicit user permission.
- Do not open holdout data without the approved protocol/user gate.
- Do not add paid providers, OAuth integrations, delete user data, or public-release the app without the required user approval.
- UI must never imply that a planned/replay order was sent to a broker.

## Dirty worktree

The repository may contain active user/project-completion changes. Never revert unrelated modifications. Work with existing changes and keep UI-system work scoped.

