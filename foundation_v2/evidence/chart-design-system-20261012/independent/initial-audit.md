# Independent chart design-system source audit

Status: initial read-only audit, not final acceptance.

The shared chart loading review remains separate. This audit covers chart-owned forms, menus, order/positions/journal surfaces and mobile; it does not propose changing the native chart engine.

| Area | Evidence before implementation | Gap to verify after root changes |
| --- | --- | --- |
| Positions empty | `LegacyPositions.jsx` renders headers, empty `td`, and 1/1 pager for zero rows | Use compact shared empty, retain tab context, hide meaningless pager; distinguish unavailable cutoff data from known zero orders |
| Positions pager | Native `select` size and page controls in `LegacyPositions.jsx`; 64px min paging bar in `ChartWorkbench.css` | Shared chart control sizes, alignment, keyboard navigation and mobile overflow |
| Order form | Native select direction/type/strategy and footer checkbox; readonly entry receives editable hover styles | Consistent field/select/checkbox semantics; readonly should read as noneditable |
| Order dialog | `ChartWorkbench.css` defines a separate dark/light hex palette and 40px/r10 fields | Route owned surfaces through semantic chart tokens while preserving modal focus trap/inert behavior |
| Popover form/menu | `chart-controls.css` uses menu34px rows, padded form fields and custom hardcoded layout switches | Common field height, hover/focus, switch colors and font; maintain Escape/arrow/focus return |
| Scalper | `LegacyTradingBar.css` hardcodes blue, red, switch neutral colors and quantity Arial12 | Reuse chart semantic actions/errors/switches/type, check grouped quantity focus without nested outlines |
| Replay controls | `LegacyReplayToolbar.css` uses a separate blue and switch colors | Common owned control palette, focus and reduced motion |
| Journal | Search wrapper lacks hover; empty title18/icon90 differs simple Positions empty; native checkbox differences | Shared input wrapper states and compact local empty pattern, preserving report/calendar context |
| Vendor native chrome | `chart-legacy.css` owns limited extension styles around vendor selectors | Keep changes scoped to project controls and documented native overrides; no vendor source mutation |

Additional semantics to preserve: data absent at historical cutoff is not proof the entire session has no trades; open/pending/closed tables currently share all columns, several of which are inapplicable to each tab. The latter is an optional semantic refinement if included in root scope, not a confirmed runtime defect.

Existing keyboard foundations worth preserving: order modal traps focus and makes app inert; popover handles Escape, arrow navigation, focus return and outside dismissal; position/journal tabs implement arrow/Home/End navigation.

Final QA should use labeled synthetic fixture, block non-read requests before backend dispatch, inspect actual computed focus/hover states and captures at desktop/mobile dark/light, and verify local empties, meaningful pagination, tab context, resizing and portal placement. Owner replay session and broker actions must remain untouched.
