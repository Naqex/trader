# Live calendar refinements — 28 October 2026

## Result and data flow

Removed the calendar info button and repeated Partial badges. Weekly/monthly
totals use shared money formatting (`$0` for USD) and trades/giao dịch wording.
The existing calendar aggregation still counts execution records, not reconstructed
round-trip positions. Account selection and filters feed the same day coverage
model; known zeros remain distinct from unknown dates. Contextual coverage details
and the note drawer retain missing-data information.

The percent toggle remains operable. It uses declared positive numeric opening
capital for every source, pooled once. Missing/invalid capital shows N/A plus a
short reason, never current balance substituted as original capital. Current MT5
snapshots do not declare opening capital; their percentages remain unavailable.

Live uses a joined square grid reaching both pane edges, one separator per seam,
colored gain/loss boundaries and a square month strip at the desktop viewport
bottom. Total cells reserve room for counts and week numbers. Day/week plus icons
work on hover/focus and stay visible on touch. Both open the same draft-only note
drawer. Weekly rows and date ranges exclude dates outside the current month and
filters; Escape/close restore focus. Closing still discards the local note draft.

## Verification

- Focused unit tests: 19/19 PASS (calendar/account aggregation, coverage, DST,
  signed costs, invalid pooled capital and ledger boundaries).
- Scoped production build: PASS, HEAD 643275da plus intentional Live overlays.
- Primary browser QA: PASS 1920/1440/768/390, VI dark and EN light, unknown vs
  observed data, no info/Partial badges, percent valid/missing basis, day/week
  draft drawers, focus return, plus visibility, full-bleed edges and desktop
  footer bottom. Every API request intercepted with labeled GET fixtures;
  no broker access or mutations.
- Independent review: PASS edge-month weeks, percent/accessible-label agreement,
  invalid capital, EN copy, modal focus and responsive screenshots.
- Deployed 5180 browser QA: PASS all four widths using the same labeled fixtures.
  This verifies the served frontend; it is not live broker accounting acceptance.

## Rollout and recovery

An early direct Vite build unintentionally wrote active dist from the dirty
checkout. The verified prior release was restored from its existing E backup,
then the final candidate was built from HEAD plus explicit task overlays on E.
No API or terminal restart occurred. The final guarded promotion retained hashed
assets and atomically replaced only the index after build/QA/review gates.

- Served index SHA256:
  `28b610a4c7ec9c6cb588f755f7ee59b669900d36f1976da3a664dfb1c6ebcc28`
- Pinned palette SHA256 (unchanged compact 0.2.0):
  `4ed40c102d752c454dd384454a142834859571bde1c258a53476655ba98f480e`
- Previous index SHA256:
  `d180eaf7d0f842fb6a0a6b3e8c5c9de0948d188d80604c18bb0b9c78b43c05da`
- Rollback index:
  `E:/BACKUP-TRADINGWORKSPACE/live-calendar-20261028/verified-ui-before/index.html`
- Build/source hashes, promotion receipts, review and screenshots:
  `E:/BACKUP-TRADINGWORKSPACE/live-calendar-20261028/`

Layout can be reverted independently; unrelated Replay/UI/API WIP was excluded
from the scoped build and commits. Neutral-black palette work and SQL paging
remain outside this slice.
