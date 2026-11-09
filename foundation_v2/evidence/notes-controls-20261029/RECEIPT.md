# Live Notes controls — 29/10/2026

## Scope and behavior

- Account/session selectors reuse `SelectChevron` and `.fx-select-check` from
  `FxSelect`. The domain-specific single/multiple selection behavior stays in
  `SessionFilter`. Browser checks compare rendered check color and chevron
  color/stroke/open rotation with the standard select.
- Notes toolbar has no account picker. Notes reads all journal notes in the
  workspace. Account selection is an explicit drawer filter; new notes default
  to General and existing notes retain their saved account/connection.
- The pen menu exposes Trades, Win rate, PnL and Content. Content toggles the
  preview. The first three remain disabled with an explanation because the
  note schema does not link trades; no statistics are inferred from tags.
- Group by is muted text with transparent background.
- Filters opens the existing native right drawer, including focus return and
  keyboard tab navigation. Basic filters account/updated date; Tags uses the
  extracted `TagFilterControls` shared with the Practice/Live ledger. Tag facets
  come from actual notes. Include/Exclude retain AND/OR and comma-safe encoding.
  Dates use the selected timezone; Apply commits draft, Escape cancels it.

## Authorized data cleanup

The owner explicitly chose deletion of the single QA demo note. A private JSON
backup of its database record, full revision history and API record was saved
outside Git before the scoped transaction removed one note and one revision.
The API confirmed absence and byte-equivalent non-target records afterwards.

The first attempt stopped with `UndefinedTable` against the base DSN, before
backup or writes. The owned supervisor command identified the explicit runtime
database. The second attempt verified exact workspace/id/title/revision and
API/DB payload equality before backup and deletion. No schema change, API or
terminal restart, broker write or other record deletion occurred.

Private backup: `E:/BACKUP-TRADINGWORKSPACE/notes-controls-20261029/authorized-qa-note.private.json`.
Backup SHA256: `d3fc7aa8bec36d82824708ac998db7f282d420a4c24e66e89790d92477c832e2`.

## Verification

Local evidence root: `E:/BACKUP-TRADINGWORKSPACE/notes-controls-20261029/`.

| Evidence | Result and limit |
| --- | --- |
| Production build | PASS; existing Vite chunk-size warning remains |
| Note/ledger model tests | 19/19 PASS; account/general mapping, local dates, missing dates, search, Include/Exclude AND/OR and comma tags |
| `liveNotesLayout.browser.mjs` | 10 cases PASS; synthetic GET fixtures at 1920 dark VI, 1440 light EN, 390 dark VI; empty/demo, create-dialog opening, content toggle, search, pagination, draft cancel/apply, responsive drawer, keyboard, unavailable/retry |
| `liveLedgerFilters.browser.mjs` | PASS at 1920/1440/390; shared tag extraction retains actual filtering and Practice parity |
| `uiBoundaries.browser.mjs` | Fixture + real runtime PASS; standard/account chevron and check parity, existing menu surfaces and keyboard behavior |
| `liveNotesRuntime.browser.mjs` | Real localhost5180 PASS after cleanup; empty Notes, no account picker, field menu and right Tags drawer; GET-only, zero page errors/writes |
| Independent review | `/root/labels_ui_review`: source and rendered Notes reviewed; no blocker. EN accessibility copy added after review. Notes tag facets are notes data, not the Practice catalog. |
| Diff check | PASS |

An initially run old `live-workspace.test.mjs` reports 1 PASS / 2 FAIL because its
source-string assertions expect the status-reader implementation to be inline
in `LiveWorkspace.jsx`. A repeat against the unchanged HEAD files reproduces
the same failures (`baseline-tests.log`); this task does not claim that suite
passes. The initial ledger browser run also failed an obsolete pseudo-element
offset assertion. The current layout deliberately disables that pseudo-line;
the test now verifies no pseudo-line and exactly one real bottom border, then
the full browser journey passes. Original failure reports remain in the local
evidence root.

## Local rollout

The UI-only helper verified passing focused receipts, asset collisions and the
current served index. It retained old hashed assets and private branding,
preserved the previous index, then atomically replaced the index. The physical
runtime dist remains in the historical checkout path; source changes belong to
`projects/trader`. No packaging or external deployment was performed.

- Before index SHA256: `2d8aa7667455abcb015982e66ede2440d1135f97757af4a8eb1a9e8170f2ebb8`.
- Candidate/served index SHA256: `83a1c79bba38aa45189259e326e379ce8afd64f86e208537adb845d5dab160db`.
- Rollback index: `E:/BACKUP-TRADINGWORKSPACE/notes-controls-20261029/ui-before/index.html`.

These results accept this Notes/control slice, not full product/broker acceptance.
