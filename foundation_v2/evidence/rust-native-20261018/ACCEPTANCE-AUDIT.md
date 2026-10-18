# Rust-native extension acceptance audit — 18 October 2026

Authority: the 17/10 execution extension in the canonical workspace
`planning/mt5-tradingview-backtester/PRODUCT-COMPLETION-PLAN.md`. This is an
evidence review, not another task ledger or a historical U/Y acceptance update.
The execution checkpoint remains `../rust-native-20261017/CHECKPOINT.md`.

**Result: the Rust-native/performance extension is accepted against the named
requirements and measured workloads, including authorized owner cutover.**
Independent final review in `runtime/final-extension-review-root.md` found no
remaining blocker in this extension. This closes the optimization extension,
not the historical full-product ledger or broker/holdout/deploy gates.
Reused receipts below retain their
original source/binary scope. A PASS is not silently promoted to a current-binary,
fresh-install, production-capacity or whole-product verdict.

| Extension requirement | Evidence and verdict | Limits / source reconciliation |
|---|---|---|
| Native/adapter/pending inventory | `runtime/final-inventory-root.json`; native dispatch owns 105 frozen command-route entries, zero Python command delegation | The 105 entries are not all HTTP endpoints or a percentage of business logic. `lib.rs` additionally mounts native read families and infrastructure routes. Optional market/live SDK connector is unavailable. |
| Financial/replay/Prop differential | `runtime/final-pure-domains-root/receipt.json` PASS 14 Rust test functions across context/control/Prop/provider/replay; `runtime/tick-portfolio-r8-checkout-root/receipt.json` PASS 41 persisted cases | Frozen corpora include v1/v2, spread/fee, rounding, cutoff, phase/DST/drawdown. The 41-case receipt verifies the restored checkout release, including tick initialization/reopening and historical portfolio isolation. Pure receipt pins Rust sources/tests and lockfiles, not separate fixture-file hashes. |
| Persisted scope/revision/retry and contracts | `../rust-native-20261017/runtime/serialized-replay-parity-root/receipt.json` PASS 132; metadata `../rust-native-20261017/metadata/pg-final.json` PASS 48 | Earlier exact-scope receipts remain evidence for unchanged domain code, not a blanket rerun on every later binary. Current core and targeted financial checks supplement them. |
| Bounded replay storage, branches, historical/analytics readers | `runtime/replay-storage-r5-root/receipt.json` PASS; `runtime/replay-step-r3-root/receipt.json` PASS 11 checks/36 samples | Canonical full reads, tick/portfolio and cold imports still depend on history. Compact BAR mutations/ready forward steps are the optimized paths. No claim of constant-time whole-product behavior. |
| Integrated chart/Prop behavior | `runtime/step-prop-r3-root/receipt.json` PASS: actual production Prop feed, 8 marks, 503/409/reload/backlog/exactly-once; `runtime/chart-endurance-fixed-root/receipt.json` PASS 600 seconds/120 journeys | Current chart retains iframe and price range, saves the requested protection once and closes. Sample-p95 confirmed-marker/rAF proxy 77.5 ms; drag-frame 16.7 ms. This is desktop same-cutoff endurance, not touch, dataset-switch or all playback endurance. |
| Memory/resource and latency | `runtime/mixed-resources-compact-root/receipt.json` PASS bounded mixed foreground/research; final chart endurance post-GC heap +10.87 MiB within 16 MiB budget, DOM delta 0 | Mixed-resource receipt predates the later financial/price-scale fixes. Do not present it as a current-binary capacity test. Chart heap covers the page target and is not a no-leak or whole-browser RSS guarantee. |
| Data and Research | `runtime/data-research-current-root/receipt.json` PASS 13 production browser checks; 39-trade native research result equals independent Python oracle | Disposable source and artifacts; one completed and one canceled job. No actual provider network or owner dataset was used as a fixture. |
| CSV, immutable publication and provider lifecycle | `../rust-native-20261017/data/csv-final/receipt.json` PASS 120; `../rust-native-20261017/data/streaming-native-and-legacy-root/receipt.json` PASS through 420,003 rows; `../rust-native-20261017/provider/catalog-lifecycle-root/pg.json` PASS 48 plus 4 extra results | Legacy PyArrow 21 exact-byte recovery remains an explicit adapter. Synthetic provider lifecycle is not a new vendor-network authorization. Similarly named earlier streaming receipts that failed remain FAIL. |
| Scientific adapter retained for a reason | `../rust-native-20261017/runtime/scientific-optimized-persisted-root/receipt.json` PASS 86 pure/12 persisted including 7 scientific/OOS; `runtime/scientific-startup-root/receipt.json` PASS | Subsequent `research_execution.rs` change only rejects an explicitly configured missing descriptor; startup receipt covers that change. Installed Nautilus Python binding remains outside interactive dispatch. Do not label the older persisted suite a current-binary run. |
| Crash/restart and ownership | `runtime/final-lifecycle-root/receipt.json` PASS 19; new `runtime/native-restart-root/verified-run/receipt.json` PASS 10 real wrapper checks; launcher tests 30 + 19 subtests PASS | New wrapper tests cover migration from empty disposable PG, native compact startup/restart, compatibility/full startup, guarded drains and refusal cases. Storage forwarding is checked in configuration/manifest; this wrapper receipt does not itself perform a financial write. Persisted storage behavior is covered by the dedicated receipts. |
| Setup and rollback | `runtime/clean-source-r2-root/receipt.json` PASS tracked backend archive build + lifecycle/financial tests; `runtime/frontend-clean-source-final-root/receipt.json` PASS committed frontend archive + fresh offline locked npm install + production build; `runtime/replay-storage-rollback-final-root/receipt.json` PASS separate restored target, atomic materialization, same-schema compatibility HTTP and native return | Installed toolchains/warm dependency caches; frontend install scripts disabled, no browser or bundled licensed chart assets in this build check. A compact database cannot be rolled back by simply toggling profile. Authorized owner promotion is recorded below. |
| Independent review | `runtime/chart-endurance-review-root.md` plus scoped reviews already linked in the checkpoint; root reviewed the restart wrapper, launcher diff and actual acceptance harness | Review is bounded by the tested source/behavior. No new quota-failed agents were restarted for a duplicate audit. |

## Retained components and disabled capability

Rust owns interactive domain arithmetic, validation and PostgreSQL transactions.
Python remains for the supported installed Nautilus scientific binding, explicit
legacy PyArrow byte identity, local process supervision/setup and independent
oracles. Node Dukascopy and licensed QDM remain provider transport adapters;
Rust owns lifecycle, validation and immutable publication. Rewriting these
adapters without equivalent evidence would add maintenance without a measured
interactive benefit.

`GET /api/v2/data/market-assets`, `POST /api/v2/data/market-assets/update` and
`GET /api/v2/live/status` preserve explicitly unconfigured behavior. The legacy
`MarketRuntime` is enabled only by `serve_exness_history.py --mt5-python` (and
optional `--ticks`); the compatibility platform supervisor does not configure
that factory either. This is a disabled optional SDK capability, not a native
implementation of MT5 sync and not permission to open a terminal/account.

## Owner handoff and remaining gates

Owner subsequently replied **có nha** to the exact migration/native-compact
startup request. `runtime/owner-cutover-root/receipt.json` records the authorized
deployment: backup and current artifact hashes match, migrations0005/0006 applied,
all18preexisting table projections unchanged before/after migration and again
after runtime/browser startup. API8010 runs native/compact with supervisor,
native research and API; no Python command worker. UI5180 serves the current
working-source production build, preserving unrelated preexisting WIP. Seven
owner replay/Prop/chart read requests returned200, the actual chart rendered,
no page errors or mutating browser requests occurred. No trade/step/protection
test was sent to the owner session. Root inspected `owner-chart.png`.

The previous preparation status and sequence follow for provenance; they do not
describe the current schema/runtime:

Read-only native preflight on the existing owner target reports API port 8010
free, no blocking active jobs, zero compact revisions, and pending migrations
`0005_replay_execution_storage.sql` and `0006_replay_prop_mark_index.sql`.
The stale old manifest's `ready=true` does not establish a living API.

Owner backup and preflight receipts accompany this audit. Before promotion:

1. Recheck that owner API/workers/artifact writers remain stopped and no active
   jobs appeared. Recreate the backup if source state changed after its receipt.
2. Use the installed PostgreSQL **18** tools for this owner database; the
   disposable test distribution is version 17 and cannot dump its version-18
   server. Verify DB and full artifact bundle before acknowledging migration.
3. Obtain owner authorization for the existing database migration/runtime
   cutover, then apply exactly the two pending migrations through Rust admin and
   start the native/compact profile with its separate candidate binaries and
   manifest. Preserve existing provider choice and explicit installed adapters.
4. Verify the owner's replay opens and stays scoped to its existing revision.
   Do not send test trades, change protection or step the owner session as QA.
5. A rollback after compact writes requires the already rehearsed separate
   restored-target/full-materialization procedure with pinned same-schema code.
   Keep the original bundle and source intact.

Historical full-product UI/broker/holdout/provider/OAuth gates, Auto-BE and
multi-position are not closed or expanded by this extension. Owner integration
proof is distinct from passing the bounded candidate suite.
Further optimization should follow a reported bottleneck and a representative
measurement; do not repeat accepted suites or rewrite rare paths for a label.

The concrete owner restart command below was authorized and executed in two
phases: first `--setup-only --migrate --backup-confirmed`, then the wrapper
without `-ApplyMigration` after verifying existing data was unchanged.
Run from the product root only after rechecking the unchanged quiesced state,
backup receipt and installed descriptors:

```powershell
.\scripts\restart_offline_api.ps1 -RuntimeProfile native -ReplayStorageProfile compact -ApplyMigration -BackupConfirmed -ScientificCapability "$PWD\foundation_v2\.runtime\api-platform\native-scientific-capability.json" -LegacyCodecCapability "$PWD\foundation_v2\.runtime\api-platform\native-legacy-codec-capability.json"
```

This retains the existing QDM transport choice; startup does not authorize or
request a download. It selects the current owner DB/artifact defaults and native
candidate manifest. `-BackupConfirmed` refers to the prepared bundle in
`runtime/owner-cutover-preparation-root.json`, not an automatic backup action.
Do not substitute a direct compatibility start after compact writes; use the
restored-target rollback procedure. After starting, inspect readiness/manifest
and the existing owner's replay with reads only; full owner workflow mutation
was not part of this authorized cutover.
