# Local Owner and Automation capabilities

Native loopback runtime can opt in to `local-capability` authentication. The
compatibility default remains `local-trusted-identity`. This separates HTTP
authority; it is not an OS sandbox against a process that can read the same
Windows user's private files or database credentials.

## Provision and start

Use the runtime-owning checkout, not a historical path from a receipt:

```powershell
python -X utf8 scripts/local_owner_access.py prepare `
  --output <project>/.runtime/local-owner-access `
  --origin http://127.0.0.1:5180 --origin http://127.0.0.1:8010
```

The command creates a private immutable generation and prints paths/expiry only.
`capabilities.json` contains digests plus the private browser session material;
`owner-secrets.json` contains the Owner bearer and bootstrap nonce. Keep both out
of Git, URLs, screenshots, logs, tasks and model prompts. Windows directory ACLs
allow the current user and SYSTEM. Provisioning does not activate the generation.

Pass `--local-capability-file <generation>/capabilities.json` to the existing
`run_api_platform.py --runtime-profile native` launch command, retaining its
storage, database, artifacts, download and installed capability arguments.
The launcher sets `TW_V2_AUTH_MODE=local-capability` and
`TW_V2_LOCAL_CAPABILITY_FILE`. The flag is rejected for compatibility profiles;
without it, inherited capability settings are cleared. The manifest records
auth mode and path, never secret values.

The PowerShell maintenance wrapper accepts `-LocalCapabilityFile` too. When
omitted for an existing matching native manifest, it preserves that manifest's
secure config path. Missing config or mismatched ownership stops the operation;
maintenance does not silently downgrade authentication. Native download-idle
checks use the launcher's existing all-workspace DB guard.

Open `/api/v2/auth/local/login` through the Trader UI origin and enter the private
bootstrap nonce. It lasts ten minutes and can be exchanged once. The resulting
cookie is HttpOnly, SameSite=Strict, limited to `/api/v2`, and has a twelve-hour
absolute expiry. Mutations require the exact configured Origin and CSRF token.
The web transport keeps CSRF in memory and never automatically replays a failed
mutation. The spent-nonce sidecar survives API restarts without renewing expiry.

The Owner bearer lasts seven days and is for scoped local maintenance clients.
After expiry, or to invalidate a generation, run `prepare --rotate` and restart
the owned runtime with the newly printed config path. Rotation preserves old
files for rollback and does not change the running process. A valid fresh nonce
can replace a previous browser cookie. No background credential renewal exists.

## Bounded Demo runner

An authenticated Owner may POST an immutable policy to
`/api/v2/automation/grants`. It binds workspace, connection UUID/generation,
login/server, Demo environment, currency and artifact SHA-256 to allowed symbols,
actions, expiry, volume, attempts, risk and account floors. The API returns one
random runner credential once; PostgreSQL stores only its digest. No grant is
created by installation, migration or a research result.

The runner may only:

| Method | Path | Effect |
|---|---|---|
| POST | `/api/v2/automation/trading/commands` | One bounded submission through the native receipt/adapter |
| GET | `/api/v2/automation/trading/requests/{request_id}` | Read its own grant/credential receipt |
| POST | `/api/v2/automation/trading/reconcile` | Read broker history to reconcile; never resend |

The same UUID and fingerprint returns the existing receipt. Conflicting reuse
is rejected. An unknown receipt and risk reservation commit together before the
adapter runs. Unknown/accepted/partial outcomes retain their reservation;
proven rejection or full fill releases reserved capacity, while attempts remain
consumed. Actual open-position risk is checked independently before a new send.

The final SDK guard requires Demo hedging, mandatory SL, fresh quote, spread,
volume, position count, per-trade and aggregate downside including the approved
cost buffer, equity/free-margin floors, current connection authority and expiry.
It performs one OrderCheck, revalidates before a single OrderSend, and never
retries an uncertain send. These calls require a separate approved grant/session;
maintenance or read-only access is insufficient authority.

Equity/free-margin floors and aggregate-risk admission apply to opening new risk.
A full close of a proven owned position remains available within the grant when
the account falls below those floors; identity, ownership, freshness, approved
spread, volume, expiry and connection fences still apply.

Owner revocation at `/api/v2/automation/grants/{grant_id}/revoke` takes the same
terminal lock as submission. It waits for an operation already holding the lock,
then denies new sends. It does not close positions. Expired/revoked credentials
can still read and reconcile their own receipts. Reconnection changes generation
and requires a new grant.

Current limitation: automated close is restricted to positions whose current
ticket equals their stable identifier and whose opening order belongs to the
same grant. Broker rollover can change ticket; such a position is denied before
OrderCheck/send because the initial native receipt does not yet persist its
stable identifier for crash-safe reconciliation. No magic-number ownership
inference or automatic fallback to a manual credential is allowed.

## Migration and rollback

Migration `0021_automation_grants.sql` is additive and preserves native receipts.
Before applying it to an owner database, quiesce jobs/writers and use
`scripts/backup_api_platform.py` to verify a matching PostgreSQL/artifact bundle.
Migration requires the owner's explicit approval in addition to backup evidence.

Older schema-20 binaries reject schema 21. Rollback therefore uses a compatible
schema-21 build/config, or restores the verified pre-migration database and
artifacts together using the existing recovery procedure. Merely launching an
older executable is insufficient. Runtime, browser login, and broker execution
acceptance are separate from source/unit/disposable PostgreSQL verification.
