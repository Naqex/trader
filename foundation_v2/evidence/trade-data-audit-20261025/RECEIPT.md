# Trade data audit — 25/10/2026

Owner request: verify gross P/L, omit currency glyphs inside net/gross badges,
and check the trade table's data against persisted records.

## Findings and changes

- Before: all 13 closed rows had frozen execution cost breakdowns, but analytics
  hard-coded gross P/L and fees to null. Eight SL/TP values in closing-position
  snapshots were also omitted from the projection.
- Analytics now reads gross from the closing fill's cost breakdown and computes
  fee debit using decimal rounded gross minus rounded net. Example: gross −0.28,
  fees 2.00, net −2.28 USD. Spread is already embedded in bid/ask fill prices;
  subtracting it again would double-charge it. Currency/net mismatches fail.
- SL/TP come from the final closing-position snapshot, including partial closes.
  Legacy events without cost/protection evidence stay unknown. Planned risk and R
  remain unknown without an original risk denominator; final SL is insufficient.
- Net/gross badges show numbers without `$` or a currency suffix. Row currency is
  retained in their accessible name and shared hover/keyboard-focus tooltip.
  Fee cells retain currency context. Tiny nonzero percentages use significant
  digits, so −0.00228% displays −0.0023%, not −0%.
- Replay drilldown now prioritizes the trade's dataset over the session-selected
  dataset, retaining the portfolio cursor and event sequence.

## Data flow and evidence

Persisted execution event → native analytics projection → paginated Trades API →
shared trade ledger. Financial values are not recalculated from visible rounded
price strings. UTC storage and both real/chart clock fields remain distinct;
Settings controls presentation.

- 18 native analytics tests PASS, including frozen Python oracle parity (410
  cases), unknown costs, decimal rounding identity and mismatch rejection.
- Six native slippage integration tests PASS, covering BUY/SELL, partial closes,
  final protection snapshots and cost projection. Release API/UI builds PASS.
- `api-audit.py`: 13 rows / three persisted sessions, source prices, quantity,
  side, asset, currency, capital, gross/fees/net, protection, clocks, type and
  revision checked. All 42 sort directions PASS; pagination sizes 5/10/100 have
  no duplicates/omissions; four side/outcome/type/asset filters PASS.
- Current persisted sessions lack both entry/activity recording schemas: all 13
  real entry/exit timestamps correctly remain unknown. Twelve order types have
  source evidence; one remains unknown. Catalog/row labels and notes are empty.
  This receipt does not claim that historical real times can be reconstructed.
- Candidate and served browser QA PASS independently: 1920 dark/UTC, 1920
  light/Asia/Ho_Chi_Minh, 390 dark/Asia/Ho_Chi_Minh. All 13 rows across pages;
  2,580 cell comparisons per run, money/gross/fee UI sorting, row/detail identity
  and replay provenance. Labeled response fixtures cover mixed currency,
  unknown gross/fees and a portfolio asset differing from session selection.
- Independent review: no remaining findings; 27 focused model/story tests PASS;
  real candidate badge hover/focus/Escape PASS. Chromium AX fixture confirms the
  currency-bearing accessible name. A later real-page AX probe timed out during
  API cutover; it was not counted as a pass.
- No browser JS errors or write requests. QA blocks MT5/Live routes and external
  origins. Visual screenshots reviewed on desktop; screenshots/logs/raw sources
  remain private under `E:/BACKUP-TRADINGWORKSPACE/trade-data-audit-20261025/`.

Runnable checks from the product root:

```powershell
foundation_v2/.venv/Scripts/python.exe foundation_v2/evidence/trade-data-audit-20261025/api-audit.py
$env:UI_ORIGIN='http://127.0.0.1:5180'
$env:UI_STAGE='served'
node foundation_v2/evidence/trade-data-audit-20261025/browser-check.mjs
```

The real-data oracle intentionally asserts the observed legacy/empty-label
fixture. New recording proofs/labels require updating its expected fixture,
not changing the product to satisfy the old receipt. Initial browser attempts
failed on oracle label wording and a missing symbol expectation; both were
corrected in the check. They did not expose additional product defects.

## Local rollout

Idle checks and candidate compatibility passed before stopping the owned old API
through its guarded supervisor. Preserved native/compact storage, database,
artifact/download roots, scientific/legacy capabilities and AI interpreter.
No schema migration, record rewrite or terminal reconnect. Readiness verifies
new executable hashes (`ready.json`). Initial early readiness probe refused
connection before supervised startup completed; final readiness passed.

UI built from tracked HEAD plus explicit task overlays, preserving the verified
private CSS baseline and excluding unrelated WIP. Promotion retained old hashed
assets, private branding and atomic index replacement. Both served browser QA and
readiness passed after rollout.

- UI before SHA256: `f5b5f39fad47c104d5a3b5bebe7eb1b7dd2e613d0169c834fa73dd3e1ca52718`
- UI served SHA256: `82b1af415a3b3c9d3659da50015bbfe59144b5d15da4d00470f4b2baebfeb7b8`
- API run: `a25e5e079f124ca9abd892e1ca2943ec`
- Rollback: private `runtime-before/`, `ui-before-release/` and guarded
  `runtime.py`/promotion helpers under the E directory above.
- Existing Vite >500kB chunk advisory remains; unrelated to this data fix.

Scope: persisted replay Trades table and its native projection. This is not
Live/broker acceptance or a new calculation model for historical execution.
