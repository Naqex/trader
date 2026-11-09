# Journal UI parity — 2026-10-30

## Scope and state

Implemented the owner's Live Tag Analytics comments and remaining Live trade
detail presentation changes. UI is promoted to local 5180. Journal financial
edits, deletion/exclusion, restoration and broker mutations are not enabled.
This is scoped UI acceptance, not whole-product or broker-execution acceptance.

## Behavior and data flow

- Filter toolbar retains shared controls and receives the standard page inset.
- Overall legend/info moves left below the title; Hide/Show tag list stays above
  the chart and expands the chart when the right picker is hidden.
- Picker reuses SearchInput and actual catalog groups/colors. Select all acts
  within the visible group. Selected labels add chart overlays; Overall stays
  scoped to tagged completed trades matching the basic filters.
- Table uses shared index/multi-sort, with expandable Overall → group → tag
  rows, result-based group tint and no pagination. Each group counts the union
  of its trades, not the sum of potentially overlapping tag counts.
- Dates come from actual execution timestamps in Settings timezone. Missing
  amounts propagate unknown; missing timestamps do not produce a fake timeline.
- Catalog loading/error does not invent Ungrouped membership. Retry remains
  visible when the picker is hidden. Existing unreadable empty state is retained.
- Live detail values share one starting column; Practice layout is preserved.
  Fills opens Entries/Exits using actual fills plus summary facts. Inputs are
  read-only and Add/Save disabled pending the owner's journal data decision.
- Vertical ellipsis uses filled SVG circles, enabled in Live and disabled in
  Practice. The extra info icon beside R is removed.

No dependency, schema or API change. Existing PostgreSQL label assignments are
read by the UI; the new presentation has no financial mutation path.

## Verification

Artifacts: `E:/BACKUP-TRADINGWORKSPACE/tag-analysis-ui-20261030/`.

- Vite production build: PASS (`build.log`); existing chunk-size warning remains.
- `node --test tests/tagAnalysis.test.mjs`: 4/4 PASS. Covers overlapping tags,
  group/Overall deduplication, untagged exclusion, unknown facts, shared timeline
  and real palette tokens.
- `integration-verified/receipt.json`: PASS on disposable PostgreSQL and real
  native Rust Router, with a synthetic replay dataset/broker snapshot.
- `integration-verified/browser/report.json`: PASS at 1920 dark VI, 1440 light EN
  / DPR 1.25, and 390 dark VI. Covers picker/search/hide/show, expand/collapse,
  multi-sort/reset/index, no pagination, dot colors, group totals, catalog error
  and recovery, empty snapshot, Live alignment, enabled/disabled SVG menus and
  read-only fills tabs/summary. Waits for CSS transitions before visual capture.
- `integration-attempt1`: retained FAIL from an incorrect English test locator
  (`Exits` versus existing UI `Exit`); corrected in tests. Attempt2 and final
  candidate checks passed. These failed artifacts were not overwritten.
- Independent source review by `note_editor_review`: initial catalog-state
  finding fixed; follow-up found no blockers, reviewed representative images and
  reran the four model tests. Reviewer did not independently rerun browser.
- Source-owner visual inspection: dark/light, narrow layout, table hierarchy and
  fills preview; accepted for this scope.
- `git diff --check`: PASS.

## Local promotion and limits

- Fresh native owner identity, process generation, path and API binary hash
  verified before copying UI (`owner-verified.json`). No API/terminal restart.
- `ui-promotion.json`: served index hash matched candidate:
  `f3378dab648acd37d0c8afa679499560a3a201464b7f1b943bd65401d50a81f2`.
- Previous index backed up under `ui-before-f64073cdbc29/`; old hashed assets and
  private branding retained. Both active and checkout dist indexes replaced
  atomically after collision checks.
- `deployed-browser/report.json`: PASS against actual UI5180/API8010, GET-only.
  Tag analytics hide/show and both trade detail modes verified, zero page errors,
  zero blocked writes and zero relevant API failures. Actual account had no
  tagged completed trades in this scope; populated and failure journeys are
  proven by the isolated fixture, not by modifying owner assignments.
- No claim of live financial editing, broker execution or long-duration sync
  acceptance. Full existing note/template/media browser suite was not rerun;
  its changed fills assertions were updated and the focused real-fixture suite
  exercises the replacement dialog.

## Pending product choice

Recommended next step: retain immutable broker facts and add server-persisted
journal exclusion/restore first; introduce versioned edits/merge later if needed.
Execution risk continues to use broker balance/equity/positions, independently
of journal reports. This is a proposal, not an implemented persistence contract.
