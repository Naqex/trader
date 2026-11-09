# Route, overlay and workflow audit — 31/10/2026

Baseline: Trader `884d04f2`; source inspection only unless a later receipt says otherwise.
This is audit evidence for the Product Plan, not an acceptance ledger.

## Fixed inventory denominator

The shell has **20 sidebar destinations** (`FxReplayShell.jsx:184–238`):

| Area | Destinations | Owning content |
|---|---|---|
| Testing (5) | Dashboard; Sessions; Trades; Analytics; Market Data | DashboardSessions; SessionPicker/ReplayWorkspace; SessionReports/FxTradeLedger; SessionReports/AnalyticsWorkspace; DataDeskWorkspace |
| Live (7) | Terminal; Calendar; Trades; Notes; Tag analytics; Analytics; Trading accounts | LiveTradingWorkspace; LiveSurfaces; LiveBrokerSnapshot/ManualTrades; JournalNotes/LiveNoteEditor; LiveTagAnalytics; LiveAnalyticsReport; LiveAccounts |
| Strategies (1) | My strategies | PlaybookWorkspace |
| AI (5) | Connections; CLIProxyAPI; Models; Workflows; Bots | AiProviderSettings; PersistentGateway; AiModelProfiles; AiWorkflows; explicit unavailable Bots state |
| Education (1) | Education | LearnWorkspace |
| Settings (1) | Settings | SettingsWorkspace (General/Trade labels) |

Additional **detail/workspace states**, outside those 20 destinations: replay chart,
MT5 chart, Prop reports, research result/job, Risk Lab, trade-note deep link, AI
assistant, UI reference and data-state previews. These require their own transition
checks; opening a sidebar destination does not validate every detail state.
`section=assistant` is deliberately rendered by `FxReplayShell.jsx:503,702`, not
`AiWorkspace`; its empty body there is not a blank-page bug.

Mechanical overlay inventory (PowerShell `Select-String`, top-level `src/*.jsx`):

| Pattern | Sites | Files |
|---|---:|---:|
| `<LegacyModal` | 25 | 19 |
| `<dialog` | 16 | 16 |
| `<LegacyPopover` | 14 | 12 |
| literal native `popover=` | 3 | 3 |
| literal `role="dialog"` | 13 | 11 |
| literal `role="menu"` | 8 | 7 |
| `data-tooltip=` | 162 | 47 |

The union of the first five patterns is **49 JSX owner files**. Counts overlap;
do not add them or claim 49 distinct dialogs. This is a bounded source-review
denominator, not rendered or accessibility acceptance. Dynamic roles, child
variants and canvas/vendor UI need explicit review beyond this mechanical scan.

## Findings

All findings below were confirmed in source, not yet reproduced in the active UI.

| ID | Finding / source | Impact / bounded remedy |
|---|---|---|
| RW-01 | Four native browser confirmations: `NoteTemplatesDialog.jsx:66`, `TradeMedia.jsx:58`, `TradeTagGroups.jsx:69`, `useAutosave.jsx:70` | Style/focus behavior bypasses the design system. Reuse a native confirmation component for the first three; keep autosave discard/unload semantics separate until reviewed. Native `showModal()` is necessary when the parent is itself a top-layer dialog; a body-portal LegacyModal would appear underneath it. |
| RW-02 | `SessionFilter.jsx:20–52,69` opens/interacts with the popup without reacting to `disabled`; `FxSelect.jsx:31` already closes on disable | An existing open session/account picker can remain editable when the catalog becomes non-ready. Close it and guard item/toggle handlers; test enabled→disabled→enabled with keyboard and empty catalog. |
| RW-03 | `LiveBrokerSnapshot.jsx:52` exposes an enabled Delete menu entry; `:28–30` leads to a disabled Delete button | Dead-end workflow despite owner deferring journal deletion. Hide the unavailable action; retain real fills/comments and no deletion side effects. |
| RW-04 | `SessionPresetMenu.jsx:15–20,28–38` only closes on pointer-outside/Escape; no blur-close, keyboard traversal or viewport placement | Tab can leave the menu behind, and placement differs from other pickers. Reuse popup lifecycle/geometry in a later preset slice; verify nested deletion confirmation and keyboard return. |
| RW-05 | `SettingsWorkspace.jsx:157–260`, `LearnWorkspace.jsx`, `RiskWorkspace.jsx`, `PlaybookWorkspace.jsx` retain substantial literal VI/EN text outside locale translation; Settings `:172–175` still describes language as navigation-only | Whole-product VI/EN is partial. Prioritize everyday settings, page actions/errors and captions; preserve names/technical identifiers. The current dictionary test validates existing entries, not unwrapped JSX text. |
| RW-06 | Native `title=` remains on help-bearing cells/actions, e.g. `FxTradeLedger.jsx:71–72`, `ProjectDateInput.jsx:276`, `TradeTagGroups.jsx:54,69`, `Mt5SymbolPicker.jsx:54`, `PaginationFooter.jsx:20` | Competing tooltip timing/appearance; native titles lack equivalent touch/focus disclosure. Move contextual help to existing `ProjectTooltipLayer` (`data-tooltip`) where it helps an action; preserve aria labels and avoid gratuitous tooltip additions. |
| RW-07 | `TestingComponentReference.jsx:20–146` is mostly literal VI and displays `Compact 0.1.1`; `ui/project-ui.json` pins compact `0.3.0` | Reference itself is not language-complete and version is stale. Remove invented version metadata or derive it from the real pin; add missing reusable confirmation/notification/panel patterns after contracts settle. Other lane owns reference changes. |
| RW-08 | `TradeJournalPreview.jsx:17–23,48–64` supports source/status choices and bulk tags as explicit UI preview; bulk template apply has no onApply consumer | These are incomplete workflows, not visually complete features. Keep preview state explicit; do not enable deletion or pretend tags/templates persist without data contracts. Record them as deferred implementation in the Product Plan. |

## Reuse already present

Shared and actively reusable: `AppIcon` (Lucide), `FxSelect`, `SessionFilter`,
`ProjectDateInput` (textbox/dropdown), `LegacyModal`, `LegacyPopover`,
`ProjectTooltipLayer`, `SelectionToolbar`, `PaginationFooter`, `DataTable`,
`VirtualTableBody`, `ReportSidePanel`, `NotificationSurface/Provider`,
`TestingReadState`/page skeletons and note editor/autosave contracts.
Do not add another general UI framework for this work.

## Validation scope

Reviewed route composition in `main.jsx`, shell map and principal owning modules;
searched hidden-surface patterns and destructive confirmations. No runtime restart,
provider/broker call, API/database write or whole-product visual verdict occurred.
Remaining denominator: rendered route matrix + overlay keyboard/state matrix +
VI/EN fallback audit. A simple user-facing completion percentage must name which
of those denominators it measures.

## Status — WIP review 01/11/2026

Source review of the leftover WIP plus a fresh production build (`$env:TEMP\review-build`,
`vite preview` 5232, mocked API, writes blocked or fixture-only). Not committed.

| ID | Status | Notes |
|---|---|---|
| RW-01 | **Done** (3/4) | `ConfirmationDialog` now backs TradeMedia, TradeTagGroups and preset delete; NoteTemplatesDialog is owned by the UI lane. `useAutosave.jsx:70` keeps `window.confirm` on purpose (discard semantics unchanged). Review fix: `Xóa` was missing from the dictionary, so the EN media confirm read "Xóa"; added. |
| RW-02 | **Done** | SessionFilter closes on disable, ignores toggles while disabled, and only consumes Escape when open (parent dialog keeps its Escape). |
| RW-03 | **Done** | Live trade inspector no longer offers Delete; the dialog only shows fills. Unused `.wm-trade-delete-menu` CSS remains in shared `page-layout.css` (not removed: shared CSS). |
| RW-04 | **Done** | SessionPresetMenu uses `LegacyPopover` (blur/focus-out close, arrow keys, viewport placement, portal into the enclosing dialog) and `ConfirmationDialog`. Review fixes: removed dead `.session-preset-confirm` CSS; preset browser tests now target `.wm-confirmation-dialog` and reopen the menu after delete/cancel. |
| RW-05 | **Partial** | Settings/Learn/Risk/Playbook text goes through `t()`; review added 15 missing dictionary entries (Risk result headings, Playbook link states, Learn empty states, `Bật`, `Đã cấu hình`, MT5 symbol empty states). Still literal: Risk metric labels (`Overall floor`, `Daily floor`, `Daily reference`) and a few `buy/sell`/`frozen` tokens; PropWorkspace strings were outside this pass. |
| RW-06 | **Done** for listed sites | Native `title=` removed from FxTradeLedger, ProjectDateInput, TradeTagGroups, Mt5SymbolPicker, PaginationFooter, LiveBrokerSnapshot; they use `data-tooltip`. Other files not swept. |
| RW-07 | Not this lane | `TestingComponentReference.jsx` WIP belongs to the foundations/reference lane. |
| RW-08 | Not this lane | `TradeJournalPreview.jsx`/`NoteTemplatesDialog.jsx` owned by `/root/ui_finish`. |

Checks: `ownerWorkflowControls.browser.mjs` **2/2 cases** (dark/vi/1440, light/en/390), now
also covering preset menu blur/Escape inside a parent dialog, failed delete alert, cancel focus
return and successful delete; no page errors, no native dialogs, writes only to fixture routes.
The test's EN pending label was wrong (`Processing…`; HEAD copy is `Working…`); fixed.

Not run: `sessionPresets.browser.mjs` fails identically on a HEAD build (chart-option height
36≠32, then no dataset options without a live API), so it cannot judge this change.
`journalUiScaffold`/`liveReviewNote`/`noteWorkspace`/`tradeAutosaveNative` need the disposable
PostgreSQL + Rust probe harness (`scripts/note_workspace_acceptance.py`); no PostgreSQL binaries
on this machine. Their WIP edits only follow the Apply-button change in NoteTemplatesDialog.
