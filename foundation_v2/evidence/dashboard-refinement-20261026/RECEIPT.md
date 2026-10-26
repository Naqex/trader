# Testing Dashboard refinement — 26 October 2026

Status: PASS for this Dashboard slice, including isolated HTTP and deployed local API/UI verification.

Owner approved the five Dashboard changes recorded in
[FX Replay comparison](../../../ui/references/fxreplay/testing-dashboard.md).

## Behavior and data

- Closed fills are labeled `Giao dịch đã đóng` / `Closed trades`.
- Four summary metrics and three chart headings expose accessible, localized
  information buttons through the existing project tooltip. No new overlay system.
- Successful replay saves record cumulative market-time deltas against server UTC
  activity time. UTC-minute buckets retain first/last observations. Full and
  optimized saves share this hook; multiasset steps count the shared clock once.
- Filtered historical replay aggregates dated deltas. Old undated prefixes and
  partially intersected minute buckets produce unknown rather than estimates.
  Lifetime keeps the existing cumulative measurement. No schema migration.
- Compatible old-runtime counter advances trigger a conservative new recording
  epoch on re-upgrade. The previous cumulative total becomes undated baseline;
  prior dated attribution is dropped rather than blocking replay or inventing dates.
- Monthly win rate distinguishes missing activity dates from no closed trades.
  A real zero win-rate month still renders a chart. Financial formulas are unchanged.
- The repeated remaining-days badge beside the session name is removed; progress
  retains its remaining-days text. Metrics use one column at widths <=380px.

Trade-off: recording size is O(active real minutes), copied into replay revisions.
This is not a constant-size history; long-session performance has not been benchmarked.

## Evidence

Task artifacts and resume instructions:
`E:/BACKUP-TRADINGWORKSPACE/dashboard-refinement-20261026/RESUME.md`.

UI builds use HEAD plus the explicit `overlays.json` list, and the accepted
private CSS snapshot from the previous rollout. Rust source is checked against
that scoped snapshot (normalizing checkout line endings) and built from the real
project manifest, because the scientific adapter pins its compile-time foundation
root. A private candidate target keeps dependencies but clears this package before
the final runtime build so Cargo cannot retain the isolated manifest's embedded path.
Unrelated worktree changes are excluded from the UI and production Rust inputs.

- `test-web.log`: 25 Dashboard model/demo tests.
- `outside-tests.log`: native timing, rollback/re-upgrade and projection checks.
- `test-clipping.log`: existing activity interval clipping/union regression.
- `qa/report.json`: candidate browser journeys, 320–1920px, VI/EN, dark/light,
  actual/fixture data, zero, no-trades, denied and error states; no writes or broker routes.
- `reviewer/`: independent source review, screenshots and keyboard/touch help checks.
- `integration/report.json`: real native HTTP with separate PostgreSQL and synthetic
  datasets; full/optimized/multiasset saves, retry, stale conflict, reload, asset switch,
  fork reset and filtered Dashboard projection.
- `outside-*.json`: Windows-owned job status; `outside-*.log`: persisted job output.

Initial failed checks are retained: missing archive compile inputs; a test assertion
distinguishing JSON integer vs float; a chart SVG count including the new info icon;
programmatic-focus tests racing scroll dismissal; the first isolated-root runtime
preflight rejected the scientific capability before stopping the active API.
Final keyboard journeys use actual
Tab/Shift+Tab and Escape. The independent reviewer also found and prompted the
rollback recovery and narrow-screen fixes.

## Runtime

The previous manifest was stale: API/UI processes were absent at inspection. Recovery
retained native/compact, database/artifact roots, QDM, scientific and legacy codec
descriptors, and the optional AI workflow interpreter.

Per owner request, build and API/UI jobs are launched by Windows `Win32_Process.Create`
through existing `pythonw.exe`, outside the Codex process tree. Job launchers exit while
the owned services continue; status/log/checkpoint files remain on E. This is scoped
to the current jobs and does not install a recurring automation.

The scientific descriptor and installed dependency hashes were rechecked with the
previous runtime admin and remained valid; they were not regenerated or bypassed.

Candidate promotion and deployed readiness: PASS. API SHA256 `6e05b8e2e5b2c28e20ff0d9c96b488dc12371ffe74f6e1d45538a5e5da429b0e`; UI index SHA256 `5ba1d4a6141e3febf8477c1fd5df0a8a7888807898cd05301f13dedf6392496f`. See [manifest](manifest.json).

25 web tests, 10 native timing/rollback tests plus 1 existing activity-clipping regression passed. Candidate and deployed browser suites each passed 11 cases. Final-byte isolated HTTP passed all three save modes and retry/conflict/fork/period checks. The real owner lifetime total remains 187680 seconds; last-week history correctly returns unknown with the date-filter flag enabled because its old prefix lacks dated observations.

No terminal reconnect or broker action was used. No FX numerical parity is claimed:
the two products use different datasets and FX backend formulas remain unavailable.
