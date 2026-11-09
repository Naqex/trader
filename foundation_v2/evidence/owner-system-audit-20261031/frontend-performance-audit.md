# Frontend responsiveness audit — 31/10/2026

Baseline: Trader `884d04f2`, canonical source `foundation_v2/web`. Read-only source
inspection and existing local production artifacts; runtime latency is unmeasured
until the causal fixture receipts below. No broker/provider/database writes.

## Findings and priority

| ID | Evidence in current source | Recommended bounded action |
| --- | --- | --- |
| FE-01 | `LiveWorkspace.jsx:67` renders lazy `LiveSurfaces` only after `/live/status` resolves. Child live-record/label reads begin after the chunk. | Load this route's chunk alongside status; preserve the data/status gate. |
| FE-02 | `SessionReports.jsx:153` blocks the independent aggregate `/replay/trades` read on session catalog; single-report analytics already bypasses this for explicit IDs. | Start aggregate ledger and catalog together; catalog denial/error and confirmed-empty semantics stay authoritative. |
| FE-03 | `useTradeNotePresence.js:21` returns a new reader every render, while `LiveSurfaces.jsx:364` uses it as a memo dependency. Each row scans every journal note. | Memoize an indexed presence reader; preserve workspace isolation, null unknown, false known-empty, comments/deleted filtering and string identity semantics. |
| FE-04 | Every `useTradeLabels` instance owns its GET. Live tag analysis mounts hooks in `LiveSurfaces`, `LiveTagAnalytics` and collapsed `SmartPicksPanel`; Live trades also mounts `TradeTagOverview`. | Reuse the catalog owner or existing bounded Query contract, preserving mutation/revision/error invalidation. Separate slice. |
| FE-05 | `LiveWorkspace.jsx:57` polls full account status every 5s on every journal section. ETag avoids transfer/React updates when unchanged, but does not prove zero backend projection work. | Measure API work and notes/calendar journeys before changing freshness policy. |
| FE-06 | `PropWorkspace.jsx:329,484` uses `window.location.assign` after create/open while ordinary routes use `navigate`. | Candidate for preserving shell/cache on successful workflow; verify the domain handoff before replacing. |
| FE-07 | `DataDeskWorkspace.jsx:506` auto-refreshes an empty configured instrument catalog with POST during initial read. | Pure inspection must block writes; assess explicit refresh UX separately. Not a timing optimization. |
| FE-08 | `vite.config.js` keeps old build chunks (`emptyOutDir:false`). Current dist has 6,729 asset files, 258,988,229 bytes; old tabs rely on retained hashes. | Bounded release retention/rollback manifest after runtime ownership audit. Never equate disk total with page transfer or purge active chunks blindly. |

## Existing architecture worth retaining

- Route lazy loading, client navigation and persistent shell already exist.
- Workspace Query cache has workspace/authority identity, bounded catalog size,
  stale/GC policy, cancellation, denial purge and shared event stream.
- Dashboard uses a bounded server page; aggregate trades uses server paging/sort.
  Live trades and data-library tables page locally; no evidence yet justifies
  virtualization/infrastructure for this single-owner workload.
- Live status ETag preserves the payload identity on unchanged snapshots.
- Optional BlockNote/templates/chart code is lazy; no framework replacement proposed.

## Artifact baseline and measurement limits

Local `dist/index.html` currently references `index-DI_q_XpP.js`: 831,546 raw /
226,959 gzip bytes, plus `index-B_360cOU.css`: 270,891 / 42,633 bytes. These are
artifact sizes, not an audited source fingerprint or user-visible latency result.
The 09/10 bundle receipt is historical, not directly comparable after feature growth.

For FE-01/02, use isolated production previews, synthetic GET fixtures, cold
browser contexts, all external traffic/writes denied. Hold the prerequisite API
response behind a gate and record whether independent chunk/request starts before
release. This proves causal overlap without guessing from elapsed ms. If timing
is sampled, label the fixed fixture delay and sample size; do not extrapolate to
owner runtime. FE-03 checks the old lookup oracle plus rendered hook identity,
workspace change, failed reads and known-empty semantics.

## Implemented slice and focused checks

- FE-01: `loadLiveSurfaces` starts alongside the status GET. Journal data still
  stays behind the original loading/status gate; terminal route unchanged.
- FE-02: an aggregate ledger with resolved query scope starts while the catalog
  reads. Catalog denial/error and confirmed-empty still replace the ledger.
- FE-03: presence data is indexed once per journal/workspace revision and its
  callback stays stable on unrelated renders. The trade-off is one in-memory
  Map/Set index proportional to the already-loaded note list; no extra cache or
  API surface. Failed reads remain unknown, never silently false.

Executed from `foundation_v2/web`:

```powershell
node --test tests/tradeNotePresence.test.mjs
node tests/tradeNotePresence.browser.mjs ../evidence/owner-system-audit-20261031/trade-note-presence
node tests/routeReadOverlap.browser.mjs http://127.0.0.1:5217 ../evidence/owner-system-audit-20261031/route-overlap-baseline baseline
```

Unit checks **2/2 pass**: aliases, strict identity, comments/deleted/empty notes,
known-empty false, input immutability and large-fixture parity. Hook browser
fixture **3 cases pass**: stable reader, workspace switch/known empty, denied
unknown; no writes or JS errors. Baseline production causal gates **2/2 pass**:
Live chunk and aggregate ledger request both start only after prerequisite release.
The baseline fixture held the response for observation; its timestamps are not
before/after latency samples.

`note-presence-samples.json`: Node v24.19.0, synthetic 2,000 notes +500 lookups,
3 warmups, 9 alternating samples, preparation included, output parity checked.
Median old scan **19.94ms**, indexed reader **0.81ms**. This is only this offline
projection workload, not a whole-app speedup or owner-runtime measurement.

## Status — WIP review 01/11/2026

Fresh candidate production build in `$env:TEMP\review-build`, `vite preview` on 5232,
all API responses mocked, non-GET aborted. Not committed; no runtime rollout.

| ID | Status | Evidence |
|---|---|---|
| FE-01 | **Done** | `route-overlap-candidate/report.json`: Live chunk requests start with `/live/status`; `/journal`, `/live/records`, `/trade-labels` still wait for status release (gate preserved). |
| FE-02 | **Done** | Same report: `/replay/trades` starts before the catalog release; denied, error and empty catalog still win over the ledger (3/3). |
| FE-03 | **Done** | Unit 2/2, hook fixture 3/3 (`trade-note-presence-candidate`). |
| FE-04 | **Done** | `labels-candidate/receipt.json` 6/6 (1920 dark VI, 390 light EN): one catalog GET for tag analysis + SmartPicks + overview, collapsed panel adds 0, one retry recovers both, a mutation updates the shared catalog. |
| FE-05 | **Measured, unchanged** | `live-poll-datadesk-candidate`: 31s visible on notes/calendar/trades → 7 status GETs each, 1×200 + 6×304. Backend projection cost per 304 not measured; no frequency change. |
| FE-06 | **Deferred** | No WIP. `window.location.assign` stays. `QuickSessionDialog` already uses `navigate` for the same replay href, but no browser test covers Prop create/open → replay, and it is unverified whether the replay route relies on the full reload. Needs that journey test before switching. |
| FE-07 | **Fixed (`96a65f45`)** | Root cause: the dataset read effect in `DataDeskWorkspace.jsx` bootstrapped an empty configured catalog by calling `refreshInstrumentCatalog` (POST). The read is now GET-only; the empty datasets state shows the existing "Cập nhật danh mục" button, which uses the normal explicit refresh path. `tests/dataDeskCatalogRefresh.browser.mjs` on an isolated preview (5241, mocked API, writes intercepted): open = 0 writes; one click = exactly one `POST /api/v2/data/catalog/refresh`. |
| FE-08 | **Open** | Build retention unchanged; needs the runtime ownership audit first. |
