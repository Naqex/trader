# Report axis policy — 25/10/2026

Owner approved the proposed sign-aware axes after reviewing one/two/many values,
same-sign/mixed-sign rows, split profit/loss, repeated values and knownzero.

## Behavior and ownership

`ReportBars` passes its actual rendered segment values to shared `chartDomain`.
Positive-only bars span zero to a rounded maximum; negative-only bars span a
rounded minimum to zero. Mixed signs use symmetric rounded bounds. Split monthly
profit/loss uses both segments, never net P/L alone. `chartTicks` thins reference
marks to fit the plot while retaining both endpoints and zero at equal intervals.

Knownzero uses domain `{low:0,high:0,ticks:[0]}` and centered coordinates, avoiding
division by zero and invented bounds. Existing category hit targets/tooltips stay
active with no artificial rectangle. Unknown/empty data remains unavailable.
Winrate's fixed0–100 domain is evaluated first; counts retain integer steps.
Equity uses `zero:false`, preserving its observed-value scale and smooth curve.
Data filters, aggregation and backend storage are unchanged.

## Evidence

- Focused model tests:7/7 PASS, including single/two/many signs, repeated values,
  allzero, tick thinning, integer counts, fixed percentages and curve regressions.
- Browser component fixture:38 assertions across1920dark/390light, horizontal
  and vertical cases, split P/L, zero percentages and integer counts. Empty and
  unknown render no numeric chart; zero/split hover tooltips verified.
- Initial split fixture assumed bounds±800 from an illustrative proposal. Existing
  nice-step selection correctly chose±750 in250 steps for[-500,+600]; fixture
  oracle corrected and rerun. Both bounds cover all segments symmetrically.
- Scoped production build passed using HEAD plus task overlays and the prior
  verified private CSS baseline. Fixture files remain outside production dist.
- Candidate and deployed Dashboard:2400dark real data,1920light demo and390dark
  demo PASS, no JavaScript errors/write requests. Real negative-only month spans
  [-5,0], symbols use integer[0,1], knownzero shows only0,12months retain mixed
  symmetric bounds and60% row thickness. All bar hover descriptions verified.
- Independent `bar_density_review` reviewed source, reran7 tests and inspected
  component/real Dashboard desktop/mobile captures; accepted without findings.

Scripts, reports, screenshots and rollback are local under
`E:/BACKUP-TRADINGWORKSPACE/report-axis-policy-20261025/`.
Served UI5180 index SHA256:
`0f236d2a48dda0b4a483f05b2a7712cbaa6a0556414402471d5abf9e449d3279`.
Old hashed assets/private branding retained. No API/terminal restart or broker action.
