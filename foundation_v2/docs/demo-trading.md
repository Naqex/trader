# Dedicated DEMO execution

The Live trading workspace is locked by default. The existing investor connector
stays read-only and cannot become an execution connector. No activation policy or
broker/terminal execution was authorized as part of implementation and tests.

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

Live → Tổng quan MT5 → Mở biểu đồ uses the Practice dashboard/setup/chart visual
components while retaining this demo API and its receipt/controller ownership.
Setup only selects an allowed symbol and timeframe; it never creates replay/prop
sessions or mutates account balance, spread or fee assumptions. A single configured
demo terminal supplies execution identity. Investor journal connections remain
separate. Missing fees/specifications are explicitly unknown, not zero.
The frontend route sanitizer excludes replay/session/dataset/prop state.

Current runtime/UI evidence and limitations:
`../evidence/mt5-overview-flow-20261022/CHECKPOINT.md`.
