# Calendar outer corners — 2026-10-28

Scoped source/candidate/deployed UI PASS. Both corner states reproduced using
labeled positive/negative May25/31 fixtures before the fix. The month scroll
clip radius was9px but child cell and colored pseudo stroke were square: the
parent cut off the corner instead of drawing a continuous curve.

Only first/last cells in the final month row now share the inner9px corner;
colored pseudo strokes inherit the shape. Middle/year cells keep their existing
geometry. This is presentation only: no report values or interaction state changed.
The square-grid/rounded-shell rule is recorded in ui/compact-system.md.

Checks: candidate corner3 and calendar controls7 journeys PASS; deployed5180
corner3 PASS. Covered1440 dark/light and390 dark; no errors/writes, no Analytics
day interaction added. Reviewer inspected source, before/after crops and QA
reports independently. Parent ran browser checks. Live selectors are untouched.

UI-only atomic index rollout preserved palette/branding/mutable assets and old
hashed assets, with rollback index in promotion.json. Native API process path
matched its owner manifest; no service restart or broker interaction occurred.

Neutral-black background screenshots are browser-local proposals ONLY. No shared
palette, pin or disabled-state contract was changed in the deployed build.
Proposal images: E:/BACKUP-TRADINGWORKSPACE/calendar-corners-20261028/candidate/
dark-current.png and dark-proposal.png. Screenshot fixtures are labeled synthetic
data, not an acceptance claim about the underlying trading data.
