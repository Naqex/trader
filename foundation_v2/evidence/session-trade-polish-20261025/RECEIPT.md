# Session and trade presentation — 25/10/2026

Direct owner request: remove duplicate from the session toolbar, show the dataset
date range in selection, enlarge the summary title alongside its kind badge,
expand the average win/loss label, style order type as a neutral badge, remove
label-cell hover fill, align the three Return labels, simplify clock headings,
and render activity tooltip duration as hours/minutes.

## Behavior and data ownership

- Session selection and summary use the same dataset timestamps and Settings-aware
  date formatter. Session creation time is no longer shown in the rich trigger.
  The duplicate deep-link/dialog remains available to existing Dashboard actions.
- Summary title is 30–36px; the owning typography rule previously forced it to
  16px. The badge keeps its own size and wraps on narrow screens.
- The metric is **Tỉ số lãi/lỗ trung bình**, a ratio of average profit to absolute
  average loss. It is not a cash amount or planned risk/reward.
- **Lợi nhuận**, **Lợi nhuận (%)**, **Lợi nhuận (R)** share the existing Return
  formulas: net after costs, net divided by explicit starting capital, and source
  realized R. Mixed-session currencies remain identified in each row; a single
  account currency is shown in the heading. Unknown capital/R stays unknown.
- Entry/exit headings use **Vào lệnh / Thoát lệnh**, with **Thực tế / Chart** on
  a second line. One Settings timezone label serves the table; timestamp fields
  and their distinct clocks are unchanged. IANA identity avoids implying a fixed
  offset for zones with daylight saving changes.
- Known order types use a neutral badge; missing types remain `—`. Label-cell
  hover is transparent; existing focus/popup behavior is retained.
- Activity tooltips use elapsed hours/minutes, including over 24 hours; chart
  axes retain compact hours. Durations keep whole elapsed minutes, with a numeric
  boundary guard for seconds → chart hours → seconds floating-point round trips.

## Verification

- 34 focused tests PASS: Dashboard duration/time/filter models, session settings,
  session selection and trade-page contracts. Includes zero, unknown, subminute,
  >24h and the 3900-second round-trip regression (1 hour 5 minutes).
- Scoped production build PASS. Existing >500kB chunk advisory remains.
- Candidate and served UI: four configurations, 12 screen checks each PASS:
  1920 dark/UTC real, 1920 light/UTC+7 real, 390 dark/UTC+7 demo, 1440 light/EN demo.
  Four real clock cells and money/%/R cells matched read-only API data. Tested
  session range, title/badge alignment, neutral badge, transparent hover, popup
  open/Escape on real rows, sorting, and shared duration hover tooltip.
- No JavaScript errors or write requests; MT5/Live routes were blocked in QA.
  Demo label editing is intentionally disabled; the initial test's disabled
  click was corrected to exercise the popup on real rows only. Initial title
  check exposed the 16px typography override and was fixed at its owner.
- Independent source, screenshot and numeric review accepted; reviewer also
  independently ran 16 Dashboard tests. Review improved exit copy to Thoát lệnh.

## Local UI rollout

Scoped tree: tracked HEAD plus task overlays, preserving the verified private CSS
baseline and excluding unrelated working-tree changes. No API or terminal restart.
Promotion guarded the prior served index, retained old hashed assets, preserved
private branding, and replaced the index atomically.

- Before SHA256: `342202577677b9e57029cd951c94027a097b56cb53af5423f6711201b003bfc5`
- Served SHA256: `f5b5f39fad47c104d5a3b5bebe7eb1b7dd2e613d0169c834fa73dd3e1ca52718`
- Runtime origin: `http://127.0.0.1:5180`
- Evidence/build/rollback: `E:/BACKUP-TRADINGWORKSPACE/session-trade-polish-20261025/`
- Runnable QA: `browser-check.mjs` beside this receipt. Set UI_ORIGIN/UI_STAGE
  to check another owned loopback candidate. It performs reads and local UI
  interactions only; it never saves labels or submits trades.

This accepts the assigned presentation slice, not whole-product/broker acceptance.
