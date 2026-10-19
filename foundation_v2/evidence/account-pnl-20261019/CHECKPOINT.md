# Consistent PnL and account equity display

The native replay account pill previously showed Balance alone. It now reads
Equity from the authoritative portfolio account (or single-asset execution).
When any asset has a position, a signed floating PnL and matching semantic dot
appear beside it. Presence follows portfolio open-position count, then asset
states/execution where that count is absent; pending orders do not count.

The popup keeps Equity, realized PnL and unrealized PnL. Realized is Balance minus
starting balance, as in the existing replay account model. Positive/negative PnL
uses project gain/loss tokens, including portaled popup values. Zero/unknown are
neutral; an unknown Equity displays a dash instead of silently using Balance.
The account currency takes precedence over the selected asset currency.

Audit of the product checkout found mixed P/L and PnL in current web screens,
translation values, API metric descriptions, archived evidence and retired Flask
templates. Standardized current frontend labels, fallback model copy and project
UI contracts to PnL: 65 localized values changed, with zero P/L display values
remaining in the catalog. Legacy translation IDs are retained so API-provided
metric copy still localizes correctly; translateTesting already resolves both
keys and localized values. API field names, metric versions, numerical formulas,
historical receipts and retired templates are not migrated by this UI change.

Validation:

- Production build passed (existing large-chunk advisory).
- 51 focused unit checks passed: copy interpolation/spelling, Dashboard,
  Analytics, period summaries, Live models and replay order contracts.
- `browser/browser.json`: 18 account snapshot journeys passed on the actual
  preview/native chart at 1368px EN/dark and 390px VI/light, with no browser
  errors or unexpected requests. Cases cover closed gain/loss, open gain/loss,
  partial close, open zero, another asset open, pending-only and unknown values.
  Checks assert Equity vs Balance, conditional floating indicator, sign, colors,
  translations and viewport containment.
- Reviewed desktop open-loss and mobile closed-loss screenshots. Reloaded the
  owner's tab and inspected actual VI account labels (`owner-account.png`);
  no order submitted, no playback advanced.

Automated financial snapshots are synthetic display oracles, not engine-fill
tests or broker execution. The rendering reads existing account state; the
execution engine and persistence contracts are unchanged.
