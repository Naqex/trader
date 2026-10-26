# Independent Dashboard review — 26 October 2026

Reviewer: `/root/dashboard_final_review`. Source reviewed read-only; no product files edited by reviewer.

**Source and candidate visual review: PASS, no remaining blocking finding.** Final native rebuild, isolated HTTP integration against the final bytes and deployed acceptance remain the root agent's separate gates.

## Findings resolved during review

1. **Rollback/re-upgrade could block replay.** An older compatible runtime advances the cumulative historical counter while ignoring dated buckets. The initial new capture logic rejected the stale sum on re-upgrade. Root now validates recording shape and clock bounds, rejects an oversized sum, and conservatively starts a new dated epoch when the recorded sum is below the cumulative counter. The old cumulative amount becomes undated baseline; it is not assigned a fabricated day. Added rollback/re-upgrade and oversized recording regression reviewed; final execution pending rebuild at review time.
2. **320px titles broke inside words.** Two metric columns plus the new help icon left insufficient title width. Root added a single metric column at <=380px. Reviewer reran and visually inspected the final 320px English screenshot: all four titles are readable, seven tips remain reachable, and no horizontal overflow appears.
3. **Avoid unrelated heading spacing changes.** HEAD already wrapped ReportBars headings in `report-heading`. Root restored that baseline and only appends the optional help button. Other ReportBars consumers retain their original heading wrapper.
4. Prior review's paragraph translation issue is fixed: ReportInfo translates each paragraph separately, so already localized dynamic multi-paragraph strings do not become spurious missing-copy entries.

## Source checks

- The common save hook captures positive elapsed deltas for both full payload and optimized taken-payload paths. Save/revision/receipt transaction ownership remains unchanged.
- Multiasset timing is incremented once for the shared replay clock; selecting an asset does not add elapsed replay time.
- Branch creation resets the timing epoch instead of inheriting the parent's measured replay time.
- Period aggregation propagates unknown coverage, keeps known zero distinct, and never assigns legacy cumulative activity to guessed dates.
- Date-filter upper bounds include the final recorded microsecond of the selected day.
- Closed-trade count, fee-based win classification and financial denominator are unchanged; added VI/EN help describes the existing contract, including partial closes and breakeven.
- The duplicate remaining-days badge is removed; remaining days below progress are retained.

## Independent browser evidence

`browser.json`: four candidate cases PASS at 1920 VI, 1000 EN, 390 VI and 320 EN. Seven help buttons per case, click and keyboard Tab/Shift+Tab, Escape, accessible names/descriptions, tooltip viewport bounds, label geometry and removed badge. No page errors, no writes and no external/broker/event access.

`final320/browser.json`: final responsive repair PASS at 320 EN. Screenshot `final320/metrics-320.png` was visually inspected alongside the desktop screenshot. Titles now fit without broken words.

Root evidence inspected: `../qa/report.json` has 11 PASS cases covering dark/light, VI/EN, real read-only data, demo, zero, denied, error and no-trades. `../test-web.log` records 25 PASS; `../test-clipping.log` records the existing activity-clipping regression PASS. Earlier isolated HTTP report has full/optimized/multiasset save, retry, conflict, reload, asset-switch, fork and period cases PASS; root is rerunning it after the final native rebuild.

## Material limits

- Legacy undated history remains unavailable for affected period filters. Arbitrary subminute filters crossing a compacted bucket also return unknown rather than estimating.
- Bucket metadata grows with active real minutes and is copied into replay revisions. This is not constant-size lifetime storage; long-session storage/performance was not benchmarked in this slice.
- This review does not claim FX backend formula parity, whole-product acceptance, broker validation or deployed verification.
