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
