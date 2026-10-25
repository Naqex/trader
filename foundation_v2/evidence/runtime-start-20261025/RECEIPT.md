# Local runtime recovery — 25/10/2026

User requested starting the project. UI5180 remained running; API8010 was absent.
The old manifest's API/supervisor PIDs no longer existed, and the old research
PID had been reused by another executable. No process was stopped.

## Result

- Source HEAD: `49b4446`; guarded build and idle preflight passed.
- Schema current: 16 migrations, none pending; no migration performed.
- Native runtime, compact replay storage, existing database/artifact/QDM and
  scientific/legacy capability descriptors retained.
- Run ID: `d2a7b4bc6b3a4967b898f94c99d8cf4c`.
- Verified owned supervisor/API/research PIDs: 12004 / 4960 / 14200.
- API SHA256: `c1c1c9f69287a701dd2b3b640dd69977198f2f2c05b9dd73ec789ec2847da0f6`.
- Readiness initially returned connection refused during startup; the next
  check passed, with executable hashes matching the new manifest.
- Real Dashboard through UI5180: session list and overview both HTTP200,
  3 session cards rendered, performance schema valid, no page JavaScript errors.
- No broker reconnection or trading action performed.

Private rollback binaries/descriptors, preflight/build/supervisor logs, ready
receipt, GET-only Playwright script/report and screenshot are local under
`E:/BACKUP-TRADINGWORKSPACE/runtime-start-20261025/`.
This verifies startup and the Dashboard read journey, not whole-product acceptance.
