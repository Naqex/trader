# Guarded local rollout mechanics

Use only the branch needed by the requested operation. Read current script/source
and manifest; do not replay an old shell command from history without checking it.

## Source and runtime separation

Keep three identities explicit: the checkout being edited, the runtime being
inspected or changed, and the account for which the action is authorized. A new
Git branch changes only source ownership. It does not select a new database,
artifact directory, MT5 terminal, provider home or port.

For a linked checkout, compare the working directory with Git's resolved top
level. Inspect its `.git` pointer and `config.worktree` when they disagree. An
absolute `core.worktree` override belongs only in that checkout's private
worktree config; do not rewrite common config or another worktree's metadata.
Preserve the original setting and verify ordinary Git commands afterward.

Before launching or running integration tests, identify inherited runtime
variables by name without printing secrets. Use explicit task-owned state,
artifact and database targets and a checked free port. Do not fall back to a
primary checkout's manifest, database or currently occupied listener when a
standalone checkout has no runtime yet. Inspecting an existing runtime requires
its explicit manifest and scope; creating a disposable rehearsal is a different
operation. Reuse saved-data and process fixtures when they answer the question.

The Python launcher requires `--worktree-runtime-root` for a linked checkout.
Its default manifest, artifacts and build outputs then resolve below that root;
runtime actions also require a non-default `--database-name` and `--port`.
Use `--check-isolation-only` first to validate this selection without connecting
to a database, inspecting listeners, creating outputs or compiling binaries.
For a build-output-only check, combine it with `--build-only`; that check needs
no database or port selection and does not build. Actual `--build-only` compiles
the candidate separately. Normal `--check-only` is a database/runtime preflight,
not this offline path check. The PowerShell wrapper takes `-WorktreeRuntimeRoot`,
`-DatabaseName` and `-Port` and runs isolation admission before listener actions.
Passing the path check does not verify broker/feed/provider isolation or readiness.

For isolated runs, the launcher pins MT5/scientific adapter roots to the current
`foundation_v2` and clears inherited terminal selection, AI workflow interpreter,
unselected scientific/legacy capabilities and QDM home. Explicit capability flags
remain available. It also strips `TW_CHATGPT_WEB_*`, `TW_AI_GATEWAY_*`,
`TW_MT5_MCP_*` and `TW_AI_PROVIDER`, and places the ChatGPT Web home/core/Bun and
gateway key paths under the private runtime root's `ai` directory.
`TW_AI_INTEGRATIONS_DISABLED=1` disables the optional ChatGPT Web/gateway paths;
the Rust boundary accepts only `0` or `1`. Expect `ai_integrations_disabled`,
not a live provider health result. This profile does not provision AI accounts,
read their credentials or launch/contact these integrations. Do not clear the
guard or restore inherited keys to make its status green. The primary checkout's
existing integration behavior is unchanged; broker/account authority remains
separate from this local profile.

Resolve workspace-only research references from the workspace named by the task,
read-only when another lane owns it. The repository's local docs remain usable
without that workspace. Keep new evidence in this task's existing output root,
and never mark the other campaign complete or change its data cutoff from a
runtime fix.

## API and terminal

1. Inspect live owner manifest and prepared candidate; run check-only/idle checks
   for the explicit native/storage profile with existing capabilities. Preserve
   task/account scope and any active work. Do not print the DSN or credentials.
2. Save manifest, descriptors and necessary private config under the selected
   task-owned backup root. If schema changes, verify compatible PostgreSQL dump
   tooling and matching artifacts.
   Backup-confirmed flags acknowledge backups; they do not create them.
3. Stop through `run_api_platform.py --stop` with the **currently owned** binaries
   and profile. Guarded ownership compares executable paths/hashes; candidate
   binary paths cannot stand in for old ownership during stop. Do not kill by
   port/process name or overwrite a running binary.
4. Start the prepared candidate with all retained settings. Readiness must verify
   the new owned supervisor/API and actual deployed build. If startup fails,
   inspect sanitized logs and use the saved compatible rollback, not broad kills.
5. Reconnect only the specifically authorized account using the supported
   connection action; check status, requested mode and fresh generation. App
   account list/sync may reach MT5: a loopback URL is not an offline fixture.

Existing terminal cold-start cleanup may remove manually enabled native MCP.
Read `foundation_v2/docs/MT5-READ-TOOLS.md` for that adapter. Keys belong in scoped
process environment/private storage; never in screenshots, repo or command line.
A binding must match fresh workspace/account/generation and owned terminal path.
Do not restore an entire old config/profile directory to repair one capability.
Report unavailable optional tools honestly; do not enable trade/file/tester tools.

## UI-only promotion

Build a scoped source tree: tracked HEAD plus intentional task overlays, excluding
unrelated dirty files. Use existing dependencies/vendor path, a task-owned build
output root, then preview on an owned loopback port. Build and focused
browser/visual checks come before promotion.

Inspect the currently served index hash and preserve it for rollback. Reuse the
latest verified promotion helper after reading it; check asset collisions, retain
old hashed assets for open pages, and replace the entry index atomically. Preserve
intentional private branding/mutable assets according to that helper's contract.
Verify the real served hash and affected read-only behavior. A UI-only copy change
normally needs no API/terminal restart. Clean up only the preview you started.

## Evidence to reuse

The product's `foundation_v2/evidence/mt5-read-tools-20261024/RECEIPT.md` records
official MCP client smoke, scoped UI promotion, old-binary stop, reconnect errors
and optional-MCP loss. It is historical evidence of this workflow, not a current
runtime status or authorization. Runtime docs and fresh manifests own current
parameters; receipts retain failed attempts.
