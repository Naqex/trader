# Palette migration — 2026-10-28

Status: candidate validation PASS; local UI promotion and deployed checks PASS.

## Scope and state flow

Owner approved the saturated palette proposal and frequency-heading alignment.
WMREPLAY explicitly pins annam-compact 0.2.0. Shared JSON tokens generate the
project palette snapshot; CSS aliases feed existing controls, reports and tags.
The native iframe has a matching adapter; candle colors remain distinct from UI
status roles. Existing 0.1.x releases and other consumers are unchanged.

Changed canvas/surfaces/text, green/red status roles, blue focus, orange emphasis,
hover/selected states, essential borders and report series. Solid green/red labels
use a paired foreground (dark ink in dark mode, white in light mode). Calendar
fills are 22% dark / 10% light to keep small text readable. Scenario series use
theme-aware colors and dash patterns. Three frequency headings stretch across
their cards: title left and average right, with equal 16px content insets.

No financial calculation, API, database, SQL paging or broker behavior changed.

## Evidence

Artifacts: `E:/BACKUP-TRADINGWORKSPACE/palette-migration-20261028/`.
Proposal/audit: `E:/BACKUP-TRADINGWORKSPACE/palette-audit-20261028/`.

- Scoped production build PASS: tracked HEAD `ef10a161` plus intentional palette
  overlays only. Unrelated ReplayWorkspace, learnIntegration, visual-polish,
  API script and existing evidence changes were excluded.
- State / keyboard / theme / contrast: `palette/browser.json`, PASS 4 journeys,
  dark/light at 1920 and 390px. Actual control hover, keyboard focus, disabled and
  selected states; rendered trade badge/tag colors; three heading geometries;
  both demo scenario charts, four dash styles and add-button hover. Sampled normal
  token text pairs >=4.74:1 and essential border >=3:1. No page errors or writes.
- Calendar controls: `calendar/browser.json`, PASS 7 journeys, including real
  read-only Session and labeled demo. No page errors or writes.
- Prop PnL: `prop-pnl/report.json`, PASS 9 journeys; solid threshold labels,
  paired foregrounds, connected geometry, theme and responsive checks.
- Monte Carlo: `monte-carlo/report.json`, PASS 4 local demo journeys across
  Sessions/Prop, desktop dark/mobile light; distinct series colors, empty state,
  run/reset, tab persistence and ruin behavior. No API/broker writes.
- Native chart: `native-palette/browser.json`, PASS 4 synthetic replay journeys,
  dark/light at 1440 and 390px, real vendor renderer. Pixel checks confirm the
  actual canvas/grid/candle palette, screenshots confirm axes/chrome. All API
  requests intercepted; no backend/broker orders. Reproduction scripts are
  `probe-native.py` and `native-palette.py` in the artifact directory.
- Focused presentation/calendar-return/frequency unit tests: PASS 29 tests.
- Independent palette review: no remaining blockers. Reviewed final source and
  directly rendered Prop dark/light threshold/donut labels and heading alignment.
- Representative screenshots reviewed: controls, trade grid, frequency, native
  chart and scenario views, including light/dark and narrow layouts.

## Failed attempts and limits

The old broad compact harness failed on its outdated select-all accessible name,
then on an existing dialog-focus assertion after a temporary harness adjustment.
Those harness edits were reverted; this is not counted as a pass. The new focused
palette test verifies the affected real state/keyboard/contrast behavior.

The broad native harness initially failed to load the vendor because candidate
preview used a nonexistent `foundation_v2/static` directory. Baseline 5180 was
ready. Correcting the preview-only vendor root to the existing product
`static/charting_library` restored readiness; the focused 4-case pixel/visual
check then passed. Broad legacy native interaction acceptance is not claimed.

These checks cover the changed palette consumers, not whole-product WCAG, native
browser zoom, canonical golden approval, long-duration stability or broker
acceptance. Disabled controls intentionally retain disabled opacity.

## Build and rollback

- Token source SHA256:
  `86043801286fcef39be02443c0d2f1c74d73e5f115c4fa14665f5f9c74c829ba`.
- Candidate index SHA256:
  `3387f61796c0dd1e0c5fbf0b05dcbe3782af9f813e7f2870e0260aa826d05d2d`.
- Palette asset: `assets/project-palette-4ed40c102d752c45.css`.
- Palette SHA256:
  `4ed40c102d752c454dd384454a142834859571bde1c258a53476655ba98f480e`.
- Previous index SHA256:
  `db1f2e1df124cdd281c15184f5852ce5ab9e03e0ac051fe42d5b33e80dad3be8`.

Promotion preserves old hashed assets, mutable root palette, private branding and
legacy vendor CSS. Only the entry index changes atomically; active UI/API processes
and data stay in place. Rollback restores the saved previous index atomically.
Rollback index:
`E:/BACKUP-TRADINGWORKSPACE/palette-migration-20261028/ui-before-palette/index.html`.

`promotion.json` records a PASS for the served 5180 index and hashed palette, both
matching the candidate hashes above. Private/mutable assets remained byte-identical.
`deployed/browser.json` records another PASS 4 state/keyboard/theme/contrast,
frequency-heading and scenario journeys at 1920/390 on the actual 5180 runtime,
with zero page errors or writes. No API/terminal restart was needed.

UI registry check: PASS, 3 pins across 2 consumers, zero errors; other consumer
pins unchanged. Scoped diff check and 29 focused unit tests PASS. Previous failed
broad-harness attempts remain recorded above and are not included in pass counts.
