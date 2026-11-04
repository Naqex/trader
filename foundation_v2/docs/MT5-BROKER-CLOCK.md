# MT5 broker clocks

The native adapter publishes UTC timestamps and preserves source timestamps.
Clock decoding never uses the latest quote's distance from the host clock. That
would reclassify a delayed quote as fresh. Source age, risk and grant gates still
run after decoding, including the final check immediately before send.

## Verified binding

| Server | Source clock | Decoding |
|---|---|---|
| `FTMO-Demo` | Broker wall time; 2026 winter UTC+2, summer UTC+3 on the US DST schedule | `ftmo_demo_server_2026_v1`: New York UTC offset plus seven hours; only events from 2026 onward |
| Other servers | Existing SDK UTC contract | `sdk_utc_v1`, unchanged; never infer a broker from a prefix, label, account name or quote age |

Exness documents UTC+0 and observed `Exness-MT5Trial17` ticks match it. FTMO
documents GMT+2 + DST; its March and October 2026 updates give the US transition
dates. The observed `FTMO-Demo` raw tick is about two hours ahead of host UTC on
4 November, while Exness is not. This is an explicit account/server integration
profile, not a universal interpretation of every MT5 feed. Recheck the profile
when the broker changes its schedule, server or feed semantics. An unknown FTMO
server is not automatically assigned this profile.

The MetaQuotes Python tick-history page describes UTC data, which conflicts with
this observed binding. The supported profile records that exception instead of
changing the Windows clock or removing the future/stale guard. DST gaps/folds,
missing timezone data and pre-2026 FTMO events fail closed rather than guessing.

## Boundaries

- Live quote `time_msc` and chart bar `timestamp` are UTC. Quotes also preserve
  `source_time_msc`; bars preserve `source_time`. The snapshot carries `clock`.
- Collector deals/cashflows, positions, orders and position quotes use the same
  decoder and preserve their corresponding source time. The SDK history range
  uses a UTC-aware broker-time envelope, followed by filtering on decoded UTC;
  this includes a current deposit/fill without admitting events after the cutoff.
- Broker reconciliation uses that same range/decoder and rejects future matches.
  Ticket, comment, magic, account, symbol, volume and final-state checks remain.
- Grant/session expiry stays absolute UTC. The broker's platform day does not
  replace the Prop reset timezone (`Europe/Prague`) or alter approved risk limits.
- Reconnect with a full collection after installing this change. Do not rewrite
  old command receipts or manually edit cached DB timestamps. A failed collection
  preserves the prior journal until a verified replacement arrives.
- Legacy manual `mt5_read_worker.py` exports and QDM historical files are separate
  input contracts. This live adapter change does not reinterpret or qualify old
  datasets. The legacy reader must not export a non-UTC binding as UTC.

## Evidence and sources

The shared workspace AI receipt owns runtime results. Synthetic clock, adapter,
collector and reconciliation tests cover winter/summer, US/EU mismatch weeks,
milliseconds, stale/future ticks and ambiguous/unsupported times.

- [FTMO account specifications](https://ftmo.oanda.com/faq/what-are-the-account-specifications/)
- [FTMO 5 March 2026 update](https://ftmo.oanda.com/blog/trading-updates/trading-update-5-mar-2026/)
- [FTMO 22 October 2026 update](https://ftmo.oanda.com/blog/trading-updates/trading-update-22-oct-2026/)
- [Exness server timezone](https://get.exness.help/hc/en-us/articles/360014390760-What-is-the-default-timezone-set-for-MetaTrader)
- [MetaQuotes Python tick-history contract](https://www.mql5.com/en/docs/python_metatrader5/mt5copyticksrange_py)
