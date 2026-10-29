---
name: mt5-runtime-operations
description: Inspect or roll out the local Naqex Trader API/UI runtime and reconnect its owned MT5 terminal. Use for runtime health, guarded updates and recovery; not ordinary UI edits, trading execution or Codex MCP configuration.
---

# Local MT5 runtime operations

Start with the user's requested action: inspect, build, promote UI, restart API,
reconnect one terminal, or migrate. Inspection is read-only. Build success does not
authorize a restart or broker call. Reuse authorization already given for this
account/action; ask only for a missing boundary, not the same approved step twice.

## Establish current ownership

From the product root, inspect Git HEAD/WIP and the current
`foundation_v2/.runtime/api-platform/native-owner.json` (or selected profile's
manifest). Verify PID, creation identity, executable path/hash and current profile.
Historical receipt ports/binary paths/account IDs are examples, never defaults
that can replace the manifest. See
[runtime guide](../../../foundation_v2/docs/RUST-NATIVE-RUNTIME.md).

For an update/recovery read [rollout mechanics](references/rollout.md). For a
read-only health request, inspect only the selected manifest/listener/readiness
and requested account; do not sync/reconnect merely to test the skill.

## Keep the active contract

Use existing `scripts/restart_offline_api.ps1` and
`foundation_v2/scripts/run_api_platform.py` guards. Preserve explicit profile,
storage mode, database/artifact roots, download configuration, installed
scientific/legacy descriptors and optional AI workflow interpreter. Do not
replace native/compact with launcher compatibility defaults.

Before a requested cutover, check active jobs/downloads/AI runs and unresolved
broker submissions; save a concrete rollback. Migration additionally needs the
matching DB/artifact backup and authorization. Use the owner-configured backup root outside the source checkout
for backups, temp and build outputs; private configs/secrets stay
out of Git and console output. Do not move active data or add junctions casually.

## Validate and report what actually ran

Check candidate source/build first, then deployed hashes/readiness and the
authorized read-only browser/API journey. A terminal reconnect retains requested
account mode; it does not grant permission to OrderCheck/OrderSend. Verify optional
capabilities after restart rather than assuming saved settings survived.

If reconnect errors, capture code/time/generation and observe a bounded existing
retry. Do not loop sync/restart, rotate keys or broaden permissions to obtain green
status. Unknown broker submission requires reconciliation, never resend.

Report source/fixture/deployed/broker evidence separately, including failed
attempts and recovery. A recovered `connected` state does not prove the root cause
was fixed or long-duration stability. Link the receipt to existing runtime docs;
do not create a new plan/ledger.
