# Quick trading: chart interaction and latency — 16 October 2026

Scope: the owner's Entry/TP/SL redesign and immediate interaction feedback in
the current `foundation_v2` implementation. This is a scoped receipt, not whole
product or Prop Firm acceptance. Auto-BE and multi-position remain deferred.

## Behavior and ownership

- Native Advanced Charts v23 primitives draw the price lines and price-scale
  labels. Small DOM controls inside the same iframe own the visible boxes and
  their hit targets; there are no invisible canvas-label drag targets.
- Buy Entry is blue, Sell Entry orange. Entry is read-only; its X opens the
  existing modal primitive with a revision-guarded close/cancel confirmation.
- Unset TP/SL appear at the Entry price in separate horizontal boxes. Set legs
  use their actual prices; saved Scalper presets preserve independent legs.
  TP is teal and SL orange. Protection labels show projected account-currency
  P/L and quantity; missing FX conversion suppresses the amount. No pips or
  synthetic/random ticket numbers are displayed. The saturated candle palette
  remains unchanged.
- Pointer capture and document capture keep the actual visible handle draggable
  across the iframe boundary. Movement is coalesced through requestAnimationFrame;
  release sends one mutation. Escape, cancellation, invalid direction and API
  rejection restore authoritative price and native line color. Arrow keys and
  Delete remain available on focused protection handles.
- A local `submitting` preview appears before the request completes, scoped to
  workspace/session/dataset/cursor. Confirmed execution always wins. There is no
  speculative fill or success notification. Pending protection retains the
  released preview until the request resolves.
- Price projection handles normal/log/inverted scales; off-screen labels are
  clipped to the pane. Resize synchronizes the marker bounds after native layout.

The UI/state flow is `click -> submitting preview -> revisioned command ->
authoritative replay -> queued/position UI`; protection uses `drag preview ->
validate -> one revisioned mutation -> confirmed protection or rollback`.
Only the order layer updates during these interactions; pending toggles no longer
wait for chart history ingestion or recreate all native order lines.

## Measured bottleneck and limits

Each small replay command previously verified the entire 140,930,011-byte
Parquet file (8,755,235 rows). Profiled verification consumed 2.126 of 2.334
seconds across five service calls. Commit `30076ed` retains bounded verification
receipts keyed by expected SHA and reliable open-file identity/change stamps.
First access and changed files still verify fully; unavailable change stamps
use the uncached path. The deployed local API was restarted using its guarded
managed restart script after its idle/schema/ownership checks passed.

Six alternating equivalent service samples had equal outputs:

| Measurement | Before | After |
| --- | ---: | ---: |
| Direct service median | 624.245 ms | 14.49 ms |
| Warm replay HTTP GET, 10 KB | 499–573 ms | 92.9–93.2 ms |

The first post-restart GET took 616.6 ms including cold verification. The Prop
replay's 260 KB GET took 170–203 ms. These read/service measurements are distinct
from click-to-confirm timings; raw samples are in `backend-performance.json`.

Real UI measurements used a newly-created disposable replay on that same large
dataset, against the running Vite -> Axum -> PostgreSQL -> Python stack:

| Side | Click to pending frame | Click to confirmed queued UI |
| --- | ---: | ---: |
| Buy | 41.7 ms | 300.2 ms |
| Sell | 31.3 ms | 349.3 ms |
| Buy | 31.0 ms | 291.0 ms |
| Sell | 30.3 ms | 288.4 ms |

The pending measurement observes the next animation frame after the DOM update;
it is a local diagnostic, not display hardware latency. Four samples do not
establish stable tail latency. Remaining confirmation time includes durable
queue/database work and existing worker/result polling (100/75 ms). This task
does not replace the scheduler or claim globally instantaneous persistence.
Owner sessions were not traded. The disposable session was deleted through its
revision/name-guarded API; `live/receipt.json` records the cleanup.

## Validation

- `node --test tests/advancedOrderOverlay.test.mjs tests/replayOrderModel.test.mjs`:
  9 passed. Tests cover currency conversion/unknown amounts, validation against
  the closeable quote, transformed coordinates and authoritative/pending state.
  A stale model assertion was corrected: persisted protection wins over a stale
  form draft; empty protection remains tested separately on a draft.
- `node tests/quickTrading.browser.mjs`: 8 scenario groups, 20 intercepted
  mutations, no page errors. Real native chart/DOM controls, synthetic API only.
  Includes delayed/rejected requests, Escape/invalid ghost rollback, duplicate
  click suppression, close confirmation, keyboard removal, presets, scale modes,
  resize at 1064/1368/1440 px and light/dark screenshots.
- Pixel checks sample the native canvas strokes independently of marker geometry:
  9 visible marker/line comparisons across normal, log, inverted, percentage and
  indexed modes; maximum difference 0.875 CSS px. Out-of-pane labels are excluded
  from stroke comparison because they are correctly clipped.
- `node tests/quickTrading.live.browser.mjs`: PASS on the running local stack.
  Four Buy/Sell/cancel cycles, actual next-bar fill, actual iframe SL drag,
  persisted SL restored after reload, no page errors, fixture cleanup confirmed.
  Initial test attempts exposed a stale historical URL in the test and a drag
  destination above the current closeable quote; the final test explicitly opens
  the latest cursor and chooses a valid SL relative to the current quote.
- `.venv/Scripts/python.exe -B -m pytest tests/test_artifact_verification_cache.py -q`:
  7 passed, including changed/replaced files, restored mtime and uncached fallback.
- `npm run build`: PASS. Existing large-chunk advisory remains.
- Independent source review: `independent-review.md`; reported source issues
  were repaired. Its requested absolute native alignment check is now covered
  by `redesign/receipt.json` and the pixel assertions above.

Visual evidence: `redesign/queued-ghosts.png`, `redesign/close-confirmation.png`,
`redesign/position-1064-dark.png`, `redesign/position-1440-light.png` and
`live/real-position.png`. Reviewed for visible handles, spacing, side/protection
colors, read-only Entry, dialog hierarchy and persisted protection.

Reference behavior was researched using FXReplay's official support articles
[drag and place SL/TP](https://support.fxreplay.com/articles/how-to-drag-and-place-stop-loss-take-profit-on-the-chart)
and [Scalper mode](https://support.fxreplay.com/articles/how-to-use-scalper-mode-for-faster-trade-execution).
The implementation uses the authorized local v23 APIs and app-owned controls;
it does not copy FXReplay source code.
