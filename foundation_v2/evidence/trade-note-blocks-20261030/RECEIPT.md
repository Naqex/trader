# Trade note block editor — 30 October 2026

Source, scoped candidate and local API8010/UI5180 rollout accepted. The owner
explicitly approved the local API/UI cutover and restoration of the existing
MT5 connection in this chat. No owner note writes, broker orders, account/mode
changes or schema migrations were performed. The existing scheduled connector
restored the connection; no explicit reconnect/sync request was needed.

## Behavior and data

Both Practice and Live trade drawers reuse one lazy-loaded BlockNote editor,
the existing journal identity, revision checks and autosave queue. Hover/focus
shows insert/drag controls; insert and slash share the block menu. Starter
templates preserve existing content; the centered template dialog supports
search, preview and insert/explicit replacement. Catalog management is UI only;
media supports URL embeds without a new upload backend. Standalone Live Notes
keeps its existing editor.

`note` remains searchable plain text; optional versioned `note_document` retains
formatting. Existing plain notes become editable paragraphs without a bulk
migration. Server key order does not reset selection/history or dirty the editor.
Old tab recovery upgrades in memory; an unresolved old request keeps its exact
plain-text body and receipt. Saved status requires the confirmed server revision
and timestamp. Read/write errors and conflicts retain their existing guards.

The detail drawer omits provenance, uses a normal hyphen for missing facts and
omits currency glyphs from its three PnL values while retaining currency context.

## Evidence

Artifacts: `E:/BACKUP-TRADINGWORKSPACE/note-block-editor-20261030/`.

| Check | Result |
| --- | --- |
| Production Vite build | PASS; editor is a separate lazy chunk |
| Autosave/document Node tests | 12/12 PASS, including legacy submitted body |
| Frozen command export | PASS, 105 commands; generated OpenAPI updated |
| Autosave browser regression | `browser-2/report.json` PASS: both drawers, standalone, failure/conflict/close draining |
| Block browser journeys | `blocks-final/report.json` PASS: 1920 dark, 1440 light, 390 dark; slash/Escape, template preservation, reload, desktop plus/drag, no root/drawer overflow |
| Native persistence | `native-final2-browser/report.json` PASS: final Rust candidate with disposable PostgreSQL, create/reload/revise, formatted blocks, conflict and workspace isolation |
| Independent review | No remaining blocker; `review-final/` records direct interaction checks and screenshot review |
| Local candidate preflight | PASS: PID/path/hash ownership, native/compact schema and idle checks, no unknown broker submissions; no process changes |
| Local deployment | PASS: owned API hash/readiness and served UI hash; old hashed assets/branding retained |
| Deployed browser | `deployed-browser/report.json` PASS: both real trade drawers at 1920/1440/390, template dialog/search/Escape, zero page errors and zero mutation attempts |
| Existing MT5 connection | `mt5-after.json` PASS: connected, original requested mode retained, fresh sync; no order or explicit sync request |
| Diff whitespace | PASS |

The native final fixture API, PostgreSQL and candidate preview5187 were stopped.
Failed attempts remain on E:
an old template Escape failure, Playwright locator dragTo hang (coordinate mouse
drag passes), and standalone reopen before catalog readiness. The latter fixture
now waits for the actual edit-ready state before reopening.

Runtime packaging maps compiled resource-root literals back to the active
installed foundation so this scoped build does not relocate AI/engine paths.
`native-path-mapping.json`, `prepared-runtime.json` and the prior ownership/config
backup capture that boundary. Final candidate SHA256:
`f77f6e575280f22543f278c7096555ac789500688b3dcb71360cec28fc8831fb`.
Scientific installation verification passed with its explicit installed root;
the first preflight lacked that root and stopped without changing services.

## Limits and deployed state

FX browser access failed (`browser.user is unavailable`). Presentation follows
the supplied screenshots and official BlockNote capabilities; this is not proof
of every FX interaction or of its implementation/library choice. BlockNote
0.55.0 is pinned and consumed unmodified under MPL-2.0; attribution is recorded
in THIRD_PARTY_NOTICES.md. No premium extension is used.

API support was deployed before the editor UI. API run ID:
`42c66f08379e4d23baec6f98eba4861e`, using the final candidate hash above.
UI5180 index SHA256:
`87fd5044b61b32c9b4be62676d3ff5b24dcc2df45c3e1a2d1aa42d4ab7924bcb`.
Previous index:
`32c80a0602ab7cdcd60d4a9c8b54dea248a1f87a29030e51f246e3dc4d0512b1`.
Guarded cutover, UI promotion and backups live on E in `api-rollout.json`,
`ui-promotion.json`, `runtime-before/` and `ui-before/`.
Readiness and connection checks do not establish broker execution or sustained
stability. Optional AI/engine resource paths/interpreters were retained; no
inference/provider/research run was submitted for this feature.

No SQL migration is needed. Older API
versions reject structured documents on writes, so after rich notes are saved
an API rollback requires compatibility review. A UI rollback may keep the new API
and plain-text projection. Preserve old hashed UI assets and atomically replace
the entry index when rolling the UI back. Guarded stop must use the current owned
candidate binary paths/hash before starting the saved compatible runtime.
