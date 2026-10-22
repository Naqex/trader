# Calendar empty totals — 22/10/2026

Owner correction: the empty live calendar still showed dashes in weekly and
monthly totals instead of the reference's zero trades and $0.

Implemented:
- Show `0 giao dịch`, W1–W6 and `$0` for each week and `Tổng tháng · $0 ·
  0 giao dịch` in the footer only when ledger and broker responses confirm no
  account exists. Daily cells remain blank; analytics asks for an account.
- Do not treat a selected MT5 connection without a snapshot, denied/locked read,
  initial read failure or stale data as an empty calendar. Unknown account data
  retains its existing unknown values. Monthly review requires an actual account.
- Weekly totals have enough width for the Vietnamese count and week number to
  share their top row. Selected account currency/percentage formatting remains
  available; monthly amounts now use the same formatter as weekly amounts.

Verification:
- `node --test tests/liveWorkspaceModel.test.mjs`: 6/6 pass, including empty
  scaffold versus missing MT5 snapshot, complete zero week, partial coverage and
  unknown costs. The underlying daily model continues to return unknown for
  missing feed data.
- `npm run build`: PASS; existing >500 kB main-chunk warning remains.
- Actual app 5180 / Rust API 8010: confirmed status `unavailable, connections=[]`;
  all five October weeks show `0 giao dịch / $0`, monthly footer shows $0 and
  zero trades, review disabled.
- Read-only UI journey with a synthetic nonexistent selected broker ID: all
  totals remain unknown and review stays disabled. No records were created.
- Screenshots inspected at 1710×987 dark, 1368×790 light and 390×844 dark. Mobile
  footer is reachable by scrolling; document width stays within viewport.
- No captured browser errors/warnings. Temporary tab closed; viewport reset and
  dark theme restored. No API restart, migration, broker login or execution.
- Independent review `calendar_review`: no blockers after distinguishing explicit
  empty state from unreadable/missing snapshots and preserving review guard.

Evidence: `calendar-1710-dark.png`, `calendar-1368-light.png`,
`calendar-390-dark.png`, `calendar-390-footer.png`, `selected-missing-account.png`.
