# Repository identity and paths

Current product: **Naqex Trader**, repository `Naqex/trader`.

| Previous location/name | Current location/name |
|---|---|
| `projects/mt5-tradingview-backtester` | `projects/trader` |
| `planning/mt5-tradingview-backtester` | `planning/trader` |
| `WMREPLAY-UI-MASTER-PLAN.md` | `TRADER-UI-MASTER-PLAN.md` |
| WMREPLAY / MT5 TradingView Backtester display brand | Naqex Trader |

## Paths that move with the checkout

- Python: resolve from `Path(__file__)`, not the current working directory.
- PowerShell: resolve from `$PSScriptRoot`; resolve caller-relative CLI paths
  once, before passing them to detached children.
- Node: use `import.meta.url` plus `fileURLToPath`/`new URL`.
- Browser: import brand/assets through Vite so the configured asset base is used.
- Markdown: use relative links within the repository. Workspace-only planning
  is optional for a standalone checkout; it is not an application dependency.
- External data, databases, tools and licensed vendors: explicit environment
  variables or CLI options. Do not search arbitrary drives or select a random
  old QA run as a default.

Supported PostgreSQL integration-test discovery: `TW_PLATFORM_TEST_PG_BIN`
(or the test's documented override), `initdb` on PATH, then the optional local
`.runtime/postgres/bin` installation. Tests use disposable databases only.

Prebuilt-binary relocation remains a packaging gate: optional Rust adapters still
use `CARGO_MANIFEST_DIR` for some resources. Source checkouts should build their
own binaries. Packaging was deferred by the owner; see [release status](releases.md).

## Compatibility identities

`foundation_v2`, Python import namespaces, Rust executable names, schema IDs,
existing `TW_V2_*` variables, browser storage keys and data revisions remain
compatible. Renaming them cosmetically would require migrations and can break
existing data. Historical receipts, hashes and archived research preserve their
original source paths and names; their dates are part of the evidence.

The previous checkout may remain temporarily while the owner runtime and WIP
are migrated. It is not the canonical source. Cutover needs a verified runtime
descriptor, backup and rollback; moving or restarting a running broker terminal
is a separate operational action.
