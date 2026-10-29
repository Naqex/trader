# Live layout and shared label menus — 2026-10-29

Scope: owner browser comments on Live pane separators, spacing across Live tabs,
transparent table-label hover, and the reference label picker/editor. Base:
`22953e05`; source is `foundation_v2/web/`, contract is `ui/compact-system.md`.

## Findings and implementation

- Baseline rendered Trades filter was 76px vs sidebar69px; Calendar was69px on
  both sides. Trades used a pseudo separator, Calendar a border. Full-bleed
  toolbars now share inset/height tokens and a single1px separator. Desktop
  panes share grid rows through subgrid, so chips/wrapping stretch both headers.
- Account pagination had20px padding vs shared16px vertical/32px horizontal;
  remove its override. Reset the default h2 margin in Live toolbar headings.
  Analytics reports and overview retain their content-inset roles shared with
  Practice rather than acquiring a new full-bleed toolbar.
- Live and Practice keep the shared catalog, assignment revisions and mutations.
  The shared cell has transparent hover; picker lists badges above search/create.
  Three dots open an adjacent editor with name, seven solid color swatches and
  confirmed deletion. Enter saves name; choosing color saves immediately with
  current name. Escape/outside discards an unsaved name draft.
- Nested portals retain parent ownership for outside/focus checks, without
  mounting inside the parent scroll container. Escape returns focus one level.
  Revision conflicts close the editor and refresh rather than overwrite.
- Six-dot grips match the reference presentation; reordering is not implemented.

## Verification

Local artifacts: `E:/BACKUP-TRADINGWORKSPACE/live-layout-labels-20261029/`.
Screenshots and synthetic fixtures stay there; no account/label exports added.

| Evidence | Result / scope |
| --- | --- |
| `../live-layout-labels-build-r5.log` | Vite build PASS; existing large-chunk advisory |
| `browser-final/browser.json` | PASS14 checks;1920dark/light,1241dark,390light; alignment with/without chips, transparent hover, solid swatches, editor fit, synthetic mutations,409, Escape and focus |
| `boundaries-r5/browser.json` | PASS; generic menu/search Escape and centered sort regressions, dark/light/mobile; all writes blocked |
| `calendar-r4/browser.json` | PASS7 cases; Calendar colored edges/hover/rows; same final layout source |
| `labels-r4/browser.json` | PASS; shared catalog CRUD/assignment across settings and Live; synthetic writes only |
| `reviewer-empty/` | Independent reviewer: empty Trades/Calendar controls and content visible; no clipping/page errors |
| `runtime-r4/browser.json` | PASS16 checks; seven Live tabs,1920dark/390light, ready surfaces before screenshots; no global overflow, page errors or writes |
| `promotion.json` | Atomic UI promotion and rollback backup; served index SHA verified |

Independent review by `labels_ui_review` closed after inspecting final R5 light
desktop/mobile: no remaining blocker in this slice. Initial light swatches were
too pale; final selector prevents badge-theme background from overriding them.
An earlier focus effect stole focus from the three-dot trigger; final effect
only focuses when opening an editor. Earlier failed reports are retained.

Runtime evidence correction: the first sweep captured lazy-loading placeholders
on some ancillary tabs. It is superseded by `runtime-r4`, which waits for each
actual surface. `runtime-r2` measured two nodes across separate render frames;
final geometry is measured atomically. `runtime-r3` used the chart-workspace
selector for the overview URL; corrected to the rendered overview charts.
These failures are not counted as acceptance.

`controlRefinement.browser.mjs` selectors were updated for the new nested editor;
its disposable Rust/PostgreSQL integration bridge was not run in this slice.
Stateful UI fixtures and existing shared-label browser coverage passed instead.

## UI rollout

The running service retains its intentionally old physical checkout path:
`projects/mt5-tradingview-backtester/foundation_v2/web/dist`.
No API or terminal restart, broker mutation, or public release was performed.
Private branding and existing hashed assets were preserved for open tabs.

- Before index SHA256: `8de4a8a0cce8afe26f0217af1b185276a09c98ccf36184bd946fd5315f6d399a`
- After / HTTP-served SHA256: `51c5d4408cbcc9e1083c23c733b707f6e8d40a02e01252f7af32cbda85510e65`
- Backup: artifact root `ui-before/index.html`; rollback is atomic replacement
  of the current index with this saved index while retaining hashed assets.

This receipt accepts the scoped UI changes, not whole-product/broker acceptance.
