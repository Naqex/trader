# Standalone Live review notes — 30 October 2026

Candidate accepted by independent source/visual review and disposable native
integration QA. Local API/UI activation is pending the owner's API restart gate.
No owner records, terminal processes, broker requests or active services changed.

## Behavior and state

The 70vw drawer has a full-width title, a review pane on the left and the same
`NoteBlockEditor` used by Practice/Live trade notes on the right. Templates use
the `live-notes` context. The panes scroll independently on desktop and stack
below 680px. Close and note navigation drain the shared autosave queue.

The left pane has a calendar range, its persisted timezone, four built-in note
types, linked closed trades, search and an account-filtered trade picker.
Date changes filter the picker without discarding explicit links. The summary
uses those linked trades: net realized PnL, win rate and trade count. It never
uses the screenshot's numbers or the current balance as historical capital.
Missing/stale sources keep links and propagate N/A; different currencies are
not added. Links identify both the source account and trade, with at most 500.

Rich document, searchable text, review metadata and links use one existing
revision/CAS write. The API validates document/text consistency and ownership
of new manual/broker links. Previously admitted links can survive unavailable
source history. Legacy text notes and local drafts remain supported; an old
unconfirmed request retains its exact wire payload. Setup/focus events that
do not change the document do not trigger saves.

## Evidence

Artifacts: `E:/BACKUP-TRADINGWORKSPACE/live-note-review-20261030/`.

| Check | Result |
| --- | --- |
| Vite production build | PASS, `candidate/` |
| Focused Node tests | 5/5 PASS, summary, unknown/currency/timezone and legacy recovery/document cases |
| Rust live ledger unit tests | 3/3 PASS, document projection, dates, note types and canonical link identities |
| Native release integration | PASS, `qa-release/receipt.json`; owned disposable PostgreSQL |
| Browser interaction/visual | PASS, `qa-release/browser/report.json`; 1920 dark VI, 1440 light EN, 390 dark VI |
| Browser journeys | Rich/template save and reload, nested Escape, date/type/link persistence, failed close/retry, CAS, recovery, legacy open/close without writes, 500 selection cap and Testing editor regression |
| Independent review | PASS; no remaining blocker, including screenshots and final release fixture report |
| Local candidate preflight | PASS, `preflight.json`; exact process ownership/hashes, native/compact capabilities, idle and unresolved-submission checks |
| Local activation | PENDING owner approval; API8010/UI5180 unchanged |

The API candidate is packaged with the existing installed resource roots and
requires no SQL migration. Retained worker/admin/capability settings and the
previous binary are recorded by the scoped preflight/rollout helpers on E.
After structured note writes, rollback needs compatibility review: the older
API cannot accept the new fields. No automatic data downgrade is prepared.

Earlier failed attempts remain on E: a money-format test oracle, stale optional
fields during remote reload (fixed), and a test teardown route race (fixed).
Authenticated FX browser access was unavailable; the UI follows supplied owner
screenshots and the inspected public frontend bundle, not an inferred backend.
