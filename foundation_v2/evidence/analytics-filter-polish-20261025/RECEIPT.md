# Analytics filters, session sort and library navigation — 25 October 2026

## Behavior and data flow

- Recent session trades retain implicit newest-close-first ordering. The initial date header is inactive; a user click activates explicit sorting. This changes presentation of default ordering, not trade data.
- Data Library no longer treats inherited `dataset` context as intent to open a details dialog. Explicit row details still work. Table options use the standard text/chevron select rather than the unsupported settings FilterIcon fallback.
- Analytics menus show search and checkboxes directly; the redundant selection field is removed. Internal report kind `app` displays as Backtest. Kind selection narrows the current source; it does not fetch another source. Keep net-after-fees breakeven separate from wins, losses and unknown values.
- Day choices use full names, Monday through Sunday, retaining calendar values1…6,0. Selected chips use readable sides/outcomes/day names, with individual removal. Time endpoints form one chip, dates another. The selected session stays visible as report context; clear-all appears only when filters exist.
- Analytics label choices reuse `scopedJournal.definitions`, the same authoritative workspace catalog/aliases projected for Trades, plus selected/legacy names. Unused labels and their colors are available without assigning them to a trade.
- The timezone dropdown sits between Time and Close date. It starts from Settings and commits to the shared browser timezone store on Apply. Draft filters persist together in the URL; date/hour logic continues to use recorded closing activity and the selected zone, including overnight hour ranges. No candle timestamp substitution.
- Time fields use two rows and neutral project colors. A reusable ProjectDateInput hour/minute popup replaces the OS-specific type=time picker in this Analytics-only time-input consumer. It supports typing, arrow buttons, keyboard steps, boundaries, nested Escape and outside dismissal. Valid edits publish immediately so direct Apply cannot lose the last keystroke.
- Equal applied filter values preserve pending selections when route props are recreated; actual applied changes reset the draft. The empty resource-status slot no longer creates a gap before Apply. Existing resource warnings remain visible.

## Requested label metadata

Created through the existing `/api/v2/trade-labels` API in workspace `tenant-a` only:
Excellent/green, test/blue, Good/cyan, Average/gray, Poor/orange, Bad/red.
The idempotent provisioning script preserves existing names and colors. It changes
catalog metadata only, with no trade assignment, replay result or execution change.
`labels-before.json`, `labels-after.json`, `labels-changes.json` and `seed_labels.py`
are saved in the artifact root. No automatic seeding on GET or render was added.

## Verification and repaired failures

Artifact root: `E:/BACKUP-TRADINGWORKSPACE/analytics-filter-polish-20261025/`.

- Original active UI reproduced the initially active close-date sort and automatic details popup after navigating from the selected session with dataset context (`before-transition.json`, `before-auto-details.png`). Initial inspection also measured the empty24px status slot and wrong fallback SVG.
- Scoped candidate build PASS: tracked HEAD plus intentional source overlays and the previously accepted private CSS baseline; unrelated WIP excluded. Working overlays byte-match the final candidate. Vite retains its large-chunk advisory.
- Existing analytics/journal/timezone/date-model tests **30/30 PASS**, `model-tests.log`.
- Final candidate browser **13/13 PASS**, `candidate-final/report.json`; deployed UI5180 **13/13 PASS**, `deployed-final/report.json`. Both record no page errors or attempted API writes. The separate six catalog creates above were explicitly requested metadata provisioning.
- Browser covers real session data, all six unused label options/colors, flat menus, Monday–Sunday order, draft versus applied state, URL reload, per-chip removal, overnight time range, timezone persistence/query/store sync, no empty spacing, implicit/explicit session sorting, library navigation without a dialog, and explicit details opening.
- Responsive1920dark,1440light,390dark and320light checks cover popup bounds, nested time popup/Escape and document overflow. Relevant screenshots were inspected directly; the1920 report image was recaptured after skeleton disappearance.
- Independent review found direct-Apply loss in the initial spinner. Repaired by publishing valid edits before outside pointerdown unmounts the popup; regression uses sequential typing19 then direct Apply, plus hour/minute button/keyboard wrapping and combined day/time filters.
- The first deployed check passed10 cases then lost a pending label selection (`deployed-attempt1.json/png`). A deterministic same-values route refresh reproduced selected=true→false on the initial UI and true→true on the repaired preview (`draft-refresh.json`). Draft sync now depends on applied scalar values rather than object identity; the final13-case browser run includes this regression.
- Independent reviewer accepted the final source, the repaired direct-Apply flow, desktop/mobile visuals and the last draft-sync patch. No remaining blocker in this scope.
- Browser contexts are isolated; GET/HEAD only, with external, MT5/live, events and WebSockets blocked. Acceptance is scoped to these filters/navigation and shared time control, not whole-product or broker acceptance.

## Local rollout

- Atomic UI5180 promotion preserves branding, rollback indices/mutable files and old hashed assets for open pages. The initial rollback is `ui-before-release/` (workspace-clock UI); the intermediate revision is `ui-before-final/`. Promotion receipts are `ui-promotion-release.json` and `ui-promotion-final.json`.
- Original served index SHA256: `ddca8be9e4dc335a4b122343a4408835d9c72b88126edd9439397cc052c129e9`.
- Intermediate index SHA256: `a5ee0cebfe4f4414caed655b1e62868a9caef54e92e7f4ab0d5f3b1a92b93a07`.
- Final served index SHA256: `36c4f9398629f4fa35cefa0f8559076ed58f5349fdc8d0e19b6a282774b0ccc7`. HTTP bytes match the candidate, and source overlays match (`served-final-hash.json`).
- Existing native/compact API remains ready under owner run `12df5b87b39f4d0fae45ebb826479cbe`. No API/terminal restart, migration, account reconnect or broker action.
- The owned preview on5196 was stopped after deployed verification with PID/command-line identity checked first.
