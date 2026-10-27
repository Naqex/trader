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
