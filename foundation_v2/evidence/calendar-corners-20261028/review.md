# Independent corner review — PASS

Scope: the Analytics month calendar corner fix in `calendar-view.css` and its matching rule in `ui/compact-system.md`. No product edits were made by this reviewer.

Source review confirms only the outermost cells of the last month row receive the shared 9px inner radius. The colored `::after` stroke inherits that shape. Middle cells retain zero radius, year cells retain their existing shape, and the selectors do not affect Live. Analytics dates remain passive: no new click handler, tooltip, focus target or hover feedback was added.

Inspected actual baseline and candidate left/right crops at 1440px dark, 1440px light, and 390px dark. The candidate colored stroke now follows the outer curve; the clipped square child corner visible in baseline is resolved. Inspected the full 1440px calendar as a layout check.

Read the runnable corner QA script and report: PASS 3 cases, matching parent/cell/pseudo radius, square middle cells, passive hover, no page errors or writes. Controls regression report PASS 7 journeys, including the real read-only Session report. Browser tests were run by the parent; independent review inspected their scripts/results and actual images.

This accepts the scoped corner fix only. Neutral-black palette images are ephemeral proposals; the candidate manifest keeps the existing palette asset/hash. No palette migration, broker acceptance or whole-product acceptance is implied.
Reviewed CSS SHA256: 4dc3c732b6ac44bff6abda768e4cb1ae037f9793c82379fa2824f956758a2a7b
Candidate index SHA256: d180eaf7d0f842fb6a0a6b3e8c5c9de0948d188d80604c18bb0b9c78b43c05da
