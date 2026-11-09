# Trade panel parity — 2026-10-30

## Scope and decisions

- Favorite templates appear once, outside All templates. Apply to opens a context
  menu; This trade inserts the selected document through the existing editor.
- Testing and Live share the note workspace, autosave boundary and SVG note
  presence icons. Unknown presence stays unknown when the journal read fails.
- Before moving to another trade, all registered autosave controllers drain.
  The workspace is inert during this transition. A failed save keeps the current
  selection and draft. Aggregate Testing navigation rereads after saving, then
  verifies the same snapshot across page boundaries; sorting/filter scope stays
  authoritative. Local Testing and Live use their displayed sorted trade order.
- Header trade time and holding duration come from executions, independently of
  autosave state. Save timestamps come from server receipts. Initial save and
  later edit, dirty, saving, failure and conflict retain distinct states.
- Group names open management menus; rename, duplicate, archive, pointer grip
  reorder and keyboard reorder are available. The short placeholder is Add tag.
  Group order is a browser preference. Duplicate atomically clones group/catalog
  labels without changing existing trade assignments. Archive retains history.
  The ungrouped fallback cannot be deleted; renaming it captures currently
  ungrouped catalog labels into a real group.
- Testing has previous/next and a disabled vertical ellipsis. Live adds comments
  and a Delete trade popup. Synced MT5 deletion is deliberately UI-only with its
  confirmation disabled: no unsupported hiding, broker deletion or order action.
- Live details include account identity, actual holding duration, persisted fill
  history and net money/percentage/R. Percentage uses the existing positive
  account baseline; R requires known initial stop distance and closed execution.
  Unknown/open values are not replaced with invented zeroes or denominators.
- Comments use separate scoped journal records (`trade-comment`) and never become
  a trade note. Pending attempts retain their source identity and draft for
  reconciliation after an uncertain receipt. No broker comment is modified.

## Research limits

The owner supplied screenshots informed composition and menus. FX tab control
remained unavailable (`browser.user is unavailable`), so full interactive FX
state parity is not claimed. Official references:

- [FX Replay February updates](https://fxreplay-webflow.fxreplay.app/learn/fx-replay-february-updates)
  confirms merged trades with multiple entries/exits.
- [Journal guide](https://support-ploy.fxreplay.app/articles/tracking-your-trades-with-the-journal-feature)
  provides the journal walkthrough.

FX presentation is not the source of broker calculations or persistence facts.

## Verification

Artifact root: `E:/BACKUP-TRADINGWORKSPACE/trade-panel-parity-20261030/`.

- Native `cargo test --lib trade_labels -- --nocapture`: 5/5 PASS.
- Node note-document/autosave unit tests: 12/12 PASS.
- API release build and Vite production build: PASS.
- `integration-promote/receipt.json` and `browser/report.json`: PASS using the
  actual Rust Router with disposable PostgreSQL, synthetic replay data and stored
  broker snapshots. Includes atomic group capture/duplication, stale CAS rollback,
  tenant isolation, template/media persistence, dirty-note navigation across both
  page boundaries, failed-save/retry, comments with uncertain-receipt recovery,
  comment/note isolation and distinct note icons. No owner writes or broker calls.
- `editor-regression-final/report.json`: PASS for production editor geometry,
  same-block hover/scroll and menus at 1920 dark VI, 1440 light EN and 390 dark VI.
  Drag → Enter → typing → undo/redo is verified at 1920; those drag cases are not
  claimed at the other widths. Journal writes in this check are simulated.
- Independent source review found and prompted fixes for the snapshot changing
  during autosave, editing during async navigation and publishing fresh payload
  before selecting a same-page neighbor. Final review found no remaining concrete
  blocker in those paths, groups or comment/note isolation.
- `deployed-browser-retry/report.json`: PASS on actual UI5180/API8010, both modes
  and all three widths, GET-only. Checks editor/groups/media/template reads,
  aligned seam, apply menu, nested Escape, navigation appearance, Live comments
  and disabled deletion. No page errors, failed feature reads or attempted writes.
  Representative screenshots were visually inspected.
- `git diff --check`: PASS before checkpoint commit.

Failed attempts remain in the artifact root. The first deployed smoke reached an
empty Live view and timed out. A subsequent read returned 28 fills/14 trades and
the unchanged deployed build passed. The initial empty state was not reproduced;
its root cause is unconfirmed, and no restart or data workaround was used.
Fixture attempts also caught incorrect expected create status and a nested test
locator; corrected harnesses were rerun without removing behavior assertions.

## Authorized local rollout

User authorization for API/UI local update and existing MT5 recovery was reused.
No migration was required; the schema18-compatible worker/admin were retained.
Native/compact profile, installed adapters, scientific/codec roots, QDM/artifacts
and the configured AI workflow interpreter were retained.

`api-rollout.json` and `runtime-final.json` record owned process identities and
hashes. Final run ID: `51a1415a23f24d1e98841a639a4964f6`.
API SHA256: `4641881b45daa158e6ca805f992bf4eb9211064ccefd9a3736dab77c66954690`.
`/health` is healthy; snapshot is ready/not stale with 28 fills and no open
positions. The existing demo connection is connected with requested mode retained;
execution capability remains false. No reconnect or broker command was sent.
This is current readiness, not long-duration connection stability.

UI promotion retained branding and old hashed assets and atomically replaced the
indexes. Served index SHA256:
`f64073cdbc29c01c965c75575e4258935fe9ac2e1119c0a3ec5ef1c4403c1bfd`.
Rollback index is under `ui-before-0f16aa937b99/active-index.html` in the artifact
root; the previous schema-compatible API binary remains available as recorded in
`api-rollout.json`. Recheck the fresh owner manifest before future operations.

The first final identity check used CIM's rounded creation timestamp and rejected
the comparison. Exact .NET process start ticks match all three manifest entries;
paths and executable hashes also match. No process was changed by that check.
