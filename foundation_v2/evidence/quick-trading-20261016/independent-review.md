# Independent review — chart trading redesign

Read-only source review on 16 October 2026 of `advancedOrderOverlay.js`,
`replayOrderLabels.js`, `TradingViewReplayChart.jsx`, `ChartOrderPanel.jsx`,
`replayOrderModel.js` and their caller. Reviewed while the root agent was
actively repairing and testing these files; this is a finding record, not final
approval of a later source revision. No owner orders were placed by the reviewer.

## Findings sent to root

1. **Pending protection preview jumps back before the response.** Original
   `finish()` cleared the drag and subsequent `sync()` drew authoritative old
   levels while the mutation was pending. Root added `pendingPrices` during
   this review, holding the marker until the request settles. This resolves
   the source-level cause; delayed-response browser coverage remains with root.
2. **Scale transformations need explicit support.** The bundled v23
   `IPriceScaleApi` exposes `getMode()` and `isInverted()`, but no
   `priceToCoordinate()` / `coordinateToPrice()` methods. The current fallback
   is linear and non-inverted, so Log/Invert can separate DOM markers from
   native lines and change the dragged price incorrectly. Root should support
   these transformations or clearly prevent editing under unsupported modes,
   and verify alignment after switching scale modes.
3. **Ghost native line color is not restored after cancel/rejection.**
   `paintDrag()` makes the native ghost line colored. `cancel()` and invalid
   release restore only the price and DOM marker. The chart's cached native
   signature may still equal its pre-drag signature, so refresh skips restoring
   transparent ghost color. Restore both price and line color on rollback and
   cover Escape, pointercancel and rejected release.
4. **Frame resize must synchronize marker bounds.** `resizeChrome()` dispatches
   the vendor resize, while marker root bounds are computed only in `sync()`.
   A resize without pointer movement or a visible-time-range event can leave
   the marker layer at old bounds. Synchronize after the native resize/layout
   settles, including positions-panel resize and viewport resize.

## Other source checks

- Only TP/SL bodies expose drag targets; Entry remains a span with a separate
  close button and confirmation dialog.
- Pointer events use capture in the iframe, coalesce movement through one RAF,
  check generation/editability and commit only after release. Escape, blur and
  lost capture route through cancellation.
- Pending quick orders are scoped to workspace/session/dataset/cursor before
  rendering. Authoritative order state wins over the pending preview.
- Validation checks direction before making the mutation. No random ticket
  number is synthesized in labels. Unknown currency conversion suppresses the
  projected money amount.
- Final acceptance still requires root's delayed-response, cancellation,
  transformed-scale, theme/width and screenshot checks on the final source.

## Backend measurement

Raw samples and scope are in `backend-performance.json`. After root's guarded
managed restart, four GET samples for the 10 KB replay response were
616.6 ms cold, then 93.2 / 93.1 / 92.9 ms. Four GETs of the 260 KB Prop replay
response were 178.2 / 203.3 / 172.4 / 170.0 ms. These confirm the integrity-cache
fix is live, but do not establish click-to-paint or mutation latency.

The visible X is present in the captured failed test screenshot despite its
`getByRole` timeout. That observation alone does not identify the accessibility
or test failure; root collected and repaired runtime evidence separately.

## Final source re-review

**No remaining actionable source blocker found in the reviewed fixes.**

- `restoreLine()` now restores both authoritative price and ghost/native color
  on Escape, cancellation, invalid release and request settlement.
- `pendingPrices` retains the marker preview through the request. Generation
  checks prevent it carrying into another replay state.
- Focusing the visible handle before pointer capture gives Escape a keyboard
  target in the iframe. Lost capture and blur still cancel the gesture.
- Inverted ranges are normalized, and mode-aware conversion handles inversion
  and signed-log coordinates. The signed-log logical/coordinate offset formula
  was independently compared with the authorized local v23 bundle
  `library.65801ad368023d78aaa8.js` and matches its mathematical transform.
- Overlay bounds are synchronized one animation frame after native resize, and
  pointerup also schedules synchronization after native interaction settles.

Source hashes at this pass:

| File | SHA-256 |
| --- | --- |
| `web/src/advancedOrderOverlay.js` | `172a1db9f4490c8d3e25768377aebcdbc6611a18acfff12a44d1e68a3cece457` |
| `web/src/TradingViewReplayChart.jsx` | `8d646057c143c0c37d0d290cc9492d5a522036bf3146c0129f0dd7669d6c5809` |

This source review does not certify absolute alignment of a canvas primitive and
a DOM marker in every scale mode. Root's transformed-mode loop checked ordering
and keyboard-updated native price; those assertions alone can pass with an
incorrect absolute coordinate. A final native-coordinate or pixel-alignment
check should cover linear/log/inverted modes alongside the final screenshots.
Root owns that runnable UI evidence and final UI acceptance.
