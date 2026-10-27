# FX Simulation research — 27/10/2026

## Evidence and scope

Read the owner's prepared Simulation demo via the existing tab without reload.
Saved full AX in `E:/BACKUP-TRADINGWORKSPACE/analytics-simulation-20261027/`.
No FX simulation, upgrade, authenticated API request or access bypass was run.
The visible page had Stop Loss Simulator and RR Simulator run buttons, the
original RR Notion help link, and a Monte Carlo skeleton. Results were therefore
researched from public frontend code rather than claimed as rendered runs.

Fresh unauthenticated download:
`https://app.fxreplay.com/en-US/chunk-7J7CEYHB.js`
SHA256 `d0cdff061301958d623ff3827c6bc8e08fc3a4c9e5f8cb68cd050e4a10395c4c`.
The `/en-US/` base is required; an initial root-relative URL returned 404.
Public entry now imports `main-JDZFVQUK.js`; the prepared earlier analytics
chunk remains publicly accessible with the same hash. These are deployment
snapshots, not stable exported APIs. Saved source/function extracts on E:.

Official references:

- https://support.fxreplay.com/articles/how-to-use-the-monte-carlo-simulation
- https://support.fxreplay.com/articles/analytic-metrics-defined
- Original rendered RR link:
  https://fx-replay.notion.site/What-is-the-RR-Simulator-2479db20207480bb883bd263526d24de
  (the web reader could not retrieve its body; source/UI verify the URL only).

## Three different questions

| Tool | Question | Verified implementation |
| --- | --- | --- |
| SL | Would a tighter stop have improved the recorded trades? | `Bs`, `D_`, `Y_`, `ws`: derive adverse movement from entry, original SL and max adverse price; compare it with the reduced stop fraction. |
| RR | What if trades used fixed take-profit multiples? | `Ns`, `__`, `d_`: compare target R with backend-supplied `idealRR`, scoring a target hit as +target R, otherwise -1R. |
| Monte Carlo | How much can outcomes vary under the same statistical assumptions? | `gs`, `jc`, `Ps`, `Hc`: generate random wins/losses and sample normally distributed gain/loss amounts; collect simulated balance paths and summaries. |

### SL details

For reduction `p`, remaining stop fraction `f = 1 - p/100`. The 0% row keeps
original realized R. Other rows score -1R when effective adverse movement
reaches `f`; otherwise use `max(original R/f, -1)`. Profit multiplies scenario R
by per-trade initial risk, with a 1%-of-initial-balance fallback if it is absent.
Trades without an initial SL are excluded. The run guard requires at least
three eligible trades; that is a software gate, not proof of statistical reliability.
The UI explicitly states simulated scenarios do not replicate trade management.
The aggregate adverse extreme does not establish intrabar event ordering.

### RR details

Defaults include 1R, 1.5R, 2R through 5R. Eligibility depends on `idealRR`;
the baseline row has additional breakeven exclusions. Monetary scenario risk
uses 1% of source initial balance. The frontend comparison is verified, but
the backend calculation/window of `idealRR` has not been established here.
Do not describe this as a verified replay of SL/TP first-touch ordering.

### Monte Carlo details

Each simulated trade draws a win/loss using configured win rate. Its amount
uses a Box–Muller normal draw around average gain/loss, with standard deviations
from the analytics response. It adds money amounts to balance (not percentage
compounding). This code continues below zero and does not truncate normal draws.
Min/max balances refer to final balances across runs, not intrarun extrema.
Random outcome draws plus amount dispersion mean this is more than a permutation
of existing trades; the Help Center's reshuffling description is simplified.
More runs reduce simulation noise but cannot repair biased/insufficient source trades.

## Current local implementation and differences

The local Simulation page now uses three full-width sections stacked vertically:
Stop Loss, Risk/Reward, then Monte Carlo. Each section starts with a short intro
and `Chạy mô phỏng`; after a run it reveals configuration, loading/error, results,
reset and rerun states. Scenario presets appear as compact chips and the trade
grid is expanded by default, with only horizontal overflow contained. SL/RR reads the existing read-only experiments endpoint,
including filter, provenance and config fences; unsupported or ambiguous trades
remain N/A in the trade details table. Demo mode uses an explicitly synthetic
fixture only.

The selected analytics tab is written to `analytics_tab`, so a refresh returns to
the same report. The three report views stay mounted while switching tabs, which
keeps an in-memory simulation result alive for that report scope. Simulation line
charts reuse the Performance chart toolbar for zoom, pan and reset.

Local SL uses ticks/multiplier rather than FX's reduction grid. Local RR keeps the
original stop and selected target R inside the source holding window/cutoff. The
Monte Carlo panel supports empirical ledger resampling, fixed configured outcomes,
and a seeded normal model with separate win/loss standard deviations. Normal
magnitudes are clipped at zero and balances stop at zero; this is labelled because
clipping can change the mean. These are deliberate model differences, not claims
of FX formula parity.

## Owner's two accompanying UI corrections

- Expectancy value on the left, average win/loss bar and values on the right;
  stack at widths <=420px. Existing card equal heights and financial values stay.
- Remove the custom Equity/Balance selector absent from the FX reference.
  Preserve automatic initial source: applicable declared equity when available,
  otherwise closed balance. Heading/help keep the actual source explicit.

Focused preview QA: performance 7/7 and drawdown 4/4; VI/EN, dark/light,
1920/1366/768/390/320px, demo/real/partial data. Reused pre-change metric-text
oracle, fixture equity oracle, source title, $/% defaults, geometry and single
scroll owner checks. Independent source and screenshot review: PASS.
Runtime promotion and final deployed evidence are recorded alongside scripts
under the E: evidence root; no API restart or execution action is needed.

Local port 5180 rollout: PASS, same 7 performance and 4 drawdown cases repeated
against the served build. Served index SHA256:
`d6504838d4dd1baabd2281f2a4fc7b917379399d7180d498a86bfeae81d9b598`.
Rollback index is `ui-before-release/index.html` under this evidence root;
prior SHA256 `1013af928447ef58fc9f72bf74687c3a454bed2737e5717b103b77c5941a8e93`.
The scoped build contains tracked HEAD plus only `FxAnalytics.jsx` and
`fx-analytics.css` overlays; unrelated working changes were excluded.
Deployed screenshots and one card proof are in `performance-deployed/`,
`drawdown-deployed/` and `proof/`. Browser checks block external origins,
non-GET/HEAD, MT5/Live/events and websockets; no JS errors or attempted writes.

## Compact SL/RR correction — 2026-10-28

This correction supersedes the SL/RR configuration/results layout described above.
After the initial Run, SL/RR show scenario chips directly above the chart, followed
by the always-open trade table. The numeric configuration, rerun/reset buttons,
five summary metrics and `Kết quả từng giao dịch` disclosure heading are removed.
Selecting a scenario updates its configuration and immediately calls the existing
read-only experiment adapter. Loading disables scenario actions; errors allow
retry by selecting a chip. The current-SL 0% chip remains non-removable. Monte
Carlo keeps its existing controls and calculation model.

Evidence: `E:/BACKUP-TRADINGWORKSPACE/simulation-compact-20261028/`.
Production build and 12 focused analytics tests passed. Preview and deployed
demo QA each passed four cases: 1920 VI/dark, 1366 EN/light, 768 VI/dark and
390 VI/dark. Checks cover the removed block/heading, visible 20-row table,
scenario-dependent results, tab persistence, chip add/remove, Monte Carlo,
single vertical scroll owner and no document horizontal overflow. No JS errors
or attempted writes were observed. This is demo/browser verification, not a
native backend or broker acceptance result.

UI-only rollout served index SHA256:
`ce7c95c715d32687782c60def72fcc37c27d4614b4420a3ab4fc5fbfea805c60`.
Port 5180 was stopped and the UI preview was started again; API and MT5 were
not restarted. The scoped build uses tracked HEAD plus only `FxAnalytics.jsx`.
Rollback index: `ui-before-compact/index.html` under the evidence directory.

## Scenario controls correction — 2026-10-28

Owner-provided FX screenshots define compact colored outlined chips, a blue Add
action and a centered multi-row scenario dialog. The local 0–60% defaults remain;
0% has no delete action. Other chips collapse the delete action to zero width at
rest, expand on hover/keyboard focus and collapse after pointer selection/leave.
Touch users can reveal delete on focus. The existing `LegacyModal` supplies the
portal, background inertness, focus trap, dismissal and focus return.

Add stays available even when all default chips are present. The dialog accepts
multiple unique SL reductions (integer 0–99%) or RR targets (positive, at most
100R); values are sorted without changing default colors. The SL >60% caution
comes from the supplied reference. Confirm selects/runs the last entered value
through the existing read-only adapter and focuses its results region; Cancel or
Escape discards drafts. A filled final input can be cleared with its trash action.
The original financial model/window is unchanged; a reduction multiplies the
configured stop distance by `(100 - reduction) / 100`.

Evidence: `E:/BACKUP-TRADINGWORKSPACE/scenario-dialog-20261028/`. Scoped production
build uses tracked HEAD plus `FxAnalytics.jsx`, `fx-analytics.css` and
`testing-copy.json`; unrelated WIP is excluded. Preview QA passed four responsive
VI/EN dark/light cases (1920, 1366, 768, 390px), covering measured hover widths,
mouse/keyboard focus, dialog center, multiple inputs, duplicate/range validation,
cancel/dismiss, sorted custom 12%/66%, result changes, tab retention, RR6.5 and
single vertical scroll/no page horizontal overflow. No attempted writes or JS
errors were observed. This is UI/demo verification, not financial backend parity.

Independent source/desktop/mobile visual review: PASS. The same four cases passed
on deployed port 5180. Twelve focused analytics model/adapter tests passed.
Served index SHA256:
`08f95644e958cd7782813d94efb39d1593344b50644a69445e3bf1b8971dba1f`.
Rollback index: `ui-before-scenario/index.html` under the evidence root. Existing
API/UI processes and prior hashed assets were retained; no backend rebuild,
terminal restart or broker action was part of this correction.

## Scenario table and axes correction — 2026-10-28

Owner-supplied reference images show dated X ticks and a `Cumulative R` Y axis.
SL/RR now plot cumulative R by `close_time_utc` (market/chart time), in the selected
timezone, using the existing temporal chart scale. A sorted copy preserves source
table order; equal market timestamps retain source order. No fabricated time,
ordinal labels or `Bắt đầu` anchor are added. The Gốc/Mô phỏng row remains the
two-curve legend; it is separate from the date axis.

Local R definition: both curves use the same original-risk amount for each trade.
Canonical realized R follows the existing observed-original-stop/ledger/declared
budget precedence. For nonzero outcomes, original net/R recovers that denominator;
for zero/zero a declared positive original risk budget is required. Missing,
invalid or overflowing denominators and dates remain unavailable. Both curves
use the same eligible sample with a visible count when incomplete; all source
trades stay in the table. This preserves the local price-experiment financial
model and deliberately differs from the FX reduced-stop R normalization described
above. There is no 1%-capital fallback or claim of identical FX numerical outputs.

The results grid now consumes shared DataTable styles directly. Its row rules
reach both interior panel edges; only cell contents retain the shared inset.
Contained horizontal overflow and the page's single vertical scroll owner remain.
The shared curve gains an optional Y title; other charts retain their prior axis
behavior. Monetary comparison statistics remain unchanged in their existing helper.

Evidence: `E:/BACKUP-TRADINGWORKSPACE/scenario-axes-20261028/`. Production build and
16 focused model/adapter tests passed. `preview-r4/report.json` passed 4 responsive
VI/EN dark/light cases, including measured full-width DS row borders, market date
ticks, absence of ordinal/Start labels, the baseline endpoint oracle 9.6R and
the previous chips/dialog regression journey. Independent source/visual review
passed. Earlier failures in this evidence root are QA selector/SVG extraction
mistakes; they are retained and superseded by the final report. Model review also
found out-of-range dates and overflowing inferred risk, which were fixed and tested.

The same four deployed checks passed on port5180, including a separate mobile
chart capture. Served index SHA256:
`d84c9af1b0014f5ad3e35d0df4a4ca8fe0be41002166e474b3f2b4fe2419003a`.
Rollback index: `ui-before-axes/index.html` under the evidence root. UI-only
promotion retained existing processes/assets; no native rebuild or broker action.

## Scroll chaining and Results correction — 2026-10-28

The owner reported that wheel scrolling stopped on the results grid and supplied
the missing Results row between chart and table. Runtime reproduction confirmed
that the table had no vertical overflow (`clientHeight=scrollHeight=1014`), but
shared `overscroll-behavior:contain` trapped vertical input. A fresh wheel gesture
on its cells left the page at scrollTop 0; changing only vertical overscroll to
`auto` advanced the page to 400. DataTable now exposes an optional `scrollAxis="x"`
used by SL/RR tables: horizontal containment remains, vertical input chains
natively. Bounded/virtual tables keep their existing default. No wheel handler,
preventDefault or touch-axis restriction is introduced.

Results now sit under the chart/legend and above the grid. Cached compact curve
observations allow comparison of active, completed scenarios on their common
eligible trade IDs. Highest means signed cumulative original-risk R, including
all-negative runs; unrun chips are not evaluated. One run/no common sample shows
coverage rather than a winner. Ties use floating-point-scale tolerance and report
the actual tied/tested counts. Conditional notices distinguish fewer than five
non-breakeven trades, unresolved outcomes and missing original risk/chart dates.
All source rows remain visible. Removing a selected chip runs the first remaining
scenario; removing the last RR chip retains Add so the user can recover.

Evidence: `E:/BACKUP-TRADINGWORKSPACE/scenario-scroll-results-20261028/`.
Scoped production build and 18 focused model/adapter tests passed. Final preview
QA (`preview-final/report.json`) passed 1920 VI dark, 1366 EN light, 768 VI dark and 390 VI
dark: wheel down/up over cells, focused PageDown, mobile horizontal scrolling,
Results placement/scope, selected/last-chip removal and prior chart/dialog checks.
Isolated component fixtures (`warnings/report.json`) passed three widths/themes
with explicit 2/4 chart coverage, three applicable notices and all four source
rows retained. Fixtures are labeled and do not claim real backend parity.

Independent final source/desktop/mobile review passed. The same four journeys
passed on deployed port 5180 (`deployed/report.json`), with no JS errors or
attempted writes. Served index SHA256:
`771972309421952442138d25026c6a81ab7619958524db9b73b0d63f5cf204cf`.
Rollback index: `ui-before-scroll-results/index.html` under the evidence root.
UI-only promotion retained existing API/UI processes and old hashed assets.

## All-scenario curves and numeric dates — 2026-10-28

The owner's additional reference shows one cumulative-R line per SL level,
not an original-versus-selected pair. Explicit Run now evaluates all configured
SL/RR scenarios sequentially under one abort controller. The mounted report caches
compact eligible observations and table outcomes. Selecting cached chips only
changes the table/highlight; adding computes uncached values, removing excludes
their lines and ranking. Removing every RR hides prior results; adding a cached
value back restores the grid without another read. Scope changes abort the batch
and discard its UI cache. Failed reads identify their scenario values and Retry
only fills missing results, retaining prior successes.

The chart and ranking share one intersection of eligible trade IDs in market
close order. A successfully read but empty scenario is not silently removed from
that intersection. An empty common sample shows an explicit unavailable state,
never an invented curve or winner. Each line uses its chip's stable palette color;
the selected line is thicker. Per-point hover/touch and one visible endpoint
keyboard stop per line expose scenario, chart date and R. Other chart consumers
retain their default colors/opacity/area behavior. Numeric date axes use shared
`displayDate` in the chosen timezone (`dd/MM/yyyy`), with anchored text bounds
preventing crowded labels on mobile. The Gốc/Mô phỏng legend has been removed.

Financial engine semantics are unchanged: local SL reductions still scale the
configured base tick distance (native report default 20 ticks; demo 10), not a
newly implemented per-trade original-SL distance. Curves normalize their outcomes
by original risk. All-line presentation is not evidence of numerical FX parity.

Evidence: `E:/BACKUP-TRADINGWORKSPACE/scenario-multiline-20261028/`. Production
build and 25 focused chart/model/adapter/date tests passed. Final preview QA
(`preview-final/report.json`) passed 1920 VI dark, 1366 EN light, 768 VI dark and
390 VI dark. It checked all 13 SL endpoints against independently summed demo
outcomes, seven RR lines, chip/path colors, numeric dates and measured tick gaps,
zoom, keyboard tooltip targets, removed legend, dialog/selection/removal, native
grid scroll chaining and the single vertical scroll owner. A first QA attempt
compared line color with neutral chip text instead of its colored border; that
oracle was corrected. Mobile label spacing was tightened by an explicit bounds
check before final acceptance.

Six labeled isolated fixture cases (`fixture/report.json`) passed: sequential
reads with one failure and retry-only-missing, cached grid selection, remove-all
RR then re-add cached 2R without requests, scope-change abort, empty common sample,
and warnings at three viewport/theme combinations. Independent review found and
verified fixes for stale results after deleting the final RR and an Intro trap
when restoring cached RR. Final source/desktop/mobile review passed. These are
UI/model fixtures and do not claim real backend or FX formula parity.

The same four responsive journeys passed on deployed port 5180, with no JS errors
or attempted writes. Separate rendered tooltip checks passed for keyboard focus
at 1920px and touch at 390px, including scenario/date/R content and Escape dismissal.
Served index SHA256:
`6ad1beb2d973b6e702aa32e6cf552bd35fe6774a5c64edc275447ffa772eabb2`.
Rollback index: `ui-before-multiline/index.html` under the evidence root. UI-only
promotion retained the existing processes, private branding and prior hashed assets.


## Results table correction — 28 October 2026

Read the owner's prepared FX simulator state without starting another simulation.
The current UI showed 3/9 eligible trades and a 5% best-overall reduction. Read all
six rendered table tooltips: SL reduction, win rate, total R, profit, profit factor
and average drawdown. The source R profit factor and drawdown are independent of
position size. The live caption is an aggregate recommendation, not a count of
only trades improved by the winning configuration.

The publicly served current route chunk `chunk-U7RN4OK3.js` imports
`chunk-VVSM7ZIE.js`; downloaded unauthenticated from the app origin into the evidence
folder. Its I_/V_/X_ functions confirm the SL ranking: PF descending, positive
average drawdown ascending, total R descending, win rate descending; eligible
reductions below 80% take precedence. Entries are rounded before ranking, ties
retain configuration order. `go` closes a drawdown episode at a new high and
includes an unfinished episode. `Bs` requires at least five source wins and five
source losses for reliability; the reference counts zero as a source win.
Local win rate and source sample counts retain strict positive/negative semantics
and explain breakeven exclusion in header help.

The source shows warnings conditionally. The owner explicitly asked to keep both
amber rows, so the local view always keeps two truthful rows: actual low-sample
or conditional threshold guidance, and actual excluded or complete coverage.
It does not claim missing price/SL causes that the current adapter cannot prove.

Each completed scenario now has one row with six columns and shared header
Info controls; best metrics are green and the overall winner has a badge. The
chart height is 420px. Summary/table/curves share the same eligible observations.
The recommendation now uses the reference ordering, rather than maximum R alone.
RR uses its separate reference order: PF, DD, money profit, win rate, average win R.
Missing or mixed currencies prevent money aggregation and an RR recommendation.

The financial engine remains the existing configured-distance, fixed-position-size
engine. In contrast, FX's SL profit tooltip describes per-trade original SL and
constant dollar risk resizing. The local profit tooltip explicitly preserves this
difference; no 1%-capital risk fallback or new engine was introduced.

Evidence root: `E:/BACKUP-TRADINGWORKSPACE/scenario-results-table-20261028/`.
Public chunk SHA256: `9a03c6fb16e738324dff43790e6ca0b52b24ff215edf09ca4b70c58739bb90fb`.
