# Performance: side, month, calendar and frequency

Checked and implemented 27/10/2026. This records the owner's eleven annotated
corrections to Testing / Analytics / Sessions / Performance. It supersedes older
notes that put frequency child headings outside their cards or used dashes for
empty Analytics calendar dates.

## Reference evidence

The owner-opened FX demo stayed mounted; it was never refreshed. Observed:

- Side count donut: teal Buy, blue Sell, legend above, percentage labels on arcs,
  no center count. Side win rates use two independent concentric tracks.
- Monthly performance: external title, aggregation radios left, balance radios
  right, separate rounded header/year/value tiles and one bottom-right Total.
- Calendar: metric selector above month/year navigation and Month/Year controls;
  empty days contain only dates; there is no monthly total footer.
- Frequency: group heading outside, child heading and average inside each card.

Primary documentation:
[Analytic Metrics Defined](https://support.fxreplay.com/articles/analytic-metrics-defined),
[Charts & Visual Performance Metrics](https://support.fxreplay.com/articles/charts-visual-performance-metrics).
They define monthly gains/losses but do not disclose all denominator rules.

The public app HTML imports `main-UJT4WWYL.js`; its analytics route imports
`chunk-WCX57NQB.js`, which reexports the components from
[chunk-BX5OK6OF.js](https://app.fxreplay.com/en-US/chunk-BX5OK6OF.js).
Read-only retrieval did not use browser cookies, internal application state or
authenticated financial endpoints. The source was inspected as text, not executed.

In this bundle, the month component's `getData` selects `analyticsCalc[balanceType]`
and passes it to `Yd` with the gain type. `el` selects the supplied
`cumulativeGainPercentage` or `overallGainPercentage`. `Yd` adds each year's
selected YTD into the last Total tile. Formatting distinguishes empty, known zero
and unavailable negative-capital data. The tooltip names start balance, end
balance and total PnL. The underlying monthly calculations are supplied by the API;
these functions do not reveal how each balance was created.

The static demo contains precomputed values and does not prove the effect of
switching controls. No claim is made that our Current Balance denominator exactly
reproduces FX's backend. Raw bundle hashes, bounded relevant excerpts, build and
browser evidence are retained outside Git at:
`E:/BACKUP-TRADINGWORKSPACE/fxreplay-performance-polish-20261027/`.

## Local calculation contract

Reuse `analyticsCapitalBases` / `periodReturn`; do not infer finance from chart
geometry or hard-code the FX demo numbers.

For period p, source session s, net result N and selected capital B:

| Selection | Calculation |
| --- | --- |
| Accum. sessions gains | Sum over s of `100 × N(s,p) / B(s)` |
| Overall gain | `100 × sum N(s,p) / sum B(s)`; count each source capital once |
| Initial balance | Source session's positive, consistent initial capital |
| Current balance | Explicit positive account-balance snapshot at report cutoff; never filtered ending balance |
| YTD / Total | Same calculation on the year's/all observed groups; equivalent to sum of unrounded period returns with the same capital pool |

The Current Balance basis is a **project-defined comparison against the current
snapshot**, not a claim about month-opening balance or time-weighted investment
return. Its info control states this. It is unavailable when a valid snapshot is
missing for any source (currently this excludes multi-session current snapshots).
Changing the basis changes the denominator, not the net PnL or stored trades.

Example: source A starts with 1,000 and gains 100; B starts with 4,000 and gains
100. Accum. is 12.50%; Overall is 4.00%. After a later A loss of 50, the corresponding
totals are 7.50% and 3.00%. Single-source net 60 gives 6.00% against initial 1,000
and 5.00% against an explicit current snapshot of 1,200. These four combinations
are exercised in model and browser checks, rather than using the FX demo oracle.

Missing/nonpositive/conflicting capital produces N/A. A currency mixture cannot
be money-pooled. Empty months stay dash tiles; known zero stays 0.00%. Partial
sources, missing PnL or undated rows make YTD/Total unavailable. Amounts are rounded
only when displayed; percentages are neither compounded nor presented as a
portfolio investment return.

## Calendar / frequency boundaries

Analytics calendar retains its four meaningful metrics (net PnL, win rate, count,
average R). It has no inactive Initial/Current controls because these metrics do
not use a capital denominator. The toolbar adopts the reference's two-row order.
Unknown financial values remain N/A; observed zero remains zero. Empty dates are
blank except for the date number. Source/undated warnings remain in a contextual
status/info control after removing the total footer.

Shared Live calendar navigation/grid behavior, weekly totals, account selection,
coverage, notes/reviews and broker/manual counting are unchanged. CSS changes to
the new metric-toolbar arrangement are scoped to Analytics.

Frequency includes zero civil periods between the first and last dated trade,
as already documented. Three equal-height bordered cards contain their own
title/help/average and stretch the plots to align with the calendar's bottom on
desktop. On small screens they stack naturally; side rings also stack rather
than shrinking labels into unreadable text.

## Verification

- 105 focused model tests, including two new capital/aggregation numeric oracles.
- GET-only browser fixtures at 1920 VI dark, 1440 EN light, 768 EN light and
  390 VI dark; all month radio combinations, empty/zero/N/A/partial/undated days,
  unavailable current snapshot, one-side rings, Month/Year/day details and demo.
- Independent source and screenshot review bound to the released index hash.
- Real existing session GET-only check; PnL remains -2.28. Local runtime promotion
  and deployed verification are recorded in the task receipt.
