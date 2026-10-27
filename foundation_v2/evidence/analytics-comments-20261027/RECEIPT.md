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

## Follow-up: actual chart time-basis trace

The owner clarified that the earlier promise to trace time through the complete
local chart pipeline also needed explicit evidence. Rechecked the running build
after `aa83acd`, without changing application code or the user's FX Replay tab.

- An isolated read-only browser captured the actual saved-session Analytics GET:
  `time_basis=market&timezone=Asia%2FHo_Chi_Minh`.
- Actual response: `scope.time_basis=market`, `equity_curve.time_basis=market`,
  one closed trade. Its chart close is `2003-05-05T00:18:00Z`; local display is
  `05/05/2003 07:18:00`, not the computer's current date/time.
- The response was passed through the current `analyticsViewResult`,
  `buildAnalyticsModel`, `advancedAnalytics` and `bucketCurve`. All projected
  `analytics_time_utc` values and PnL curve timestamps matched `close_time_utc`.
  Resulting buckets: hour `07`, month `2003-05`, calendar `2003-05-05`.
- Browser assertions independently confirmed `07:18` on the PnL plot and year
  `2003` in its calendar. Hour/day/month/calendar/frequency share that projection;
  session windows classify the same instant in fixed UTC windows.
- The same API GET with `time_basis=activity` returned that declared basis and
  null `report_time_utc`. Chart close stayed intact. Missing real recording time
  was not fabricated from chart time.
- Backend trace: `analytics/routes.rs` branches on the requested basis; market
  selects `build_replay_analytics_view`, activity selects `activity::view` and
  recorded close metadata. `AnalyticsWorkspace.jsx` explicitly requests market
  for session Analytics; no wall-clock timestamp is used to date these charts.
- Focused time/chart model suite rerun: **30 passed, 0 failed**.

Replay commands, sanitized result and calendar screenshot are saved alongside the
other raw evidence as `time-basis-qa.mjs`, `time-basis-qa.json` and
`calendar-time-basis.png`. This is a confirmed-current check of the selected local
session, not a blanket assertion about every product surface or FX backend.

## Follow-up: weekday top boundary and clearer year heading

The next owner review identified the missing top horizontal boundary above Monday
and found the Vietnamese YTD label unclear. Added that boundary so all seven
weekday rows have eight equally spaced horizontal boundaries. Replaced Lũy kế
with Tổng năm in Vietnamese; English remains YTD. This means the total of the
observed months in that year under the active filters. Formulas and data/state
projections are unchanged.

- Focused Node tests: **54 passed, 0 failed**; production build succeeded.
- Preview and deployed browser checks: **3 cases each** (1920px Vietnamese,
  390px Vietnamese, 1920px English), all passed.
- Verified eight horizontal boundaries, equal spacing, the translated heading,
  only `.fx-content` owning vertical scroll, and no document horizontal overflow.
- Reviewed the deployed desktop screenshot. No FX Replay refresh/navigation,
  API restart or broker operations. The user's existing local tab was not reloaded
  after this correction.

Evidence and replay scripts:
`E:/BACKUP-TRADINGWORKSPACE/analytics-day-top-line-20261027/`.
Current served index SHA-256:
`70c60a12ff6546bee423875047a38ed8813ec3019fe512dc9bcbbf48d9c43825`.
Rollback entry: `ui-before-release/index.html` in that directory. Existing hashed
assets, branding, API and UI processes were retained during UI-only promotion.
