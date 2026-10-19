# Legacy Forex execution initialization

Owner observed `dataset account currency is required` in Prop replay `d848723290084cf98e8d03de6cff4dbf`.

Read-only inspection confirmed revision 1, no execution, frozen V2 options with costs/slippage off and an old EUR/USD manifest without `instrument_spec`. The catalog's existing replay projection supplies USD and FX pip/tick units. Session option initialization instead read only the raw manifest, so it rejected the dataset before execution could initialize.

Initialization now reuses `provider_routes::catalog::replay_instrument` for currency and slippage units. Declared specs remain authoritative, legacy manifests are not rewritten and missing unsupported metal specs still fail closed. This changes the source of execution metadata, not pricing, spread defaults, order timing or session data.

Validation:

- Four focused Rust module tests PASS: legacy EUR/USD and USD/JPY projections, declared-spec precedence, immutable input and unsupported-metal rejection included.
- Eight pricing/slippage regressions PASS, including both BUY/SELL zero-cost chart fills and deterministic adverse execution.
- Disposable PostgreSQL/native compact HTTP acceptance PASS: the existing seven Backtesting/Prop/V1/V2 mode scenarios now run for both declared and legacy manifests (14 scenarios). Exercises quick fill, protection, reload, Prop feed, close and branch. Only the disposable fixture removes a manifest spec to reproduce the owner shape.
- UI back-button acceptance is recorded separately under `ui/`.

Runtime: built release bins in an inactive existing Cargo target; backed up the three installed executables under `.runtime/legacy-forex-20261019/rollback-binaries`; guarded idle/schema/capability preflight and stop passed; installed binaries were hash-checked and restarted at the existing native-candidate paths. Native/compact API 8010 and production UI 5180 are ready. No migration. `runtime.json` confirms deployed API hash, readiness, owner session still revision 1 and the unchanged legacy catalog shape. No owner order was submitted. `installed-binaries.json` records release identities.
