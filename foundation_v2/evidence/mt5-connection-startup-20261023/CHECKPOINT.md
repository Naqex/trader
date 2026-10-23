# MT5 connection startup and account controls — 2026-10-23

Scope: account table interactions, access selection and the first-login permission
regression. This receipt does not close the broader product/execution gates.

## Behavior and state

- Account names are static text; account-menu navigation remains available.
- Sync header text is static. Only its adjacent green icon queues sync; hover
  stays transparent. Row sync retains the same shared icon/tooltip.
- Native radio choices use project tokens: Trading left/default for new
  connections, Read only right. Existing saved access takes precedence.
- Switching access changes the password label; the form remains local until
  submit. No saved connection mode or credential was changed during QA.
- Error rows show only the status badge. Shared tooltip contains the existing
  localized diagnostic, without a permanent line below the badge.

## Startup diagnosis and fix

The previous owned terminal log showed successful authorization and trading
enabled, followed about 1 second later by `automated trading is disabled because
the account has been changed`. Startup config enabled Experts/live trading but
did not set the account-change behavior. The first successful snapshot could
therefore be followed by `mt5_trading_disabled` on the next health operation.

Generated config now explicitly sets `[Experts] Account=0`. This affects only
the project-owned terminal. Enabled/AllowLiveTrading still follow the saved
mode, DLL import stays disabled, and identity/credential/generation/permission
checks remain unchanged before operations. No automatic order retry was added.

Official references verified directly:

- https://www.metatrader5.com/en/terminal/help/start_advanced/start — Experts
  `Account`: disable (1) or not (0) when connecting with a different account.
- https://www.mql5.com/en/docs/python_metatrader5/mt5accountinfo_py — account_info
  exposes environment and margin mode, not broker commercial products such as
  Standard/Pro/Zero/Raw Spread. No commercial type is inferred or invented.

The owned native API was restarted using its existing release and capability
files. The first retry during restart returned a generic worker failure before
the fresh terminal config was present; another queued sync started the new
worker successfully. This transient is recorded rather than counted as a clean
restart. The fresh terminal started at 01:24:46 UTC; its 01:24:49 authorization
did not produce the account-change disabling message. It remained connected
through 01:30 UTC with successive persisted sync timestamps. The original
first-login permission regression was not observed on this fresh worker.

`runtime-status.json` and `runtime-final.json` contain selected nonsecret API
fields. No order/preview/reconciliation endpoint was called on the real runtime;
this is connection/read evidence, not broker execution acceptance.

## Validation

- Python: `-B -m pytest foundation_v2/tests/test_mt5_connector.py
  foundation_v2/tests/test_mt5_broker_worker.py
  foundation_v2/tests/test_mt5_demo_trading.py -q`: **45 passed, 36 subtests**.
  Added config regression covers trading/read-only, DLL/privacy flags and
  preservation of the user's installation config; existing tests cover guards.
- Frontend: `node --test tests/liveAccountModel.test.mjs
  tests/mt5Connections.test.mjs`: **11 passed**.
- `npm run build`: passed. Existing >500 kB main-chunk warning remains; the
  connection form continues to load as an independent lazy chunk.
- Actual localhost browser: default Trading checked on the left, Read only on
  the right; ArrowRight selects Read only and updates the password label.
  VI/EN labels checked. Account names have no button; header tooltip appears
  on hover and computed icon background is transparent.
- Actual page at 390 px: document scroll width equals viewport width; radio
  labels remain horizontal. Screenshot after focusing the radio scrolls the
  form into view. Desktop viewport restored and language returned to VI.
- Isolated fixture on 5192, no SDK/DB/broker: reconnect preserves saved Read
  only; error cell contains only badge text and tooltip opens on hover; no
  permanent diagnostic. Clicking header label records zero sync requests;
  clicking icon records exactly one sync request to its fixture connection.
  Fixture tab/server stopped after QA.
- Scoped diff review and `git diff --check` passed. Unrelated WIP is excluded.

Screenshots: `desktop-vi.png`, `desktop-en.png`, `mobile-en.png` (actual app);
`fixture-error-readonly-light.png` (explicit synthetic error/read-only state).
