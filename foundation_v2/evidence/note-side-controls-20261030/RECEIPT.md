# Note side controls — 30/10/2026

Scoped UI acceptance and local promotion for product commit `3673d043`.

## Changed behavior and cause

- Baseline: controls computed 20×36px despite a 24px height rule because global
  button min-height remained active. Their 24px SVGs were compressed to 20×24px;
  the 40px control group exceeded the editor's 32px gutter.
- Idle hover itself remained visible in the baseline. A real 1px ancestor scroll
  with the pointer still on the same block dismissed it. The installed SideMenu
  controller explicitly hides on ancestor scroll rather than only repositioning.
- Controls now use 24px square targets, 20px square SVGs, first-line alignment,
  physical-pixel coordinate rounding and a dedicated 56px gutter. The plus uses
  shared ChartIcon and handles click/Enter/Space on the whole button; BlockNote's
  public side-menu, suggestion and drag APIs still own editing behavior.
- FloatingUI autoUpdate and reference clipping remain active. Small scrolls no
  longer dismiss controls; moving to another block updates the active anchor.
  This avoids globally freezing the menu or patching dependency files.
- Escape checks actual suggestion state rather than hidden listbox DOM. Native
  BlockNote Escape still blurs text before dialog dismissal.

Persistence flow remains `{text, document}` → shared autosave → existing scoped
journal adapter. No API, storage contract, dependency or MT5 operation changed.

## Verification

Artifacts: `E:/BACKUP-TRADINGWORKSPACE/note-side-controls-20261030/`.

- Production build PASS. Existing bundle-size warning retained; no limit raised.
- `noteBlocks.browser.mjs`: PASS at 1920 dark, 1440 light (DPR1.25), 390 dark.
  Paragraph/heading alignment <1px; square SVGs; same-block idle hover and 1px
  scroll; plus edge click/Enter/Space; desktop drag reorder; templates; structured
  save/reload; keyboard dismissal. Journal writes are simulated, owner GETs real.
- 12 autosave/document unit tests PASS. No new native persistence claim.
- Candidate and deployed GET-only browser checks PASS for both Practice and Live
  at all three widths, actual journal reads, no page errors or attempted writes.
- Independent agent reviewed exact `3673d043`, source, report and screenshots:
  accepted scoped UI change; original plus hit-box finding resolved.

Earlier failed runs remain in `controls*` reports. They exposed a viewport/relative
coordinate mismatch (fixed), an invalid test note over the 10,000-character limit
(fixture corrected), and confusion between editor blur and native dialog Escape
(test now focuses the header for native dialog close).

## Local rollout

UI5180 index SHA256:

- Before: `87fd5044b61b32c9b4be62676d3ff5b24dcc2df45c3e1a2d1aa42d4ab7924bcb`
- After: `2fff7470371d8401a35737d0eaffd32d52af47a9553bbec37108fef000b59e74`

Promotion checked candidate/review reports and unchanged active index, copied
collision-checked assets, retained prior hashed assets/private branding and
atomically replaced both checkout/runtime indices. Served hash verified.
Rollback index: artifact root `ui-before/active-index.html`. API not restarted.

## Remaining limit

Immediate Enter on a drag-created NodeSelection can raise the installed upstream
`nodeSelectionKeyboard` Position-out-of-range error. This separate sequence is
not accepted here. The final drag→click text→type journey passes. Keep this finding
when evaluating further editor keyboard work; these controls do not establish
arbitrary post-drag keyboard acceptance or whole-product completion.
