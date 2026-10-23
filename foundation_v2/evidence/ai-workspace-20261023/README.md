# AI và Bot UI checkpoint — 23/10/2026

Owner scope: separate AI area below the Strategies divider with a divider beneath it,
no ampersand in its name, shared assistant/provider controls, future bot scaffold,
and design-system feedback on account bulk actions.

Implemented `view=ai` with Assistant, Connections and Automation tabs. Connections
lazily mounts the existing provider settings; Assistant opens the existing shell
chat. General Settings links to Connections. Automation has two unavailable rows
and no execution controls. Workspace/language survive navigation; backend context
uses the existing `settings` screen contract. Provider selection still has its
documented machine scope and RAM lifetime.

Validation passed on the built preview at port 5180:

- Vite build; warning retained for the main bundle exceeding 500 kB.
- `run_ai_workspace_acceptance.mjs`: desktop 1440 vi/dark and mobile 360 en/light;
  route/history/reload, collapsed rail/mobile drawer, divider/icon geometry,
  localization, lazy provider chunk, no idle polling or navigation mutations.
- `run_ai_provider_acceptance.mjs`: 1440/360, vi/dark and en/light; selection,
  empty/auth/quota states, send/cancel and stale-selection contract with HTTP fixtures.
- `run_chatgpt_account_acceptance.mjs`: 360/768/1440; fixture login, cancellation,
  selection, stale/error/denied states and keyboard flow.
- `run_ai_chat_acceptance.mjs`: existing shared chat regression at 360/768/1368;
  transcript/history, settings, resize, workspace isolation and cancellation.
- `run_live_selection_acceptance.mjs`: dark/light; matching green sync icons,
  shared hover/focus, deletion cancellation and deselection; all mutation calls denied
  by a labeled fixture and none attempted.
- `run_ai_provider_local_acceptance.mjs`: actual preview → API8010 → pinned
  temporary gateway with an empty auth store. Empty catalog and foreign-workspace
  denial verified. Gateway stopped and prior provider restored in cleanup.
- Representative screenshots reviewed for sidebar placement, connection layout,
  mobile wrapping and selection toolbar. No page errors or viewport overflow in
  the scoped checks.

Reports/screenshots for this change are in the sibling directories. Earlier provider
integration evidence is preserved. Synthetic responses are UI fixtures, not proof of
model inference or account-pool operation. No OAuth login, real model prompt, broker
operation or trading automation was performed. This checkpoint does not change
whole-product acceptance.
