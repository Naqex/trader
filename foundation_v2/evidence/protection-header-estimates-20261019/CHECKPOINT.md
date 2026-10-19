# Compact header estimates

Owner rejected the separated, enlarged estimate totals and requested their
placement at the right of the SL/TP switch row. Moved the existing estimate
component into that row; restored compact 12px label/13px amount and removed
the separator and separate totals row. Semantic colors/calculations unchanged.
The switch label retains only its own width, so clicking an estimate does not
toggle SL/TP. Header supports wrapping for unusually long localized amounts.

Validation: production build passed (existing chunk-size advisory). Three native
Partial TP journeys passed, including target allocations/execution/accounting,
reload and fork, at 1368 dark VI, 768 light EN and 390 dark VI. Reviewed desktop,
mobile and tablet screenshots: estimate and switch remain on the same line.
Owner preview rebuilt and reloaded; restored the visible enabled SL/TP draft
without submitting. No backend or persistence changes.

Report: `partialTakeProfit/browser.json`. Proof: `owner-header-estimates.png`.
