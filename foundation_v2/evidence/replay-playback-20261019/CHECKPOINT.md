# Replay chart interaction and historical playback — 19/10/2026

Scoped production UI verification on local native Rust API8010 and Vite preview5180.
Baseline source HEAD: `f78d164`; the pre-existing Prop auto-initialization effect
dependency change in `ReplayWorkspace.jsx` was preserved and excluded from this commit.
No broker, provider, storage migration or API restart was performed.

## Behavior and state

- Advanced Charts no longer renders the top historical banner or the duplicate
  historical bottom strip. Selecting a start candle uses the toolbar pressed
  state; returning to the canonical cursor uses one compact history icon with
  the viewed/canonical cursor in its tooltip. Read-only historical order gates
  and the existing branch action under Chart tools → Details remain intact.
- The widget identity is session + dataset + explicit rewind generation. Forward
  reads and the transition back to the canonical head retain that widget.
  Rewinds intentionally restore the earlier cutoff-safe native layout to prevent
  later saved drawings leaking into the past.
- Historical reads keep their full authoritative execution/account state. Their
  overlapping native rows are checked against the previous same-revision,
  same-session, same-dataset/hash window before supplying a bounded new tail to
  the existing datafeed. Stale/changed/malformed windows use authoritative chart
  history instead. No future candles are prefetched or locally invented.
- Native panning and timeframe changes keep Play active. With sync off only the
  chart timeframe changes; with sync on the next replay dispatch uses the chart
  interval. Existing one-in-flight API serialization remains. Order edits,
  drawing actions, selecting a start, explicit rewind and invalid intervals stop
  Play. Pause remains available during an in-flight read, by button or Space.

## Measurements

Actual owner replay `6428cf18b3f54a36b2e90207ef12392e`, historical cursor2997,
canonical3129, 1m chart and replay interval, 1368×790, fresh isolated headless
Chromium contexts, same machine/services, normal 2000-row rolling window.
All browser API writes were blocked (including practice-time logging); playback
reads did not change the owner's session. The screenshot-only final reload uses
the existing `demo=1` audit flag to disable activity logging rather than showing
an intentionally blocked activity error. It still uses real API/chart data.

Five consecutive forward steps, click through candle delivery and two animation
frames; these are diagnostic samples, not capacity or stable tail estimates:

| Metric | Before | Final |
| --- | ---: | ---: |
| Widget/iframe recreations in five steps | 5 | 0 |
| Median step | 1585 ms | 1168 ms |
| Sample p95 (n=5) | 1740 ms | 1270 ms |
| Maximum sampled parent animation-frame gap | 83.4 ms | 33.4 ms |
| Additional chart-window fetches during five ready forward steps | 10 | 0 |

Median step latency fell about26%, without changing the server's historical
execution projection. This is not a claim of sustained60fps or16steps/s.
One bounded direct GET measured6,994,089 response bytes and2,987 execution events.
The browser historical GETs remain roughly0.9–1.2seconds each. Full history
hydration/reconstruction/serialization is still the principal remaining latency;
this UI change does not optimize that backend contract or remove correctness checks.

Follow-up: [historical API optimization](history-api/CHECKPOINT.md) records the
subsequent backend/frontend contract change, equivalent real-session measurements
and guarded local runtime update. The measurements above remain the original UI
checkpoint rather than being overwritten by the later optimization.

Raw baseline: `before/measurements.json`; final: `final-verified/measurements.json`.
Screenshots: `before/initial.png`, `final-verified/initial.png`,
`final-verified/width-{360,768,1368}.png`.

## Verification

From `foundation_v2/web`:

```powershell
node --test tests/advancedChart.test.mjs tests/replayChartWindow.test.mjs tests/advancedChartSave.test.mjs tests/replayStepView.test.mjs tests/replay-speed-a11y.test.mjs
npm run build
node run_replay_playback_acceptance.mjs final-verified
```

40 focused Node tests passed; production build passed with the existing large
main-chunk warning. The actual browser journey passed selection/no-layout-shift,
five incremental steps, panned viewport retention, native1m→3m change, synced5m
change, Space during pending read, safe rewind, return-to-latest, toolbar bounds
at360/768/1368px and an injected503 read retaining the last chart while locking
stepping. No page errors or attempted non-activity API writes were observed.

The harness accepts `TW_REPLAY_QA_SESSION` / `TW_REPLAY_QA_CURSOR` for another
existing single-asset replay with enough opened history. It never allows API
mutations. Earlier harness failures were a translated accessible-name mismatch
and a test coordinate hitting the native Back link; neither was a product pass.
The final run uses a stable latest-control ID and blurs focus before pressing Space.

Native calendar aggregation, stale seed fallback, wrong-base tails, pending
history cancellation, saved-layout cutoff selection and malformed rolling-window
rejection remain covered by focused tests. Broker/Prop execution, throughput at
high playback rates and full-product acceptance are outside this receipt.
