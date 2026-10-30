# Autosave for note editors

Project shared pattern. `autosave.js` owns the write queue, `useAutosave.jsx`
owns React lifecycle and the common `AutosaveStatus`. Trade drawers and standalone
Live Notes are the initial consumers. This is a project contract; no global
UI-Systems release or consumer migration is implied.

## Interaction and visible states

- Read successfully before enabling edits. Idle empty editors have no saved claim.
- Wait 900ms after typing; flush on blur, hidden page and close. Closing waits for
  the latest edit, including edits made while the first write is in flight.
- Use one writer per resource identity even during panel unmount/remount.
- Show loading, unsaved, saving, saved, invalid, error and revision-conflict states.
  Saved means a validated server response for the current value. Display its
  `updated_at_utc` in Settings timezone, never the browser clock as proof of save.
- Errors retain editable text and a retry action. Conflict preserves the draft;
  loading the server version requires confirmation before replacing local edits.
- Keep an unsaved recovery copy in tab sessionStorage, scoped by workspace and
  resource. It survives reload in that tab; it is not durable server storage.
  Surface storage failure and guard browser unload while unsaved. A user may keep
  a locally retained draft and close after an error; normal close waits for save.
- Preserve keyboard/focus behavior and use live status text. Financial commands,
  account creation and other consequential forms retain explicit submission.

## Persistence adapters

`tradeNoteApi.js` reuses `/api/v2/journal` for Practice and broker trade notes.
Identity includes workspace + source session (Live: `live:<connection_id>`) + trade.
New source kind is `trade-note`, with a composite JSON source ID. Revisions preserve
source, tags and structured payload fields and send `expected_revision`.
Reuse a single matching historical note; ambiguity never silently picks a record.
Trade notes do not become duplicate `live_records` entries in the standalone list.

Trade drawers edit `{text, document}`: `note` remains the plain-text projection for
search and existing readers; optional `note_document` stores the versioned
BlockNote blocks. Old plain notes open as paragraphs without a bulk migration.
Structured loads reject mismatched plain text instead of overwriting saved data.
Compare documents semantically: JSON key order may change in native storage and
must not reset editor selection/history or create another save.
Legacy tab recovery values are upgraded in memory; an unresolved plain-text
request retains its original body and idempotency receipt on retry. Standalone
Live Notes retains its existing editor and persistence contract.
Roll out the API contract before the block-editor UI. No SQL migration is needed,
but older API builds reject `note_document` on writes: after rich notes exist,
rolling back the API requires a compatibility review. A UI rollback can continue
to use the new API and the retained plain-text projection.

`LiveNoteEditor` reuses `liveLedgerApi.js` and `kind: note`, preserving metadata,
account/connection choice, strategy revision and folder on creation. Server-trimmed
titles are reflected in the editor. Both adapters retain existing authorization.

All writes use `scopedMutation` and its idempotency receipts. Unknown outcomes keep
the exact submitted snapshot until resolved; later edits never overtake it. A
lost-response trade note can be reconciled by a scoped read. An unresolved request
older than the 24-hour receipt lifetime is not blindly replayed. A 409 stops the
writer rather than overwriting newer data. Reading a changed recovery base also
requires reconciliation.

Current server contracts require nonempty note content (and a standalone title).
Clearing an existing note therefore retains an invalid local draft and the prior
server version; it never reports a successful empty save. Changing this needs a
separate persistence contract update, not a whitespace placeholder.

## Verification

`tests/autosave.test.mjs` covers serialization, close draining, unknown-outcome
retry, recovery, expired receipts, conflicts and validation/storage failure.
`tests/tradeAutosave.browser.mjs` tests production UI with simulated writes.
`tests/tradeAutosaveNative.browser.mjs` requires a disposable native API/PostgreSQL
endpoint, and verifies create/reload/revise plus workspace and revision isolation.
`tests/noteDocument.test.mjs` covers text projection, legacy recovery and semantic
equality; `tests/noteBlocks.browser.mjs` covers block controls and template insertion.
