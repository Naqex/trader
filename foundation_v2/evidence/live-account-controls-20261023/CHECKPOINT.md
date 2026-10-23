# Live account naming and sync controls — 2026-10-23

Scope: the owner's four account-table comments. Builds on 0e3afd1 and 7bcbc96;
does not reopen the whole-product acceptance gates.

Names now use the verified stored login and environment, with an optional saved
nickname. Generic MetaTrader names are omitted; read-only access stays as a
localized suffix. The current connection displays `MT5 464104926 - demo - Chỉ xem`.
Standard is not available in the broker snapshot; setting the nickname to Standard
produces the requested example without inventing broker metadata. Rename edits
the saved nickname, not the generated display string. Search/sort use the display
name. Manual account names are unchanged.

Both sync controls use the same shared two-arrow icon and tooltip. The row action
has no circular gray surface. The header queues eligible connections across the
whole workspace, regardless of filter/page. It preserves paused/disconnected and
already queued/syncing states, locks duplicate actions, continues after a partial
failure, and refreshes the final list. CSV copy is `Tải mẫu CSV`, left aligned.

Validation:

- Node model/connection tests: 11 passed, including naming fallbacks, sequential
  bulk requests, partial failure and paused/queued/disconnected exclusions.
- Native Router + owned disposable PostgreSQL: 1 integration test passed. Verified
  login in list/status/action summaries, workspace isolation, no credentials/full
  history in list responses, existing lifecycle/ETag tests. `connections-pg.json`.
- Production frontend and release API build passed. Existing Vite main-chunk size
  warning remains; this change adds no dependency, SDK call or polling interval.
- Isolated production-build browser fixture: filter to Standard, sync all still
  queued three eligible connections, continued past one simulated failure, left
  paused untouched, exposed the partial error and disabled queued rows. Captured
  `bulk-sync-ui.json`; fixture had no broker/SDK/database and sent zero commands.
- Actual localhost 5180 + native 8010: correct full login/demo/read-only name;
  both row/header clicks each sent one `/connections/<id>/sync` POST; connection
  returned connected. No trading command was sent. VI/EN labels and keyboard
  tooltip checked. CSV download inspected for the native expected column header.
- Real 1920×940 desktop screenshot and 390×844 responsive check. Document width
  remained 390; the table scrolls inside its 317px viewport (696px table width).
  Temporary viewport was reset and the user's page restored to Vietnamese.

Runtime updated using the owned launcher after stopping the old exact executable
paths. Active release directory: `.runtime/api-builds/mt5-access-final-20261022/release`.
No migration or credential/access-mode change. API 8010 and preview 5180 remain up;
temporary synthetic fixture server/tab were stopped/closed. Unrelated WIP retained.
