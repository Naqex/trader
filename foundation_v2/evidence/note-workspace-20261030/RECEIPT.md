# Trade note workspace — 2026-10-30

## Implemented scope

- BlockNote 0.55 leaves a NodeSelection after dragging. Enter now inserts through
  BlockNote's block transaction API before its invalid bare-paragraph shortcut.
  Drag → Enter → type → undo/redo preserves content and a valid document.
- Shared trade detail panes support pointer and keyboard resizing. The persisted
  ratio is a browser display preference; no trade values are changed.
- Testing/live trades reuse the existing label catalog, group and assignment API.
  Creating a label retains focus inside its popup so Escape cannot close the trade.
- Trade media supports PNG/JPEG/WebP/GIF screenshots, preview and deletion. Native
  ownership validation uses persisted replay trades or stored broker snapshots;
  these operations do not poll a terminal. Limits: 5 MiB/image, 50/trade,
  200 MiB/workspace; signature/MIME checks, digest deduplication and scoped reads.
- Templates use the existing editor, scoped mutation/idempotency and autosave.
  Built-ins are localized and immutable; duplicate them to edit. Custom templates
  support creation, rename, content editing and deletion. Favorites and defaults
  are private to workspace + authenticated subject. Defaults are independent for
  Testing Trades, Live Trades and Live Notes. Deletion clears matching defaults
  and favorites transactionally. Existing Live Notes receive a plain-text
  projection because that form still stores plain text.
- The templates search and metadata share one grid row and one continuous seam.
  Template/palette, lock, star, duplicate, delete and chevrons reuse SVG icons.
  Sharing remains outside this task.

## Research

[FX Replay's journal guide](https://support-ploy.fxreplay.app/articles/tracking-your-trades-with-the-journal-feature)
describes per-trade screenshots, tag groups, locked built-in templates,
duplicate-to-edit and three independent default contexts. Browser tab control was
unavailable (`browser.user is unavailable`); no claim of full interactive FX
parity. The supplied crop confirmed the misaligned seam.

## Verification

Artifacts: `E:/BACKUP-TRADINGWORKSPACE/note-workspace-20261030/`.

- Node note-document/autosave tests: 12/12 PASS.
- Native command ownership tests: 4/4 PASS.
- `native-17/receipt.json`: real isolated Rust Router/PostgreSQL template CRUD,
  revisions/CAS, idempotency, workspace/subject isolation, defaults, deletion
  cleanup, invalid documents, media signatures/size/digest/read/delete and stored
  broker snapshot ownership. Replay revision and broker snapshot stay unchanged.
- `native-candidate/receipt.json`: the same native fixture plus production-build
  browser journeys at 1920 dark VI, 1440 light EN and 390 dark VI. Includes new
  template, duplicate while dirty, favorites, all three defaults, apply, delete,
  tag-group creation/assignment, image preview/deletion and 503 recovery.
- `editor-candidate-2/report.json`: production editor, drag/Enter/undo/redo,
  side-control geometry, same-block hover/scroll, menus/Escape and structured
  autosave reload at three widths. Journal writes are intercepted fixture writes.
- Independent source review found no additional material defect in the keyboard
  fix, native library/media ownership or sidebar resizing. Review requested and
  confirmed stricter malformed-document guards and dirty-template duplication.

Failed attempts are retained. They exposed a queued-tooltip Escape interception
and label-creation focus loss, both fixed; test harness fixes included excluding
buffered SSE, awaiting label assignment and draining route callbacks on teardown.
An editor harness assumed its long block was the last block; it now targets the
actual inserted long text. No assertion was removed for these fixes.

## Local rollout and recovery

Implementation commit: `02e01170`. Final fixture:
`native-candidate-final/receipt.json` PASS. Migration0018 adds template,
preference and image tables. The verified dump and matching artifact inventory
(4,142 files) are retained outside the checkout. Native/compact, installed
adapter/scientific/codec roots, QDM and AI workflow interpreter are retained.

The first startup failed because the retained older research worker rejected
migration18. The schema-compatible API fallback also could not start with that
same worker. Both failures remain in the logs; neither restored/deleted user
data. Recovery built the matching research worker from the same scoped source,
verified the stopped owner, then started API + worker with the existing settings.
`api-rollout.json` records the successful recovery and exact owned hashes.

Local process run ID: `ff0e0ec8d5cd4bd7b75815f51d1474d3`.
`recovery-preflight.log` confirms18 migrations, no pending migration and idle
runtime. Both the new API and schema-compatible baseline API require the new
schema-compatible worker; an arbitrary old binary is not a rollback option.
The private `recover-local.py` and retained launch arguments are in the artifact
root. Review fresh owner identity before any later stop/start.

UI assets were collision checked; old hashed assets and private branding retained;
the index was replaced atomically and verified against5180. Separate active and
checkout index backups are retained. `ui-promotion.json` owns deployed hashes.

`deployed-browser/report.json` PASS: real UI5180/API8010, Testing + Live, 1920 dark
VI /1440 light EN /390 dark VI. Editor, tag groups, media reads, private template
library, aligned seam, nested Escape and no horizontal overflow; no page errors,
failed feature API reads or attempted writes. A screenshot caught a grid-only
hidden placeholder style leaking into the group panel; the panel now explicitly
keeps its add-tag placeholder visible.

`mt5-status.json`: the existing connection automatically returned to connected,
with the same requested mode. No explicit reconnect or trading command was sent.
This verifies current recovery, not long-duration broker stability. CRUD writes
were verified on disposable PostgreSQL; deployed browser QA is read-only.

Open GitHub issues in `Naqex/workspace` and PRs in `Naqex/trader` were empty at
the final task check. This task did not merge unrelated branch history.
