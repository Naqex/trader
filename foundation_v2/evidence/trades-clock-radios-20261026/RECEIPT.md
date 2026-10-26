# Trades: Chart / Realtime radios — 26/10/2026

Owner requested clock selection inside the filter panel. This supersedes the
fixed market-only policy in the previous clock-removal receipt. No toolbar
selector. FX's default date-filter clock remains unverified.

## Behavior and data flow

- Basic drawer begins with native Chart / Realtime radios, default Chart.
- Draft clock previews calendar facets through scoped GET `/api/v2/replay/trades`.
  It does not change applied table data or URL. Abort + basis tagging fence late
  responses. Wrong-clock rows never fill missing calendar facets.
- Pending/error previews disable Apply; errors offer Retry. Apply commits clock,
  base filters and extra filters atomically, resetting page/detail. Escape discards
  the draft. Clear All resets draft Chart; outside Clear filters resets applied Chart.
- Chart uses market close for closed rows, entry for open rows; Realtime uses
  activity timestamps. Calendar filters follow Settings timezone. Missing Realtime
  dates stay unknown. Existing data has no Realtime dates, so date-filter behavior
  there is explicitly limited rather than backfilled from Chart.
- Shared FilterDrawer adds an optional slot; unrelated consumers do not receive it.
  Reusing the existing trades read avoids a second facet endpoint, at the cost of
  one page-sized read when previewing another clock.

## Verification

- Focused model/contract tests: **17/17 PASS**; candidate build PASS.
- Candidate browser: **12/12 PASS**; deployed 5180 browser: **12/12 PASS**.
- Actual read-only journeys: 1920 VI dark, 1366 EN light, 390 VI light, 320 EN dark;
  keyboard radios, preview facets, draft/cancel/Apply/Clear/reload, session scope,
  date/chip filters, Return help, pagination and layout.
- Labeled fixtures: preview error/Retry, held late-response race, empty, unknown,
  partial, denied, error and stale. No page errors or data writes in either run.
- Independent `/root/trades_review`: source/shared consumers and visual PASS;
  preview failure/race evidence accepted, no blockers. Independent model tests3/3 PASS.
- Owner tab refreshed with Basic panel open and Chart selected. Screenshot saved.
- Served UI hash and unchanged API binary/profile/listener identities verified.
  UI-only atomic promotion retains old assets/private branding and a rollback.
  No API/terminal restart or external FX changes.

## Reusable evidence

`E:/BACKUP-TRADINGWORKSPACE/trades-clock-radios-20261026/` contains build source
snapshot/hashes, logs, `preview-qa/`, `deployed-qa/`, independent `review.json`,
`promotion.json`, `final-verification.json`, `owner-panel.png`, rollback
`ui-before-release/` and `RESUME.md`. Services remain independent of this chat.

Current contract: `ui/display-conventions.md`; reference history:
`ui/references/fxreplay/testing-trades.md` §8. This is scoped Trades UI acceptance,
not whole-product, broker or FX backend parity acceptance.

## Owner layout follow-up

Centered the legend and radio pair; Vietnamese legend is now **Thời gian áp dụng
bộ lọc**. CSS/copy only, behavior unchanged. Build and independent visual review
PASS; focused candidate/deployed checks3/3 PASS at1920 VI,320 VI,320 EN, including
measured centering and no overflow. Served hash verified; owner tab refreshed.
Evidence/snapshot/rollback: `E:/BACKUP-TRADINGWORKSPACE/trades-clock-centered-20261026/`.
