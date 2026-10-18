# Session trading options

New Backtest and Propfirm Normal sessions use **Create session → More options**
(`Tạo phiên nhanh → Tùy chọn thêm`). Spread and commission are off by default;
slippage defaults to zero. FTMO presets are outside this feature.

The creation request stores `trading_options.version = session-trading-options-v1`,
`costs_enabled`, and exactly one asset config for every selected dataset ID:

```json
{"spread_price":"0","commission_per_lot":"0","commission_charge":"round_trip","slippage_price":"0"}
```

Amounts are nonnegative decimal strings, at most 1,000,000 and 12 decimal places.
Spread and slippage use price units, not pips. The UI explains the conversion
with EUR/USD: `0.00010 = 1 pip`. Commission uses account currency per lot for FX,
or per quantity unit for other asset classes.

## State and calculations

The form sends the same configuration through Backtest creation or the Prop
bundle's `resume_state.setup_metadata`, then replay creation. Rust validates the
selected asset set and freezes this payload. Initialization, including the atomic
quick-order route, uses the saved active asset configuration instead of caller
cost defaults. Metadata and branches retain it; PATCH cannot change it. Starting
balance is pinned when supplied at creation. Session settings show the saved
configuration even before the simulator initializes.

`session-cost-v1` isolates the new calculation from legacy sessions:

- With zero spread, Bid and Ask both equal the raw chart close; quick BUY and
  SELL fill there immediately. Zero commission and slippage give zero initial P/L.
- Enabled spread is fixed and simulated. Bid/Ask use chart close minus/plus half
  spread, rounded outward to the instrument tick. It is not historical spread.
- Commission is `rate × quantity`, doubled only for `per_side`. For example,
  7 USD/lot at 0.01 lot costs 0.07 USD round trip, or 0.14 USD per-side convention.
- Slippage remains a modeled round-trip cost:
  `price_per_side × 2 × quantity × contract_size × quote_to_account_rate`.
  It does **not** move the chart fill. The UI states this explicitly.

Configured sessions use bar execution; historical Bid/Ask tick mode cannot be
mixed into them. Legacy sessions without `trading_options` keep their stored
costs and tick behavior. Python compatibility mode explicitly rejects the new
options rather than silently dropping them. No database migration is required.

## Limits and validation

Leverage/margin and hedging are visibly unavailable for this bar model. It
retains one active position per asset. Quote-to-account conversion still uses
the existing assumption `1`; cross-currency financial accuracy is not added by
these settings. No historical Bid/Mid candle provenance or FTMO realism is claimed.

Focused tests are `web/tests/sessionTradingOptions.test.mjs`, the existing Prop,
validation and settings suites, and `api-rust/tests/session_trading_options.rs`.
The two browser scripts `sessionTradingOptions.browser.mjs` and
`sessionCostsQuick.browser.mjs` intercept creation/trading writes; they validate
real UI controls and outgoing configuration, not backend financial calculations.

For real native/compact HTTP calculations on a disposable database, from
`foundation_v2` run:

```powershell
.\.venv\Scripts\python.exe -B api-rust/tests/session_trading_options_pg.py --pg-bin <installed-postgresql-bin> --output evidence/<attempt>/backend.json
```

This runner creates its own temporary PostgreSQL cluster, overrides the owner
DSN/artifact root, and stops/removes the fixture afterward. The Rust test also
refuses any database whose name does not start with `rust_metadata_`.
Evidence for this slice is in `evidence/session-trading-options-20261018/`.
