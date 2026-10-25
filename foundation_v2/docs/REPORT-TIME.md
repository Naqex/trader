# Report time and account curves

Aggregate performance, Journal, calendar and detailed analytics requests use
`time_basis=activity`. Individual session summaries (including expanded Dashboard
cards) use `time_basis=market` to describe the backtest. Session month/day/week
metrics anchor to its latest market close, not today's real calendar. Both bases
use the same account Equity ledger, including floating P/L; only the time axis
changes. Source month buckets retain year identity; weekdays aggregate Monday–Sunday
across the selected session range. The API keeps `market` as its
compatibility default for engine/research consumers. Cache keys include basis,
Settings timezone, selected revisions and filters.

- `open_time_utc` / `close_time_utc`: simulated market instants; retained for
  replay, Prop phase boundaries, execution lineage and market holding duration.
- `recorded_at_utc`: observed opening fill time.
- `close_recorded_at_utc` / `report_time_utc`: observed closing fill time. PnL,
  closed-trade counts, win rate, calendars, date filters and report sort use this
  instant. Partial closes each have their own observed time.

Persist instants in UTC. Convert to the selected IANA timezone before grouping
days, weekdays, hours or months. Aggregate month/week/day cards use the current real calendar,
not the final replay candle. Dated chart buckets show the year below their month
label, never beside the heading.

Session `periods.performance` contains every observed year-month (the legacy
`periods.months` compatibility field still contains the last twelve). Each bucket
has positive and negative sums of **net trade P/L**, its net value and trade count;
costs are included once through net P/L. Both sides remain visible when they
cancel to zero. The monthly P/L presentation sums matching calendar months across
all selected years into at most twelve horizontal rows, without a year picker.
Its tooltip retains the year range. Daily P/L sums matching weekdays over the
same scope. These are totals, not averages; dated source buckets remain complete.
Signed performance scales are symmetric around zero with equal tick intervals.
Absent months are missing, not fabricated zero-return months. Actual breakeven
buckets retain zero and their count; tooltips preserve exact amounts.

Server save boundaries capture only newly appended events. Sparse timestamp
receipts verify dataset, event sequence and canonical financial/cause hash. Forks
retain inherited observation times and discard future receipts at their cutoff.
Metadata saves and idempotent retries cannot restamp historical events. Existing
records without proof remain unknown: preserve all-time financial totals, exclude
unknown instants from date buckets and date filters, and show partial coverage.
Neither session update time nor the opening fill time is a closing-time fallback.

The account Equity curve uses event `equity`, including floating P/L and phase
resets. A portfolio uses its causal account ledger, never the sum of each asset's
Equity (which would count starting capital repeatedly). Account Equity is not a
Buy-only or winning-trades-only curve; date filters apply, trade filters do not.
Missing observations split the line. The compact summary samples at most128
points. Display interpolation uses bounded cubic controls through those observations;
it does not create market observations, new extrema or change timestamps. Filtered
closed-trade Balance/PnL curves in detailed analytics retain
their explicit hypothetical/closed-trade scope.

Live reports retain broker deal timestamps, not import/sync timestamps. Broker
deal PnL history is not mislabeled Equity. Automated research results lacking
user activity observations likewise cannot manufacture an activity calendar.

Activity receipts currently follow the existing payload metadata pattern and
grow with recorded financial changes. This change does not establish a large
history performance claim. Moving receipts to dedicated immutable storage needs
its own migration and benchmark; do not silently truncate or fabricate history.

Verification: `scripts/report_activity_acceptance.py` exercises disposable native
full/compact storage, actual recording times versus historical asset dates,
retries, branches, partial closes, portfolio Equity, report/filter/cache parity
and legacy unknowns. Rust analytics tests retain the frozen market/CSV oracle.
