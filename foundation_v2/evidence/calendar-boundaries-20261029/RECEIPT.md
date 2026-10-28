# Live calendar boundaries and alignment — 29/10/2026

## Scope

UI-only change for the Live calendar. Empty weekly/monthly summaries display
`0 giao dịch` and `$0`; day-level unavailable values retain coverage semantics,
and percentage mode remains `N/A` without valid opening capital. No financial
calculation, API, broker or terminal change.

The previous line issue was reproduced with a GET-only fixture and pixel probe:
state/hover pseudo borders were painted inside an existing top/left border, and
negative insets extended across neighboring cells. The fix uses one physical
border owner per seam. Internal seams use the cell top/left edge; the shell,
sidebar and month footer own exterior edges. Tone and hover recolor that edge;
no pseudo painter, negative inset, box-shadow or second adjacent border remains.

Shared icon/text controls use an inline-flex alignment box with centered SVG
geometry. The project contract records the 4/8px keyline, text-baseline and
optical-balance rules in `ui/display-conventions.md`; the shared architecture
rule is in `UI-Systems/docs/ARCHITECTURE.md`. The QA skill now requires ordinary
and hover seam pixel checks, outer-edge checks, and icon/text alignment checks.

## Verification

Candidate index: `66fd81ffba86bc52f179b5b123a52b6a7f048d7e338b4977d02450c1abc739fd`.
Independent review: `review.md`, PASS. Source overlays and transformed chart
asset were hash verified. Independent candidate checks: calendar 7/7, partial
4/4, palette 4/4, plus three future-month null-summary cases and pixel scans.

Served localhost:5180 checks after promotion: calendar 7/7, partial 4/4,
palette 4/4; no page errors or mutation attempts. Empty-summary probe passed:
weekly and monthly totals render `0 giao dịch` and `$0`.

Promotion: `promotion.json`, PASS. UI-only atomic index replacement; API/UI
processes retained. Previous index and preserved mutable assets retained for
rollback. Rollback index: `E:/BACKUP-TRADINGWORKSPACE/calendar-boundaries-20261029/verified-ui-before/index.html`.
Previous index SHA256: `86eccb94ad821c5b925a4f17241ed3c6d52d085fea712d0167dd53c3e43f2484`.

## Limits

Fixture API routes are labeled local fixtures and external/broker paths are
blocked. This receipt does not claim backend formula parity, broker behavior,
or whole-product acceptance.