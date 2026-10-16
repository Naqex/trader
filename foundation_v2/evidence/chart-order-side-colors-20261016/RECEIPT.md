# Entry direction colors — 2026-10-16

Owner requested Buy green / Sell red on the chart order marker. Entry now uses the existing chart positive/negative tokens for its text, outline, close button and dashed price line. Color consistently identifies order side, regardless of the floating PnL sign; explicit +/- amounts still identify profit or loss. TP stays green and SL orange. Fallback chart strokes follow the same colors. No new palette values or dependencies.

The order side from existing projected state selects the token. Order values, persisted protections, execution, layout and drag behavior are unchanged.

Validation:
- 11 focused unit tests pass; existing assertions cover losing Buy, winning Sell and light/dark tokens.
- Build passes with existing bundle-size advisory.
- Browser regression: 9 groups / 20 synthetic mutations pass using real native chart with fixture API intercepts. Buy/Sell marker color, compact handles, drag/rollback/rejection, scale, close flow and light/dark switching verified. No owner data writes.
- Initial browser run timed out at the old light-theme blue expectation; updated that assertion to the newly requested light-theme green and reran. Initial screenshot retained separately.
- Buy1064 and Sell1368 screenshots visually reviewed. Independent source review by quick_trade_latency_audit found no blocker; reviewer did not rerun tests independently.

Screenshots and receipt.json are fixture evidence; this is a scoped color change, not new engine/performance acceptance.
