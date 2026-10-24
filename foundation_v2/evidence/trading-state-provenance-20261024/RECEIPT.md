# Live trading-state provenance and action-only stale feedback

2026-10-24. Scope: selected managed MT5 connection, trading conditions and stale
feedback. No execution guard, requested access, risk limit or send retry changed.

## Result

- Opening/reloading a stale chart and repeated SSE snapshots do not show a
  stale-price toast. Buy/Sell and order-check attempts show an application-labelled
  warning without calling preview/commands. Manual close remains closed through
  subsequent snapshots; auto-hide remains eight seconds. Another explicit attempt
  starts a new display period. Transport errors, uncertain requests and symbol
  recovery keep their existing feedback/recovery controls.
- Conditions separate raw MT5 permission/symbol facts, quote quality calculated
  against the host clock, and application policy. Five seconds is labelled as
  application policy. The session is unknown because the adapter has no session
  schedule contract. A stale tick does not prove market closure.
- Snapshot provenance uses `broker_state`, `data_quality`, application policy
  profiles and source tags for derived capabilities/execution admission. Older
  warm-worker payloads retain managed-account behavior without inventing missing
  raw flags; bounded Demo limits/mandatory SL remain separate.
- Only actual broker check/send retcodes map to market closed, trading disabled,
  no quotes, long-only, short-only or close-only. Unknown results and reconciliation
  keep their previous semantics.

## Verification

- Python adapter: 25 tests passed; worker regression: eight tests passed.
- Node model/receipt tests: 11 passed. Stale/future/invalid clocks, profile
  compatibility, unknown session and rejection attribution covered.
- Isolated production build passed (339 modules; existing chunk-size warning).
  Source was HEAD plus only this task's five UI overlays. Unrelated dirty Replay
  and styling changes were excluded.
- Synthetic Live market acceptance: 1920 dark, 1440 light, 768 dark and 390 dark
  passed; no API mutations. Dock/action fixture passed the same four viewports;
  all preview/command responses were intercepted, zero broker calls. Replay
  regression passed 1440/390 dark/light with no mutations or simulated orders.
- Independent backend review found no material issue/permission expansion.
- Active local UI promoted without restarting the API. Old hashed assets and
  existing brand asset retained; prior index/mutable assets backed up on E:.
- Owner explicitly approved reconnecting only connection
  `492ec8a5-3938-41a3-8a26-8c0f7f59ed43`. Account suffix and absence of unresolved
  requests were checked before one `/sync` call. Requested access stayed
  `trading`; connection recovered to `connected`. Actual new snapshot confirms
  raw account/terminal permissions, symbol mode 4/order_mode 127, session unknown,
  application policy max age 5000 ms and application-derived stale quality.
- Runtime browser checks against real local services passed at 1920 and 390:
  no initial/reload stale toast, warning only after Buy, stable dismissal,
  eight-second auto-hide, no order dialog, and three-source conditions. All
  non-read API requests were aborted/asserted absent in this UI check.
- Selected screenshots reviewed for desktop/mobile and scrolled policy content.
  No live OrderCheck, preview or order send was performed. Broker rejection paths
  are fixture-tested, not broker execution acceptance.

## Artifacts and rollback

All temporary source/builds, JSON reports, screenshots and prior UI files are in
`E:/BACKUP-TRADINGWORKSPACE/trading-state-provenance-20261024/`:
`build.log`, `browser/report.json`, `dock/report.json`, `replay/report.json`,
`runtime-report.json`, `runtime-check.mjs`, `reconnect.json`,
`ui-promotion-verified.json` and `ui-before-verified/`.

Active index SHA256:
`26a42e72433c2080c4f34da3da5b5a0d444731e4fed8151f5d21d5bb12ad6ff0`.
Prior index SHA256:
`b9129f4f4b3f57b853f9c29c14dc6c348350a2880a60b224894611c79497b7a2`.

Rollback can restore the saved index and mutable CSS atomically; leave hashed
assets for open pages. Backend source rollback takes effect only after another
approved reconnection because the worker imports its Python module at startup.
