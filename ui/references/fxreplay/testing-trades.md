# Testing Trades — đối chiếu ngày 26/10/2026

**Kết luận:** cấu trúc bảng và số học mẫu local đang hợp lý. Việc nên sửa trước
là hiển thị bộ lọc đang áp dụng, công bố cơ sở thời gian lọc và giải thích ba
cột Return. Chưa cần đổi công thức PnL hoặc làm lại toàn bộ bảng.

Lượt này chỉ research, lưu reference và đề xuất; chưa triển khai UI.

## Baseline và phương pháp

- FX Replay **2.0.3811-prod**, tài khoản Free, EN, Testing → Trades; một phiên
  có 4 dòng: 3 đóng, 1 mở. Viewport có sẵn 1536×724; không đổi kích thước.
- WMREPLAY HEAD `dec2b2aa2a93f02b0edef799aa3543f25a83ee7a`, UI5180,
  VI, dữ liệu thật, `sessions=all`, Asia/Ho_Chi_Minh, viewport 1920×940.
  Response có 14 dòng của 3 phiên: 13 đóng, 1 mở. Các dòng đóng không khai báo
  `status` riêng được read model/renderer hiểu là closed.
- Hai bên khác bộ dữ liệu. So công thức và mapping trong từng bên; không so
  trực tiếp 16 USD với −6,68 USD để kết luận lỗi.
- Theo [verification-workflow.md](verification-workflow.md): UI đang đăng nhập,
  DOM/ảnh, response do thao tác filter/sort/page của chính trang phát sinh,
  source local và script số học offline. Không đọc state nội bộ framework,
  token/cookie, không gọi endpoint FX riêng hoặc sửa dữ liệu giao dịch.
- Raw chỉ lưu local:
  `E:/BACKUP-TRADINGWORKSPACE/fxreplay-reference-20261026/testing-trades/`.
  [Manifest](testing-trades-evidence.json) giữ hash file và source đã đọc.

## 1. Cấu trúc và hành vi

| Thành phần | FX quan sát được | WMREPLAY quan sát/source | Quyết định |
| --- | --- | --- | --- |
| Phạm vi | Selector Sessions, bảng có cả Open/Closed | Tất cả hoặc nhiều phiên; scope workspace/session và provenance từng dòng | Giữ bảng gộp; không cộng tiền khác currency thành tổng tùy tiện |
| Cột | Session, Type, Source, hai Entry Date, Asset, Side, Entry type, Return $, %, R, Trade Rating, giá/size/SL/TP, Exit date, Gross PnL, Fees | Cùng nhóm chính; có thêm Exit Realtime/Chart riêng, số thứ tự; Tags thay cho Trade Rating | Giữ hai đồng hồ; nhãn Tags local đúng chức năng hơn |
| Basic | Notes, Assets, Side, Outcome, Type, Date range, Year, Month, Days, Hour | Tương tự nhưng chưa có Days; có Unknown outcome | Giữ Unknown. Days là bổ sung sau, chưa cần cho lượt sửa nhỏ |
| Type | Pending, Canceled, Open, Closed | Pending/Canceled bị khóa; Open/Closed dùng được | Giữ khóa khi read model chưa có pending/canceled; không làm bộ lọc giả |
| Tags | Include/Exclude, AND/OR | Đã có Include/Exclude và AND/OR | Không cần làm lại. Chưa kiểm đối chứng trên dữ liệu có tag |
| Filter đang áp dụng | Chip `Side : Short`, `Remove`, Clear All | Lọc Bán ra 4 dòng nhưng không có chip/trạng thái đang lọc ngoài drawer | Nên học theo FX |
| Sort | Entry Chart → request `sortBy=entryDate&sortDirection=ASC`; baseline createdAt DESC | Sort net PnL server-side, ưu tiên nhiều cột trong source; thiếu giá trị xếp sau | Giữ cơ chế local; không thay bằng sort riêng từng trang |
| Phân trang | 4 dòng, size 10, next/last khóa | 14 dòng → 10 + 4, không trùng định danh (session, trade); quay lại trang 1 được | Local khớp response. Chưa kiểm FX nhiều trang do thiếu dữ liệu |
| Chi tiết | Journal trade mở notes drawer, Details/Tag groups/Media, gross/commission/net | Inspector chỉ đọc với số liệu, nguồn, liên kết nhật ký/replay | Giữ inspector; nghiên cứu editor nhật ký thành scope riêng |

**Quan sát UI:** hai bảng đều rộng và cuộn ngang. Hai viewport khác nhau nên
không kết luận pixel parity hay nghiệm thu responsive từ các ảnh này.

## 2. Số học và hiển thị đã kiểm

| Chỉ số | FX: response + UI | Local: response + source | Kết luận |
| --- | --- | --- | --- |
| Return tiền | Closed 4,5 + 8 + 3,5 = **16 USD**; detail ghi Net P/L; phí mẫu = 0 | Mẫu −0,28 gross − 2 phí = **−2,28 USD**; toàn bộ 13 closed: net −6,68, fees 6 | Mẫu mỗi bên tự khớp; FX chưa có phí khác 0 để kiểm cách thu phí |
| Return (%) | `returnUsd / backtestingSessionAccountBalance × 100`, khớp cả 3 mẫu với capital 10.000 | `net_pnl / starting_balance của phiên nguồn × 100`; mẫu −2,28 / 100.000 × 100 = **−0,00228%**, UI **−0,0023%** | Local công bố vốn ban đầu. Mẫu FX không phân biệt được mọi cơ sở vốn có thể dùng |
| Làm tròn % | Response 0,034999999999999996%, UI 0,03%; 0,045% hiển thị 0,05% | Số nhỏ khác 0 dùng significant digits | Không copy hiện tượng làm tròn sát biên của FX; không biến lãi/lỗ nhỏ thành 0% |
| Return (R) | Cả 4 dòng null → N/A, SL null | R nguồn chưa biết → N/A. Native replay projection hiện chưa có frozen planned risk và realized R, kể cả vài dòng có SL hiện tại | Không suy risk ban đầu từ SL hiện tại; chưa có mẫu khác null để xác minh R |
| Lệnh mở | Return $, %, R null → N/A; Gross PnL/Fees lại hiện 0 | Return, gross, fees, R đều N/A; không coi floating hoặc chi phí chưa chốt là realized | Giữ local; không học số 0 của FX cho các cột chưa áp dụng |
| Zero/unknown | Mẫu FX không có closed hòa vốn | 10 closed net=0 hiển thị 0; giá/ngày thiếu `-`; không có mẫu số `N/A` | Giữ phân biệt ba trạng thái |

Phép tính giá FX `(exit − entry) × size` khớp ba lệnh LONG của đúng mã COCOA
trong mẫu. Không khái quát thành công thức PnL cho mọi sản phẩm/contract.
Local lấy frozen gross/fee từ closing fill, không tính lại chi phí bằng cách
cộng các thành phần đã làm tròn riêng.

## 3. Điểm cần làm rõ: thời gian lọc

**Đã xác minh local tại thời điểm audit, trước follow-up §6:** request trang gửi `time_basis=activity`. Closed dùng
`report_time_utc` (thời gian đóng thực tế); Open dùng thời gian vào thực tế qua
`table_time_utc`. Các cột Chart vẫn hiển thị đồng hồ thị trường tương ứng.

14 dòng hiện tại đều thiếu thời gian thực tế; chart time vẫn tồn tại. Response
trả `years=[]`, date range null/null; nút chọn năm bị khóa. Đây là hệ quả của
contract không backfill ngày thực tế bằng ngày thị trường, không phải không có
ngày trên chart. UI chưa nói bộ lọc đang dùng đồng hồ nào.

**Đề xuất:** thêm `Thời gian lọc: Chart / Realtime`, ưu tiên Chart trong Testing
Trades để lọc lịch sử replay. Đổi basis phải dùng projection/API tương ứng,
reset trang và dựng lại facets; không tự fallback theo từng dòng. Ghi rõ qua
(i): closed theo ngày thoát, open theo ngày vào, dùng múi giờ Settings. Khi
Realtime thiếu ngày, chỉ báo giới hạn đúng ngữ cảnh bộ lọc ngày.

API native đã phân nhánh market/activity trong source; chưa chạy đối chứng live
market-basis trong audit này. Đây là hạng mục triển khai + kiểm thử tiếp theo,
không phải chức năng đã nghiệm thu.

**Chưa rõ FX:** hai Entry Date khớp timestamp response và hiển thị UTC+7 trong
mẫu; chưa xác định cơ sở Year/Days/Date range. Click Year combo bị timeout nên
dừng mức nhẹ. Không đoán bộ lọc FX dùng entry hay exit chỉ từ tên.

## 4. Đề xuất cụ thể theo ưu tiên

| Ưu tiên | Trước → Sau | Lý do và kiểm tra cần có |
| --- | --- | --- |
| 1 | Lọc xong không hiện scope → chip cho từng nhóm filter, xóa riêng, Xóa tất cả | Nhìn thấy vì sao bảng ít dòng. Reuse filter model/URL; xóa chip reset page, giữ session scope và nhóm filter còn lại |
| 1 | Ngày/năm/giờ ngầm theo activity → selector Chart/Realtime như §3 | Lọc được lịch sử chart mà vẫn bảo toàn unknown thực tế. Test hai ngày khác nhau, open/closed, timezone, missing và reload |
| 1 | Return chỉ có nhãn → (i) nhỏ trên ba cột, VI–EN: net sau phí; % trên vốn ban đầu của từng phiên; R theo risk gốc nếu có | Giữ nhãn Lợi nhuận/Return theo contract hiện hành, không cần đổi tên mọi cột. Nêu cả đơn vị tiền khi scope nhiều phiên |
| 2 | Footer chỉ có page/size → thêm tổng số dòng đã lọc, chỉ khi total known | Có sẵn `filtered_count`; không dùng visible row count làm total, không hiện 0 khi nguồn chưa đọc đủ |
| Sau | Chưa có Days → thêm lọc thứ trong tuần nếu cần | Xác định rõ weekday và basis, OR trong nhóm/AND giữa nhóm; không thêm khi chưa có nhu cầu thực |

**Giữ:** layout bảng flat, column picker, sort/phân trang server-side, Tags,
inspector, hai đồng hồ, gross/fee/net, tỷ lệ nhỏ và N/A có nghĩa.

**Bỏ qua:** clone toàn bộ editor/media của FX, Trade Rating không có rating,
pending/canceled chưa có projection, gross/fees=0 cho Open, reverse backend để
tìm một công thức chưa phân biệt được bằng dữ liệu mẫu.

## 5. Bằng chứng, giới hạn và tiếp tục

- `audit.mjs` **PASS**: số học FX/local, unknown Open, closed/short/sell filters,
  sort, đủ hai trang local và identity không trùng; tolerance 1e−9.
- **14 test hiện có PASS** qua `tradesPage.test.mjs`,
  `tradeTableSemantics.test.mjs`, `ledgerFilters.test.mjs`. Đây là test contract
  và filter model; không thay cho kiểm backend hay mọi tương tác browser.
- Chưa kiểm FX có phí, loss/breakeven, partial close, risk gốc, nhiều currency,
  nhiều trang, tag thật hoặc time filter; không tuyên bố toàn bộ parity.
- Hai trang đã về URL/scope baseline, trang 1, size 10, không lọc; FX sort
  createdAt DESC, local không sort. Drawer/inspector đã đóng; Network capture
  hai tab đã tắt. Không đổi viewport, restart runtime, nhập/sửa notes, tags,
  tạo/xóa/đóng lệnh hoặc lưu cấu hình.
- Lưu `context.json`, `calculations.json`, raw responses/DOM/ảnh, `RESUME.md`,
  `audit.mjs` và `manifest.json` trên E. Khi tiếp tục, đọc tài liệu này rồi chọn
  lát triển khai được giao; không cần audit lại Dashboard/Sessions.

Source chính: `FxTradeLedger.jsx:44–62`, `FxAnalytics.jsx:24–35`,
`SessionReports.jsx:16–92`, `LedgerFilterDrawer.jsx:23–62`,
`api-rust/src/analytics/trades.rs`, `activity.rs`, `open_trades.rs` và
`api-rust/src/analytics.rs`. Manifest pin hash của đúng lần đọc.

## 6. Follow-up được duyệt và triển khai — 26/10/2026

Ba đề xuất ưu tiên 1 đã được triển khai và kiểm chứng trên bản UI5180:

- Chip cho từng nhóm filter, xóa riêng hoặc xóa tất cả. Session và ngôn ngữ được
  giữ lại; drawer chỉ áp dụng draft khi bấm Apply, cập nhật toàn bộ URL một lần.
- Chọn Chart/Realtime, mặc định Chart cho bảng Testing Trades gộp. Đổi clock
  reset trang/chi tiết, thay facets; không backfill ngày Realtime. Đã kiểm request
  `market`, facets có năm 2003/2024, lọc 05/05/2003 ra đúng một dòng; `activity`
  vẫn có 14 dòng khi không lọc ngày và `years=[]`. Reload giữ basis và scope.
- Ba cột Return có (i) VI–EN, giữ rõ net sau phí, % trên vốn ban đầu mỗi phiên
  và R theo risk gốc của nguồn. Không đổi phép tính tiền, phần trăm hoặc R.

QA cũng sửa hai vấn đề nhỏ: tên Realtime trong menu VI phải thống nhất với cột;
CSS phải tôn trọng `hidden`, tránh báo lỗi đọc cùng lúc với empty state giả.

**Bằng chứng:** 17 test model/contract PASS; 10 browser cases PASS ở candidate
và cùng 10 cases PASS ở deployed. Bốn viewport 320–1920, VI/EN, light/dark;
fixture được ghi nhãn riêng cho empty/unknown/partial/denied/error/stale.
Review source + ảnh độc lập PASS. Không có page errors hoặc request ghi dữ liệu.

Receipt: [Trades refinement](../../../foundation_v2/evidence/trades-refinement-20261026/RECEIPT.md).
Raw, build snapshot, ảnh và rollback:
`E:/BACKUP-TRADINGWORKSPACE/trades-refinement-20261026/`.

Tổng số dòng ở footer và lọc thứ trong tuần chưa thuộc lát triển khai này.
Giới hạn về FX trong §5 vẫn giữ nguyên; không suy ra parity backend từ QA local.
