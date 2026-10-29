# Live trade presentation and page loading — 2026-10-29

Scope: the owner's Live Trades/Calendar/Notes comments. UI-only promotion;
no API restart, terminal reconnect, broker command or financial-data mutation.

## Changes and data flow

- Reuse the shared trade grid, account-name formatter and label presentation.
  Full MT5 account labels, neutral Closed badge, lowercase order types and ten
  rows by default. Broker tag cells share hover/focus display; replay assignment
  endpoints are not valid broker metadata storage.
- Reconstruct broker lifecycles before calendar bucketing, per account before
  aggregation. 28 fills become 14 completed trades. Exclude open/incomplete
  outcomes; retain unknown costs and history coverage. Attribute to closing time.
- Sidebar analytics use the account's loaded history and explicit filters,
  independent of the calendar month. Balance remains the broker snapshot.
  Expectancy contributions divide each group total by all completed trades.
  Remove the curve subtitle and legend counts; weekly summaries use shared tones
  and one-owner seams.
- An older `/assets/LiveJournalSurfaces-DslVCGGH.js` returned HTML instead of JS
  on localhost. Restore verified old assets, retain hashes across builds and
  reload a failed Vite lazy import once per build/tab. Offline, denied storage
  and repeated failures cannot cause an automatic reload loop.

## Verification

- Build from HEAD plus task overlays on E; unrelated dirty sources excluded.
- 33 focused Node tests passed (broker reconstruction, filters, account
  aggregation/identity collisions, coverage, separators and chunk recovery).
- Recorded-history browser regression: 5 cases, 1920/1440/390, dark/light;
  10-row default, 14 trades, 14.29% wins, expectancy $0.07, contributions
  $0.22 / $-0.14, month-independent sidebar, loss/gain week and chunk recovery.
- Existing grid regression passed; sidebar regression passed 7 cases;
  calendar separators passed 7 widths/themes and partial-coverage journeys
  passed at 1920/1440/768/390, including note drawer/focus return.
- Actual localhost GET-only journeys: Notes, Trades, Calendar, Accounts;
  final in-app link navigation Calendar → day note → Notes → Trades passed.
  No page errors; actual served index hash matches the promoted candidate.
- MT5 balance is $10,001.01. The reference screenshot's $20,001.01 is not
  independently reconciled; no extra $10,000 was invented to match it.

Private recorded snapshot, screenshots, full test reports, promotion hashes
and rollback indexes: `E:/BACKUP-TRADINGWORKSPACE/live-ui-reconcile-20261029/`.
Final served index SHA256:
`714c60053fc22250f397a4c6ec29d85525488d0b9a409ceb57f74b951c9ad986`.
