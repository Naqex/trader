# Page spacing, grid clarity and ledger audit — 25 October 2026

## UI behavior and ownership

- `page-layout.css` owns the first inset after shell navigation:24px desktop and16px through760px. Removed the Analytics filter's extra12px margin; Research/Playbook now share the same outer inset. Full-bleed Live panes, embedded reports and chart workspaces preserve their own boundaries. Loading skeletons use the same token, avoiding an8px mobile settle.
- Sessions report boundary is24px. Ledger filter labels/Basic/Tags stay together when controls wrap; mobile hides the now-unneeded divider between action groups.
- Sorted headers retain gray background/orange superscript priority and gain a1px inset vertical separator. Absolute positioning leaves column widths, text alignment, sticky bottom line and clear controls intact.
- Removed the persistent legacy timestamp notice from Dashboard and session reports, the Analytics inspector's implementation paragraph and the catalog-install explanation. Shortened the payoff tooltip to its formula. Missing values remain unknown; errors, recovery, partial/stale state and relevant units remain.
- Added one scoped AGENTS pointer and the concrete UI copy/spacing contract in `ui/display-conventions.md`. Updated stale blue-header/clear-all wording to the implemented gray/replaces-# contract.
- `#` remains a display position after full-scope filtering/sorting and before paging offset:1–10, then11–14 for the current data. Persistent identity is the session+trade key, not this number.

## Verification

Artifact root:`E:/BACKUP-TRADINGWORKSPACE/page-rhythm-ledger-20261025/`.

- Baseline measurement reproduced36px Analytics and32px Research starts versus24px sibling pages. The initial route inventory used obsolete playbooks/prop routes; the corrected inventory uses playbook and explicit Prop Analytics. Ordinary and Prop Analytics screenshots use distinct names in the final rhythm suite.
- Scoped candidate build passed from tracked HEAD plus11 intentional source overlays and the previously accepted private CSS baseline; unrelated ReplayWorkspace/CSS/evidence WIP excluded. Vite retains its preexisting large-chunk advisory.
- Frontend table/page/semantic model tests:13/13 PASS (`frontend-model-tests.log`).
- Candidate rhythm53/53 and deployed UI5180 rhythm53/53 PASS,12 normal pages at1920dark,1440light,390dark,320light; includes first inset, no document overflow, grouped mobile controls and actual16px loading skeleton. Reports `candidate-rhythm/report.json` and `deployed-rhythm/report.json`.
- Candidate sort7/7 and deployed sort6/6 PASS; the extra candidate check compares total width against the previous deployed build (3166.671875px unchanged). Sort/clear keyboard, superscript priorities, alignment, sticky scroll, shared Library headers and double-digit priority remain working. Reports `candidate-sort-final/report.json`, `deployed-sort/report.json`.
- Independent reviewer checked20 route/width cases and a labeled Live demo exception at1920/390, then reviewed desktop/mobile screenshots and final diffs. No blocker in this UI slice. Review used GET-only contexts; no broker calls forwarded.
- Current owner Trades API-to-rendered-cell comparison:21 source columns ×14 rows across two pages; sort resets page and preserves mapping, clear restores source order; all three losses found across the entire source before paging. Five journeys PASS in `data-review/cells-report.json`. This uses session+trade identity (raw position IDs can repeat between sessions). Initial harness expectations incorrectly used `2 USD` instead of existing `$2` fee formatting and assumed raw trade IDs were globally unique; corrected the oracle, not product data.
- Browser reports record no page errors or attempted writes. This verifies current rows and presentation; it does not prove a newly submitted order journey or whole-product/broker correctness.
- AI environment audit before/after:0 errors,0 warnings; active instruction chain16418B/65536B, reserve49118B. No global instruction/memory update.

## Local startup and UI rollout

The owner requested starting the project before continuing. Both API8010 and UI5180 were absent. Existing binaries/hashes, idle state and schema preflight passed (16 migrations, none pending); no schema changes. Existing native/compact, database/artifacts, QDM, scientific/legacy descriptors and AI interpreter retained. Current run:`af833c24b53c4de5b5567dee8b311f37`, API/research/supervisor11532/7944/9284; UI4024. No terminal reconnect or broker action.

An initial readiness probe ran while the manifest still lacked its API child and raised KeyError; the subsequent completed manifest and `/health/ready` passed. `ready.json`, `preflight-start.log`, `supervisor.log`, `ui-start.json` retain startup evidence.

UI promotion preserves private branding and old hashed assets, backs up the previous index/mutable files under `ui-before-release`, then atomically replaces index. Before SHA256:`36c4f9398629f4fa35cefa0f8559076ed58f5349fdc8d0e19b6a282774b0ccc7`; deployed SHA256:`60fcc0ce5a350885f9a41ccaf095cbef33d8f9dfa1b1690d1961b8f00689daa4`. HTTP bytes/candidate/index match, all11 source overlays byte-match (`ui-verification.json`).

## Data audit follow-through

The requested Backtest/Prop data audit found a confirmed Prop multi-asset report checkpoint mismatch: the frontend submits an account sequence but the backend rejected it as a local sequence; dropping the fence also exposed incorrect provenance. The correction below completes this confirmed report bug; it does not claim every historical replay boundary is supported.

### Exact Prop account checkpoints

`checkpoint_event` validates the account's immutable asset pins, hash, session/branch/currency, contiguous source events, phase history, balances and exposure. It restores each asset at the acknowledged local event and the account's pending queues. Same-candle events cannot leak beyond the requested account event. Matching inherited phases support assets initialized later. The API verifies all pins against stored manifests and rejects cursor/cutoff disagreements. Analytics exposes the account hash/phase/sequence and retains both account and asset close ordinals.

The existing entry metadata contract remains exact: an actual server timestamp belongs to a newly saved fill, never a metadata edit/retry or historical candle. Existing missing realtime fields and one unknown legacy order type remain missing. All13 closed rows satisfy gross minus fees equals net; the open row retains unknown realized values. Source and saved-record audit is `data-review/AUDIT.md` under the artifact root.

- Root independently reran6 portfolio and27 analytics tests, including frozen Python oracle parity. The opted-in saved-record test passes both actual Prop records at their heads and every stored account event (38 and6). The review lane also ran24 JavaScript model tests. A root invocation of `replay_entry_recording` matched zero tests and is not counted as coverage.
- Before deployment both exact bound report GETs returned422. After deployment both return200 and pass the real frontend adapter's session/hash/branch/event/phase/currency fence (`data-review/prop-bound-before.json`, `prop-bound-deployed.json`).24 reports have no replay binding; they retain the existing unbound state.
- Initial candidate preparation omitted compile-time sibling files. These were restored from HEAD. The temporary-source build was then discarded because runtime capabilities pin the original compile-time foundation path. A package-clean candidate rebuild used the original source path, with all runtime-source diffs restricted to the three reviewed Rust files and hashes recorded in `backend-build-receipt.json`. An initial Cargo clean refused the copied cache's missing ownership tag; the task-owned target was explicitly tagged before package cleanup. No active binary was built over.
- Guarded preflight and old-binary stop passed;16 migrations current, none applied. Native/compact, existing storage/artifacts, QDM, scientific/legacy descriptors and AI interpreter retained. Run `388f838437514dd68ad467889c7cfebd`; API SHA256 `0ceafda39a7b4b1db27b77ba8db2d766a7bd71bdc4070f3758af5c12c76252c3`. Binaries are under `E:/BACKUP-TRADINGWORKSPACE/page-rhythm-ledger-20261025/backend-target/release`. Saved compatible rollback is `backend-before-release/rollback.json`; readiness and capabilities preflight are `backend-ready.json` and `backend-preflight.log`.
- After backend rollout, the21-column/14-row mapping, paging, sort/clear and full-scope loss-filter journeys passed again, without browser errors or writes (`data-review/cells-report.json`). No terminal reconnect or broker action.

Known limits: no new order was submitted on owner data. Exact account event0 remains unavailable, rather than inventing a financial checkpoint. The broader Backtest saved-record audit found an intermediate event2 containing only a market fill without a reconstructable canonical local checkpoint; it remains explicitly rejected. The current Backtest head at sequence3117 passes offline. This does not establish every historical event or broker/product acceptance.

### Prop report presentation follow-through

Removed the remaining persistent profile/terms/model explanation from healthy Prop reports; actual missing/blocked objective branches remain. The report timestamp uses a semantic `time` element retaining its original UTC instant, with scoped16–24px typography so a date/year does not fragment on narrow screens. Removed the misleading fixed UTC label: the value follows Settings, with timezone identified by the shared workspace clock.

Independent review accepted the final three-file UI change at1920/390/320 with Settings `Asia/Ho_Chi_Minh`. Date and time each occupy a single text range; no document overflow, browser errors or writes. Candidate build and guarded atomic promotion preserve branding and old assets. Final UI index SHA256 `cfc64f6c8b92952cfb3225078f3e3e61f583ed5525493dbd408bea8a9d1084e8`; rollback `ui-before-prop-release`. Both actual reports pass all6 deployed responsive journeys (`data-review/prop-browser.json`), including unchanged semantic instant, no UTC suffix, no paragraph and intact date text. The owned preview5196 was stopped after QA; API8010 and UI5180 remain running.
