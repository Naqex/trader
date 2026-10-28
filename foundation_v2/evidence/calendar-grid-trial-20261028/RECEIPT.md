# Analytics calendar joined-grid trial — 2026-10-28

User authorized trying square connected day cells, with a return to the previous appearance if disliked. This is a reversible presentation trial, not a global design-system decision.

- Only Analytics calendar month/year cells change: gap0, radius0, single neutral1px separators. Each cell owns top/right; first column owns left; last week owns bottom. Outer panel keeps its rounded corners.
- Outside-month dates are dimmed without dimming the shared borders. Gain/loss backgrounds, selected/focus, keyboard and day-detail behavior remain. Live calendar uses the shared components but all new CSS is scoped to .wm-analytics-calendar, so Live is unchanged.
- No JSX, state, data, metrics, API or SQL changes.
- Independent scenario_review: no blocker; reviewed specificity, month/year compact grids, nonduplicated boundaries, outside dates and focus.
- Read-only browser QA:3/3 viewport journeys on preview and deployed.1920dark uses the actual selected session6428cf18b3f54a36b2e90207ef12392e;1440light/390dark use labeled demo. Each tests exact gap/border ownership, adjacent geometry, cell opacity/radius, outer radius, day details, Enter/Space, month/year navigation,12mini calendars, focus inset and no document overflow. No writes/broker reads. Screenshots visually inspected.
- Build uses tracked38f1d4da + only src/calendar-view.css overlay; unrelated WIP excluded. Atomic UI-only promotion verified served hash; old assets/private branding retained. No API restart.

## Rollback

Pre-trial product HEAD:38f1d4dab741b6730b7de309f78f850e1a381001. Keep this trial in its own commit so its CSS can be reverted without reverting label/filter/performance work. Original CSS also saved at E:/BACKUP-TRADINGWORKSPACE/calendar-grid-trial-20261028/calendar-view.before.css. Exact pre-trial UI index is in ui-before-calendar-trial/index.html there (hash in build.json); restore atomically for immediate UI rollback only if no newer UI has been promoted. Old hashed assets remain available. Source rollback and a rebuilt UI are the durable route if subsequent changes exist.

Reproduce: TW_UI_ORIGIN=5191 preview or5180 deployed; TW_UI_EVIDENCE_DIR under E; node E:/BACKUP-TRADINGWORKSPACE/calendar-grid-trial-20261028/qa.mjs. Full build/QA/rollback files remain under that folder.
