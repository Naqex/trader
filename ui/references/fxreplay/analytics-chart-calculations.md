# Analytics: calculation and chart contracts

27/10/2026. Extends [the FX research](analytics-live-charting-audit.md).
FX was showing demo data, a reference for interaction and labels rather than
a production formula oracle. This document records the local chart contracts.

## Data flow

Replay result → `analyticsViewModel` ledger/observed curves → `advancedAnalytics`
filter/classification/group statistics → `FxAnalytics` → `AnalyticsCharts` SVG.
Only experiments matching session, dataset/hash, revision, cursor and event sequence
enter the report. Prop also fences its binding/phase/currency. Live keeps its own
manual-trade/broker-deal adapters and account/coverage/currency boundaries.

Actual R precedence: verified original-stop experiment R → ledger realized R →
net/original account risk budget. Enrichment happens before grouping. The top
sparkline, hour/session/month and calendar now use the same observations.
Configured scenario stops cannot become original risk; missing R is unavailable.

## Chart matrix

| Chart | Calculation / grouping | Display and missing data |
| --- | --- | --- |
| Cumulative PnL | Observed closed balance minus original capital; last observation in each time bucket | All/day/hour/15min; retain internal null gap; unknown capital prevents relative money |
| Actual R | Net/original account risk with verified source precedence above | One slot per selected trade; unknown gaps remain; mean/max of known values only |
| Ideal R / opportunity | Maximum costed closeable opportunity in complete observed one-week window within cutoff | Partial week unavailable; losing recovery uses eligible observed losers; no guaranteed fill |
| Expectancy | Sum net / all closed trades includingBE | Average money; missing financial input blocks certainty |
| Profit factor | Sum positive net / absolute negative net after fees | Uncapped ratio; owner-selected ring cap4 only. Empty/BE/loss0; allwin∞; unknown N/A |
| Winners/losers | Threshold classification, count/extrema/mean/duration/streaks and source-capital returns | Separate green/red cards, VI/EN help; threshold changes classification, not money |
| Side count / WR | Counts incl unknownside; wins/all closed trades of each side includingBE | Count pie versus independent WR progress rings; WR need not sum100 |
| Session radars | Overlapping fixedUTC windows: Asia00–09, London07–16, NewYork13–22, outside22–24 | Count/WR/meanR/net-to-source-capital%; session names and grid without numeric labels, exact values on hover/focus/touch; domain and signed zero contour retained; overlapping counts not additive |
| Hour bars | Report observation time in selected zone; net/meanR/return%/WR | Signed bars, units; unavailable distinct from0; WR includesBE |
| Weekday bars | Local weekday net and independent WR column | Green/red money; no-trade WR=N/A; no misleading second money/% axis |
| Month matrix | Source-capital percentage returns; pooled or sum-session mode selected | Empty dash, missing capital N/A, incomplete allocation blocks totals; current snapshot separate from filtered ending balance |
| Calendar | Monday-first dates, trade-weighted period/R summaries | Shared Live presentation, independent adapters; undated/partial scope blocks complete totals |
| Frequency | Mean trades per active weekday, ISO week number and calendar month; header uses total trades / distinct active periods | Explicit tradeCount/periodCount/average; empty categories unavailable, missing PnL still counts; undated rows not allocated. See [frequency correction](analytics-frequency-and-aggregation.md) |
| Closed DD | Prior observed peak minus close balance, % of peak | Money/% negative bars; conservative after gap; recovered elapsed24h days distinct from unresolved episode |
| Equity DD | True equity including floatingPL, separate segments | Never substitute closed balance; trade filters cannot claim account equity; sampled/partial explicit |
| MAE | Observed adverse closeable price/original SL distance | Knownzero included, bins conserve counts; configured SL rejected; unknown terminal extrema omitted, possible lower bound |
| Winning MAE | Mean/min/max observed MAE for net-positive trades | No winners/original risk → N/A; no Infinity placeholders |
| SL/RR alternatives | Read-only costed path within original holding/cutoff; original SL for RR, configured stop for SL | Ready rows with both PnLs only, same rows in both curves; eligible n/total; ambiguous/unsupported numbers hidden in table too |
| Monte Carlo | Seeded complete-ledger bootstrap or binary probability model; ruin floor0; percentiles over all runs | At most30 paths drawn. No invented missing defaults. Binary initial WR excludesBE; bootstrap retainsBE. Strict blank/input/overflow guards; changed config needs rerun |
| Live curves/tags | Manual closed trades vs filled broker deals; net=profit+commission+swap+fee | No round-trip WR from deal count; incomplete costs/coverage stop certainty; per-record tag filtering even in mixed sources; tags overlap |

## Independent four-trade oracle

Capital1000; Jan1/Jan3/Jan3/Feb5 net `[100,-50,0,150]`,
R `[2,-1,unknown,3]`: net200, expectancy50, WR50% includingBE, PF5;
meanR4/3, hour08 meanR0.5, hour14 meanR3. January net50/return5%,
February150/15%; frequency4/3 active day,4/2 active week,4/2 active month. RR keeps source slot#4.
Scenario stale999 on non-ready rows is excluded from sums, curves and details.
Monte Carlo1000capital/100%win/100meanwin/3trades ends1300 on every path;
fractional mean1.333… remains valid without rounding money for an HTML step.

`foundation_v2/web/tests/analyticsChartLogic.test.mjs` and the existing
analytics/capital/calendar/chart/Live suites own numeric regression checks.
Raw oracle scripts, screenshots, failed attempts and manifests remain local:
`E:/BACKUP-TRADINGWORKSPACE/fxreplay-chart-logic-20261027/`.

## Deliberate differences and remaining FX gaps

Main local WR includesBE; FX demo75%=3/(3+1) excludesBE. Binary configured Monte
Carlo and the RR alternative use their explicitly stated nonBE denominator.
Frequency now uses explicitly defined active periods, with frontend/demo evidence
and backend limits recorded in [the correction](analytics-frequency-and-aggregation.md).
PF uses net after fees and cap4 only for display. These
definitions remain recorded rather than changed to match demo constants.

FX production Ideal/MAE/intrabar/SL/RR/Monte Carlo internals, populated Live
returns/partial fills/reconciliation and inaccessible Prop/Live charting remain
unverified. Existing tested local contracts apply. No original FX tab refresh,
replay advance, owner trade write or broker action was used in this audit.

[Rollout and acceptance receipt](../../../foundation_v2/evidence/fxreplay-chart-logic-20261027/RECEIPT.md).
