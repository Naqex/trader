# Local read-only MetaTrader 5 connector — 21 October 2026

Scope: implement the owner's web account-connection workflow for MT5, remove the
redundant Accounts footer disclosure, and anchor desktop pagination to the content
viewport. This is software/local UI acceptance, **not broker acceptance or live
execution authority**. Baseline: branch `Nam`, parent `afe4814`; unrelated WIP was
preserved. The feature commit is the commit containing this checkpoint.

## Behavior and state ownership

Web form → native connection endpoint → private stdin SDK adapter → DPAPI envelope
in PostgreSQL → serialized background collector → workspace/connection-scoped
snapshot → existing Live calendar, trades, accounts, transactions and analytics.
The collector uses a copied portable terminal, never the user's active terminal.
There is no order submission capability.

- Form: MT5, name, server, numeric login, investor password, UTC history start.
  Known failures clear the visible password. Uncertain submissions keep one attempt
  only in component memory and retry the same immutable request receipt.
- Up to ten connections/workspace. Queued/syncing/connected/error/paused/disconnected
  states remain visible without inventing balances or history. Pause retains the
  encrypted credential; disconnect erases it and retains stale historical data.
  Reconnect replaces credentials. Generation fencing rejects late worker results.
- Success sync interval 60 seconds; failure retry five minutes. Initial, resumed
  and manual full sync replace history in the selected start-date scope;
  incremental sync reconciles a two-day authoritative overlap. Deal tickets are
  deduplicated, deleted/changed overlap entries replaced, cashflows kept separate.
- Accounts polls summaries every five seconds. Full history is selected per
  connection; unchanged snapshots return ETag/304. Summary and full reads share a
  read-only repeatable-read transaction. This is not server paging for history.
- Desktop table and form scroll independently; pagination touches viewport bottom.
  On smaller screens the form stacks and the content scrolls naturally. Existing
  FxSelect, ProjectDateInput, pagination, tokens and themes are reused.

## Validation

| Check | Result |
|---|---|
| Python adapter tests | 8 passed; fake SDK, real Windows DPAPI/ACL and cleanup tests |
| Rust library suite | 157 passed, 16 deliberately ignored; no failed tests |
| Focused connector unit tests | 5 passed, including full-sync scope replacement |
| Windows process ownership tests | 7 passed; one internal child helper deliberately ignored |
| Disposable PostgreSQL integration | PASS; real Router/auth/DB/DPAPI, immutable retry receipts, lifecycle actions, isolation and ETag |
| Web tests | 434 passed |
| Release binaries / web build | PASS; existing Vite >500 KB chunk warning remains |
| Scoped diff review | PASS; independent connector review found no remaining source blocker |

The full Rust run initially caught the old route-inventory count. Its assertion
now includes the three MT5 routes and verifies their native owner/methods; the
full suite passed afterward. Independent review also caught a torn metadata/full
snapshot read, fixed by repeatable read, and cancellation cleanup plus repeated
`../` portable-directory preparation issues, covered by corrections/regressions.

The isolated API fixture measured **41,417 bytes full vs 606 bytes summary**;
unchanged requests returned 304. See `postgres.json` for source hashes and output.
These bytes describe that fixture, not a benchmark of a real broker history.

Browser checks used the real local app: empty Accounts, form opening/reset,
server/login validation, visible password clearing, date popup/Escape, and empty
Transactions. A synthetic overflowing u64 login returned a validation error before
credential sealing, SDK initialization or DB insertion. No credential was used
for an actual broker request. Populated account lifecycle is covered by the
isolated API fixture, not a browser success journey.

Screens reviewed at 360×800, 390×844, 768×1024, 1440×900 and default 1280×720;
dark/light and VI/EN form labels checked. No document horizontal overflow at
checked widths. Desktop pagination bottoms were 900/900 and 720/720. Mobile
submit remained reachable. Date popup closed with Escape and restored focus.
Browser dev logs showed no captured warning/error. Final browser state restored
VI/dark/default viewport; the temporary QA tab was closed.

## Owner runtime and backup

The owner explicitly authorized backup, migration and local restart in this
conversation. PostgreSQL 18 tools were used after the initially selected older
pg_dump version was rejected; no migration preceded the successful backup.

- Verified backup: `.runtime/api-platform-backups/mt5-connector-20261021-pg18`.
- Snapshot: `20261021T154444Z-3682242003c7`.
- Manifest SHA-256: `0daa8c27958346f761f02a8690925a28ad4ebf703eb7a9b8866a8d0070f414c9`.
- Artifacts: 4,142 files / 4,267,581,349 bytes, verified with DB backup.
- Additive migration `0009_mt5_connections.sql` applied; schema current at 9.
- Native/compact API ready on 8010, web 200 on 5180, SDK/terminal probe available.
  Owner workspace connection count remains zero; execution capability is false.
- Runtime binaries are staged in `.runtime/api-builds/mt5-connector-20261021-final`
  rather than running from mutable Cargo output. `runtime.json` pins run/hash and
  confirms actual 200/304 behavior. No active user terminal was restarted.

## Practical limits and next real check

No real account login, broker server discovery, successful collection, reconnect
against a broker, or fully invisible terminal launch has been verified. The owner
can now test from Live → Trading accounts → MetaTrader 5 with an investor password.
Installed terminal/server files and broker permission determine acceptance.

This connector is local Windows-only; remote/multi-user authentication and MT4
are outside this slice. DPAPI is bound to the Windows user/machine. Effective
`trade_allowed=false` is a permission check, not proof of password type. Terminal
settings are defense in depth. Abrupt power/API loss can leave terminal session
files inside the private ACL folder until next-start cleanup; do not claim every
terminal artifact is DPAPI encrypted. Real deployment/backup must preserve the
owner's private runtime data.

Rollback: pause/disconnect connections before reverting the feature commit;
retain migration 0009 and user data. Restore the verified DB/artifact backup only
through the established recovery procedure. Do not drop tables or revert to a
binary that requires an older exact migration set without recovery verification.

Implementation/operations: `../../README.md` and `../../../ui/live-market-standard.md`.
