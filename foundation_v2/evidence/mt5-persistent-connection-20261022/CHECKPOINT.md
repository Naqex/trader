# Persistent MT5 connections and account labels — 22 October 2026

Base: `6284ce1`, branch `Nam`. This receipt covers the owner's three account-table
comments and continuous connection request, not whole-product or broker execution
acceptance.

## Behavior and data flow

Both `read_only` and `trading` connections now use the existing native-owned
persistent Python worker and its isolated portable MT5 terminal. The API supplies
the saved access mode with workspace, connection, credential and generation;
collection checks that exact binding in PostgreSQL and in the worker. Read-only
workers disable terminal trading and reject every operation except collection.
The native trading context still requires saved trading access and verified
execution permissions. An investor connection is never promoted implicitly.

Normal account/history updates reuse the same authenticated session every 60s
and retain connected status. Actual failures enter error, close the unusable
collection worker and retry after the existing 5-minute interval. Pause,
disconnect, reconnect and API shutdown revoke the owned terminal process tree.
No per-refresh terminal/file cleanup occurs. This trades a resident terminal per
active connection for less startup churn; it is not tick streaming. The trading
chart retains its separate 2-second read loop. The local API/machine/network must
remain available. There is one native API owner and at most 10 cached workers.

The table appends ` - Chỉ xem` to the saved name only for read-only connections.
The saved name itself is unchanged. Source displays MT5 without the Demo/Real
badge; the duplicate access line under status is removed. Broker environment
remains present in the connection data and trading flow.

## Verification

- Python connector, order helper and worker: **39 passed, 36 subtests passed**.
  Added coverage starts a synthetic read-only session once, performs two reads
  without shutdown/reinitialization, checks terminal trading stays disabled,
  denies snapshot/preview/command/reconcile, and rejects stale/revoked access.
- Rust focused tests: **5 connector + 4 trading passed**, including in-flight
  revocation retaining the worker slot. Targeted rustfmt and diff checks passed.
  A repository-wide fmt check also exposed existing formatting differences in
  unrelated files; those files were not reformatted.
- Disposable PostgreSQL: [connections](connections-pg.json) and
  [trading receipts](trading-pg.json) passed. These test native authorization and
  lifecycle/receipt behavior without broker orders.
- Frontend model/navigation: **12 passed**. Production Vite build passed with
  the existing chunk-size warning. Actual 5180 account table checked at 1920px
  and 360px. At 360px the document stays 360px wide and the table scrolls inside
  its own region (287px viewport / 645px content). Temporary viewport reset.
  The non-hovered row has a transparent cell background.
- Actual existing authorized account: [141.7-second observation](warm-receipt.json),
  **27 samples**, all connected, no error, read=true/trade=false. Terminal PID
  **6320** and worker PID **14464** stayed unchanged. Three snapshot timestamps:
  `16:00:10.850414Z`, `16:01:11.266201Z`, `16:02:12.269156Z`.
  Full observations: [warm-samples.json](warm-samples.json). The observer only
  reads local connection state/process identity; no credential is logged.
- Screenshots: [connected account](account-connected.png),
  [360px table](account-360.png). The narrow screenshot was captured before the
  API swap; the same final frontend build was used on both runtime versions.

## Runtime and limits

Native/compact API 8010 was restarted through the verified owner manifest; UI
5180 serves the new build. No migration was needed. Previous binaries are kept
at `.runtime/api-builds/mt5-persistent-before-20261022` for rollback. The earlier
verified DB/artifact backup remains unchanged. Runtime identity and source hashes
are in [runtime.json](runtime.json) and [source-sha256.json](source-sha256.json).

Before deployment, the old cold read-only collector again reported
`mt5_identity_changed` and later recovered on its scheduled retry. No identity
check was relaxed. The warm observation did not reproduce this error; it does
not establish that every future cold startup or network recovery will succeed.
Long-duration operation and actual trading access/fills remain unverified. No
broker order was sent. The user's existing connection remains read-only.
