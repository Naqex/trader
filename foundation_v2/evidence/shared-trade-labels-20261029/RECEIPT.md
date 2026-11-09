# Shared trade labels and compact Live analytics — 29 October 2026

## Implemented slice

- Live gross and net PnL reuse the signed return badge.
- Win-rate title, percentage and category legend form a compact left column;
  the existing concentric chart stays on the right. No repeated category counts.
- Settings > Nhãn giao dịch manages the shared Practice/Live catalog: groups,
  names, colors and archive. No example groups or assignments are seeded.
- Live broker trades reuse Practice's picker. Assignments live in revisioned
  workspace metadata keyed by connection and position; broker snapshots remain
  immutable. Aggregate calendars retain each source account/trade identity.
- Archive hides labels from new selections while keeping historical assignments.
  Revision conflicts close the stale Settings draft and request a fresh read.
  Modal close restores focus. Empty trade labels retain the current display.

## Evidence

Artifacts, build logs, screenshots and rollback are local under
`E:/BACKUP-TRADINGWORKSPACE/label-settings-20261029/`.

- Native label unit tests: 5 passed. Real Router with disposable PostgreSQL:
  1 integration passed; group revisions, Practice/Live catalog, Live assignment,
  rename, archive/history, workspace isolation and immutable broker snapshots.
  Harness report: `.artifacts/trade-labels-pg-20261029.json`.
- Production build passed. Stateful intercepted browser tests passed at 1920px
  dark and 390px light: CRUD, color/group membership, assignment/reload, archived
  history, conflict recovery, keyboard focus, badge parity, aggregate tag filter
  (6 trades to 1 tagged source trade) and no viewport overflow/page errors.
  All writes were synthetic label mutations; no broker call.
- Independent source and screenshot review found no remaining blocker after
  repairing multi-account identity, filter options and stale revision handling.
- Actual localhost5180/API8010 read-only journey passed: six existing labels in
  Settings and Live picker, ten default visible trade rows, gross PnL badge and
  compact win-rate layout; no page errors or API writes. `runtime-ui/runtime.json`.
- UI promoted atomically; previous hashed assets retained for open tabs. Index
  SHA256: `abf1dc139d282cf69177fba210b0d3e3a3e4397d043c4b62b07944a1ea7a40f0`.

## Runtime boundary

Native/compact API rollout passed ownership, executable hashes and idle preflight;
no schema migration. Existing research worker, scientific/legacy capabilities,
QDM, AI interpreter and storage paths were retained. Owner authorization for the
same demo account/API update is recorded in this conversation.

The first API build used the new checkout's missing MT5 SDK environment and
reported `mt5_worker_failed`. A focused repair adds `TW_V2_MT5_ADAPTER_ROOT` so
Python, scripts and terminal folders stay together at the existing installation.
Absolute-root configuration tests passed; MT5-focused unit run passed 16 tests,
with 2 broker-dependent tests intentionally ignored. Runtime rollback manifests
and the failed attempt remain in the local artifact directory.

Final rollout `runtime-r2/api-rollout.json` passed readiness with the explicit
installed adapter root. The authorized demo account 464104926 returned
`connected`, `error_code: null` and a fresh sync; `runtime-r2/connection.json`.
The final actual UI read-only rerun passed in `runtime-r2/ui-stable/runtime.json`.
An earlier run during cold history synchronization timed out waiting for the
grid; its failed report remains at `runtime-r2/ui/runtime.json`. After the fresh
28-deal snapshot was available, the unchanged smoke passed. This does not prove
all cold-start/long-duration transitions. No order was sent.
The intermediate scientific preflight refusal came from selecting the
new-checkout admin beside the first candidate; the installed descriptor was
re-probed and identical. Retaining the original admin/research installation
passed the guard; no capability identity or gate was weakened.

This receipt covers label metadata and UI behavior. It does not grant trading
permission or close full product, research, live broker or long-duration gates.
