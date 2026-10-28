# Neutral palette and calendar seams — 28/10/2026

Owner approved the neutral black/fresh orange proposal and requested Live calendar
hover/separator repairs and a colored month-total border. Scope is visual and copy;
no financial model or API/broker operation changes.

Candidate: `annam-compact@0.3.0`; generated snapshot and explicit consumer pin.
Source SHA256: `1d7675bc71a06c14e5d636ce96e78dc596afd94a72abc77d8cf39123c3113a71`.

## Changes and ownership

- Neutral black/gray dark surfaces; fresh orange actions with dark ink in both
  themes. Financial green/red, blue focus, yellow warnings and chart comparisons
  retain distinct roles. Disabled controls use explicit gray instead of whole-box
  opacity. Light trading badges use a lighter tint to keep small text readable.
- Live calendar row tracks own sizing; all eight cells stretch to the same row.
  Only outside-month text is muted, so structural lines remain continuous.
  Hover/tone overlays cover the existing seams; the orange month strip owns the
  bottom boundary. Shared rules are in `ui/display-conventions.md`.
- Native iframe palette mirrors shared roles through its adapter; candle/order
  roles remain unchanged. Journal is translated through the existing copy map.

## Focused validation

Candidate index: `86eccb94ad821c5b925a4f17241ed3c6d52d085fea712d0167dd53c3e43f2484`.
Scoped build uses product HEAD `0646860e` plus the intentional overlays recorded
in `scoped-build.json`; unrelated dirty source is excluded.

Evidence root: `E:/BACKUP-TRADINGWORKSPACE/palette-calendar-20261028/`.

- `calendar/browser.json`: PASS 7 light/dark/responsive geometry, hover, focus,
  outside-month, month-border and drawer journeys; includes 4/6-week months.
- `palette/browser.json`: PASS 4 state/keyboard/contrast journeys at 1920/390px,
  including real read-only Session analytics and labeled demo chart series.
- `behavior/report.json`: PASS 4 Live fixture journeys for partial/unknown/zero,
  percentage capital availability and draft note behavior.
- `corners/browser.json`: PASS 3 passive Analytics corner regressions.
- `boundary.json`: PASS pinned native adapter values, unchanged candle/order
  roles, rendered Vietnamese Journal label and hashed CSS HTTP checks.
- Reviewed dark desktop, light desktop seam and light mobile screenshots.

Fixture QA is labeled separately from actual read-only Session checks; external
and broker calls/writes are blocked in the new suites. Native checks cover the
palette/asset boundary, not full native chart interaction acceptance. No whole
product or production acceptance is claimed.

## Review and local rollout

Independent [review](review.md): PASS. Reviewer verified all 11 overlay hashes,
the exact native CSS URL build transform, screenshots and HTTP asset hashes;
independently reran calendar 7/7 and palette 4/4.

Design registry check: zero errors; old token versions retain their original
bytes and other consumers retain their pins.

[Promotion receipt](promotion.json): PASS. UI-only atomic index replacement on
localhost:5180; old hashed assets and private/mutable files retained. No active
API/UI process restart. Both calendar 7/7 and palette 4/4 passed again on the
served index, with no page errors or writes. Reports: `deployed-calendar/browser.json`
and `deployed-palette/browser.json` under the evidence root above.

Rollback index: `E:/BACKUP-TRADINGWORKSPACE/palette-calendar-20261028/verified-ui-before/index.html`.
Restore it by staging a copy beside `foundation_v2/web/dist/index.html` and
atomically replacing that index; retained assets keep the previous UI usable.
Previous index SHA256: `28b610a4c7ec9c6cb588f755f7ee59b669900d36f1976da3a664dfb1c6ebcc28`.
