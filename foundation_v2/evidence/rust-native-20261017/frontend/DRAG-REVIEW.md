# TP/SL drag performance continuation

The marker writes its local preview on animation frames; the revisioned API
mutation still happens once at pointer release. Rejected/cancelled gestures restore
the authoritative price. Returning to the original tick sends no mutation.

The overlay now skips repeated snapped prices, reuses the computed label and line
color, and uses ResizeObserver border-box measurements for collision placement.
This removes synchronous marker geometry reads from the recurring pointer path.
Colors, labels, price-to-coordinate mapping and keyboard behavior are unchanged.

Production React + actual Advanced Charts, synthetic identical API, six measured
gestures after one warmup per build, Node v24.19.0 / headless Chromium:

| Metric per gesture | Before median / sample p95 | After median / sample p95 |
| --- | --- | --- |
| Native line price writes | 74 / 74 | 12 / 16 |
| Chromium layout count | 91 / 91 | 21 / 26 |
| Click to confirmed paint | 30 / 46.5 ms | 30.4 / 31.4 ms |

Raw samples and source hashes: drag-before/receipt.json, drag-after/receipt.json.
These are rendering diagnostics, not HTTP/backend or production capacity results.
The sequential order and small sample count do not establish robust latency tails.

Validation: five overlay unit tests; quickTrading.browser.mjs passed nine workflow
cases and twenty intercepted mutations, including Buy/Sell, real pointer drags,
invalid direction, cancellation, API rejection, pending preview, unchanged-price
round trip, close confirmation, keyboard, log/invert/relative scales, resizing,
light/dark and equal-price marker placement. Screenshots reviewed at SELL1064 dark
and BUY1440 light. Evidence remains in drag-regression/receipt.json and PNGs.

The browser regression uses fixture interception against the existing local UI;
it neither mutates owner replay sessions nor contacts a provider or broker. Full
native-runtime HTTP/UI acceptance remains open in the canonical checkpoint.
