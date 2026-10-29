# Label picker interaction/design-system correction — 29/10/2026

## Changes

- Removed row hover and the stretched assignment button. Only the small colored
  badge toggles a label; whitespace is inert. Live now uses the shared default
  placeholder `Chọn nhãn…`, retaining the existing hover/focus reveal behavior.
- Replaced decorative grip SVG with the existing chart `ChartIcon` grip. Pointer
  capture supports mouse/touch; Alt+Up/Down reorders by keyboard. Focus remains on
  the grip for repeated moves. Escape cancels a drag without assigning/reordering
  or closing the picker.
- Order is a browser display preference keyed by workspace and stable label IDs.
  `useTradeLabels` applies it to shared consumers; storage/custom events keep
  mounted consumers in sync. Reload retains it, new IDs append, removed IDs are
  ignored. It does not update server catalog/assignments or sync across devices.
  Storage failure keeps the current view with an explicit session-only notice.
- Selection marks in the picker and color editor reuse `.fx-select-check`.
  The delete separator belongs to a noninteractive wrapper; the rounded hover
  target sits below it and uses the standard menu hover token with danger text.
- Updated `ui/compact-system.md`; no shared global token version changed.

## Evidence

Local evidence root: `E:/BACKUP-TRADINGWORKSPACE/label-picker-20261029/`.

| Check | Result |
| --- | --- |
| Production build | PASS; existing Vite chunk-size warning retained |
| `tradeLabelOrder.test.mjs` | 2/2 PASS; missing/duplicate/new IDs and moves in both directions without definition mutation |
| `liveLayoutLabels.browser.mjs` fixture | 14 checks PASS, desktop1920 dark/light,1241 dark,390 light; exact small hitbox, inert whitespace, pointer/keyboard reorder, reload, Escape cancel, storage denial/recovery, actual CDP touch drag at390; nested editor rename/color/assignment/conflict/confirmation/focus, boundaries and menu colors |
| `sharedTradeLabels.browser.mjs` | PASS; existing catalog/settings CRUD, account isolation, assignments/reload and archived-history semantics preserved with synthetic writes intercepted |
| Independent review | `/root/labels_ui_review` reviewed source and R2 dark desktop/light mobile screenshots; no remaining blocker in this slice |
| Real localhost5180 | 16 checks PASS at1920 dark/390 light; GET-only popup/editor/hover/checkbox checks and Live navigation, zero page errors/blocked writes; no real label mutations |

The initial cancel-drag browser run failed: the global tooltip consumed Escape
in document capture before the grip handler. The diagnostic rerun verified the
key target was the grip; suppressing tooltip metadata only during drag removed
that conflict. Alt+arrows uses capture on the grip to precede native popover
navigation. Temporary diagnostics were removed; `picker-final/browser.json`
passes with zero page errors/blocked writes. Initial failure evidence remains
under `picker/` and `picker-debug/`, not relabeled as success.

UI promotion and real GET-only runtime evidence are recorded in `promotion.json`
and `runtime/browser.json` at the local evidence root. The rollout retains the
previous served index, old hashed assets and private branding. No API/terminal
restart, broker operation, user label write or server schema change is needed.
This receipt accepts this UI slice, not whole-product/broker acceptance.

Served index SHA256 after promotion:
`0d423e98e9839760b78ce764af63d0d61df402c571a3da2c587b2b5c1ac62f76`.
Previous index SHA256:
`83a1c79bba38aa45189259e326e379ce8afd64f86e208537adb845d5dab160db`.
Rollback index: `E:/BACKUP-TRADINGWORKSPACE/label-picker-20261029/ui-before/index.html`.
