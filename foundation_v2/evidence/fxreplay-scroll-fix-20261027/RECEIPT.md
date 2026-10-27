# Analytics nested-scroll fix — 27/10/2026

Status: **PASS** for the owner-reported analytics layout slice on localhost `5180`.

## Changed

- Removed the month matrix inner horizontal scroll and its width expansion (`min-width: 1040px`, negative margin and `width: calc(...)`). The matrix now stays inside the report width.
- Added a responsive three-column month grid at widths up to `850px`, so month values remain readable without a nested horizontal scrollbar.
- Stretched the Buy/Sell cards in “Hiệu suất theo hướng lệnh” to fill the section body on desktop. Their bottom edges now align with the adjacent session-performance panel; mobile stacking remains unchanged.

## Verification

- Candidate Vite build: **PASS**.
- Analytics/model regression suite: **110 tests PASS**.
- Deployed Playwright QA on `5180`: **PASS** at `1920`, `1440`, `1200`, `1000`, `768` and `390`.
- At every viewport: document, `.fx-content` and `.fxa-month-scroll` have no horizontal overflow; the month matrix has `scrollWidth === clientWidth`; no page errors were observed.
- At `1920` and `1440`: the side panel and session panel share the same bottom edge; Buy/Sell cards fill the side panel body.
- The existing horizontal scroll owners for the primary sub-navigation and the seven-column calendar remain scoped to those controls; no analytics month matrix scroll remains.
- Served index SHA256: `7d719f32b15d96bf451087f698aaf926d795a291f9aa034efb39206e444d8b39`.

Promotion was UI-only and atomic. The API/UI process was not restarted and the original FX Replay tab was not refreshed or navigated. Rollback index: `E:/BACKUP-TRADINGWORKSPACE/fxreplay-scroll-fix-20261027/ui-before-release/index.html`.

## Follow-up: document-level vertical scroll lock

The remaining double-scroll case came from the document viewport still being
scrollable while `.fx-content` owned the route content scroll. The shell now
locks `html`, `body` and `#root`; `.fx-content` remains the only scroll owner.

- Local demo browser check on `5180`: **PASS** at `1920`, `1440` and `390`.
- Computed overflow at each viewport: document roots `hidden`, `.fx-content`
  `auto`; no second scrollable root was present.
- The existing synthetic acceptance runner could not reach its first fixture
  assertion because the configured API did not expose its expected `60 trade
  đóng` seed; this is separate from the scroll check.
