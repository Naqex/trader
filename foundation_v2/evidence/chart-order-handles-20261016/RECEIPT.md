# Joined TP/SL handles — 2026-10-16

User reference: `codex-clipboard-9a2adef9-7345-4a5f-9e18-b89dab5c6fb8.png` (attached visual): each grip has a single column of dots; the two boxes touch side by side.

Changes:
- Grip width is 2px, matching one 2px-wide repeating dot tile; the entire button remains independently draggable.
- TP and SL at the same price share an edge. Entry keeps its separate 8px gap. Different price levels retain independent vertical positions and normal collision spacing.
- Placement measures fractional DOM bounds to avoid subpixel overlap when boxes touch. Compact protection text uses consistent padding whether unset or saved at Entry.
- No execution, persistence, validation or price changes.

Verification:
- 11 focused unit tests pass.
- Build passes (existing bundle-size advisory remains).
- Browser: 9 scenario groups / 20 synthetic mutations pass, using real native chart with intercepted fixture APIs. Checks cover single-column grip dimensions, TP/SL touching bounds at 1064/1368px for Buy/Sell, drag preview, Escape, validation/rejection, scale modes, themes and close confirmation. No owner data writes.
- Initial run failed the older strict-gap assertion; updated its oracle to permit the newly requested shared edge. Final screenshots reviewed for Buy1064 and Sell1368.
- Independent source review by quick_trade_latency_audit found no blocker in spacing, compact padding or single-column grip changes. Final fractional DOM measurement was reported to the reviewer as well.

Full browser results are in receipt.json. Screenshots are fixture evidence, not owner session screenshots.
