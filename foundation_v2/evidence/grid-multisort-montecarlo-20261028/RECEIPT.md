# Multi-sort and Monte Carlo UI receipt

Date: 2026-10-28

## Scope

- Shared multi-sort was applied to sortable data grids: catalog, design-system reference tables, Trades, session recent trades, accounts, cashflow, broker/manual journals and labels.
- Active columns use separate inset orange outlines with a light orange tint and priority numbers. The clear-all action has a bordered tinted surface and stays centered in the row-number slot.
- Monte Carlo is available in both Sessions and Prop firm analytics. It uses the current filtered, single-currency trade scope and keeps results tied to report revision, cursor, filters and extra analytics state.

## Verification

- 57 focused Node unit tests passed: table models, data library, accounts, analytics simulation, trading analytics and chart logic.
- 16 grid browser checks passed at 1440px dark and 390px light, including neutral defaults, asc/desc, adding/removing priorities, clear-all, paging reset, design-system tables, responsive overflow and GET-only request checks.
- 4 Monte Carlo browser cases passed: Sessions/Prop × 1440px dark/390px light. Checked six inputs, empty-before-run, distinct straight-line paths, computed six-color palette, zero-variance oracle, zero-capital stop, eight metrics, tab persistence, reset, no page errors and no writes.
- Candidate was built from the tracked HEAD plus intentional task overlays, served on preview `:5181`, then promoted atomically to the existing `:5180` UI. Served index hash matched the candidate after promotion.

## Limits

- Browser journeys use local demo/synthetic fixtures and prove UI/state behavior; they do not prove real broker or real Prop replay binding.
- Monte Carlo does not calculate Prop daily-loss rules or pass probability. Missing moments and mixed/unknown currency remain unavailable instead of being fabricated.
- FX Replay research confirms Analytics Monte Carlo is an enabled Analytics capability for Backtesting/Battles/Prop. The different visible placement between source modes has no verified intentionality, so this implementation keeps the shared capability in both Sessions and Prop.
