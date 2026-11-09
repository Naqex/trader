# MT5 chart market stream

Managed Live charts use `GET /api/v2/live/trading/events` with the existing
`X-Workspace-Id` header and local-origin boundary. Browser reads use fetch SSE;
orders remain explicit HTTP commands with preview, confirmation, idempotency and
reconciliation. Backtest/Prop remain deterministic revisioned replay actions,
not subscriptions to live broker prices.

Flow: `MT5 terminal → warm owned SDK worker → Rust MarketHub → SSE → chart datafeed`.
The Python MT5 SDK is sampled every 500 ms, without overlapping/catch-up calls.
This is a continuous browser stream with a sampled terminal adapter, **not** a
broker tick-push feed or a guaranteed sub-500-ms execution path. A slow SDK/lock
delays the next sample. Quote timestamps remain the broker timestamps.

## Managed account lifetime

Each connected account keeps its own warm terminal/SDK worker. Two accounts can
therefore have two background `terminal64.exe` processes; sharing one terminal
would let a login replace the other account. The API starts managed workers on
an owned, noninteractive Windows desktop, including SDK-launched descendants.
It never switches the user's desktop; terminal windows stay off the taskbar.
Job-tree cleanup and per-account generation/identity checks still apply.

**Sync** requests fresh history on the existing session without changing its
generation. It cannot resume a paused/disconnected account. Credential changes,
pause/resume and disconnect still revoke older generations; delayed cleanup must
preserve a worker that already belongs to the new generation. Remove preserves
the existing unresolved-submission gate. These operations grant no order authority.

### Connection diagnostics

The API emits JSON `mt5_connection_transition` events only when collector status
or error code changes. Each record includes UTC timestamp, workspace/connection
ID, generation, old/new status and old/new machine error codes. The connection ID
identifies the account without logging its login, name, credentials or snapshot.
The before/after pair comes from the same locked database update; stale-generation
writes and unchanged healthy/error polling emit no transition. Terminal lock
contention keeps the previously verified status, so it is not a disconnect event.

Explicit connect, sync, pause/resume, disconnect and remove actions emit
`mt5_connection_action` after persistence. These correlate a user-requested refresh
with a temporary queued/syncing state instead of assuming every unavailable read
means broker network failure. Logs are diagnostic history, not a state store or
proof that the broker connection was continuously healthy.

Enable this module when the runtime otherwise uses `RUST_LOG=warn`:
`RUST_LOG=warn,trading_workspace_api::mt5_connector=info` in the owned launcher
environment. Keep the launcher-sanitized `platform-<run_id>-api.out.log` with the
matching owner manifest/receipt. No extra collector, database migration or logging
service is required. Logs follow the existing runtime's retention/backup policy;
they do not reconstruct incidents before instrumentation was enabled.

## Market subscriptions

- One producer per workspace, subject, connection, symbol and timeframe; up to
  8 feeds, 8 subscribers per feed and 32 stream connections per API process.
  Streams from different scopes never share data. Existing database terminal
  locks still serialize SDK reads and commands across processes.
- Initial/recovery reads contain 300 bars. Warm reads contain the most recent
  3 bars, with an authoritative full read every 5 seconds. The producer retains
  at most 300 bars. A subscriber receives a full `snapshot` first, then `update`
  objects containing changed fields and changed bars. `replace_bars: true`
  replaces history when an authoritative read removes bars.
- Watch channels retain the latest complete state. A slow subscriber receives a
  delta from its own last delivered state, without a growing event queue. Every
  reconnect begins with a full current snapshot; events are not an audit log.
- Heartbeats arrive every 2 seconds. Streams rotate after 10 minutes. Browser
  reads fail closed after 15 seconds without bytes and reconnect with bounded
  backoff. Hiding the page releases its stream; showing it reconnects. Producers
  stop after their last subscriber leaves and any in-flight read completes.
- SDK identity, connection generation, requested mode and permissions are checked
  using the existing read path on every sample. Unavailable reads back off to
  2 seconds. Revoked/deleted/unauthorized bindings clear retained visual data.

The chart alone may retain its last good bars/identity/instrument during a
temporary outage in the same scope. Order controls use the current authoritative
snapshot and stream state; cached chart data never grants trading permission.
The 5-second quote freshness guard is unchanged. Warning overlays do not change
chart geometry, so their appearance does not resize the native chart.

The in-chart asset selector is an anchored searchable popover. Search does not
navigate; selecting a symbol or timeframe changes the URL scope. Overview setup
and broker-condition dialogs retain their separate roles.

Validation: `node --test tests/liveMarketStream.test.mjs tests/liveChartDatafeed.test.mjs`
and `node run_live_market_acceptance.mjs` from `web/`; the latter uses a labeled
synthetic SSE server and blocks non-read API methods. Real SDK performance and
broker acceptance must be reported separately. No order submission is part of
this workflow.

## Restartable quote capture

Use `GET /api/v2/live/trading/ticks` for bounded tick-history pages rather than
turning SSE snapshots into an audit trail. It uses the existing authenticated
connection/worker, terminal lock and generation/identity fences, including
read-only connections. No second SDK attachment or terminal is created.
The consumer explicitly supplies `connection_id`, current `generation`, exact
`symbol`, `from_msc` and `to_msc`. Ranges are half-open UTC, second aligned,
at most 60 seconds, and end at least two seconds before host UTC. A page over
5000 returned SDK rows fails instead of truncating; use a smaller registered
page size. Revoked/paused/reconnected bindings fail closed.

The SDK uses `COPY_TICKS_ALL`; output retains Bid/Ask, flags, raw/UTC timestamps
and original ordering, including identical events in the same millisecond. This
is a quote capture contract, not a trade-volume or market-depth feed. FTMO queries
use the verified broker-clock profile; ambiguous DST intervals fail closed.
Response lineage includes connection/account/generation, clock, SDK version and
executed decoder/capture source hashes. HTTP authentication is still required;
this read route grants no execution capability.

An empty/successful range is **not** proof of complete broker tick coverage.
The SDK may backfill or revise history. Pages explicitly report
`coverage=broker_history_unverified`; their requested end is not a verified
event watermark for closing a strategy bar or authorizing an order. See
[bounded capture/recovery](FOREX-FORWARD.md#bounded-observed-quote-capture).

Primary SDK contract:
[MetaQuotes copy_ticks_range](https://www.mql5.com/en/docs/python_metatrader5/mt5copyticksrange_py).
