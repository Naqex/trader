# Shared data tables — 25/10/2026

Status: scoped implementation and local runtime verification PASS.

## Delivered

- Native `DataTable` / `SortableColumn`, full-cell hover/focus/sort, stable arrow
  slot, separate borders, opaque sticky headings and footer outside table scroll.
- Shared row sizing, numeric alignment, selected rows and icon actions. Trading
  colors, monetary calculations and execution permissions stay in their owners.
- Shared range/count, pager and page size. Footer responds to its own available
  width; compact controls and a second row prevent overlap or broken CSV text.
- Consumers: Trades, offline library, broker history catalog, accounts/cashflows,
  broker/manual trades, tag statistics, recent-report tables, scenario details and
  Prop objectives. Chart execution/position docks retain their own UI contract.
- Eight offline-library headings sort directly. The redundant sort dropdown is
  removed; `Mới cập nhật` stays in table options with a visible active state.
- Shared contract pinned in `ui/data-tables.md`; runnable 35-row reference at
  `?workspace=tenant-a&area=testing&ui_reference=1#data-table`.

## Data and state

Audited consumers filter the complete selected scope, sort, count, then slice.
No filter-after-page defect was found. Aggregate Trades remains server paged:
the response is bounded to page_size and includes full-scope facets/counts.
Small complete catalogs remain local. This task is not a load benchmark.

Found and repaired accent/token search inconsistencies in library/local/native
Trades, catalog date sorting with mixed timestamp representations, local sort
page reset, and ledger selection being cleared merely by changing pages.
Checked rows now survive paging/sorting; filter/workspace/source changes clear them.

## Verification

- 57 focused JS tests PASS: comparator/unknown/zero, date metadata, late-row
  filtering, pagination, analytics and account/workspace regressions.
- 19 native library analytics tests PASS, including 35 rows where the matching
  row is absent from page 1, full-scope facets and filtered page/count clamping.
  The existing Python oracle parity also passes. An initial `--bin` test command
  discovered zero tests; the recorded acceptance is the corrected `--lib` run.
- Scoped Vite build PASS, excluding unrelated working tree files. Native release
  API/admin/research builds PASS. Shared UI registry: zero errors.
- Runnable `web/tests/dataTables.browser.mjs`: light/dark desktop/mobile reference
  states, keyboard sort, full heading hit areas, sticky scroll, footer dropdown,
  preserved page selection, cleared filtered selection, and late-row filtering
  from page 2 in server-paged Trades and library.
- `web/tests/liveDataTables.browser.mjs`: 10 labeled fixture journeys for accounts,
  cashflows, broker/manual deals and tag tables at 1440 dark / 390 light. Requests
  are fulfilled locally; no broker or terminal operation occurs.
- Independent review identified footer overlap at viewport 481px and checked the
  source filter/selection pipeline. Root fixed the width handling, the library's
  inherited 220px heading-button cap, and narrow footer CSV layout. Follow-up
  geometry covers 28 screen/theme/width cases; 16 library heading hover/sort
  checks pass. Eight narrow final served-runtime checks cover the repaired boundary.
- Real served API: 13 rows, page 1 returns 10 and page 2 returns 3; global numeric
  sort matches the complete set; a request for page 9 with a one-row search clamps
  to page 1 and reports filtered_count=1. No data mutations.

Early browser attempts exposed selector/oracle mismatches in the test harness;
those were corrected before the passing runs. Narrow pager/CSV and heading-cap
failures were product defects and were repaired. Independent review's final
follow-up was unavailable due to its usage limit; root reran the concrete checks.

## Local rollout and recovery

- UI 5180 index SHA256:
  `0d97c35976e8f9e9df243cfd0d4037120200b60bac0feae00c07f600e68df6f0`.
- API 8010 owner run: `11cee2389f4040f1a84a9b112a1ee2aa`, native/compact;
  readiness and executable hashes verified. Schema current, no migration.
- Guarded idle check, exact old-binary stop and descriptor preservation preceded
  restart. Scientific/legacy descriptors and runtime options retained. No
  reconnect, broker query, OrderCheck or OrderSend was performed by this task.
- Previous UI index/assets and runtime descriptors retained under
  `E:/BACKUP-TRADINGWORKSPACE/grid-system-20261025/`. Old hashed assets remain for
  open tabs. Private branding is preserved. Only the owned preview is stopped.

Raw build/test logs, synthetic screenshots and private runtime backup stay in
that E directory. Compact summaries in this receipt's folder contain no runtime
credentials. These checks accept this grid slice, not the whole product.
