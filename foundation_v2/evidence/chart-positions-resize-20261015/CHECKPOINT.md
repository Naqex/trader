# Chart positions resize and flat Prop rules

Scope: local `foundation_v2` UI. No playback, orders, data migration or backend
contract changes. The targeted browser test blocks API writes while opening an
existing running replay; activity-sync warnings in those screenshots are expected.

## Findings and changes

- The previous drag stayed closed until 48px, then jumped to a 260px minimum.
  It also resized the native canvas during each frame and hid/revealed the
  floating toolbar. The table now tracks rounded pointer coordinates over a
  stationary chart; the chart commits its new size on release. A preview below
  48px closes on release instead of leaving an unusable strip.
- Pointer cancellation, lost capture, Escape, window blur and viewport changes
  restore the previous layout. Closing preserves the selected table tab; restore
  uses the previous table size. Memoization avoids rebuilding the trade table
  for each drag frame.
- The mobile utility rail intercepted the maximized table's restore control.
  Table overlays now have their own stacking context above the rail. Account
  actions use compact mobile spacing and an accessible Analytics icon.
- Stats & Rules uses full-width horizontal rules and column separators instead
  of nested rounded cards. Vietnamese copy uses plain labels while retaining
  Prop Firm, Drawdown and Replay; English labels are also checked. Financial
  thresholds and lifecycle state remain the existing session's actual values.

## Evidence

- `receipt.json`: PASS, real local native chart; 1710/1440/390px and device pixel
  ratios 1/1.25/2; mouse, touch, reversal, cancellation, keyboard, maximize and
  restore; iframe retained and canvas geometry stable during the gesture.
- No ancestor CSS zoom, transform or blur filter found. Native canvas backing
  dimensions match CSS dimensions times the device pixel ratio within rounding.
  This does not reproduce every possible OS scaling or browser zoom setting and
  does not establish a cause for subjective softness in resized screenshots.
- `rules-*.png`, `positions-*.png`: reviewed desktop/mobile and English rendering.
- Production build: PASS (existing bundle-size warning). Prop creation/rule model:
  7 Node tests PASS.
- `design-system/browser.json`: 10 desktop dark/light fixture cases PASS,
  including table tabs, pagination, hover/focus and unknown execution state.
  A broader run stopped at the old mobile assertion that the utility rail starts
  collapsed; the current rail is visible. That unrelated expectation was not
  changed or counted as passing. Targeted mobile drag checks are in `receipt.json`.

These checks cover the requested UI changes, not whole-product acceptance.
