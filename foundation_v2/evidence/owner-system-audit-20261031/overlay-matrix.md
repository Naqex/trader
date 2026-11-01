# Matrix dialog, popover, tooltip và notification — 01/11/2026

**Có proof tốt cho một số primitive/consumer; chưa có integrated overlay acceptance.**
Lát này chỉ đọc source, test và receipt; không mở browser/service, không chạy lại
test, không gọi provider/broker hoặc ghi database. HEAD khi khảo sát `a5a079d0`;
Studio còn WIP do root sở hữu ở thời điểm khảo sát. File này bổ sung O1/O5/O10,
không thay ledger. Delta sau tích hợp nằm ở cuối file, supersede các ô tương ứng.

## Cách đọc bằng chứng

- **Verified-fixture**: có receipt chạy thật trên fixture, chỉ đúng case đã ghi.
- **Verified-historical**: receipt cũ có phạm vi/source riêng; chưa rerun candidate.
- **Source-only**: đã tìm/đọc implementation hoặc test script; chưa có run proof
  phù hợp để kết luận hành vi trên candidate.
- **Unknown**: chưa có bằng chứng cho chiều kiểm tra đó trong packet được review;
  không có nghĩa tính năng hỏng hoặc không từng được test ở nơi khác.

`showModal()`, event handler Escape, focus trap trong source và script có assertion
không tự biến thành browser PASS. Mở route thành công cũng không kiểm lớp ẩn.

## Inventory source hiện tại

Quét top-level `web/src/*.jsx` bằng `Select-String -SimpleMatch`; số dưới là
**dòng match**, không phải số instance DOM/biến thể UI độc lập.

| Literal | Dòng match | File |
|---|---:|---:|
| `<LegacyModal` | 27 | 20 |
| `<dialog` | 16 | 16 |
| `<LegacyPopover` | 14 | 12 |
| `popover=` | 3 | 3 |
| `role="dialog"` | 13 | 11 |
| `role="menu"` | 6 | 6 |
| `data-tooltip=` | 166 | 53 |

Union năm pattern đầu = **51 owner files**, supersede inventory **49** của
`routes-audit.md` cho snapshot này. Không cộng các dòng/file vì chúng chồng lấn.
`FxSelect` có `role={searchable ? 'dialog' : 'presentation'}` nên nằm ngoài union
literal; Notifications, menu-only owners, editor/vendor/canvas UI cũng cần bổ sung
theo workflow. Vì vậy 51 không phải mẫu số toàn bộ overlay của sản phẩm.

## Owner map (51 file, không phải 51 ca đã kiểm)

Đường dẫn rút gọn đều ở `foundation_v2/web/src/`. Các nhóm phục vụ routing; một
file có thể sở hữu nhiều loại surface. Coverage cụ thể nằm ở bảng tiếp theo.

| Nhóm | Owner files | Loại chính / status hiện tại |
|---|---|---|
| Primitive | `LegacyModal.jsx`, `ConfirmationDialog.jsx` | Dialog/portal; source-only cho contract toàn primitive, consumer proof ở M01/M03 |
| Template | `NoteTemplatesDialog.jsx` | Native dialog, menu mặc định, nested confirmation; M01/M04 |
| Media | `TradeMedia.jsx` | Native preview + confirmation; M01 chỉ kiểm remove, chưa preview lifecycle |
| Nhóm nhãn | `TradeTagGroups.jsx` | Popover editor + confirmation; M01 |
| Preset | `SessionPresetMenu.jsx` | LegacyPopover + confirmation trong parent dialog; M01 |
| Session picker | `SessionFilter.jsx` | Inline dialog; M01 |
| Date/time | `ProjectDateInput.jsx` | Native top-layer popover; M05 |
| Notes/journal | `LiveNoteEditor.jsx`, `LiveJournalSurfaces.jsx`, `LiveRecordDialog.jsx`, `NoteFolderDialog.jsx`, `LiveDayNote.jsx`, `NoteTypeSelect.jsx`, `TradeJournalPreview.jsx` | Drawer, centered trade picker, type/menu, preview dialogs; M04/M05, còn nhiều source-only |
| Filters | `FilterDrawer.jsx`, `AnalyticsFilterControls.jsx` | Native drawer/inline dialog; source-only cho toàn contract candidate |
| Session/Prop setup | `QuickSessionDialog.jsx`, `SessionSettingsDrawer.jsx`, `SessionDuplicateDialog.jsx`, `SessionActions.jsx`, `PropRulesDialog.jsx` | Native dialog/drawer/menu; source-only trong packet này |
| Trade inspector | `FxTradeLedger.jsx`, `LiveBrokerSnapshot.jsx` | Native inspector; source-only, removal of dead Delete là source fix RW-03 |
| Account | `AccountActionDialog.jsx`, `LiveAccounts.jsx` | Account action modal/menu/popover; source-only cho Escape/focus/nested/async/error của candidate |
| Analytics | `FxAnalytics.jsx` | LegacyModal; source-only cho lifecycle toàn modal |
| Groups/labels | `TradeGroupControls.jsx`, `TradeLabelSettings.jsx`, `TradeLabelCell.jsx` | Merge/label modal và popover; M06 chỉ merge scope; labels catalog proof không tự là overlay proof |
| AI/Studio | `AiProviderSettings.jsx`, `AiResearchWorkspace.jsx`, `AiChatPanel.jsx`, `AiAgentPicker.jsx`, `AiModelPicker.jsx` | Connection drawer, preview modal, chat dialog/native popovers; M09, WIP |
| Chart/trading | `ChartTradingDock.jsx`, `LegacyChartHeader.jsx`, `LegacyReplayToolbar.jsx`, `LegacyOrderDialog.jsx`, `LiveTradingWorkspace.jsx`, `Mt5ChartSetup.jsx`, `Mt5Positions.jsx`, `Mt5SymbolPicker.jsx`, `PartialCloseDialog.jsx`, `ReplayWorkspace.jsx`, `TradingViewReplayChart.jsx` | Ticket/conditions/confirm/setup/order tools/menu; source-only cho current overlay matrix; execution gate riêng |
| Data | `DataDeskWorkspace.jsx` | Native dialog; source-only. FE-07 GET-only open proof không kiểm dialog |
| Playbook | `PlaybookWorkspace.jsx` | LegacyModal editor/compare; source-only |
| Shell | `FxReplayShell.jsx` | Help/mobile nav/assistant panels; source-only cho keyboard/focus lifecycle |
| Reference | `TestingComponentReference.jsx` | Sample modal/native dialog/popover/confirm; M03 chỉ những assertion được nêu |
| Tooltip controller | `ProjectTooltipLayer.jsx` | Delegated tooltip qua LegacyPopover; M07 |

Ngoài union: `LegacyPopover.jsx` (primitive portal, không tự render literal được quét),
`FxSelect.jsx` (searchable/multiple/listbox), `Notifications.jsx`
(provider/viewport/surface), `DataLibraryActions.jsx`, `LegacyLayoutMenu.jsx`
(menu-only), 53 file có `data-tooltip`, và rich editor/vendor UI. Chưa inventory
mọi descendant/menu động hoặc iframe content.

## Coverage Escape / focus / nested / async / error đã có thật

| ID / surface | Trạng thái và nguồn | Escape | Focus | Nested/layer | Async/pending | Error/recovery |
|---|---|---|---|---|---|---|
| **M01 SessionFilter, ConfirmationDialog, preset, media remove, tag-group delete, template delete** | **Verified-fixture**, `workflow-controls/receipt.json`, 2 cases: dark VI 1440 + light EN 390; `ownerWorkflowControls.browser.mjs` | Picker/preset đóng; pending confirm không đóng; nested confirm đóng mà parent còn | Initial Cancel và opener return; picker trigger; preset/group cancel return được assert. Không có full Tab-loop assertion | Native parent → confirm; parent → preset → confirm; template native dialog → confirm | Busy gate + media request giữ pending được kiểm; preset delete async | Media fail→alert→retry; preset fail→alert→cancel→success. Group/template chỉ success/cancel, **unknown** error/retry |
| **M02 Autosave discard/reload conflict** | **Verified-fixture theo root handoff**, `420efc86`, `OWNER-REVIEW-20261101.md`; script `autosaveDiscardConfirm.browser.mjs`. Chưa có raw run JSON tại canonical folder | Cancel và Escape giữ draft; confirm mới reload server value | **Source-only**: shared confirm quản focus; script không assert return/trap | **Unknown** khi nằm trong native template/drawer thật; fixture standalone | Fixture load/save conflict, confirm reload; chưa delayed reload/close race | 409 conflict có; reload failure và uncertain outcome **unknown** |
| **M03 UI Reference modal + multiselect** | **Verified-fixture**, `foundations/results.json`, 4 dark/light × 1440/390, VI, reduced-motion | Script bấm Escape đóng multiselect; không assert chuỗi Escape qua mọi layer | Checkbox focus outline đã assert; full Tab trap/return **unknown** | Portal render/checkmark/icon geometry; multiselect nằm trong modal có proof | **Unknown** (API trả labeled 503, không workflow async) | Không kiểm recovery; 0 page errors không phải error-state coverage |
| **M04 Notes drawer/menu/trade picker/template** | **Verified-historical**, `../ui-system-audit-20261031/REPORT.md`, mục Notes drawer: 8 nhóm fixture + 9 deployed GET-only cases ở 1920 dark/1440 light/390 dark | Picker cancel/Escape không đổi links được ghi; drawer/menu scope trong report | Rename focus và navigation flush có proof; full trap toàn biến thể **unknown** | Drawer → menu/trade picker/template có historical workflow proof | Flush trước navigate; cap500; rich/template persistence | Fixture CAS/error/recovery có; không tự phủ confirm mới 420efc86 hoặc mọi note/folder/day variant |
| **M05 Date/type/session dropdown** | **Verified-historical**, cùng REPORT: date-presentations 12 nhóm fixture + 12 deployed read-only cases; note picker 6 nhóm fixture | Date invalid→Escape→valid; range đầu tiên hủy draft; type Escape được ghi | Focus return và nested-disabled-focus bug đã có regression scope | Top-layer calendar trong Notes/trade picker; không phủ mọi chart setup | Late catalog revision/CAS và disabled saving có scope; date selection thuần local | Invalid date giữ value, 409/422/503 + custom type protections theo report; không mọi consumer |
| **M06 Merge/split journal group** | **Verified-historical**, cùng REPORT, trade-merge-native-qa3 + deployed confirm/cancel 6 cases, ba widths | Confirm/cancel có proof; explicit Escape/Tab-loop chưa được report xác nhận | **Unknown** chi tiết focus return trong packet đọc | Merge modal consumer có proof; stack với chart/native inspector **unknown** | Persist/reload/split thật trên disposable PG; real CAS refresh | Injected503/stale source/eligibility denial có; deployed chỉ read-only/cancel |
| **M07 Tooltip + ordinary catalog menu** | **Verified-historical**, `../analytics-controls-tooltips-20261026/RECEIPT.md`: tooltip18 geometry cases, catalog preview/deployed và Dashboard3 cases | Tooltip Escape; ordinary catalog menu Escape/return được ghi | Keyboard/touch disclosure scope có; không toàn 53 owner files | Controller/viewport placement có; tooltip bên trong mọi native dialog **unknown** | Hover180ms/close120ms là **source-only** ở snapshot này; không coi delay đã timing-test | Long text/4 sides/internal scroll/page-scroll dismissal có; detached/queued anchor Escape có source guard, chưa current run proof |
| **M08 Notification/recovery viewport** | **Verified-historical**, `../chart-notifications-prop-recovery-20261018/receipt.json`, `r5/browser.json`, CHECKPOINT | **Unknown**; notification không có Escape handler riêng trong source | Hover/focus/visibility pause có source; timing script có nhưng chưa tìm run receipt trong packet này | Historical chart bottom-left/non-chart top-right; trên native top-layer dialog **unknown** | Persistent Prop recovery và real native feed fixture giữ đúng replay state | Injected503→backlog locked; injected409→recovery retained→feed success. Không gọi broker owner; không thử provider |
| **M09 Studio connection drawer / AI picker** | **Source-only cho current WIP**. `aiStudio.browser.mjs` có drawer/error-state assertions; root đang review/rerun. Lượt pass trước đã report riêng, chưa đóng delta hiện tại | Script gửi Escape; cần assert drawer detached/parent còn đúng, không chỉ bấm phím | Shared LegacyModal source; dedicated return/Tab-loop run proof **unknown** | Drawer + gateway/detail route; iframe bridge/provider popup boundary **unknown** | Mock status states có script; pending mutation/cancel **unknown** | Script kiểm stopped/unavailable/login_failed tone/alert; current final run chưa được matrix này công nhận |

M01 cho phép đúng 8 fixture writes in-memory (media/group/template), không owner
writes. M03 API 503 chỉ phục vụ reference, không suy ra loaded-data workflow.
M04–M08 có proof hữu ích nên không cần tự động chạy lại toàn historical suite;
chỉ kiểm delta và seam giữa primitive/consumer trên candidate được root khóa.

### Contract thấy trong source, chưa được đóng bằng integrated browser proof

- `LegacyModal`: stack/inert body, initial focus, Tab loop, Escape top modal,
  opener return. `LegacyPopover`: nearest dialog/fullscreen portal, viewport
  geometry, focus-out/pointer-out close, Arrow/Home/End và anchor restore.
- `ConfirmationDialog`: native top-layer, initial Cancel, pending chặn dismiss,
  `role=alert`, opener restore. Consumer quyết định pending/error/unknown outcome;
  proof một consumer không xác minh transaction của consumer khác.
- `ProjectTooltipLayer`: visible tooltip mới consume Escape; queued/detached
  hint không chặn Escape của parent. `FxSelect`/SessionFilter đóng trên disable,
  chọn/search và keyboard có owner riêng, không dùng LegacyPopover.
- `Notifications`: 5/7/8/10 giây theo tone, pause hover/focus/hidden, persistent
  không timeout, dedup và tối đa3 notices. `notificationTiming.browser.mjs` có
  assertions tương ứng; **chưa thấy output không được ghi pass**. Source không
  có Escape-dismiss; cần quyết định UX nếu muốn yêu cầu đó.

## Next integrated fixture: ưu tiên 8 hành trình, không test máy móc 51 file

Khóa một candidate build/SHA + explicit WIP hash trước; hai cấu hình đầu tiên:
**1440 dark VI** và **390 light EN** = **16 journey-cases dự kiến**. Đây là kế
hoạch kiểm tra, chưa có case nào được thực hiện bởi lượt review này.

| Ưu tiên / case | Chuỗi và assertion cần bổ sung |
|---|---|
| P0 / I01 Session preset | Session settings native parent → preset popover → delete confirm. Tab/Shift+Tab ở từng lớp, Escape chỉ đóng top layer, opener return; fail→retry, busy Escape/outside click blocked; đóng parent không để orphan portal |
| P0 / I02 Notes liên kết | Notes drawer → menu → centered trade picker → date/type/dropdown. Cancel/Escape không đổi link draft, date invalid chặn Apply; pending catalog disable không đóng nhầm parent; đổi workspace/route khi lớp đang mở không giữ dữ liệu cũ |
| P0 / I03 Template + draft | Native template trong drawer → delete confirm; dirty conflict → discard confirm. Cancel/Escape giữ draft, confirm tải đúng revision; pending/error/retry; tooltip trên nút không nuốt Escape khi còn queued |
| P0 / I04 Trade inspector | Testing và Live chọn một đại diện → media preview/remove và label/group popover. Kiểm layer order, failure giữ nội dung/opener, unknown outcome không báo thành công; dismiss không đổi nguồn trade |
| P1 / I05 Filter/grid | Filter drawer → searchable/multi FxSelect/date. Phân biệt draft/Apply, disabled/error/empty; Escape top-first, outside click, focus return; pagination/selection không bị overlay che |
| P1 / I06 Tooltip + toast | Tooltip ngắn/dài trong native dialog và portal; visible/queued/detached Escape; pointer→tooltip scroll, focus/touch. Success/error/persistent notices; timer còn lại khi hover/focus/hidden, close button và stacking không che action |
| P1 / I07 Studio | Connection drawer → local gateway/detail; stopped/needs-attention; Escape/Tab/focus return, narrow scroll. Mock bridge health và iframe origin; chặn external/provider/OAuth, không gửi start/refresh thật |
| P1 / I08 Chart/session | Quick session/Prop rules/settings + một representative chart order/setup modal bằng synthetic replay data. Nested select/popover và tooltip, reduced motion, async/error close; chỉ fixture action, không broker/live submission |

Reuse `ownerWorkflowControls`, date/note native harness, `notificationTiming` và
tooltip placement helper; thêm integration ở seam thiếu thay vì dựng primitive
mới. Mọi HTTP mutation phải abort hoặc fulfill trong fixture được allowlist;
external origins/WebSocket/provider/broker đều chặn. Nếu cần persistence, dùng DB
tạm có owner và receipt riêng, không trỏ ignored tests vào DB owner.

Mỗi case lưu route/surface/state, build fingerprint, config, kết quả assertions,
page errors, blocked/allowed fixture writes và ảnh layer cao nhất. Sau 16 case,
chỉ mở rộng theme/locale/width hoặc consumer khi có khác biệt contract/risk cụ
thể. O5/O10 vẫn mở cho tới khi root review packet thực thi và giới hạn còn lại.

## Delta root sau tích hợp 01/11

- **M09 Verified-fixture có giới hạn**: Studio `b11e258b`,
  `studio-independent-review.md` và `STUDIO-RESULT.md`. Root đã chạy lại
  aiStudio4 theme/locale +390 layouts; row/drawer errors và stopped/login failure
  nhất quán. Independent probe kiểm Escape/initial focus/opener return, AX,
  reduced-motion. Full Tab-loop/pending mutation trong mọi picker vẫn unknown.
  `studioEmbed.browser.mjs`4 cases dùng document tổng hợp xác nhận giữ iframe,
  preference và retry; không xác nhận native app/provider/OAuth.
- **M08 timing Verified-fixture**: root chạy `notificationTiming.browser.mjs`,
  `notification-timing/report.json`9/9 PASS,0 page errors. Bao gồm tone durations,
  giữ remaining time khi hover/focus/hidden, rerender không reset và persistent
  vẫn đóng thủ công được. Không kiểm layer order trên native top-layer dialog.
- Visual route census phát hiện host unavailable buttons chưa dùng role chung;
  delta CSS mở rộng shared control scope sang persistent hosts và dùng chung
  font token. Independent focused controls evidence do candidate receipt giữ.

Inventory và các unknown của M01–M08 không thay đổi từ các delta này.
