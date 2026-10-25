# Grid semantics and Open replay trades — 25 October 2026

## Delivered behavior

- Session and shared multi-select controls show selected/eligible total, independent of search and excluding stale/disabled choices.
- Pagination shows a readable result count, with the visible range available on hover. The footer identifies the Settings IANA timezone and actual UTC offset(s) at displayed timestamps, including DST transitions.
- Header and numeric badge text share their visual edge. The empty label prompt appears only over its own cell, on keyboard focus or while open; touch access remains available.
- Presentation uses `-` for unavailable values, `N/A` for inapplicable results and explicit zero for known zero. Punctuation and source values are preserved. See [primary source](https://www.ethnicity-facts-figures.service.gov.uk/style-guide/data-style-guide/#missing-data).
- Trades includes actual Open exposure from validated session snapshots. Remaining quantity, entry fill and current protection come from execution state; unknown exits and realized results are never fabricated.

## Data flow and boundaries

Validated replay snapshot → separate Open projection → cloned table ledger/facets → full-scope filter/sort/count → page slice. Cache keys include workspace and replay revisions; warm page changes reuse the projection. Session history uses its requested checkpoint, never current exposure. Forked Open exposures retain distinct session identities; closed ancestry dedup remains unchanged.

Financial analytics and CSV retain their realized-only contract. Open Return amount/percentage/R and gross realized PnL are `N/A`; unknown fees remain unknown, not an estimated debit. No floating profit substitutes for realized results. Replay navigation uses the opening checkpoint for Open rows.

## Verification

Evidence/builds/backups: `E:/BACKUP-TRADINGWORKSPACE/grid-semantics-20261025/`.

- Frontend: **93/93 PASS**, `frontend-tests.log`.
- Focused Python backend: **85/85 PASS**; native Rust analytics: **24/24 PASS**; release binaries built successfully. Backend worker reviewed source/tests; parent reviewed integration.
- Candidate and deployed browser suites: **5/5 PASS each**, `candidate/report.json` and `deployed/report.json`. Checked 1920 dark, 1440 light, 390 dark/light, selection/search, cell hover, keyboard, alignment, sticky header, footer, document overflow and Open contract. No page errors/writes.
- Actual Open browser journeys: **2/2 PASS**, `actual-open-browser.json`; global status filter/inspector and historical session opening table.
- Actual API: **14 total = 13 Closed + 1 Open**. All **5 pages at size 3** match expected row order, identities and snapshot; full-scope status filters and page clamp pass; realized metrics unchanged (`api-deployed.json`).
- Independent UI review: **ACCEPT**, no remaining frontend blocker. This is scoped UI/API acceptance, not broker or whole-product acceptance.
- Frozen performance oracle **does not pass**: existing additive `facets.date_range` and `ledger[*].has_notes` differ from its frozen source. The same mismatch was confirmed at pre-task HEAD. Row/filter identities agree. The newly supported `report_time_utc` sort is outside that historical oracle. No benchmark acceptance is claimed.

## Local rollout

UI5180 index SHA256: `06bf27af8e290b6356f52374caee695bafaf8c77f3bddc9d12e315b2ab8ee786`.

Atomic promotion retains previous assets/index in `ui-before-release/`; promotion receipt: `ui-promotion-release.json`.

API8010 native/compact run: `734f3b4df62a4f15a65eb8adaa113f99`, database/HTTP ready (`ready.json`). Binaries: `E:/BACKUP-TRADINGWORKSPACE/grid-semantics-20261025/rust-target/release`.

- API SHA256: `2edb52131ba2c53be29e893c84e530b346325269a4cf9414311ad27e3440f279`.
- Research SHA256: `1bca9329242b2be04e195f346cc2ce27f024e04139bcdaf314471b880565ef05`.
- Scientific descriptor: `E:/BACKUP-TRADINGWORKSPACE/grid-semantics-20261025/scientific-candidate.json`; only its engine-code commitment changed, with runtime/adapter/dependency identities verified unchanged (`descriptor-check.py`). Existing legacy codec, QDM, database/artifacts and AI workflow interpreter retained. No schema migration, terminal restart/reconnect or broker operations.

## Recovered issues

1. An initial release compile targeted the previous active binary directory. Only the owned compile tree was stopped before linking; active binary hashes were unchanged. Final build used the isolated directory above.
2. Preflight rejected a stale scientific engine commitment. Official bootstrap regenerated the descriptor, identities were checked, and guard/idle checks passed before cutover.
3. An early readiness helper encountered the startup manifest before API ownership existed. It now retains the prior binary path during the transient state; final readiness/hashes passed.
4. The first scoped browser candidate omitted two source overlays (`tradingAnalyticsModel.js`, `SessionReports.jsx`). The overlay was corrected and rebuilt; final candidate and deployed checks pass.

Build/staging excludes the unrelated ReplayWorkspace effect-dependency edit, dirty CSS, unrelated API acceptance script and historical evidence. Existing runtime ownership remains in `.runtime/api-platform/native-owner.json`.
