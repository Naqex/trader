# Order UI and partial close — 19 October 2026

Scope: the owner's eight chart/order comments. This is a scoped implementation
receipt, not whole-product acceptance.

## Behavior

- Quick Buy/Sell uses `execution_timing=current_quote`; the confirmed marker is
  an already-open position. Existing pending-order semantics remain distinct.
- TP/SL axis labels use brighter teal (`#46C7B7` dark, `#159989` light), switch to
  yellow while hovered/focused/dragged, and restore afterward. BUY entry is white;
  SELL entry is yellow. Both BUY and SELL position text use orange.
- Clicking open-position quantity opens Take partials: remaining/original basis,
  percentage presets, exact quantity, Max, current size and realized PnL. The API
  owns execution and persists the residual. Invalid sizing blocks submission.
- Partial submission is gated on the server capability, including at the submit
  boundary. An older server cannot silently interpret a partial as a full close.
- Position edit omits Preset and the redundant timing/SIM hint; its footer aligns
  right. Order toasts and the new dialog support Vietnamese and English.
- The open/closed positions list preserves realized PnL and each closed slice.

## Validation and evidence

- Focused frontend unit suite: 34 passed; order model regression suite also passed.
- Production build passed. `ui/browser.json`: four synthetic API journeys through
  the real native chart (1368/768/390px, VI/EN, BUY/SELL, dark/light), quick fill,
  reload, partial sizing, original basis, Max, rejected close/retry, capability
  denial, edit dialog and selected/hover styles. All API writes were intercepted;
  these fixtures do not prove financial calculations.
- Reviewed desktop and mobile screenshots; fixed radio and selected-hover CSS
  collisions found during review. No horizontal overflow or JavaScript errors.
- Independent frontend correctness review found no blocking issue. VI/EN copy
  contracts passed; exported API contract check passed for 105 routes after
  synchronizing the existing current-quote timing properties.
- Financial proof is separate: [backend receipt](../order-partials-20261019/BACKEND.md),
  including 14 disposable PostgreSQL workflows, native/compact reload, Prop feed,
  final close, tick and Python parity. No owner trades were submitted by QA.
- Installed API and production UI verified after guarded restart. `runtime.json`
  records native/compact readiness, executable hashes, capability and unchanged
  owner revision/cursor/position/event sequence. `installed/installed-browser.json`
  records the deployed chart loading without JavaScript errors and with owner API
  writes blocked. The owner session was flat, so no installed partial trade was
  submitted; financial writes were tested only in the disposable environment.

## Decisions and limits

Uses existing React, native chart primitives, modal lifecycle and project palette;
no new dependencies or database migration. Native price anchoring remains owned by
the chart library. Partial fees follow original volume and existing per-fill money
rounding; several fills can differ by a cent from closing once. This does not add
multiple simultaneous positions per asset or enable live broker execution.
The partial-close dialog is offered by Advanced Charts; the rollback Lightweight
chart retains its existing full-close action.

Rollback executables and the prior owner manifest are retained in
`.runtime/order-ui-20261019/`. The scientific descriptor was refreshed with the
existing bootstrap, preserving installed runtime/dependency identities.
