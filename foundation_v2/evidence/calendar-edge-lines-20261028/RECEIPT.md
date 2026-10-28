# Calendar horizontal lines to panel edges — 2026-10-28

User clarified horizontal row lines must reach the outer panel edges, rather than stop at the content padding. Direct month-grid scroll now bleeds across the16px panel insets. Navigation/metric controls keep their padding; mini year grids and Live are unchanged. Edge-cell side borders are removed where the panel border owns that edge. No data/state changes.

Scoped build66e605d9 + only calendar-view.css. Independent scenario_review: no blocker. Preview3/3 and deployed3/3 viewport journeys passed (real1920dark selected session, demo1440light/390dark), including prior day/keyboard/month/year cases plus scroll edges exactly at panel inner borders,16px toolbar inset, no doubled cell boundaries and no document overflow. Screenshot inspected. Atomic UI-only rollout hash/rollback in promotion.json; no API restart.

Trial rollback remains available. To return to the original rounded/gapped calendar, restore calendar-view.css from pre-trial38f1d4dab741b6730b7de309f78f850e1a381001 and rebuild/promote; this undoes both calendar trial commits while retaining unrelated UI. The original source/index backup remains E:/BACKUP-TRADINGWORKSPACE/calendar-grid-trial-20261028/. This task's ui-before-edge-lines/index.html only returns to the square grid with inset sides, not to the original rounded cells.

Reproduce with TW_UI_ORIGIN=5191 or5180 and TW_UI_EVIDENCE_DIR under E: node E:/BACKUP-TRADINGWORKSPACE/calendar-edge-lines-20261028/qa.mjs.
