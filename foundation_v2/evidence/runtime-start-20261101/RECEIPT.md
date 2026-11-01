# Local startup — 01/11/2026

Owner requested restart and a progress report. Startup only; no new migration,
provider job, terminal restart or broker order was requested.

- UI5218 serves the reviewed Studio build from
  `foundation_v2/.runtime/studio-final-build`, entry `index-C_fM6QLT.js`.
  Served index matches local bytes, SHA256
  `011a991c4500d698e5500de429ea72389cfd853926d5b5d0bd0e88291fd0c280`.
- API8010 reuses the retained schema20 native/compact API and research binaries
  from the previous checkout's manifest. Existing artifacts, QDM, scientific and
  legacy descriptors, database and optional AI interpreter are retained.
  This is not deployment of the new audit backend changes in canonical source.
- Canonical runtime owner remains at the retained checkout:
  `projects/mt5-tradingview-backtester/foundation_v2/.runtime/api-platform/native-owner.json`.
  Run ID `7881853db3b9427883b0246ec3c8dfeb`; readiness and health return200,
  `ok=true`, `execution_capability=false`.
- Paperclip17860 starts through `tooling/paperclip/run-local.mjs`, using its
  existing company/database/config. Heartbeat disabled. Native health and the
  UI5218 read-only health bridge return `status=ok` on pin
  `e2a9b5e5aaf221c30b89fed55a1513e664a96ac5`.
- UI5218 proxies `/api/v2/replay/sessions` successfully. The initial probe used
  nonexistent `/api/v2/sessions` and returned404; corrected to the existing route.
- First API preflight timed out. An unchanged retry passed schema/idle/identity
  checks and launched the retained runtime. Root cause of timeout is unconfirmed.
- Private launcher, PID receipts and logs:
  `E:/BACKUP-TRADINGWORKSPACE/runtime-start-20261101/`.

These checks establish startup and read-only routing, not complete owner journeys
or whole-product acceptance. Opus5.5 is expired per owner; no model job was run.
The owner audit remains partial; continue from
`../owner-system-audit-20261031/CHECKPOINT.md`.
