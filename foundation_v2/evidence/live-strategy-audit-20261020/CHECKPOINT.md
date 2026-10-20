# Live journal, strategies and analytics — 20 October 2026

**Activation update, 21 October:** the owner approved the local backup, migration
and restart. Activation and main-instance read-only checks passed; see
`../live-strategy-activation-20261021/CHECKPOINT.md`. The original checkpoint
below records the implementation/fixture state before that separate approval.

Implementation and disposable-fixture verification are complete for this slice.
Activation on the owner's local database is pending explicit permission to back
up the database/artifacts, apply migration 0008 and restart API 8010. The main
database was not used for financial test writes. This is scoped evidence, not
whole-product or broker acceptance.

## Result and data flow

- Live follows the existing FX-style workspace: calendar, closed trades, notes,
  tag analysis, analytics and trading accounts. Shared dialogs, selects, date
  inputs and project styles keep the interface editable within the current UI.
- A native workspace-scoped journal stores manual accounts, closed trades and
  notes. Writes use idempotency receipts and immutable revisions; edits require
  the expected revision. An unknown write outcome blocks another submission.
- Accounts are evaluated separately in their own currencies. Net PnL is gross
  PnL plus signed commission, swap and fee. Recorded balance is opening capital
  plus recorded net PnL; cash flows and floating equity are not inferred.
- CSV validates the entire file before sequential writes, reports progress and
  resumes known failures from the first unsaved row. Partial imports lock their
  account/file/strategy. Re-importing a file remains an explicit new operation;
  CSV is not a backup of strategy links or revision history.
- Strategies can be created, revised, frozen, forked and compared across
  revisions. Practice session creation and Live trades keep the exact strategy
  ID and revision. Existing executable rules are preserved. Manual notes do not
  become an automated runner.
- Analytics rejects malformed numeric/date values instead of turning them into
  zero or 1970 dates, and applies the same breakeven tolerance throughout.

## Verification

| Check | Evidence and result |
| --- | --- |
| Frontend unit suite | 425/425 pass with `node --test --test-concurrency=1 tests/*.test.mjs` |
| Concurrent suite caveat | Initial default-concurrency run: 424 pass, one existing heartbeat timer test failed; its focused rerun passed 7/7. Initial failure retained locally in `node-tests-initial-concurrent.log`; no assertion weakened. |
| Native library | 151 pass, 16 ignored; ignored integration tests are not counted as passing |
| Native journal PostgreSQL integration | Real native Router/auth/idempotency, workspace isolation, immutable revisions, stale updates, reference validation and concurrent admission checks pass; see `live-ledger-pg.json` |
| Analytics arithmetic | 42 canonical Rust fixtures match the frontend; native oracle test passes |
| Analytics HTTP | 28 checks over 16 requests against disposable native API 18011; see `analytics-http.json` |
| Production frontend build | Pass; existing approximately 603 KB main chunk warning remains |
| Independent review | Backend/frontend and analytics reviewers completed; root integrated fixes for account/tag state, upfront CSV bounds, exact revision selection and unknown write outcomes |

Raw test logs are retained in this local evidence directory and ignored by Git.
`source-sha256.json` pins the reviewed source. Representative screenshots and
the structured browser receipt are committed alongside this checkpoint.

## Browser journeys

CUA browser QA used Vite 5183 and a disposable PostgreSQL/native API fixture on
18011. The FX Replay reference was inspected read only; no external records were
created. The owner API/database received no test mutations.

- Create/edit account, create/edit closed trade, create note, CSV upload/preview/
  import/export, account retention across tabs, account-specific tag reset.
- Create strategy v1, revise v2, freeze v3, fork a new v1. Open historical v2 in
  Practice creation and attach that same v2 to a Live trade after v3 exists.
- USD account: five recorded trades, net **141 USD**, balance **10,141 USD**,
  win rate **60%**, profit factor **2.38**, return **1.41%**. EUR account remains
  separate: two trades, net **28 EUR**, balance **5,028 EUR**.
- Tag analysis: overlapping groups remain explicitly non-additive. Calendar
  monthly totals match recorded trades; historic populated days stay visible.
- Blocked journal GET retains prior rows with a stale warning and disables
  writes; unblocking and retry recovers. Empty tenant and denied workspace were
  checked without cross-workspace leakage.
- Analytics oracle: closes **+1, +6, -7**, total **0**, balance **10,000**, win rate
  **66.67%**, closed-balance drawdown **7**. Partial-close commission allocation,
  win/loss filtering and historical cursor fence match API arithmetic. UI values
  match, and the inspected analytics console has no errors.
- Dark/light desktop, 768 px tablet and 360 px mobile were inspected. Dialog body
  overflow, narrow header wrapping and search controls were corrected. The final
  desktop dialog keeps its header while its form scrolls.

Screenshots: `live-trades-dark.jpg`, `live-calendar-light.jpg`,
`strategies-dark.jpg`, `analytics-oracle-dark.jpg`. The 1440 px light-calendar
capture is cropped by the native capture surface; it is not evidence of the
entire 1440 px frame. The browser receipt records limitations explicitly.

## Boundaries and remaining activation

The configured broker source remains read only. Provider connection, Share,
broker order submission, automated strategy execution and real floating equity
are outside this slice. Native journal reads are bounded to 10,000 records per
workspace; server paging is not claimed. No shared UI snapshot was changed.

Before main activation: verify managed-runtime ownership and idle state; stop
the owned API, create and verify a database plus artifact backup, then apply the
additive migration and start the native API. Only read-only smoke checks belong
on the owner's data. Do not set a backup-confirmed flag before a backup exists.
The user confirmation for this exact operation is pending.
