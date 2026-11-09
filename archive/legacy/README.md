# Legacy archive

This directory keeps the retired Flask/phase implementation and its historical
verification tools after the Trader cleanup on 2026-10-29.

## Current source

The supported product source is [`foundation_v2/`](../../foundation_v2/). The
archived files are not launchers, CI entrypoints, or the current API/web source.
They remain in Git so older receipts and rollback investigations can still find
the exact implementation.

## Archive layout

- `root/` — old Flask workspace, P1–P5 factories, MT5 gateway helpers, local
  launchers and account-specific legacy config.
- `flask/static/` and `flask/templates/` — retired server-rendered UI.
- `tests/` — tests for the retired root implementation. Current release and
  foundation tests remain in their supported locations.
- `scripts/` — retired root verifiers, portability helpers and launch scripts.
- `docs/` — the historical Flask reference document.

The semantic modules that `foundation_v2` still imports were moved into
`foundation_v2/trading_workspace_v2/semantics/`; they are current source, not
archive material. Advanced Charts remains outside this cleanup and is still
managed through the existing local vendor path and license boundary.

Archive moves are reversible with `git mv`/`git revert`; no runtime database,
`foundation_v2/evidence/`, or ignored vendor/runtime directory was deleted.
