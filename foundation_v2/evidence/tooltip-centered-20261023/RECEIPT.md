# Shared tooltip placement — 23 October 2026

Scope: app-owned control tooltips through ProjectTooltipLayer/LegacyPopover,
including the shared controller mounted in chart documents. Vendor-rendered
TradingView data/control hints retain their own renderer.

Tooltips now prefer the horizontal center of their trigger. At viewport edges,
the pointer stays at least 18px from the box edge (half-width for very short
tooltips), away from the 8px rounded corner. The pointer square is reduced from
8px to 6px. Menu alignment and tooltip lifecycle are unchanged.

Validation: production Vite build passed. Browser QA against the actual :5180
build verified the reported Chat AI tooltip (center x=30.3125px in a 60.625px
box), the right-edge help tooltip (26px pointer clearance), bottom-navigation
tooltip flipping above its trigger, and EN/light at 390px (center x=29.367px in
a 58.734px box). VI/dark and the native viewport were restored. Screenshots are
in this directory. No broker actions or account mutations were used.

The stopped static preview was restarted on :5180; API :8010 was not restarted.
The prior error-document tab could not be navigated by the browser tool, so a
fresh application tab was retained for review.
