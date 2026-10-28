# Grid default sorting and header separator — 28/10/2026

## Change

Removed the decorative active-header `::after` separator in `data-table.css`.
Catalog, Live accounts/cashflow, broker/manual trades and both reference tables
now start with no explicitly selected sort. Default row order remains name
ascending for catalogs/accounts and time descending for trading history/cashflow.
First header activation chooses ascending, second descending; changing sort resets
paging. Trades multi-sort and recent-session tables already had neutral defaults.
Static metric/Prop tables have no sortable headers and keep their domain order.

## Verification

- Independent read-only review: no blocking issue; fallback data order checked.
- Unit: `node --test tests/tableModel.test.mjs tests/dataLibraryModel.test.mjs tests/liveAccountModel.test.mjs` — 30/30 PASS.
- Extended `tests/liveDataTables.browser.mjs` — 16 PASS cases at 1440/dark and
  390/light. Demo catalog/Trades, both references and synthetic Live fixtures;
  initial order, actual asc/desc row changes, page reset, clear-sort,
  layout geometry, no vertical pseudo-element. No page errors or write requests.
- Existing browser test initially failed because it expected the old visible
  range/count footer. Updated assertions read the current footer's range title;
  the rerun passed. Virtual-scroll test expectation updated for neutral→asc→desc;
  the broader real-data scroll journey was not rerun for this presentation fix.
- Screenshot review: desktop and mobile catalog; deployed 1920px default state.
- Deployed demo catalog smoke at 5180 PASS: neutral initial header, real asc/desc
  row order, no separator and no page errors. No API/terminal restart.

## Local rollout

Scoped build: tracked HEAD plus the seven intentional source overlays, excluding
unrelated dirty files. Candidate preview at 5181 closed after QA. Atomic index
promotion retained existing hashed assets and private branding.

- Served index SHA256: `329f55e49980996d9d83f493a88e5133a3d72ba6cec9ec09fe0d8a54ab964184`
- Build/fixture/runtime evidence and rollback index:
  `E:/BACKUP-TRADINGWORKSPACE/grid-sort-defaults-20261028/`

Synthetic/demo evidence does not claim broker integration or full product acceptance.
