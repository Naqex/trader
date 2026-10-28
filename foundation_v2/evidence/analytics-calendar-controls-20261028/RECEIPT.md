# Analytics calendar controls — 2026-10-28

## Delivered scope

- Calendar capital radios are always visible on the right, wrapping naturally on mobile. They affect return (%) only; money and R stay unchanged.
- Current balance uses the same report account snapshot and strict pooled capital calculation as the monthly matrix. It is unavailable without valid source snapshots. This deliberately replaces the calendar's previous day-opening presentation; historical day-opening model fields remain unchanged and unused by this control.
- Return (R) has a noninteractive info glyph in the menu and hover/keyboard help. Daily R sums each trade's original-risk realized R; missing risk stays N/A. Local arithmetic is not a claim of FX backend parity.
- Positive/negative calendar cells use semantic green/red backgrounds and matching borders. Perimeter clipping avoids fake scrollbars; real mobile horizontal scrolling remains.
- Monthly capital radios retain accessible definitions without separate info buttons. Aggregation help remains.
- PnL defaults to Day, including civil date labels for single-day reports. All observations, hour and 15-minute views remain available.

## Verification

- Candidate build: tracked HEAD `15ef3aa2` plus exactly four task source overlays, excluding unrelated dirty files.
- Calendar controls: PASS 7 browser journeys at 1920 dark VI, 1440 light EN and 390 dark VI, including fixtures for initial/current returns, missing snapshot/risk, menu help, month/year, geometry and a read-only real session single-day axis (`05/05`).
- Prop PnL regression: PASS 9 browser journeys.
- Focused model/presentation tests: PASS 24 tests.
- Independent review: scenario_review reported no blockers after checking perimeter geometry and source semantics; no reviewer edits.
- Deployed port 5180: PASS 7 calendar journeys, no page errors or attempted writes. Screenshots inspected.
- First deployed run caught a transient light-theme border mismatch; immediate rerun passed. The geometry test now waits for existing calendar animations to finish before comparing computed colors; the final run passed. Earlier candidate fixture/tooltip harness corrections are retained in the task session history.
- Scoped diff whitespace check passed.

Artifacts: `E:/BACKUP-TRADINGWORKSPACE/calendar-controls-20261028/` (`controls/browser.json`, `prop-pnl/report.json`, `deployed/browser.json`, screenshots, build and promotion metadata).

## Local rollout and rollback

UI-only atomic entry index replacement; old hashed assets and private mutable branding retained. Served SHA256: `db1f2e1df124cdd281c15184f5852ce5ab9e03e0ac051fe42d5b33e80dad3be8`.

Previous entry index: `E:/BACKUP-TRADINGWORKSPACE/calendar-controls-20261028/ui-before-calendar-controls/index.html`. Restore that index atomically into `foundation_v2/web/dist/index.html` to roll back this local promotion.

No API, SQL paging, broker, terminal or database changes.
