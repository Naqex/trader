# Multiasset Backtest and Prop Firm — 18/10/2026

Scoped acceptance: **PASS** on the optimized Rust release; local API updated.
Backtest already supported multiple assets. This change completes native Prop
portfolio accounting and enables the shared creator for both modes, up to 12
unique datasets with one account currency and overlapping data coverage.

## Behavior and state ownership

Each asset retains its own execution state, positions and TP/SL. A canonical
portfolio ledger orders account events by causal timestamp, groups simultaneous
marks, counts initial capital once and pins every dataset. Changing the chart
does not change the account identity, add capital or create a financial event.
Prop consumes that account ledger rather than the selected asset's ledger.
PostgreSQL transactions, revisions and receipts remain authoritative.

Per-asset initialization and asynchronous order context follow the active
dataset. Chart overlay teardown retains its original Window so switching assets
cannot crash after the old iframe detaches. Prop resume restores all positions;
phase transitions apply one account-level capital reset.

## Verification

- 56 focused Node tests passed; production Vite build passed.
- Rust check/build passed; three portfolio tests, two Prop portfolio tests and
  the existing Prop differential corpus passed.
- Disposable PostgreSQL + native/compact optimized release + real browser:
  eight grouped acceptance cases passed, with zero JavaScript errors. Both modes
  created EURUSD/GBPUSD sessions, filled BUY/SELL immediately, switched charts,
  advanced a shared clock, dragged TP/SL with mouse events, closed positions and
  reloaded persisted state. Backtest historical reads/branches preserved parent.
- Independent arithmetic verified each leg's +/-2 USD result: the shared +/-4
  USD crossed a 3 USD target/loss rule. Phase reset funded 20,000 USD once;
  exact retries did not fund twice. Same-day fills counted one qualifying day.
- Ordered/skipped/stale/foreign feeds, duplicate/delayed retry, unacknowledged
  financial writes, daily reset and calendar expiry were checked. Expiry does
  not falsely acknowledge a later replay mark.
- Independent source/interaction review found no remaining concrete defect
  within this scope. Desktop/mobile screenshots were reviewed.

Reproduce from `foundation_v2` using an isolated target:

```powershell
.\.venv\Scripts\python.exe -B scripts/native_multiasset_acceptance.py --evidence-name ../.runtime/evidence/native-multiasset-release-r10 --binary-directory api-rust/target/prop-fix-20261018/release
```

The committed [receipt](receipt.json) retains the sanitized case list, release
identity and owner read-only smoke result. Raw attempts/screenshots remain under
`.runtime/evidence/native-multiasset-release-r10/`. Earlier failed attempts
include the real iframe teardown defect and harness fixture/assertion fixes;
only the final successful run establishes acceptance.

## Local runtime

API SHA256: `23d5ac9632ac920c454e3e7296413f3c0fda89a624b8451618355c1fafc125f2`.
The existing managed runtime was stopped through its ownership/idle guards,
the prior API executable retained under `.runtime/multiasset-rollback-20261018/`,
and only the API binary replaced. Scientific/legacy codec descriptors and
existing research/admin binaries were preserved. Native/compact startup and
`/health/ready` passed; schema 6 had no pending migration. No migration applied.

Production UI preview remains on port 5180, API on 8010. A post-restart real
catalog creator smoke passed three cases at desktop/mobile sizes with all
mutations blocked, zero unexpected writes and zero JavaScript errors. Owner
sessions were not traded, stepped or reset for testing.

## Boundaries

Acceptance used two synthetic FX datasets sharing USD; the 12-asset selection
limit is not a 12-asset load/performance benchmark. No mixed-account-currency
conversion, multiasset tick execution, broker margin, provider or live broker
acceptance is claimed. Multiasset uses full replay responses inside the native
runtime; compact single-asset envelopes are unchanged.

Unknown historical intrabar equity coverage remains explicitly blocked for
monetary Prop verdicts while money, positions, acknowledgements and calendar
expiry persist. Later flatness cannot certify the earlier path. Traded legacy
Prop portfolios without canonical account history require a new session; their
stored history is preserved. This is scoped feature acceptance, not whole-product
or unrestricted Prop challenge acceptance.
