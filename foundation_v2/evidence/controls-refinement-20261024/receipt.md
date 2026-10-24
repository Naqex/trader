# Trading controls refinement — 2026-10-24

Scope: the owner's latest eleven browser comments and the related selection audit.
This is a task receipt, not whole-product or broker acceptance.

## Delivered behavior

- Trade labels use an anchored searchable popup, multiple choices, removable
  chips, and workspace-wide create/rename/color/delete. Empty cells show their
  affordance on hover/focus/touch. Labels persist as metadata and feed the ledger
  facets and filters. Execution snapshots and financial results are unchanged.
- Native Rust owns revisioned label definitions and per-trade assignments.
  Idempotency, workspace isolation and optimistic revisions protect writes.
  Journal edits apply only the added/removed label delta, preserving newer table
  selections. Renames retain filter aliases; deleted names remain reserved.
- Assets, sides, outcomes, weekdays and labels in Analytics support searchable
  checkbox lists. Values within a set use OR; different sets intersect. Empty
  sets mean unrestricted, except the existing explicit report-kind semantics.
  Existing aggregate session/account controls retain their appropriate multiple
  selection; chart/trade-owner account, timezone, currency, sort and order type
  remain single. DataDesk provider remains single because it owns one operation.
- Dashboard Backtest/Prop/All keeps one Performance layout with three report
  charts. The API intersects source and explicit scope, preserves empty scopes
  and deduplicates inherited fills using complete replay ancestry.
- Live account naming shares verified login/environment, with optional owner
  nickname. The selector orders name, platform, balance and connection status.
  Live actions match Sessions: new account, direct Analytics link, intentionally
  disabled settings, confirmed deletion. The chart action uses the same arrow.
- Sessions Analytics is a destination link. The account timestamp is labelled
  Last sync, which represents the last successful observation, not expiry.
  Stale/failed summary reads override a cached connected badge and permission.

## Evidence

- Production UI build passed (355 modules; existing large-chunk warning remains).
- Focused Node model tests: 37 passed. Rust label unit tests: 3 passed;
  source-scope intersection unit test: 1 passed.
- Native release binaries built; OpenAPI generator/check passed.
- `native-integration.json`: disposable PostgreSQL and synthetic licensed data,
  migration 16, mutation/idempotency/conflicts/isolation, canonical filters,
  journal delta regression, immutable financial state and source intersections.
- `native-browser.json`: real disposable native Rust/PostgreSQL label writes,
  reload, rapid consecutive choices, edit/delete, Escape/focus, responsive
  light/dark popup and searchable multiple-side filter. No broker calls.
- `live-fixture.json` and `source-states.json`: synthetic ready/stale/error/
  disconnected/denied/empty states, mobile bounds and layout parity.
- `deployed-browser.json`: read-only journeys against local API/UI on 8010/5180,
  matching promoted index hash, real source scopes, label popup, Sessions link,
  account naming/actions, mobile bounds and Last sync column. Zero page errors
  and zero attempted writes. The first run's invalid option-role locator was
  corrected to the existing SessionFilter button; the full rerun passed.
- Independent backend and UI reviewers accepted the scoped implementation and
  dark/light mobile rendering; no remaining blocker was reported in that scope.

Reusable tests: `scripts/trade_labels_acceptance.py`,
`web/tests/controlRefinement.browser.mjs`,
`web/tests/liveControlRefinement.browser.mjs`, and
`web/tests/dashboardSourceStates.browser.mjs` under `foundation_v2/`.
Detailed logs/screenshots are in
`E:/BACKUP-TRADINGWORKSPACE/controls-refine-20261024/`.

## Local rollout and recovery

The previously authorized local rollout applied migration 0016 and promoted the
matching API/UI. Account …4926 was reconnected/synchronized once; its fresh read
reported connected. No OrderCheck/OrderSend, owner label mutation or account
deletion was performed. Fixture label mutations used only a disposable database.

Before migration, the owner database was dumped, restored into an owned
disposable verification database and checked against all public table counts.
The matching artifact backup contains 4,142 hash-verified files (4,247,522,786
bytes). The verification database was then dropped. Backup and private runtime
descriptors stay outside Git in the directory above, under `owner-backup/`.
Migration 0016 extends the record-kind contract: rolling back an older binary
requires the matching database/artifact restore, not just an executable swap.

Promoted API SHA256:
`0c7787578780e55f127aef102befdd13c2725d8da710b5a67017f47569b9942b`.
Promoted UI index SHA256:
`b8141fd20a58c7da2349eac19e9b52322390c65972cedd6d5e84e088057bc3fb`.
Unrelated ReplayWorkspace, learn/visual CSS and platform-acceptance WIP were
excluded from the candidate UI and task commit.
