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
| GET | `/api/v2/automation/trading/snapshot?symbol=...` | Read only the grant account/generation and an allowed symbol; fixed H1, at most 300 bars |

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

### Durable session client

`scripts/mt5_demo_session.py` runs a preapproved immediate open → full close
pair. It replaces one-off execution harnesses; it never creates a grant, chooses
a symbol/side/SL/risk budget, retries a command, renews expiry or falls back to an
Owner endpoint. The native API/SDK remains the authority for every send.

The operator supplies a private JSON manifest with:

```json
{
  "schema_version": "mt5-demo-session-v1",
  "api_origin": "http://127.0.0.1:8010",
  "workspace_id": "tenant-a",
  "connection_generation": 11,
  "artifact_path": "artifact.json",
  "artifact_sha256": "<approved artifact SHA256>",
  "expires_at": "<approved timezone-aware expiry>",
  "entry": {
    "request_id": "<fixed opening UUID>",
    "connection_id": "<approved connection UUID>",
    "mode": "demo",
    "account_id": "<approved login>",
    "server": "<approved server>",
    "action": "place",
    "symbol": "<approved symbol>",
    "side": "BUY",
    "order_type": "market",
    "volume": 0.01,
    "stop_loss": 1.10
  },
  "close_request_id": "<fixed distinct closing UUID>"
}
```

These are placeholders, not approved trade parameters. `artifact_path` resolves
relative to the manifest. Supply the native one-time grant response as a
separate credential JSON containing only `grant_id`, `credential_id` and
`credential`. Keep it private; never use the Owner bearer or put secret values
in command arguments, task bodies or reports. Start the runner without Owner,
database or provider credentials in its environment. The client uses no SDK/DB
and only the three Automation routes above. Plain HTTP is restricted to an exact
numeric loopback origin; environment proxies and redirects are disabled.

```powershell
# Choose a NEW session directory under the private evidence root; parent exists.
python -X utf8 scripts/mt5_demo_session.py start --manifest C:\private\plan.json --credential-file C:\private\grant.json --state-dir C:\private\session
python -X utf8 scripts/mt5_demo_session.py status --state-dir C:\private\session
python -X utf8 scripts/mt5_demo_session.py resume --manifest C:\private\plan.json --credential-file C:\private\grant.json --state-dir C:\private\session
python -X utf8 scripts/mt5_demo_session.py reconcile --manifest C:\private\plan.json --credential-file C:\private\grant.json --state-dir C:\private\session
```

`start` refuses an existing directory. A private directory, exclusive OS lock,
checksum, fsync and atomic replacement protect the local orchestration state.
The manifest/artifact and credential identity are checked again on resume; the
state stores only a credential digest. The native database remains the broker
receipt/budget authority; this file records only which client intents were made.

Each command intent is persisted **before** its single POST. After interruption,
timeout, malformed response or 404, the same intent is only read/reconciled, never
posted again. This deliberately sacrifices automatic recovery of a request that
crashed just before POST; absence of a receipt is insufficient evidence to send.
Full fill/volume, request/account/generation/grant/artifact identity must match
before proceeding to close. Partial fills or unknown outcomes require attention.
One invocation performs at most one receipt lookup and one reconciliation per
uncertain intent; it does not start an unattended retry loop.

`resume` may send a not-yet-attempted close after proving the opening full fill,
if the original approved session remains valid. `reconcile` never creates new
intents or sends, including a close. Expiry or a `STOP` file in the session
directory blocks new commands but permits reconciliation. These do **not** close
an existing position; `attention_required` means the Owner must inspect the
account. For immediate revocation use the native Owner revoke route. The native
fence is authoritative if revocation races an already admitted client request.
No automatic restart/scheduler or post-expiry liquidation is installed.

Console output gives status/reason/attention only. Full private `state.json`
retains native receipts and HTTP duration; stale SDK rejections also retain
quote timestamp, SDK observation timestamp, age and policy limit. None of these
diagnostics relaxes the 5-second quote gate or proves continuous tick coverage.
Both quote reads independently pass freshness. For price-free market-execution
requests, final Bid/Ask movement is bounded by the existing approved
`deviation_points` (broker points, not pips); risk, spread, SL and margin limits
are recomputed at that fresh quote. The checked request itself must remain
unchanged, so a price-bearing request still rejects changed price. Opening
equity/free margin, inventory, currency, grant and connection retain their change
guards. A full close may tolerate floating equity/free-margin movement because
it only reduces proven owned exposure. The retained final quote's age is checked
again after the last native fence. No added OrderCheck/send or automatic retry.
A state-change rejection reports changed preview field names and whether quote
drift exceeded policy, without exposing other positions.
Exit codes: 0 = proven open/close completion, 3 = blocked/stopped/attention,
2 = input/transport/checkpoint error. Paperclip continues to own tasks/reports;
do not add a second workflow-management UI around the session client.

### Decision-driven finite forward session

`scripts/mt5_forward_session.py` reuses the same transport, durable command
intents, receipt identity checks, file locking and native risk admission. The
immediate-pair client above keeps its original behavior. The forward runner
receives only its Automation credential; it cannot create/revoke grants, read
Owner routes, renew expiry, reconnect a terminal or change budgets.

Register `mt5-forward-session-v1` with an immutable session UUID, exact account /
connection generation, artifact digest, local API origin, source pins, native
adapter hashes, SDK version and clock metadata. `starts_at < finish_at <
expires_at` bounds the session to at most 15 minutes, with 30–120 seconds left
for a final close. Scope is USD EURUSD/EURUSDm, one cycle, 0.01 lot, at most $2
modeled downside and an explicit cost buffer of at least $20 per lot. The
controller must create a matching native grant with at most one position and
two submissions; the runner cannot authorize those limits by its manifest.

The registered input basis is `mt5_native_bid_h1_utc_v1`: all warmup and new bars
come from the same broker H1 Bid snapshot with normalized UTC times. It is
distinct from QDM/shadow midpoint quotes and is not a claim of complete tick
coverage. At least 20 closed H4 bars seed the unchanged candidate. Forming H1
and bars closed less than 30 seconds ago are excluded; historical bootstrap
never trades. Only a newly closed H4 decision, no older than 60 seconds, can
open. Changed closed OHLC, source/SDK/clock/identity, a missing cursor, stale
quotes, foreign exposure or unresolved submissions block new work.

Broker receipts and inventory determine positions, never the paper ledger.
Candidate EXIT or the explicitly registered finite session end can close the
proven owned full position. A full close receipt still needs a subsequent flat
inventory read. External SL closure may also prove flat by inventory; its P&L
is not inferred. STOP, pause, revoke, expiry and unknown outcomes preserve
attention/exposure; none means flat. Saved observations, decisions and intents
allow resume without replaying a POST, including a crash between decision and
intent. Reads/reconciliation remain possible after revoke/expiry while the
account/generation still matches. Source changes prevent new sends.

```powershell
python -X utf8 scripts/mt5_forward_session.py watch --manifest C:\private\forward.json --credential-file C:\private\grant.json --state-dir C:\private\forward
python -X utf8 scripts/mt5_forward_session.py status --state-dir C:\private\forward
python -X utf8 scripts/mt5_forward_session.py resume --manifest C:\private\forward.json --credential-file C:\private\grant.json --state-dir C:\private\forward
python -X utf8 scripts/mt5_forward_session.py reconcile --manifest C:\private\forward.json --credential-file C:\private\grant.json --state-dir C:\private\forward
```

`watch` is a finite supervised process, not a daemon or automatic restart. It
prints phase/cursor/observation time every step (about two seconds plus HTTP
time); retain PID, stdout/stderr and checkpoint paths and project the result
into the existing native Paperclip task. If no new signal occurs, completing
flat without an order is valid; do not force a broker entry for a green test.
This proves system behavior, not profitability, a qualified strategy, shadow
H1 handoff or unattended uptime. Release requires the integrated offline gate
and only the outstanding runtime/broker evidence, not repeated long captures.

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
