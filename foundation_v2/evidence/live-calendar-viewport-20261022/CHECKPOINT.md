# Live Calendar viewport and empty states — 2026-10-22

Scope: the five owner comments on Live Calendar. No API, database, connector or
broker execution change. Preview on 5180 was rebuilt from the scoped source.

- Desktop Calendar and Analytics now fill the available content viewport.
  Calendar rows use intrinsic content minimums and share remaining space;
  small windows scroll within the pane rather than extending the whole page.
- Outside-month days are disabled with opacity 0.4. Unknown daily values are
  visually blank; their accessible labels still expose the unknown amount.
- Weekly totals retain count, week number and account-currency amount. Existing
  coverage logic is unchanged: an empty covered week is zero; missing history
  stays unknown. Broker deal count is not renamed to completed trades.
- Share and Monthly review have a subtle token-based separator, hidden on narrow
  mobile layouts to avoid an orphan divider after wrapping.

Validation:

- `npm run build`: PASS (existing large-chunk warning remains).
- `node --test tests/*.test.mjs`: 434 passed, 0 failed.
- Independent read-only review by calendar_review: no blocking findings.
- Actual local route, VI/dark and light: 1710×987, sidebar bottom 987px,
  outer content overflow 0px; calendar scroll/client height both 608px.
- Actual route at 1368×790: sidebar bottom 790px, outer overflow 0px;
  full-frame visual proof is `final-calendar.png`.
- Demo at 1280×720: populated day content does not overflow cells. Six-week
  November has no weekly label/amount overlap; sidebar bottom remains 720px.
  Calendar scrolls internally where its content requires more height.
- Covered September demo weeks 4 and 5 show `0 deals` / `0 $`; uncovered weeks
  remain unknown. These fixtures are not evidence of a real broker connection.
- Demo at 390×844: document width 390px, calendar scroll region 285px with
  640px internal content, sidebar stacked. No horizontal page overflow.
- Basic filter drawer opens/closes and applies outcome filters; day selection
  shows unavailable-data detail. Temporary tabs closed; dark theme and default
  viewport restored. User tabs were not closed or navigated.

Numeric observations and fixture text: `actual-metrics.json`.
This is scoped Calendar acceptance, not whole-product or broker acceptance.
