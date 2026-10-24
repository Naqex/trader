# Guarded local rollout mechanics

Use only the branch needed by the requested operation. Read current script/source
and manifest; do not replay an old shell command from history without checking it.

## API and terminal

1. Inspect live owner manifest and prepared candidate; run check-only/idle checks
   for the explicit native/storage profile with existing capabilities. Preserve
   task/account scope and any active work. Do not print the DSN or credentials.
2. Save manifest, descriptors and necessary private config under E. If schema
   changes, verify compatible PostgreSQL dump tooling and matching artifacts.
   Backup-confirmed flags acknowledge backups; they do not create them.
3. Stop through `run_api_platform.py --stop` with the **currently owned** binaries
   and profile. Guarded ownership compares executable paths/hashes; candidate
   binary paths cannot stand in for old ownership during stop. Do not kill by
   port/process name or overwrite a running binary.
4. Start the prepared candidate with all retained settings. Readiness must verify
   the new owned supervisor/API and actual deployed build. If startup fails,
   inspect sanitized logs and use the saved compatible rollback, not broad kills.
5. Reconnect only the specifically authorized account using the supported
   connection action; check status, requested mode and fresh generation. App
   account list/sync may reach MT5: a loopback URL is not an offline fixture.

Existing terminal cold-start cleanup may remove manually enabled native MCP.
Read `foundation_v2/docs/MT5-READ-TOOLS.md` for that adapter. Keys belong in scoped
process environment/private storage; never in screenshots, repo or command line.
A binding must match fresh workspace/account/generation and owned terminal path.
Do not restore an entire old config/profile directory to repair one capability.
Report unavailable optional tools honestly; do not enable trade/file/tester tools.

## UI-only promotion

Build a scoped source tree: tracked HEAD plus intentional task overlays, excluding
unrelated dirty files. Use existing dependencies/vendor path, output on E, then
preview on an owned loopback port. Build and focused browser/visual checks come
before promotion.

Inspect the currently served index hash and preserve it for rollback. Reuse the
latest verified promotion helper after reading it; check asset collisions, retain
old hashed assets for open pages, and replace the entry index atomically. Preserve
intentional private branding/mutable assets according to that helper's contract.
Verify the real served hash and affected read-only behavior. A UI-only copy change
normally needs no API/terminal restart. Clean up only the preview you started.

## Evidence to reuse

The product's `foundation_v2/evidence/mt5-read-tools-20261024/RECEIPT.md` records
official MCP client smoke, scoped UI promotion, old-binary stop, reconnect errors
and optional-MCP loss. It is historical evidence of this workflow, not a current
runtime status or authorization. Runtime docs and fresh manifests own current
parameters; receipts retain failed attempts.
