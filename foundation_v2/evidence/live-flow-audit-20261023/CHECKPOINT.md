# Live flow audit — 23/10/2026

Scope: improve the existing Live workflow, reuse Testing components, preserve broker authority and avoid loading chart/forms on Overview. This is a scoped runtime/source audit, not full-product or broker execution acceptance.

## Changes and data flow

- Live navigation retains locale, broker, symbol/timeframe and strategy context, and drops replay session/dataset/cursor settings. Overview opens the chart directly. Section changes reset shell scroll without resetting filters on ordinary refresh.
- Overview reads verified persisted account metadata (`summary=true`, visible polling every 10s). It does not read chart bars/history or invoke MT5. Chart loads its own CSS/controls and reads the existing persistent connection every 2s while visible. Journal uses the existing five-second reader and ETags. Same-payload 304 responses preserve object identity.
- Broker forms, record dialogs and journal sections load lazily. CSV download no longer imports a record dialog. Account/snapshot/tag aggregates avoid unnecessary repeat work. Tags use append accumulation instead of repeated array copying.
- Read-only broker access may inspect chart/positions, but API and worker still independently deny preview/command/reconciliation. Stored identity/generation/workspace bindings remain required. Demo and Real share broker constraints; this change does not promote an account or impose Prop limits.
- Notes can belong to a manual account, broker connection or general scope. The backend validates the broker's workspace and rejects two parents. Existing JSON records remain compatible; no migration. Monthly review inherits the selected connection and strategy revision. General notes with null parents edit correctly.
- Shared select, modal, tooltip, filters, date inputs, metrics and pagination remain in use. Notes/tags support 10/20/50/100 rows locally. Locale strings, connection errors, request action/status, modal titles and redundant subtitles/implementation copy were corrected. Raw broker deals are not silently turned into completed trades.

## Validation

- `frontend-tests.log`: 55 focused Node tests pass.
- `python-tests.log`: 44 connector/worker/trading tests pass.
- `rust-unit-tests.log`: 4 focused Rust trading tests pass.
- `native-trading-pg.json`: disposable PostgreSQL acceptance passes (summary read isolation, denied commands, workspace and generation checks).
- `native-ledger-pg.json`: disposable PostgreSQL ledger acceptance passes (broker note binding, workspace isolation and ambiguous-parent rejection).
- `frontend-build.log`, `backend-build.log`: production web build and release Rust binaries pass.
- `ui-checks.json`: actual browser journeys and responsive checks; fixture uses no broker SDK or DB. `fixture-requests-en.txt` records the final translated receipt table. `local-overview.png` is the running local app; fixture images are synthetic.
- API restarted through the owning supervisor with the newly built binaries. Runtime manifest: `.runtime/api-platform/native-owner.json`; API PID 6416 at verification. Account remained connected/read_only. One owned MT5 terminal was observed (PID 8564, approximately 150 MB working set at that instant).

## Performance evidence and trade-offs

`loading-comparison.json` compares Overview dependencies: 22 asset requests before, 9 after; no journal/playbook/form/chart request on the clean Overview load. Compression/cache fields differ between old and new captures, so byte percentages and overall latency speedups are deliberately not calculated. Raw captures remain in `baseline-overview.json` and `current-overview.json`.

`api-timings.json` retains five current summary samples (481 bytes each; median 16.04ms) and three chart samples. One initial chart sample was unavailable; the next two returned 300 bars in 250.32/170.85ms. The missing reason prevents attributing that first failure; the UI later recovered without a send or credential change. These are small diagnostic samples, not capacity or p95 benchmarks. Overview account values can lag the periodic account/history refresh; trading decisions always use the full checked broker path.

Journal history still returns a full scoped snapshot for aggregate analytics; paging is client-side. Large-history server pagination and incremental aggregate APIs remain future scaling work. The common app entry bundle still has Vite's >500kB warning. No unsupported pending-order/partial-close capability is presented as complete.

## Failures and cleanup boundaries

The first readonly-PG fixture failed because its request lacked required fields/UUID binding; it was corrected and rerun. `native-trading-pg-first-failure.json` preserves one failure receipt. Restart initially failed when the launcher was given different binary ownership paths; stopping with the exact active paths then starting the new candidate succeeded. Diagnostic identity checks succeeded, but the earlier `mt5_identity_changed` cause was not reproduced and is not claimed fixed.

The temporary fixture server/tab were stopped/closed after QA, viewport overrides reset, and the local app left running. Automated command review rejected removal of `.runtime/mt5-audit-diagnostic-20261023` with only `blocked by policy`; the inactive diagnostic directory was retained. No user market data, broker terminal directory, unrelated WIP or historical evidence was removed. Build caches remain local/ignored.

User-facing result: linked Live workflow and lighter route loading are deployed locally. Actual broker order acceptance remains untested; the saved account's read-only access was not changed.
