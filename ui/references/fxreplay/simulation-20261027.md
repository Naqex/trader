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
remain N/A in the lazy details table. Demo mode uses an explicitly synthetic
fixture only.

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
