# MT5 broker trading

## Managed account connection

Live uses the selected account connection for both Demo and Real broker accounts.
The account environment comes from MT5 `account.trade_mode`; it is independent of
`requested_mode` (`read_only` or `trading`). Existing connections default to
`read_only` under migration 0011. Reconnect explicitly in the form to change access;
the app never treats a Demo account as a simulation or an investor password as
permission to trade. Trading requires the master/trading password and effective
MT5 account/terminal/Python permissions. Credentials stay DPAPI encrypted and never
enter command receipts or logs.

The flow is Live → Tổng quan → Mở biểu đồ (direct navigation). Symbol/timeframe
selection stays inside the chart. The account balance/equity, available assets,
quotes, lot/tick/stops/freeze constraints, margin and execution results come from
that account's MT5 terminal. Commission remains unknown until broker history
reports it; stop-risk estimates exclude unknown commissions, swap, gaps and
slippage. The managed path does not impose Prop/replay settings or application
risk/volume caps. SL/TP are optional when the broker allows it.

Pass `connection_id` on trading snapshots, previews, commands and reconciliation.
The native API resolves the connection in the authorized workspace, verifies its
stored permission/identity/generation binding, then sends private JSON lines to
`mt5_broker_worker.py`. The worker owns a separate portable terminal for that
connection and authenticates once. Both read-only and trading connections keep
their terminal running between journal refreshes; trading reads reuse that same
session. Read-only workers enable no terminal trading permission and accept only
health checks and journal collection. Health is checked about every 10 seconds;
history/account snapshots refresh every 60 seconds while the
local API is running, independently of which page is open. Heartbeats select only
connection metadata from PostgreSQL and never decode/merge its journal snapshot.
A successful incremental history collection reads the previous snapshot once to
merge it; a full sync replaces it. This is periodic data
refresh over a persistent broker connection, not tick streaming. Normal refreshes
keep the connected status. Transient IPC/network/terminal failures retry after
15 seconds; authentication, identity and other failures retain a 5-minute retry.
A live terminal keeps its session through a broker network interruption; a stopped
or broken worker is recreated. This recovery applies to reads/session ownership,
never to order sends. Windows broker discovery copies only public `servers.dat`/`.srv`
from data belonging to the installed terminal, never saved accounts/profiles/EAs.
SDK cold startup has a 60s budget, worker startup 75s and warm operations 15s.
Pause/disconnect/reconnect or API shutdown closes the owned terminal job, including
WebView children. No terminal cleanup runs after a successful periodic read:
cleaning there both disconnected MT5 and raced Windows file locks. A cold worker
cleans its private account/configuration directory before authentication, retaining
only the three owned MT5 executables. Initial setup seeds terminal, MetaEditor and
tester from the installed MT5 directory and keeps self-updated binaries. Removing
the companion executables made MT5 LiveUpdate download them and restart the
terminal even at the same build. No global update setting is changed.
The native local supervisor must remain the single API owner of this terminal root;
multiple independent API processes sharing it need a lifetime lease before use.

Each worker operation checks DB generation, requested access, status and encrypted
credential. Execution checks again immediately before its single `order_send`.
Pause/disconnect/reconnect revoke the worker; generation changes do not discard
unknown receipts. A broker timeout/crash remains unknown, blocks new sends and
requires read-only reconciliation. Reconciliation verifies the same account,
connection, environment and request identity across reconnects. Removing a
connection is denied while any receipt is unresolved. There is no automatic send
retry. A completed send result is preserved if access changes afterward.
Revocation retains the shared worker slot until the in-flight operation finishes,
so a new generation cannot start a second terminal while the previous one closes.

Current commands support Market placement, full close, SL/TP changes and canceling
existing pending orders on both hedging and netting accounts. New Limit/Stop orders
and partial close remain unsupported. The UI exposes only supported capabilities.
No broker order was sent for the implementation acceptance; synthetic SDK, native
PostgreSQL and UI fixtures are separate from actual broker execution acceptance.
See [current evidence](../evidence/mt5-connection-trading-20261022/CHECKPOINT.md).
Persistent read-only lifetime is verified separately in the
[warm-session checkpoint](../evidence/mt5-persistent-connection-20261022/CHECKPOINT.md).
Health/recovery and the bounded resource measurement are recorded in the
[connection-health checkpoint](../evidence/mt5-connection-health-20261022/CHECKPOINT.md).

## Legacy external DEMO policy

The following separately configured adapter remains available when no managed
`connection_id` is supplied. Its stricter Demo-only limits are retained for
compatibility; they do not configure the managed account flow above.

This external-policy path is locked by default and cannot promote an investor
connection. Its activation remains separate from managed connection access.

An operator must explicitly approve the exact DEMO account, workspace, terminal,
symbols and risk limits before configuring `TW_V2_MT5_DEMO_POLICY` to an absolute
local JSON file. The terminal must be a **separate portable installation**, already
authenticated as that DEMO account, with Algo Trading/Python execution permitted.
For practical use, that separate terminal must already be running/authenticated;
otherwise a request can incur a terminal cold start and timeout on each poll.
This implementation has no persistent trading-terminal service or automatic
login workflow. End-to-end broker acceptance remains unverified.
Do not point this at the investor connector, a personal/real-account terminal, or
the default `C:/Program Files/MetaTrader 5/terminal64.exe`. The adapter is owned by
the API process-tree job; descendants it launches terminate when that request
ends. It never copies terminals, accepts passwords, changes account permissions,
calls `login`, or modifies investor configuration.

The following is an **inactive shape example**, not authorization or working config:

```json
{
  "enabled": false,
  "mode": "demo",
  "workspace_id": "REQUIRES_OPERATOR_SCOPE",
  "terminal_path": "C:/REQUIRES_DEDICATED_DEMO/terminal64.exe",
  "login": "REQUIRES_EXACT_LOGIN",
  "server": "REQUIRES_EXACT_SERVER",
  "symbols": ["REQUIRES_EXACT_SYMBOL"],
  "max_risk_amount": 1,
  "max_risk_pct": 0.01,
  "max_positions": 1,
  "max_volume": 0.01,
  "max_quote_age_ms": 2000,
  "deviation_points": 0,
  "cost_buffer_per_lot": 1,
  "magic": 44556
}
```

Risk amounts are in the account currency; volume is broker lots, never replay
quantity. `cost_buffer_per_lot` must be deliberately specified from broker fees
and a chosen reserve; the product does not assume zero fees or derive leverage
from screenshots. Estimated stop risk uses `order_calc_profit` plus that reserve,
then combines all existing positions/pending orders and the candidate. The
Existing position downside is measured from a fresh liquidation quote because
equity already contains floating P/L. The account-wide cap is the smaller of `max_risk_amount` and current equity times
`max_risk_pct`. Unknown/unprotected existing exposure blocks new exposure. Stop
fills can gap/slip beyond the estimate; this cap is not a guaranteed maximum loss.

Only hedging DEMO accounts and Market placement are supported initially. Limit,
Stop and partial close are explicitly unsupported. Close/protect/cancel require
exact position/order ticket, allowed symbol and this policy's `magic`. Cancel can
operate on an existing managed pending order even though new pending placement is
not exposed. A Stop Loss is mandatory for new/protected positions. All commands
recheck account/terminal identity, DEMO mode, trade permissions, fresh quote,
volume/tick step, directional stop/freeze distance, risk, margin and `order_check`.
The policy is reread before SDK import and immediately before `order_send`.
Changing the quote during validation requires a fresh preview; a send is never
retried, including requotes/timeouts.

The HTTP interface is local-origin and workspace authorized:

* `GET /api/v2/live/trading?symbol=...&timeframe=M1` returns actual quotes,
  up to 300 bars (M1/M5/M15/H1/H4/D1), instrument specification, positions/orders, permitted limits
  and the latest 50 receipts. Missing policy returns `locked`, empty arrays and
  no account identity; the SDK is not imported or initialized. Polling is bounded
  by the caller; the adapter is not a permanent account service.
* `POST /api/v2/live/trading/preview` calculates/checks a draft without sending.
  It is advisory; commands independently revalidate current data.
* `POST /api/v2/live/trading/commands` requires a UUID `request_id`. Body uses
  `mode:'demo'`, string `account_id`, exact `server`, `action`, and applicable
  `symbol/side/order_type/volume/entry_price/stop_loss/take_profit/ticket` fields.
  Browser values never expand the local policy.

Migration `0010_demo_trading.sql` adds receipts and pause state. The API commits
an `unknown` intent **before** starting the trading adapter, serializes all SDK
operations (including snapshots/previews/reconciliation) with a PostgreSQL
terminal lock, waits for owned descendant cleanup before unlocking, serializes requests
for the same canonical dedicated terminal, and never resends the same request.
Same UUID with another body returns `409 demo_request_conflict`. A crash, timeout,
unknown broker outcome, asynchronous acceptance or partial fill blocks new sends
for that terminal. There is deliberately no browser "retry unknown" or "clear
unknown" button. `POST /api/v2/live/trading/reconcile` with the original
`request_id` performs read-only account history/state checks. Place/close require
exact request tag (full UUID encoded as a 25-character MT5 comment), magic,
symbol, side, time, order/deal linkage and final volume accounting. Protect and
cancel require exact managed ticket plus the requested final broker state and
post-submission update time. Missing/rewritten tags, active remainder,
incomplete history or ambiguity preserve the lock. No reconciliation resends.

`pause` and `resume` only change the persisted local gate; they cannot enable a
missing/disabled policy. Pause rejects new exposure and protection changes but
permits managed full close/cancel; it does not automatically close anything or
revoke a command already submitted. Snapshot remains `ready` with `paused:true`,
`execution_enabled:false` and per-action `capabilities`. An unresolved request
blocks every send until reconciled, including risk-reducing sends whose outcome
would otherwise be uncertain.

Verification is synthetic/offline: `tests/test_mt5_demo_trading.py`, Rust request
and origin tests, and disposable PostgreSQL receipt/control tests. These are not
a broker execution acceptance or permission to launch a terminal.

Primary protocol references: [order_send](https://www.mql5.com/en/docs/python_metatrader5/mt5ordersend_py),
[order_check](https://www.mql5.com/en/docs/python_metatrader5/mt5ordercheck_py),
[symbol properties](https://www.mql5.com/en/docs/constants/environment_state/marketinfoconstants),
[trade return codes](https://www.mql5.com/en/docs/constants/errorswarnings/enum_trade_return_codes).


### Product navigation

The dashboard/chart visuals reuse Practice components. Route sanitization drops
replay/session/dataset/Prop identifiers and preserves the selected MT5 connection.
Symbol/timeframe selection never creates a replay session or rewrites broker costs.
