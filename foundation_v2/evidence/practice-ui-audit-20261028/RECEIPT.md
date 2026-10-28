# Practice UI review — 28/10/2026

## Scope and changes

Bounded review requested by the owner: preserve the accepted Practice direction,
fix the blank strip beneath the Analytics calendar and clear remaining UI faults.

- Reproduced a 35px bottom strip at 1920px with the real May 2003 session.
  The Calendar panel stretched to Frequency's height while its grid did not;
  the body also retained 16px bottom padding.
- Month rows now share the available height and meet the panel edges. The panel
  alone draws the bottom boundary; the month scroller respects its rounded corners.
  Year view and expanded day details retain their 16px inset. Live is unchanged.
- A delayed valid price-path response recreated calendar items and unexpectedly
  closed an open day. Selection now follows report/session/filter scope, rather
  than array identity. Same-scope enrichment preserves details; applied filters,
  session changes, navigation and explicit Close still reset them as appropriate.
- Added a browser regression to the existing Analytics loading journeys and
  updated the owning display contract. No API, financial formula or SQL work.

## Evidence and verification

Full local artifacts and runnable scripts:
`E:/BACKUP-TRADINGWORKSPACE/practice-ui-audit-20261028/`.

| Check | Result |
| --- | --- |
| Existing served UI, 8 routes × desktop/mobile | 16 loaded views inspected; no document overflow or JavaScript errors |
| Calendar visual/keyboard/navigation QA | 3 viewport/theme journeys PASS: 1920 dark real, 1440 light demo, 390 dark demo |
| Calendar geometry and shared table interaction QA | 9 cases PASS: 4/5/6-week months have 0px bottom gap; Year/day-detail inset preserved; Trades 5-column and Market 3-column sort controls do not overlap and reset correctly |
| Existing Analytics loading browser test | 9 journeys PASS, including same-scope delayed enrichment, applied scope reset, demo draft/Apply and existing lazy/error/recovery cases |
| Independent review | scenario_review reviewed source and representative screenshots; final no-blocker result after correcting the demo selection scope |
| Served 5180 after UI promotion | Index hash matched; calendar 3 journeys and Analytics loading 9 journeys PASS again |

Viewed Overview, Sessions, Trades, Market Data, Analytics Session Performance,
Prop Performance, Drawdown and Simulation. Existing real-session data and labeled
demo were inspected separately. Sorting was checked on real read-only tables.
Checks allow only local GET/HEAD/OPTIONS and block broker/live/event endpoints;
no trading, simulations, imports or source data mutations were performed.

The first interaction run exposed the day-detail closure; its failed report is
retained under `interactions-first-attempt/`. A valid delayed-response fixture
reproduced the failure under `refresh-before/`, then passed under `refresh-after/`.
The existing non-UI price-path 422 limitation was not hidden or changed.

## Rollout and reversibility

Scoped build: tracked product HEAD `67a4656d` plus this task's three web-source
overlays, excluding unrelated dirty source. Existing API/UI processes retained.
The index was replaced atomically, with old hashed assets and private branding
preserved. Served index SHA256:
`6070882168a24b419c16b4edb158f8edc983c5c0ad84153ead8c3ab6caea5ad0`.

Pre-task UI index: `ui-before-practice-audit/index.html` inside the artifact folder.
The accepted calendar remains a reversible trial. Original rounded/gapped calendar
CSS is retained at
`E:/BACKUP-TRADINGWORKSPACE/calendar-grid-trial-20261028/calendar-view.before.css`;
restore only the relevant visual rules and rebuild to retain the state fix.

This is scoped UI acceptance, not whole-product or broker acceptance. SQL paging
remains deferred by the owner. Other Practice screens required no new redesign.
