# Horizontal report bar density — 25/10/2026

The owner reported excess space between horizontal row boundaries in monthly
performance and trades by symbol. Both use `ReportBars`, whose shared thickness
formula capped horizontal bars at36px regardless of the available category height.

Horizontal bars now occupy60% of their category row, centered with20% padding
on each side. The row uses measured plot height and category count. Vertical bars
retain their existing sizing. Data, axes, signed segments and grouping are unchanged;
knownzero still has no artificial bar and retains its tooltip target.

## Verification

- Scoped HEAD build with only task overlays and the previously verified private
  CSS baseline passed; unrelated WIP excluded.
- Before/candidate/deployed checks:2400dark real data (one month/one symbol),
  1920light and390dark demo data (12 calendar months), all PASS.
- All six before/candidate chart comparisons retained row counts, descriptions
  and value-axis bar lengths. Row padding remained positive for every segment.
- Hover tooltip text matched its category; real knownzero retained its hit target
  without a visible rectangle. No page JavaScript errors or write requests.
- Initial QA tried focus immediately after scrolling; the tooltip was dismissed
  by a pending scroll event. The check was corrected to use the requested hover
  behavior and wait for matching tooltip text, then all stages reran successfully.
- Independent `bar_density_review` inspected the diff and desktop/mobile images;
  accepted with no actionable findings.

Local scripts, screenshots, reports and rollback:
`E:/BACKUP-TRADINGWORKSPACE/report-bar-density-20261025/`.
UI5180 served the verified index SHA256
`9eb9c5fc4ad87722cace2097fd95c820395b75da17e61e780038ed08bbb0af9f`.
Old hashed assets and private branding retained. API/terminal unchanged.
