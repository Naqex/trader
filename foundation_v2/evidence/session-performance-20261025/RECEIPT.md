# Session performance — 25 October 2026

Completed the assigned session-calendar and report presentation corrections on
local API 8010 / UI 5180. This is scoped acceptance, not whole-product/broker acceptance.

## Behavior and data flow

- Dashboard expanded cards and Session summaries request market time; aggregate
  Dashboard Performance, Journal and detailed activity analytics retain actual
  observation time. Settings timezone applies before grouping. UTC storage is unchanged.
- Account Equity still includes floating P/L and uses the single-account or causal
  portfolio ledger; the market view changes event time, not the financial value.
- Monthly/daily Performance splits positive and negative net trade P/L after fees.
  Both sides remain visible for an offsetting net zero. Month/day summaries retain counts.
- `periods.performance` carries all year-month buckets; legacy capped periods and
  core/CSV oracle remain compatible. Multi-year history defaults to a year-by-12-month
  net P/L heatmap, with keyboard/year selector drilldown to split bars. Dense years
  use fixed-height vertical bars; missing months differ from actual breakeven months.
- Shared bars compact numeric labels, put them inside when space permits, preserve
  exact amounts in tooltips/accessibility and never draw a false zero bar. Small
  labels may be thinned; all bars remain. Light/dark contrast and zero axis are explicit.
- Removed redundant bottom padding. Narrow axes shorten/thin month labels and rotate
  full weekdays vertically where necessary. No nested chart scrollbar was introduced.

## Verification

- 42/42 focused frontend tests (dashboardModel, sessionPerformance, analyticsViewModel,
  demoMode, live-overview). 15/15 Rust analytics tests, including frozen core/CSV oracle,
  market Equity without recording receipts, portfolio account Equity and 36 historical
  month buckets with split net wins/losses.
- Disposable native PostgreSQL acceptance PASS full + compact: real versus market
  clocks, true floating Equity, summary/cache/timezone/filter/paged parity, retries,
  metadata, branch inheritance, legacy unknown. New market summary assertions also
  reconcile counts, split sums and true Equity against the direct session API.
- Scoped production build from tracked HEAD plus intentional overlays only. Independent
  source and desktop/mobile screenshot review: no remaining blocker.
- Candidate and deployed demo UI PASS at 1920/390, dark/light, VI/EN. Full weekdays,
  no scroll, zero has no bar, inside values calculated contrast >=4.5 across all chart
  accents, zero axis visible, reduced bottom gap. Five-year GET response fixture proves
  60 calendar cells, 59 data months plus one explicitly absent month, real zero, year
  selection/keyboard focus return, twelve-month detail and split loss/profit sides.
- Real deployed GET-only Dashboard Backtest/Prop/All, Session summaries and Journal
  PASS at desktop/mobile. All 16 report requests use the expected per-scope time basis;
  no page errors or mutation requests. Deployed API checks both UTC and Asia/Ho_Chi_Minh,
  complete period history, exact market Equity parity, binary hashes and served UI hash.

## Rollout and limits

Guarded native/compact preflight: schema16 current, no pending migrations. Idle check
passed; preserved DB/artifact roots, scientific/legacy capabilities, QDM and AI interpreter.
Old owned binaries stopped before canonical-source candidate start. An early readiness
GET preceded startup and got connection refused; readiness and the complete subsequent
API/UI journeys passed. A copied old UI test initially asserted all requests were activity;
corrected its obsolete expectation to the explicit per-scope contract and reran PASS.
No database migration, terminal reconnect, OrderCheck or OrderSend was performed.

UI index changed from `61778c1d7ce479644cef74a6c4ec05389623eaa2376bf2216ec2ae183592b374`
to `2e5f886bb8c97d069d34b72c8e1fb55318fefab3e8fd1d4817c1948dda1067f7`.
Old hashed assets and private branding retained; rollback index/manifests/logs/screenshots
and repeatable QA scripts remain under `E:/BACKUP-TRADINGWORKSPACE/session-report-20261025/`.
Only the owned preview5196 was stopped; API8010/UI5180 remain running.

Historical missing activity proof is still unknown in aggregate reports; market session
history is not a backfill of actual user timestamps. Heatmap encodes net P/L; select a
period year to see its separate gain/loss totals. No large-history benchmark is claimed.
