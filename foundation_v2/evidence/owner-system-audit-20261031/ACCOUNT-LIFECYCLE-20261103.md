# MT5 account lifecycle — 03 November 2026

Scoped local fix for [Naqex/workspace#7](https://github.com/Naqex/workspace/issues/7).
The owner requested background terminals and an account-flow review, with standing
local restart/reconnect authorization in Trader AGENTS. This receipt does not
complete the broader owner audit or authorize broker execution.

## Findings and changes

| Finding | Evidence | Correction |
|---|---|---|
| Two visible MT5 helpers | Two owned paths, one Exness and one FTMO; both had interactive main windows. There was no same-account duplicate at capture. | Retain per-account isolation; launch the managed Python worker on a private Windows desktop so its terminal/SDK descendants cannot show on the active desktop. No SwitchDesktop, global service or polling window-hider. |
| Sync restarts authenticated sessions | The native action always incremented generation and asynchronously revoked the worker. | Sync queues a full history read on the same generation and session. Paused/disconnected connections cannot be resumed by Sync. |
| Delayed revocation can kill a newer session | After the DB commit, cleanup waited for the shared slot and then killed whichever worker occupied it. | Carry the committed generation into cleanup and revoke only older workers. Removal retains unconditional cleanup and the unresolved-submission gate. |

Data flow: native account row/credential + generation → per-account worker slot →
owned background desktop/job tree → MT5 SDK → identity/generation fence → native
snapshot. Sync changes refresh state, not authentication identity. Credential
change/pause/resume/disconnect still invalidate the old generation. Existing
kill-on-close ownership, pipe-only credentials, limits and account permissions
remain in place. The private desktop is window placement, not a security sandbox.

The first experiment showed that changing only the parent thread desktop does
not move a newly created Python process to that desktop. The implemented fix
sets the owned worker's STARTUPINFO.lpDesktop at CreateProcess instead. See
[Microsoft desktop selection](https://learn.microsoft.com/en-us/windows/win32/winstation/thread-connection-to-a-desktop),
[CreateDesktopW](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-createdesktopw)
and [MT5 initialize auto-launch](https://www.mql5.com/en/docs/python_metatrader5/mt5initialize_py).

## Focused verification

- Windows owned-process suite: 9 passed, covering stdin/limits/tree cleanup,
  worker crash and the actual private-desktop GUI/descendant path. The ignored
  abrupt-worker helper is invoked by its parent crash test, not an omitted gate.
  After extending the new test, its focused rerun also proved desktop release
  after the process tree stops; it is not counted as another unique test.
- Generation revocation: 2 passed, including delayed cleanup preserving a
  healthy new-generation process and stopping it only after a newer revocation.
- Disposable PostgreSQL lifecycle integration: 1 passed; native router/auth,
  DPAPI seal, create/replay/conflict, reconnect, pause/resume, repeated Sync,
  tenant isolation, snapshot/baseline preservation and removal. No collector or
  broker login runs in this fixture. The unrelated read-tool DB test matched by
  the revocation name filter was not executed by that unit-test command.
- Existing broker-worker authority/warm-session tests: 10 passed, synthetic SDK.
- Account model/navigation/request tests: 20 passed, including selected-history
  isolation, missing/stale values, duplicate-account seed and uncertain mutations.
- Locked release build and final diff check passed. No schema/dependency version
  update; only features on the already pinned Windows API binding were enabled.

## Actual local runtime

Saved the old owner manifest and account identities before guarded cutover.
Preflight found schema20 current, no pending migrations, no active jobs/downloads
or unresolved broker submissions. Stopped only the manifest-owned native/compact
runtime and started the candidate with the same DB/artifact/QDM/scientific/legacy
capabilities, AI interpreter and installed MT5 adapter root. Canonical source is
still projects/trader; runtime ownership stays in the previous checkout.

Deployed API SHA256:
`27157a271f7c3ff712451d0fb4f62674c29bf3c133fe0981b5f5284aecfbbd5c`.
Matching schema20 admin/research binaries were retained; no migration or UI build.

Actual Exness and FTMO demo observations:

- Both accounts connected again with fresh sync timestamps and no error code.
- Both terminals' windows were enumerated on their own Naqex-MT5 desktops; zero
  visible terminal windows on Default and zero interactive main-window handles.
- Clicked **Sync all** in the served UI: both native requests returned200.
  Terminal PIDs/creation identities remained identical, one terminal per account.
- DB comparison preserved connection IDs, authentication generations, requested
  modes, encrypted-credential hashes and account keys. No unknown submissions.
- Browser visited each account's cashflow view and verified the returned native
  connection_id; reload preserved the selected account and rendered its details.
  No page error occurred in the post-cutover reload check. Earlier connection
  errors during the intentional API restart remain in the private browser log.

The first read-only observer could not resolve cross-process desktop handles
with GetThreadDesktop; its failed measurement is preserved. Replaced that probe
with EnumDesktops/OpenDesktop/EnumDesktopWindows, verifying real window/PID
ownership without switching desktops. All7 runtime assertions then passed.

Scope limits: CRUD and revocation failure cases used the disposable DB, not
destructive actions on the owner's accounts. Real broker operations were reads
and connection maintenance only; no OrderCheck/OrderSend. This is bounded local
runtime acceptance, not long-duration soak or a claim that every account-flow
failure is eliminated.

Private evidence/rollback: `E:/BACKUP-TRADINGWORKSPACE/mt5-account-lifecycle-20261103/`.
Contains test/build logs, owner/account baselines, runtime-acceptance.json,
candidate hashes and guarded rollout.py. For rollback use its rollback action
after current ownership/idle/reconciliation checks; it restores the retained
binaries without reverting DB/account data. Browser artifacts stay in the scoped
tw-mt5-lifecycle-20261103 session; the session was closed after verification.
