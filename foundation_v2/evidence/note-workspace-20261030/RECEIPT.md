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

## Runtime boundary

Source/fixture acceptance precedes local deployment. Migration0018 adds template,
preference and image tables. Runtime rollout must retain native/compact,
installed adapter/capability roots and the existing account mode. The verified
database dump and matching artifact inventory are outside the checkout. A
schema-compatible baseline binary is prepared for rollback without deleting new
data. Current owner processes and deployed evidence are recorded separately
after rollout. No trading command is authorized by this work.
