# Exness demo broker trial — 29 October 2026

## Scope and runtime

Owner explicitly requested trading through this project on the selected Exness
Demo account to populate Live pages and verify execution/performance. The bounded
trial used 0.01 lot with SL/TP, at most 12 closed round trips, a $10 observed-loss
stop, no retries of unknown sends, and at most two protected positions left open.

- Workspace: `tenant-a`.
- Connection: `492ec8a5-3938-41a3-8a26-8c0f7f59ed43`.
- Account: `464104926`, `Exness-MT5Trial17`, verified MT5 `trade_mode=demo`.
- Product source: `389d1dba`; native/compact API on `:8010`, UI on `:5180`.
- API owner PID `22824`; executable path and SHA-256 matched the runtime manifest.
  SHA-256: `64887cf9230252e2b888b91fdf9736bc8ac5c684d30adfb3435cda3aca70764d`.
- No API or terminal restart, trading-policy change, direct SDK order call,
  synthetic financial record, or automatic order retry.

Raw JSON, requests, timings and screenshots are retained locally at
`E:/BACKUP-TRADINGWORKSPACE/demo-broker-acceptance-20261029/`.
They contain account/trade identifiers but no broker credentials.

## Clock blocker and recovery

The initial preview returned `demo_quote_stale`, with no send. Windows time service
reported unsynchronized / Local CMOS Clock. Three read-only Microsoft NTP samples
showed the host ahead by about 4.37 seconds, consuming most of the 5-second quote
freshness budget. The owner separately authorized correcting system time.

An ordinary `w32tm /resync /rediscover` was access denied; the elevated resync did
not establish synchronization. A bounded elevated script measured three stable
NTP samples and used `Set-Date` for a one-time -4.3675773-second correction.
Post-correction samples were +8.5 ms and -1.1 ms. A subsequent BTC snapshot had a
786 ms quote age and the UI protection controls were enabled. No freshness limit
was relaxed. This is a measured point-in-time correction, not verification of
persistent Windows time-service configuration or long-duration clock stability.

Evidence: `clock-sync.json`, `sync-clock.ps1`, `api-samples.json`.

## Broker results

All 27 submitted commands returned MT5 `10009`, no reconciliation required:

| Action | Count | Coverage |
| --- | ---: | --- |
| Market placement | 14 | BUY and SELL; BTCUSDm, EURUSDm, GBPUSDm |
| Full position close | 12 | Inventory checked after each close |
| SL/TP modification | 1 | Broker snapshot confirmed changed TP |

The first BTC placement and full close used the actual web ticket, preview,
confirmation and send controls. The remaining commands used the same project
native HTTP API, preserving workspace/account/connection identity, fresh quote,
OrderCheck and receipt persistence. Each API command body/UUID was saved before
submission. There were no unknown outcomes, partial fills or send retries.

- First UI placement: request `13798a5c-aaf0-44a4-aded-d5e17c478dfa`, position/order
  `2760812567`, deal `2467437094`.
- First UI close: request `a0f5e4d0-6906-43bd-bb3a-ff1a01cc56df`, deal `2467437295`.
- Final history: **26 deals = 24 deals for 12 completed round trips + 2 entries**.
- Closed net P/L: **-$2.00**; balance **$9,998.00**, from $10,000.00 initially.
- History profit + commission + swap + fee agrees with the balance delta.
- No outstanding pending orders or unresolved command receipts.

Protected positions left open at the final check (floating P/L can change):

| Ticket | Symbol | Side | Lot | Entry | SL | TP |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| 2760813848 | BTCUSDm | BUY | 0.01 | 81147.40 | 81040.33 | 81296.73 |
| 2760813851 | EURUSDm | SELL | 0.01 | 1.11541 | 1.11660 | 1.11390 |

Initial broker stop-risk estimates for these two entries were $1.07 and $1.19;
these exclude slippage, gaps and unknown costs and are not guaranteed loss caps.
Final observed equity was $9,997.58, floating P/L -$0.42.
This receipt grants no future trading authority.

## Live pages and remaining report issues

Verified real, naturally refreshed broker data in MT5 Overview, Trades, Calendar,
Analytics, and Account Transactions/details. Trades displayed 26 deals and -$2;
calendar displayed the same total; account details displayed $10,000 baseline,
$9,998 balance and -$2 net P/L. The UI was using UTC+0, so these fills are dated
28 October UTC (29 October in Vietnam). No history was backdated or synthesized.

Created one explicitly labeled QA note through the web form, attached to the
connection; saved note `6ae00f10-8a14-4be9-b7d6-b62e6416a551` survived reload.

This run exposed limits that are **not accepted as correct trade analytics**:

1. `LiveSurfaces.jsx:LiveAnalyticsReport` maps every broker deal into a closed
   analytics trade, with identical open/close timestamps and prices. The report
   consequently shows 26 trades and 14 breakevens, despite 12 completed positions
   and 2 open positions. Holding-time and trade-level statistics need a separate
   position/deal reconstruction contract, including partial/netting behavior.
2. The adapter reads `account.opening_balance`, while this broker payload supplies
   `balance_baseline`. Account balance/return/monthly percentage values in this
   report remain unavailable despite the baseline being available elsewhere.
3. Broker deals have no journal-record tag linkage in the current UI/model.
   Tag Analytics remains honestly empty. Note tags do not tag broker deals;
   no duplicate manual trades were created to populate it.

Total broker P/L was verified, but these trade-level analytics semantics were not
changed or declared accepted during an execution/data-population trial.

## Performance and limits

Native timings include the complete local HTTP response/JSON read. The 25 native
commands comprise 13 placements, 11 closes and 1 protection update; the other two
commands were submitted through the UI.

| Measurement | Samples | Median | Sample p95 | Maximum |
| --- | ---: | ---: | ---: | ---: |
| Native command | 25 | 603 ms | 816 ms | 845 ms |
| Passed native preview | 13 | 376 ms | 509 ms | 509 ms |

Warm browser full-document navigation until rendered real data was observed:
Trades 942 ms; Calendar 901 ms; Analytics 901 ms; Account Transactions 934 ms.
One sample per page, shared warmed browser/runtime; not cold-start, load/capacity,
long-duration or stable tail-latency evidence. Earlier selector-wait failures and
the rejected stale preview remain in the raw evidence.

No measured API/frontend bottleneck justified changing product code. Broker
journal/history refreshes remain periodic (about 60 seconds); order receipts and
chart inventory are separate from that refresh. No performance guard was bypassed.
Pending creation, partial close, Real accounts, disconnect/unknown reconciliation,
idempotent replay, broker SL/TP triggering and multi-day/P&L-diverse history were
not exercised. All closed test positions were losses; no profitable record was
fabricated. Existing unrelated worktree changes were left untouched.
