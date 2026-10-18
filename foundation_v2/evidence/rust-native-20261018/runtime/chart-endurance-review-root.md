# Independent scoped review — chart endurance

Reviewed the current diff of `web/src/TradingViewReplayChart.jsx`, `web/scripts/quick_trading_latency_probe.mjs`, and `scripts/rust_native_ui_acceptance.py`, then checked the final `chart-endurance-fixed-root/receipt.json` and `browser.json` for consistency. No source edits, builds, tests, browser sessions, owner runtime access, or child agents were used for this review. This file is the review artifact only.

**Result: no blocker found within this scope.** The `fitOrder` early return avoids repeatedly adding padding when every valid order level is already visible; out-of-range levels retain the existing expansion behavior. The probe now checks the range between repeated order journeys as well as during each drag. Its error path preserves FAIL and rethrows; the wrapper requires browser success and unchanged source/binary before declaring PASS.

Final evidence is internally consistent:

- Receipt `passed=true`; browser `status=PASS`; no page errors; release backend, compact storage, disposable environment, `owner_runtime_touched=false`, `broker=false`.
- Requested endurance 600 seconds; recorded 600.0016698 seconds, 120 endurance journeys at a nominal 5-second period, plus 6 measured initial journeys. Total wrapper journey time was 622.0140846 seconds, which includes setup and initial journeys.
- All 126 measured journeys retained the warmup visible price range, including their post-drag range: 1.098755624515128 to 1.10180546935609.
- 121 post-GC memory samples: heap 23,731,772 to 35,129,084 bytes, delta 11,397,312 bytes versus a 16,777,216-byte allowance; DOM 1,727 to 1,727, delta 0 versus an allowance of 50. Both recorded deltas match the endpoints. The final memory sample was at 598.105275 seconds.
- Endurance drag-frame sample p95 16.7 ms versus 33.5 ms; marker/rAF timing sample p95 77.5 ms versus 200 ms. These are endurance metrics; the receipt's initial-journey paint summary is a separate population.
- Receipt source/binary stability flags are true. All 261 recorded source fingerprints match the current files; the current API binary matches receipt SHA-256 `f35a37bd86c821304f1e76df758dfb3b8f3d7fd9e84dbdf69ac617d270473040`.

The earlier `chart-endurance-600s-root` and `chart-endurance-diagnostic-root` remain failed evidence: each has `receipt.passed=false` and `browser.status=FAIL` with a protection-response timeout. The diagnostic captured sample 51 SELL with a visible range of approximately -259.677 to 262.066. The later successful run does not relabel either failed run.

Limits: this proves a bounded headless desktop open → drag TP → close workload at the same replay cutoff. It does not establish whole-product acceptance, playback/reload/dataset-switch endurance, manual or touch interaction, capacity, or absence of leaks. Memory is page-target heap after forced GC, comparing endpoints while the canonical ledger grows; it is not peak or whole-browser RSS. API resource observations have no acceptance budget in this probe. Marker timing uses DOM mutation plus `requestAnimationFrame`, not compositor-confirmed pixel presentation. Existing saved layouts with already-expanded ranges are not automatically repaired by the early return. Data/Research revalidation is outside this review.
