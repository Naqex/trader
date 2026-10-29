# Dropdown surfaces and Live balance separator — 2026-10-29

Owner reported that removing dropdown borders did not restore the appearance
before palette migration, and that the line above the Live balance box was missing.
Base source: `47fc4277`. This is a presentation-only change.

## Cause and change

Git comparison against `a13c8921^` shows unchanged menu padding,12px radius and
`0 8px 24px #0003` shadow. The raised surface changed light#FAFAFA→#F0F0F0 and
dark#1D1D1D→#1C1C1C. The latest label picker/editor also used panel surface
(dark#121212), while other menus used the raised surface. Removing borders alone
therefore left inconsistent surfaces.

The product adapter now owns pre-migration menu colors through `--wm-popup`:
dark#1D1D1D/light#FAFAFA. FxSelect, session/account picker and non-tooltip
LegacyPopover use this same background. The label-only panel override is removed.
Outer borders remain0 and shadow is unchanged. Generated palette snapshots and
the rest of the product colors are not rolled back. Keyboard focus, form-field
borders and inner separators retain their own roles.

The Live controls row had no bottom padding, and balance rows only had a bottom
border. Controls now have16px vertical padding; the balance row owns exactly one
top border. The controls row has no bottom border, avoiding a doubled seam.
Data, catalog assignments and account state flow remain unchanged.

## Evidence

Local artifact root: `E:/BACKUP-TRADINGWORKSPACE/menu-surfaces-20261029/`.
Build log: `E:/BACKUP-TRADINGWORKSPACE/menu-surfaces-build-20261029.log`.

- Baseline tests against the previous build failed as expected: popup was
  rgb28 rather than historical rgb29, and balance top border was0px, not1px.
  Reports/screenshots remain in `baseline-menus/` and `baseline-line/`.
- Vite production build PASS; existing large-chunk advisory only.
- `menus/browser.json`: PASS, generic menu/session/FxSelect surface, borderless
  frame, unchanged shadow, search/Escape/focus and sort geometry; desktop dark,
  desktop light and390px light. All writes/external traffic blocked.
- `layout/browser.json`: PASS14, labels/nested editor dark/light/mobile,
  chips/header alignment, shared menu backgrounds and the balance seam.
- `runtime/browser.json`: PASS16 on localhost5180; seven ready Live surfaces at
  desktop dark/mobile light, real read-only labels/menu and balance geometry;
  no JavaScript errors, blocked writes or global horizontal overflow.
- `runtime-menus/browser.json`: PASS; real Replay picker, account menu,
  FxSelect, generic popover, keyboard/search return and Calendar seam regression.
  Served index hash matches the promoted candidate.
- Independent `labels_ui_review` reviewed source/history and candidate dark/light
  screenshots, including nested mobile editor. No remaining findings in scope.
- Product `ui/compact-system.md` records the menu surface and separator ownership.

Only presentation colors are restored; this is not a claim that every pixel of
an earlier product version is restored. Runtime verification is read-only;
fixture mutations are intercepted synthetic requests. No API/terminal restart.

## Rollout and rollback

UI promoted atomically to the intentionally retained runtime checkout at
`projects/mt5-tradingview-backtester/foundation_v2/web/dist`.
Private branding and old hashed assets remain intact.

- Before index: `51c5d4408cbcc9e1083c23c733b707f6e8d40a02e01252f7af32cbda85510e65`
- After / HTTP index: `2d8aa7667455abcb015982e66ede2440d1135f97757af4a8eb1a9e8170f2ebb8`
- Rollback: atomically restore artifact-root `ui-before/index.html` as the runtime
  index; retained hashed assets support both versions.
