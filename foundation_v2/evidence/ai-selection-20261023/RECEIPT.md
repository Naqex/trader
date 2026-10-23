# Mentor model selection persistence — 2026-10-23

## Behavior

Removed the vertical model/effort separator, retaining secondary effort text and
the existing provider detail in the picker/tooltip. No additional surface or copy.

The latest provider/model/effort is saved to localStorage per workspace, including
unsent choices. Reload and new chat/agent retain it. Explicitly opening history
restores that conversation's selection. On first use without a valid preference,
the restored conversation or resolved chat/system profile supplies the selection.
Catalog and conversation response order cannot overwrite an unsent stored choice.

A ready catalog reconciles removed models within the same provider: valid profile
default first, otherwise its first model. A removed provider permits a ready-route
fallback. Offline routes, failed reads and empty catalogs preserve the preference;
the composer is disabled when its route/model is unavailable. Removed efforts use
the gateway default or the first advertised WebGPT effort. Provider IDs remain part
of identity when two catalogs expose the same model ID. Invalid/blocked browser
storage is tolerated; blocked storage cannot persist across reload.

Selection is for the next turn. In-flight run snapshots and unresolved idempotent
POST bodies remain untouched. Reconnecting/reloading never resubmits inference.
No API/schema/provider configuration change or new polling/background task.

## Verification

- Node: 14 passed, including 8 selection cases plus stream/transcript regressions.
- Final production-build selection fixtures: 6/6 VI/EN ×360/768/1440, then the same
  6/6 on installed5180. Unsent selection, both restore response orders, new chat,
  duplicate provider IDs, failed/offline/empty catalogs, removed effort/model,
  stale catalog response, held run/reload without resend, invalid/blocked storage,
  explicit history open and workspace isolation. One synthetic held POST per case.
- Stop/Continue regression: 6/6, 9 synthetic POST attempts per case; agent regression:
  6/6, 3 synthetic POSTs per case. No real provider calls in these fixtures.
- Actual local UI/API read-only journeys: 6/6 on preview and6/6 installed; no mocked
  reads, configuration writes, inference, or page errors. Representative mobile
  and desktop dark/light screenshots inspected; no horizontal overflow.
- Isolated HEAD build with only scoped source overlays passed. Existing638KB main
  chunk warning remains. Unrelated dirty Replay/CSS/evidence excluded.
- Initial selection fixture failed because its history list retained an obsolete
  synthetic ID after a new chat; fixed fixture identity and awaited history restore.
  The implementation was not changed to accommodate the incorrect oracle.

## Local rollout and rollback

Builds, screenshots, logs and UI index backup:
`E:/BACKUP-TRADINGWORKSPACE/ai-selection-20261023/`.
Key files: `unit.log`, `build.log`, `fixtures-verified/report.json`,
`installed-fixtures/report.json`, `continuation/report.json`, `agents/report.json`,
`live-readonly/report.json`, `installed-readonly/report.json`,
`runtime-readonly.json`, `ui-promotion-verified.json`.

Atomic UI index swap, old hashed assets/installed brand preserved. No API/gateway
restart, migration, OAuth, credentials or broker changes. Installed index SHA256:
`7ecdfb118e1f47459eadad414cae33af79e43ffec6a253401bba22bb3aeb5e8c`.
Rollback restores this task's `ui-before-verified/index.html` to `web/dist/index.html`.
Existing browser pages receive the update on reload.

Architecture progress was separately reconciled in `docs/AI-PLATFORM-ARCHITECTURE.md`
against source, current read-only endpoints and earlier rollout/inference receipts.
This task adds no real multi-model workload, pool failover, TradingAgents domain
integration or chart/MT5 performance acceptance. Those remain explicit next work.
