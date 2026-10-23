# Mentor and custom chat agents — 2026-10-23

## Behavior and data ownership

- History header/row separators span the panel width; content/actions keep their gutters.
- Mentor alone shows a plus/Create agent action below the header, without a New badge.
  Once a custom agent exists, the header name opens an agent menu with Create at its end.
- Native dialog: name, description, instructions, bounded knowledge files, sample link,
  retained drafts after failed saves, keyboard/focus handling and localized file controls.
  Mentor identity/instructions are read-only; the server also rejects Mentor updates.
- Custom agents persist under `(workspace_id, subject)` with optimistic revisions.
  Selecting an agent starts a separate chat; reload restores the saved chat's agent.
  History filters by agent and retains the existing keyset pagination/budgets.
- Runs snapshot the selected agent at admission. Instructions/knowledge reach both
  transports in grounded user JSON, below server policy; no tools or broker authority
  are added. Changes affect future turns; Continue uses its prior agent snapshot.

The public FX Replay strategy sample was read through a fresh Playwright context
after the web reader failed. Its guidance informed the sample link, short single-
strategy files and lifecycle checks in the server policy: bias/setup/entry/risk/
management/exit/no-trade. Page content is reference data, not trusted instructions.

First version supports UTF-8 TXT/Markdown, up to five files/64 KiB combined, instructions
up to 8,000 characters and 32 custom agents. PDF/DOCX extraction and large-document
retrieval are not implemented. Metadata lists omit knowledge/instructions; full config
loads only for editing/admission, with no polling, new package, embeddings or service.

## Verification

- Rust AI suite: 18 passed, 4 explicit acceptance tests ignored. An initial run during
  release compilation hit an existing 10ms fixture deadline (504); the normal-load
  repeat passed 18/18. The product timeout was not changed.
- Owned disposable PostgreSQL lifecycle: passed separately, including migration 0014,
  create/read/update, immutable Mentor, stale write rejection, foreign subject denial,
  immutable run snapshot after edit, agent data reaching the provider fixture,
  idempotent replay and separated history. No production DB used in this fixture.
- Transcript/SSE unit regression: 6 passed.
- Final installed production bundle with isolated API fixtures: 6/6 (VI dark/EN light
  ×360/768/1440), covering creation, editability, file validation, sample link, failed
  save draft retention, reload, revision on subsequent send, separate conversations,
  history width and keyboard Escape. Fixed Escape closing the parent panel.
- Installed Stop/Continue regression: 6/6, 9 fixture submissions per case; retained
  thinking/partial output, continuation, reload, pagination and lost-POST recovery.
- Installed actual UI/API read-only journeys: 6/6, no writes or page errors.
- Actual 5180 →8010 →CLIProxyAPI →Gemini 3.8 Flash: one synthetic inference passed.
  Create custom agent, upload `risk=0.37%` strategy, reload, edit, ask: answer `0.37%`.
  Reload retained the answer without another POST; persisted model profiles unchanged.
  Only that synthetic conversation/agent was removed afterwards by verified exact IDs.
- Scoped Vite build and optimized Rust release passed. Existing main chunk warning
  (~638KB) remains. Unrelated dirty Replay/CSS excluded from the isolated UI build.

## Local rollout

All task builds/temp/images/reports are in `E:/BACKUP-TRADINGWORKSPACE/ai-agents-20261023/`.
The repo's existing backup helper was reused after guarded idle/identity stop. The
first dump attempt used PostgreSQL17 against server18 and was rejected before any
migration. Installed PostgreSQL18 was then used successfully; no new tool installed.

Verified backup (DB plus 4,142 artifacts, 4,267,620,443 bytes total):
`E:/BACKUP-TRADINGWORKSPACE/workspace/projects/mt5-tradingview-backtester/foundation_v2/.runtime/api-platform-backups/ai-agents-20261023/`.
Manifest SHA256: `01d7daee2b849b40ddf59969d7e6b5c59628148285212759e32d95bf2cb80a68`.
Migration `0014_ai_agents.sql` applied through the existing backup/idle guarded
native launcher; existing rows become Mentor via NULL agent identity.

Native/compact API run: `3f388d3a747f4a43a96f0f8007230b03`.
API SHA256: `29aa3d936dac36f92f01383bf1b461208aded37c10feeb73f501d76a55afba8e`.
Installed UI index SHA256: `70621d7d3da43ca164d0347cf4b8e061256d8eb79859f74940bfdf1eec27dfdd`.
Preserved scientific/legacy capabilities and workflow interpreter. Gateway restarted
through its existing manager, 3 accounts/3 models; runtime default restored to the
persisted system profile (CLIProxyAPI/Gemini), ready=true. No OAuth or execution changes.

One release packaging attempt hit Windows locks on the old active binary directory;
the successful release uses this task's separate binary directory with compiler-cache
junctions, then guarded startup. The actual installed UI uses an atomic index swap,
retains old hashed assets and the installed brand. UI rollback can restore
`ui-before-verified/index.html`; rollback to a pre-0014 backend additionally requires
the verified DB backup and matching schema/binaries because migration ledgers are strict.

Key external evidence: `postgres-tests.log`, `rust-ai-tests-final.log`,
`installed-fixture/report.json`, `installed-continuation/report.json`,
`installed-readonly/report.json`, `live-agent-report.json`, `live-agent-reply.png`,
`cleanup.json`, `backup-final.log`, `rollout.log`, `ui-promotion-verified.json`,
`owner-before.json`, `owner-after.json`.

This receipt covers the assigned agent/chat UI feature, not whole-product, TradingAgents,
workflow fanout, broker or live-execution acceptance.
