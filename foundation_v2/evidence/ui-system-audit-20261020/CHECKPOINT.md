# WMREPLAY UI-system audit — 20/10/2026

Scope: project UI consistency and shared component behavior. Baseline24eef99,
branch Nam. This is a scoped receipt, not a second progress ledger or whole
product acceptance. Product Plan/WMREPLAY retain authority.

## Result and ownership

- LegacyModal now owns modal stacking, inert background, scroll lock, keyboard
  containment and restoration. Order dialog reuses it instead of maintaining a
  second focus trap. General modal styling lives beside the component, so it no
  longer depends on chart CSS loading first.
- LegacyPopover fits the viewport, tracks ancestor scrolling/anchor resize and
  stays inside its containing dialog. Nested calendar/menu keyboard ownership
  is explicit. Project overlay layer tokens replace consumer-specific z-index.
- Portal controls inherit project theme, focus, disabled and reduced-motion
  rules outside the app shell. Menus use12px radius; field controls8px.
- FxSelect closes on disabled, navigates only available options and exits via
  Tab. Dataset selection has no bulk action that bypasses domain constraints.
- Date fields compare ISO wall times before display formatting, preserve an
  allowed10:30, and synchronize the displayed time after min/max clamping.
  Calendar keyboard navigation and separate44px touch targets are implemented.
- Resource-state popup has bounded placement, outside-focus dismissal and
  Escape restoration. Its touch slot matches its44px target.
- Existing living catalog now includes working nested overlays/date fields and
  unavailable/denied examples. Rules are documented in ui/compact-system.md.
  No dependency or shared snapshot changed; project-ui propagation gate stays
  false. Native dialog/top-layer and vendor chart behavior retain their owners.

State flow remains component-local: opening a layer registers it; only its top
  modal owns keyboard containment; closing a child restores the opener while
  keeping the background inert. Form values stay in their existing parents.
  Order/risk execution, backend permissions and financial state are unchanged.

## Verification

| Check | Observed result |
| --- | --- |
| Node unit/contract suite |408/408 pass, node-tests.txt; includes four new date-bound regression cases |
| Production build |Pass, build.txt; index-DZudBlQh.js603.10kB. Existing >500kB chunk warning remains; no new framework |
| Diff hygiene |git diff --check pass; only line-ending advisories |
| Independent review |INDEPENDENT-REVIEW.md; reported issues fixed; source-only review scope |
| Modal/menu journeys |Nested dialog Escape, Tab wrapping, child restoration, body scroll-lock lifetime, dropdown Escape without closing parent, Tab to next field |
| Real chart read-only |Existing session at historical cutoff2997: order panel shows disabled controls/read-only reason, Escape restores utility trigger; no order submitted |
| Chart Go To |Calendar ArrowRight20→21; first Escape closes calendar only; second closes parent popup |
| Date bounds |Allowed10:30 retained; empty field selecting bounded date emits09:00 and time input also shows09:00 |
| Theme/geometry |Dark/light, dialog440desktop/328mobile, menu/field radius, no stacked picker focus ring; touch clear/picker44×44 |
| Reduced motion |Browser media emulation: modal animation none, field transition0s; emulation cleared afterwards |
| Resource status |Partial popup280px wide within360px viewport, summary target44px, Escape closes/restores |
| Real create-session |Backtesting form and asset dropdown opened; no select-all bulk row; native dialog retains parent on dropdown Escape.360px form and768px Prop creation entry inspected; canceled without saving |
| Production5180 |New bundle loaded and interactive portal dialog tested after build |

Browser observations are in browser-observations.json. They are recorded live
observations, not a standalone automated assertion suite. browser-console.json
contains no captured warning/error entries for the completed QA tab journeys.

## Route and data-state coverage

- Overview1440 light: loading, empty, error, denied, unavailable, stale, partial,
  unknown, refreshing via existing labeled preview fixtures. Retained data and
  scoped notices were inspected, not merely component existence.
- Sessions/demo, Trade/filtered, Analytics/partial, Playbook/demo and Journal/demo
  at1280 light; same main areas at360 light. Market-data empty preview inspected.
- Settings, Live, Learn, Research and Risk at768 and360 dark using actual local
  services. No whole-document horizontal overflow in those checks.
- Prop entry redirects to Overview's Prop Firm creation dialog by design;
  observed selected Prop tab rather than treating absent old .prop-shell as pass.
- Trade/Analytics show16px full-bleed separator overflow relative to .as-page,
  staying within the parent content gutter. Chart/bar/table regions keep their
  own horizontal scrolling; this was not treated as root-page overflow.

Representative screenshots: dialog-dark-360.jpg, calendar-dark-360.jpg,
create-session-light-360.jpg, prop-create-dark-768.jpg,
order-readonly-light-1024.jpg, production-dialog-dark-1024.jpg.
The1440 screenshot is right-clipped by this capture surface; use computed1440
observations for width and the1024 screenshot for complete visual evidence.
Earlier light360 screenshot precedes the final redundant-ring removal; the
dark360 and production screenshots show the final focus rule.

## Runtime and remaining boundaries

At resume API8010 and preview5180 were stopped. Existing offline launcher
restored native/compact API8010 with download-engine none, current schema7;
no provider/broker/migration was run. Optional stale scientific-adapter identity
failed closed before startup; scientific/download readiness is not claimed.
Production Vite preview5180 was restored. Temporary dev5182/QA tabs are cleaned
up after verification; main API/preview remain available.

This audit does not certify every combination of every form, native browser
zoom, full WCAG/axe, every chart plugin or sustained frame pacing. Native dialog
and portal modal remain separate implementations with the same interaction
contract; no framework rewrite was used. Legacy modal uses sticky header with
panel scrolling, while create-session retains its own body/footer anatomy.
No final order/financial mutation tests were repeated for this UI-only batch;
the preceding practice audit remains separate evidence. Unrelated dirty source
and historical evidence files are preserved and excluded from this commit.
