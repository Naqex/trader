# Quick current-quote execution and SELL controls — 17 October 2026

Scope: the owner requested immediate replay Quick Buy/Sell, FXReplay-style SELL
markers and smooth TP/SL interaction. This receipt covers local replay only.
Auto-BE, multiple active positions per asset and the later BUY color revision are
outside this slice. No owner replay/Prop session was mutated and no broker was
contacted. Real-service sessions were created for QA and deleted in `finally`.

Engine checkpoint: `c76154d`. Worker/transport checkpoint: `854e814`.
The chart/UI changes and this receipt form the following checkpoint.
Validation used the current working tree on branch `Nam`, starting from
`a56ffb6`; unrelated existing work was preserved and excluded from these commits.

## Behavior and state ownership

- UI market submissions explicitly send `execution_timing: current_quote`.
  SELL fills the already-visible bid; BUY fills the ask. Time and cursor do not
  advance. Bar mode uses only the current closed row, and tick mode retains the
  preceding pinned canonical quote. Existing API clients default to `next_bar`.
- Actual position, fees, floating P/L and ledger come from the domain response.
  The UI shows an immediate submitting preview; it never invents a successful
  fill. A new SELL can show a negative initial P/L due to spread and costs.
  Margin rejection stays an error even when the HTTP response contains a saved
  rejection checkpoint. The current future-bar/end-of-session admission guard
  remains in force.
- Immediate fill/rejection is followed by a same-cutoff price mark. Validation
  links it to the fill, preserves intrabar coverage and feeds Prop marks in order
  using returned revisions. Exact retries retain existing deduplication.
- SELL uses orange-red text, orange border and actual P/L. Unset TP/SL touch
  side-by-side at Entry with one grip-dot column each. The quantity opens the
  centered position editor; X opens the existing close confirmation. The editor
  reuses project controls and disables Save until a protection changes.
- Native Advanced Charts primitives own dashed lines and price badges. The
  existing iframe DOM handles own pointer/keyboard interaction. All three native
  line colors stay populated, so Entry/TP/SL plus the market price form four
  colored badges, stacked by the library at coincident levels. Chart-only palette
  tokens own SELL, protection and X colors; shared global components are unchanged.
- Pointer drag does not add a second focus border. Focus is retained so a user
  can follow a drag with arrow keys/Delete; keyboard focus still has a ring.
  Invalid SELL TP above the closeable ask is rejected locally. Valid release
  sends one protection mutation and keeps the preview through the response.
  Protections act on subsequent quotes, never retroactively on past candle OHLC.

## Performance and runtime evidence

Windows, local Axum API at `127.0.0.1:8010`, PostgreSQL/Python command workers,
Vite development UI at `127.0.0.1:5180`, installed native Advanced Charts v23.
Real replay fixture used the existing 134 MiB dataset; viewport 1368×790.
One browser journey, four entry samples, no load/capacity test.

| Measurement | Baseline | Final runtime |
| --- | --- | --- |
| Click to submitting paint | 32.1–47.2 ms | 21.5–44.7 ms |
| Click to UI observed by Playwright | 343.4–418.3 ms | 257.3–323.7 ms |
| Click to confirmed marker's rAF callback | Not instrumented | 246.2–280.4 ms |
| Quick/market request total, four entry samples | 250–320 ms | 183–206 ms |
| SELL drag frame intervals | Not instrumented | 81 intervals; maximum 17 ms; 0 above 32 ms |

Raw samples: [baseline](baseline/receipt.json), [first candidate](candidate/receipt.json),
[final real-service journey](final-runtime/receipt.json).
The confirmed rAF metric is a browser paint proxy, not a physical display latency
measurement. Playwright's observed metric includes locator/poll overhead. Small
samples are diagnostic, not stable p95. The baseline queued for the next bar;
final behavior fills now, so this is not an equivalent-output throughput claim.

Measured/verified causes and changes:

1. Axum still delegates domain commands to Python through PostgreSQL. It is not
   a wholly Rust execution path. The previous worker idle sleep (100 ms) and
   result poll (75 ms) added avoidable waits. An enqueue notification now wakes
   one shared LISTEN/NOTIFY listener; generation checks avoid missed wakeups,
   bounded fallback remains, and recovery runs at most once per worker per second.
   The durable queue, leases, workspace locks and ambiguous-mutation handling
   remain authoritative. Rust result checks use a bounded 10/20/40/75 ms backoff.
2. Protection changes previously called `fitOrder()` and changed the price range.
   Fitting now keys only on the entry identity. Protection save/close does not
   force autoscale. Equal OHLCV JSON at an unchanged cutoff does not republish
   candles or reread history. Drag preview is retained through the React commit.
3. Final live SELL test verifies **zero history reads**, the **same iframe**, and
   an **exactly equal price range** across two protection saves. The local drag
   sample ran at roughly a 60 Hz cadence. This does not promise all hardware,
   large ledgers or concurrent sessions will have identical timing.

HTTP request/response remains appropriate for these bounded commands. No evidence
requires WebSocket to remove the measured idle/refit costs. Confirmed execution is
still around a quarter second in this dev run; immediate feedback and local drag
do not wait on the server. Further server latency work should profile domain,
locking, storage and response phases before changing transport or stack.

## Verification

- 132 Python tests + 11 subtests passed: immediate execution, quick orders,
  protection, execution core, tick execution, command workers and replay/Prop.
  Includes same-cutoff checkpoint/fork/reload, tampered marks, retained insufficient
  intrabar coverage, immediate Prop exposure/cost feed and exact retry, legacy
  next-bar semantics, notification race and bounded fallback/recovery tests.
- Rust library: 26 passed, 1 ignored (existing isolated database test).
- Node focused suites: 19 passed. Includes equal JSON/no-history-refresh and
  existing label, projection, historical-cutoff and quote semantics.
- `npm run build`: passed; existing >500 kB bundle warning remains.
- [Synthetic interaction receipt](interaction/receipt.json): 9 journeys,
  20 intercepted mutations; real native iframe, mocked API clearly labeled.
  Covers double click, withheld/rejected response, invalid drag, Escape,
  keyboard deletion, independent Scalper presets, position P/L, close confirmation,
  log/invert/percent/indexed projection and 1064/1368/1440 widths in dark/light.
  Assertions were updated from the superseded queued response fixture to a filled
  position. Equal-price native pixel checks allow the coincident SL color to cover
  Entry while its separate scale badge remains visible.
- Final runtime journey: immediate BUY/SELL without stepping, two valid SELL
  protection saves, invalid SELL TP sends no request, quantity→editor, Order form
  fill, reload-protected BUY, manual close/ledger and fixture cleanup all passed.
- Independent read-only reviewer checked source and all five final SELL/editor
  images; no blocking defect found. This is scoped local replay acceptance,
  not completion of the wider product plan or live/broker acceptance.

Visual evidence:
[entry](final-runtime/sell-entry.png),
[TP drag](final-runtime/sell-target-drag.png),
[SL drag](final-runtime/sell-stop-drag.png),
[saved levels](final-runtime/sell-protected.png),
[position editor](final-runtime/edit-position.png).

Reproduce from `foundation_v2/web` with the local services already running:

```powershell
node --test tests/advancedChart.test.mjs tests/advancedOrderOverlay.test.mjs tests/replayOrderModel.test.mjs
$env:QUICK_TRADING_OUTPUT='../evidence/quick-order-smooth-20261017/interaction'
node tests/quickTrading.browser.mjs
$env:QUICK_TRADING_OUTPUT='../evidence/quick-order-smooth-20261017/final-runtime'
node tests/quickTrading.live.browser.mjs
```

Keep raw output from earlier attempts separate if collecting new comparisons.
No database schema migration was added. Rolling back the engine must retain
support for already-persisted explicit current-quote event details.
