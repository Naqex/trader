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

The requested Backtest/Prop data audit found an additional confirmed Prop multi-asset report checkpoint mismatch: the frontend submits an account sequence but the backend rejects it as a local sequence; dropping the fence would also expose incorrect provenance. The broader data correction remains in progress and is not claimed complete by this UI checkpoint.
