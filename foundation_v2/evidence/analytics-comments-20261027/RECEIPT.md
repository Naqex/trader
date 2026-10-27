# Analytics Performance — remaining owner comments

27/10/2026. Scope: six visual comments attached to the Analytics time-basis follow-up.

| Owner comment | Result |
| --- | --- |
| Left side card is taller than session radars | Desktop rings reduced from 210px to 150px. Radar row stretches to the same bottom. At 1920px, both surfaces are 246px high. From 1201–1500px, side plots stack to match the two-row radar group. |
| Day chart lines should run horizontally | Kept signed horizontal PnL bars; changed the dashed grid from vertical value lines to horizontal weekday separators. |
| Monthly controls are visually noisy | Shortened the two aggregation choices to Cộng % phiên / Tổng thể (%); retained native radios, capital selection and existing definitions. |
| Remove standalone USD | Removed only the day chart's standalone label. Currency remains available in each money tooltip/accessibility description. |
| Translate YTD | Vietnamese: Lũy kế. English: YTD. |
| Single-color expectancy bar loses one rounded end | Do not render zero-width segments. Explicit win/loss classes preserve the correct color when one segment remains; the clipped outer track rounds both ends. |

## Data/state boundary

Report projections and formulas are unchanged. Side plots still consume `data.side`;
the day plot uses `data.weekdays`; monthly radio state still chooses the existing
`periodReturn` aggregation and capital basis. Expectancy keeps average win/loss
amounts and omits only visually empty segments. Unknown and zero remain distinct.

The three risk cards were already equal in the current render; verified that the
left/right metric columns share their card inset. Calendar/frequency alignment,
empty calendar days and the single vertical scroll owner were regression-checked.

## Verification

- Isolated candidate: tracked HEAD `c1c3f24` plus the four intentional UI overlays.
  Unrelated working-tree changes excluded.
- Focused Node tests: **54 passed, 0 failed**. Vite production build succeeded.
- Preview and deployed Playwright checks: **9 cases each**, at 1920/1440/768/390px,
  Vietnamese/English, dark/light, mixed/positive-only/negative-only/unknown/empty.
- Screenshot review: desktop side/radars, day grid, month controls, calendar/frequency,
  mobile month layout and single-color expectancy bars.
- Real saved session: GET-only check without mocked responses passed. The existing
  local user tab was reloaded and showed 150px rings, Lũy kế, the full-width red
  expectancy segment and only `.fx-content` as the vertical scroll owner.
- No document horizontal overflow or month-table overflow at the tested widths.
- No FX Replay tab navigation/refresh, API restart, broker calls or trading writes.

## Local evidence and recovery

`E:/BACKUP-TRADINGWORKSPACE/analytics-comments-20261027/` holds `build.py`, `qa.mjs`,
`real-qa.mjs`, logs, screenshots, `preview-final/report.json`,
`deployed-qa/report.json`, `real-qa.json` and `promotion.json`.

UI-only promotion copied the new hashed assets and atomically replaced the entry
index, retaining old assets and existing UI/API processes. The served index SHA-256
is `9a87f4c23f1fa59084102d1d85d2df689eb547b733dd3c5c8de79c5356790dcf`.
Rollback entry: `ui-before-release/index.html` in that evidence directory.

This receipt verifies this presentation slice; it does not assert FX backend
formula parity or whole-product/broker acceptance.
