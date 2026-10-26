# Trades reference follow-up — 26/10/2026

Status: **PASS for the three authorized Trades changes and deployed UI**.
Scope comes from [Testing Trades](../../../ui/references/fxreplay/testing-trades.md).
Footer counts and weekday filters remain outside this slice.

## Behavior, state and decisions

- Applied filter groups appear as chips, with individual removal and clear all.
  The drawer owns a draft until Apply. Apply, removal and clear each write one
  complete URL scope, preserving workspace, selected sessions and language.
  Filter changes reset pagination and close the selected trade detail.
- Aggregate Testing Trades defaults to Chart (`market`). The explicit Realtime
  (`activity`) selection persists as `trades_time_basis` in the URL. API projection
  and facets use that basis; changing it discards facets from the other clock,
  resets page/detail and retains filters, sort and sessions. Clear filters keeps
  clock and sessions. Other analytics pages retain their existing clock contract.
- Chart/Realtime filter closed rows by exit time, open rows by entry time, in
  Settings timezone. Missing recording metadata remains unknown. The current
  14-row source has market dates but no Realtime dates; the Year section explains
  that limit contextually. The selector uses consistent Chart/Realtime names.
- Three Return column definitions use shared ReportInfo beside the sort button.
  Money remains source-currency net after fees; percent remains net divided by
  source initial capital times 100; R remains source realized R with original
  risk evidence. Current SL is not an opening-risk oracle. Open realized fields
  and missing denominators remain N/A; zero remains zero. No calculation change.
- The error fixture exposed an existing CSS override of native `hidden` on the
  ledger. A scoped selector now hides it, preventing a false empty table below
  an error. Stale reads continue showing prior rows with recovery state.

## Verification

Raw evidence, candidate sources, build logs, helper scripts and rollback:
`E:/BACKUP-TRADINGWORKSPACE/trades-refinement-20261026/`.

- **17 focused model/contract tests PASS**: chip groups and removal, hour zero,
  tag commas/AND/OR state, atomic URLs, repeated sessions, aliases, clock state,
  existing page provenance/count contract and open/unknown semantics.
- Scoped candidate build PASS. Source is HEAD `6d11685` plus eleven intentional
  source/test overlays. Two accepted release CSS overlays are retained from the
  Dashboard build snapshot; unrelated current WIP is excluded. Build hashes are
  saved in `build.json`. Vite reports the existing chunk-size advisory.
- **10 Playwright cases PASS on candidate, then the same 10 PASS on UI5180**.
  Actual read-only service journeys at 1920 VI dark, 1366 EN light, 390 VI light
  and 320 EN dark; separately labeled browser response fixtures for empty,
  unknown totals, partial, denied, initial error and stale refresh.
- Actual API requests confirm default `market`, market year facets, date+side
  Apply yielding one row for 05/05/2003, individual removal preserving dates,
  reload persistence, clear all restoring 14 rows, Realtime `years=[]`, basis
  page reset, retained session scope, independent sort and per-row currency.
  Closed sample remains -2.28 USD / -0.0023%; unknown R and open net remain N/A.
- All three Return help controls passed focus, click/touch, Escape, accessible
  description, independent sorting and tooltip-bounds checks. No nested buttons,
  page errors or browser write requests. No document/content horizontal overflow;
  shell remains the root vertical scroll owner, with table horizontal scrolling.
- Independent reviewer `/root/trades_review`: source + representative desktop,
  mobile, help and error screenshots PASS; independently ran 3 model tests PASS.
- Owner's existing tab was reloaded. Confirmed the new clock control and all
  three help buttons, opened/closed clock help and saved owner-session images.

Initial test attempts corrected selector assumptions (localized labels, named
pagination, string year facets), date field formatting and scroll settling before
tooltip focus. Application findings were the inconsistent Realtime menu label
and hidden/error CSS behavior above; both were fixed and full scoped QA rerun.
The known unrelated global testing-copy P/L assertion was not changed or claimed
passing. This is scoped UI acceptance, not full-product or FX backend parity.

## Runtime, rollback and resume

UI promotion checked source and entry-index hashes and asset collisions, retained
old hashed assets and private branding, then replaced the index atomically.
Served HTTP bytes returned 200 and matched:
`dbb1dc7ff12b17652d1e36305e3028d29ea23192e736a1510b0e9bfdd202c46b`.
The prior entry index and mutable assets are in `ui-before-release/`; promotion
metadata and `final-verification.json` retain the exact identities.

Native/compact API remains PID23024 and UI5180 remains PID24980, both owned by
Windows independently of this app. API binary SHA256 remains
`5b95efc97ecb6d592a41efef701a3ddce07753d367341a55e1b5867aba5481e5`.
No API restart, terminal reconnect, broker action, migration or FX mutation.
Only candidate preview PID23344 was stopped, after matching executable path,
creation identity and exact command. Live listener PIDs were verified afterward.

Rerun from `foundation_v2/web` using the saved reference dataset/runtime:

    node --test tests/ledgerFilterModel.test.mjs tests/tradesPage.test.mjs tests/tradeTableSemantics.test.mjs tests/ledgerFilters.test.mjs
    node tests/tradesReference.browser.mjs http://127.0.0.1:5180 E:/BACKUP-TRADINGWORKSPACE/trades-refinement-20261026/rerun-qa

The browser script uses a disposable headless context, blocks non-GET requests
and broker/live/event routes, and closes WebSockets. Its actual-source assertions
are intentionally pinned to this audit's 14-row sample. Refresh the oracle if
the owner changes that sample; do not change expectations to hide a regression.
The reusable page research workflow remains
[verification-workflow.md](../../../ui/references/fxreplay/verification-workflow.md).
Read its baseline/restore rules before researching another page.
