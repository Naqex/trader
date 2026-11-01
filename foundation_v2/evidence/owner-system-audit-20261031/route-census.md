# Route census (static) — 01/11/2026

Trader HEAD `420efc86` + 7 dirty files (not inspected for ownership). Source-only:
no server, no port 5180/8010, no request. Complements, does not repeat,
[routes-audit.md](routes-audit.md) (RW-01…08, overlay denominator) and
[frontend-performance-audit.md](frontend-performance-audit.md) (FE-01…08).

Routing model: one root document; `main.jsx:60-162` picks content from `view`
(+ `session`/`dataset`/`job` inference at `:75`), `FxReplayShell.jsx:183-237`
maps `area`/`section` to the sidebar. Every route content below is a `lazy()`
chunk (`main.jsx:5-22`) unless noted. "GET on open" = reads issued on mount;
all reads send `X-Workspace-Id`. `WorkspaceQueryProvider` also opens
`/api/v2/events` for every real route (`main.jsx:162`, `workspaceEvents.js:57`).

Change since routes-audit: AI now has **6** sidebar items (`paperclip` default,
`automation` replaces Bots), so the sidebar denominator is **21**, not 20.

## Sidebar destinations (21)

| # | URL | Owner | GET on open | Overlays reachable | Risk |
|---|---|---|---|---|---|
| 1 | `view=overview` (`area=testing&section=dashboard`, bare `/`) | `DashboardSessions.jsx:30` via `main.jsx:43` | `/dashboard/sessions?…`, per-row `/replay/sessions/{id}/metadata`, `/replay/sessions/{id}/analytics` (`dashboardModel.js:120-188`) | QuickSessionDialog (lazy, `create=prop|backtest` opens it, `:51`), SessionDuplicateDialog, SessionSettingsDrawer, SessionActions | Bare root runs N+1 metadata/analytics reads per visible row |
| 2 | `view=replay&select=1` (`section=sessions`) | `SessionPicker.jsx:55` | `/replay/sessions` (`:115`) | SessionDuplicateDialog, SessionSettingsDrawer, SessionPresetMenu+ConfirmationDialog, SessionFilter | — |
| 3 | `view=trade` (`section=trades`) | `SessionReports.jsx:117` `ledgerOnly` → FxTradeLedger | `/replay/sessions`, `/replay/trades?…` (`:39`), `/trade-labels` | TradeInspector `<dialog>` (`FxTradeLedger.jsx:39`), LedgerFilterDrawer, TradeLabelCell popovers, TradeMedia+confirm, TradeTagGroups | — |
| 4 | `view=analytics` (`section=analytics`, `analytics_source=sessions`) | `SessionReports.jsx:117` → FxAnalytics | `/replay/sessions`, `/replay/sessions/{id}/analytics` | LedgerFilterDrawer, LegacyModal (`FxAnalytics.jsx:326`), AnalyticsFilterControls `role=dialog` | `title=` 16× in FxAnalytics, 11× SessionPerformance |
| 5 | `view=market-data` (alias `view=data`) | `DataDeskWorkspace.jsx:364` | `/data/datasets`, `/data/downloads` (`dataDeskApi.js:18,47`) | `<dialog>` (`:172`), DataLibraryActions menu, MarketAssetCatalog | **POST `/data/catalog/refresh` on open** when catalog empty+configured (`:505-507`, = FE-07) |
| 6 | `view=live&section=terminal` | `LiveTradingWorkspace.jsx:48` via `LiveWorkspace.jsx:25` | `/live/connections` (poll 10s, `:103-113`), `/live/trading/…` summary (poll 10s, `:150-158`) | Order ticket, conditions, confirmation LegacyModals (`:315-336`), Mt5SymbolPicker | Order/pause actions behind explicit confirm (no auto write) |
| 7 | `view=live&section=calendar` (default for unknown `section`) | `LiveSurfaces.jsx:284` via `LiveWorkspace.jsx:24` | `/live/status` poll 5s (FE-05), `/live/records`, per-account `/live/status?connection_id=` (`useLiveCalendarAccounts.js:25`), `/playbooks`, `/trade-labels` | LiveDayNote `<dialog>`, FilterDrawer, ReportSidePanel, LiveRecordDialog (lazy) | Literal `"Reading account data…"` (`LiveWorkspace.jsx:70`) |
| 8 | `…&section=trades` | LiveSurfaces → ManualTrades / `LiveBrokerSnapshot.jsx` | as #7 + `/journal` (note presence) | LiveBrokerSnapshot `<dialog>`, FxAnalyticsFilters drawer, TableColumnControl, LiveRecordDialog | — |
| 9 | `…&section=notes` | LiveSurfaces → JournalNotes (`LiveJournalSurfaces.jsx`) | as #7 + `/live/note-folders`, `/note-types`, `/note-templates` | NoteFilterDrawer, NoteFolderDialog, LiveNoteEditor modals/menu, NoteTemplatesDialog | `useAutosave.jsx:70` `window.confirm` (RW-01 kept) |
| 10 | `…&section=tag-analytics` | LiveSurfaces → JournalTags + `SmartPicksPanel` | as #7 + `/journal`; `/trade-labels` fetched by several hooks (FE-04) | FxAnalyticsFilters drawer, ReportSidePanel | — |
| 11 | `…&section=analytics` | LiveSurfaces → LiveAnalyticsReport | as #7 (multi-account status) | SessionFilter | — |
| 12 | `…&section=trading-accounts` (`account_tab=connect|transactions`) | `LiveAccounts.jsx:26` | `/live/status?summary` + `/live/connections` | AccountActionDialog, LegacyPopover (`:121`), LegacyModal | — |
| 13 | `view=playbook` (`area=strategies`) | `PlaybookWorkspace.jsx:184` | `/playbooks`, `/playbooks/{id}/revisions` (`:103,115`) | LegacyModals (`:75,180`) | RW-05 partial i18n |
| 14 | `view=ai&section=paperclip` (default, also invalid section) | `AiPaperclipPanel.jsx:4` persistent in shell (`FxReplayShell.jsx:709`) | Paperclip health (`:26`), iframe | — | Cross-origin iframe; postMessage origin checked |
| 15 | `…&section=connections` | `AiProviderSettings.jsx:13` (+ ChatGptAccount) | `/ai/assistant/connections/local-gateway`, `/…/chatgpt-web` (`:50`) | LegacyModal (`:149`), OAuth popup window | Polls 1.5s only while an operation is active |
| 16 | `…&section=gateway` | `AiGatewayPanel.jsx:6` persistent | `/ai/assistant/connections/local-gateway`, gateway health, iframe | — | **POST `/local-gateway/refresh` on leaving the page** (`:14-37`) — implicit write on navigation |
| 17 | `…&section=models` | `AiModelProfiles.jsx:9` | `/ai/assistant/profiles`, `/catalog`, `/account` (`:20`) | AiModelPicker popover | — |
| 18 | `…&section=workflows` | `AiWorkflows.jsx:11` | `/ai/assistant/workflows` (+ run poll when selected) | AiSourcePicker | — |
| 19 | `…&section=automation` | inline `AiWorkspace.jsx:28` (no lazy chunk) | none | — | Placeholder only |
| 20 | `view=learn` | `LearnWorkspace.jsx:82` | `/learn/overview`, `/learn/glossary`, `/learn/resources/{id}` | — | Literal VI back labels `Về Research`/`Về Replay` (`:48,51`) |
| 21 | `view=settings` (`settings_tab=labels`) | `SettingsWorkspace.jsx:76`, TradeLabelSettings (lazy, `:5`) | `/session/status`, Notion OAuth status, `/execution/capabilities`, refetch on every window focus/online (`:102-125`); labels tab `/trade-labels` | TradeLabelSettings LegacyModal (`:62`) | Focus-triggered triple re-read |

## Detail / hidden states (not in the sidebar)

| URL | Owner | GET on open | Overlays | Risk |
|---|---|---|---|---|
| `session=…` or `surface=workspace` (replay chart) | `ReplayWorkspace.jsx:120` | `/data/datasets`, `/replay/sessions/{id}`, prop attempt if bound (`:216,290`) | LegacyOrderDialog, PropRulesDialog, SessionSettingsDrawer, LegacyPopover, chart modals | `useReplayActivity` POSTs `/replay/sessions/{id}/activity` while focused (`:511`) — intentional telemetry write |
| `dataset=…` without `fresh=1` and no remembered session | `ReplayWorkspace.jsx:402-403` | `/data/datasets` | as above | **Auto POST `/replay/sessions` (create) on mount** from a plain link |
| `view=live&section=terminal&surface=workspace` | LiveTradingWorkspace chart | `/live/trading/events` stream, `/live/connections` | Object tree aside, order/confirm modals | — |
| `view=analytics&analytics_source=prop` | `PropAnalytics.jsx:12` | `/prop/reports` | — | — |
| `view=analytics&job=…` / `surface=workspace` | `AnalyticsWorkspace.jsx` | `/{kind}/{id}/analytics` (`:139`), `/journal/context` | — | — |
| `view=trade&intent=order` | `TradeWorkspace.jsx:144` | `/replay/sessions/{id}`, `/data/datasets` | — | — |
| `view=research` or `job=…` | `ResearchWorkspace.jsx:173` | `/data/datasets`, `/research/engines`, `/research/jobs/{id}` (+checkpoint), bounded retry | — | — |
| `view=risk` | `RiskWorkspace.jsx:70` | none (POST only on submit, `:112`) | — | RW-05 leftovers |
| `view=journal&session=…&trade=…` | `TradeNoteRoute.jsx:8` (ledger + inspector) | as #3 + `/journal` | TradeInspector | — |
| `view=ai&section=assistant` | `AiChatPanel.jsx:29` in shell (`FxReplayShell.jsx:713`) | `/ai/assistant/agents`, `/account`, `/catalog`, `/profiles`, chat list/restore | `<dialog>` (`:197`), AiAgentPicker/AiModelPicker | — |
| `view=ai&section=research` | `AiResearchWorkspace.jsx:58` | none (fixture preview) | Create/confirm LegacyModals (`:40,131`) | Preview only; events stream disabled |
| `view=testing` / `view=prop` | redirect `main.jsx:72` → overview `create=prop` | — | QuickSessionDialog | — |
| `ui_reference=1` | `TestingComponentReference.jsx:122` | none | sample modals/popover/confirm | RW-07 |
| `demo=1` / `ui_state=…` | `ViewStatePreview.jsx:23` (unmounts real readers, `main.jsx:158`) | fixtures | per view | — |
| Unknown `view` | `UnavailableWorkspace` (`main.jsx:47`, not lazy) | none | — | Literal VI copy, no `t()` (`:53-54,142-145`) |

Shell-wide overlays on every route: help panel (`FxReplayShell.jsx:702`),
AI chat side panel/modal (`:713`), mobile nav drawer (`:697`), ProjectTooltipLayer.

## Top risks

1. `?dataset=X` link (no `fresh=1`, no remembered session) creates a replay session on mount (`ReplayWorkspace.jsx:403`). Opening/bookmarking a URL is a write.
2. Data Desk POSTs a provider catalog refresh during initial read (FE-07, `DataDeskWorkspace.jsx:505`).
3. Gateway page POSTs `local-gateway/refresh` whenever the user leaves it or opens chat (`AiGatewayPanel.jsx:14-37`).
4. Polling load on Live: status 5s on every journal section plus 10s connection/summary polls on terminal; dashboard N+1 per-row reads.
5. i18n/native-UI gaps remain: `UnavailableWorkspace` and Live skeleton labels are literal; `useAutosave` keeps `window.confirm`; `title=` still in ~37 files (FxAnalytics 16, SessionPerformance 11, LiveSurfaces 9).
