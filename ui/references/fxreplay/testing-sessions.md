# Testing Sessions — đối chiếu ngày 26/10/2026

**Kết luận:** cấu trúc trang đã gần FX. Khác biệt cần quyết định nằm ở nghĩa của
chỉ số ngày/tuần/tháng, định nghĩa Risk/Reward và nhãn số dư trong settings.
Lượt này research và lưu reference; chưa triển khai các đề xuất dưới đây.

## Baseline và cách kiểm

- FX Replay web **2.0.3805-prod**, Free, một phiên selectable. Tab đã đăng nhập;
  Testing → Sessions. Giới hạn retention/account không cho đại diện toàn bộ lịch sử.
- WMREPLAY HEAD `8ce890b8b6a644f36a21f4b18458bec27f6cab0c`, runtime UI5180;
  phiên thật, không demo; timezone Asia/Ho_Chi_Minh, metadata revision 92.
- Hai bên khác dữ liệu. So ý nghĩa, công thức và mapping trong từng bên;
  không so số tuyệt đối để kết luận parity.
- Theo [verification-workflow.md](verification-workflow.md): đọc UI, sáu (i),
  SVG ba chart, response do FX UI phát sinh, source WMREPLAY và GET runtime local.
  Đã thử selector/search rỗng; mở settings đọc các tab, không Save/tạo/xóa/giao dịch.
- Raw JSON, DOM và ảnh tài khoản chỉ lưu local:
  `E:/BACKUP-TRADINGWORKSPACE/fxreplay-reference-20261026/testing-sessions/`.
  `audit.mjs` tính lại offline; `calculations.json` giữ kết quả;
  [manifest](testing-sessions-evidence.json) pin hash để tìm lại.

## 1. Giống nhau về luồng sử dụng

Sessions là **chi tiết phiên đang chọn**, không phải bảng toàn bộ phiên thứ hai.
Hai bên có selector tìm kiếm, tạo phiên, Analytics, Settings, xóa, summary,
description, ba chart, sáu chỉ số, Recent Trades và Journal/phân trang.
Giữ cấu trúc này. Local selector có Backtest/Prop, mã và timeframe; session metadata
và analytics được đọc theo workspace + session + revision, hủy request khi đổi scope.

## 2. Chỉ số và số học đã kiểm

| Thành phần | FX: UI + response | WMREPLAY: source + runtime | Kết luận |
| --- | --- | --- | --- |
| Total PnL | 16 USD; ba closed PnL 4,5 + 8 + 3,5; phí 0 | −0,28 gross − 2 phí = **−2,28 USD** | Khớp trong mỗi tập; chưa chứng minh cách FX xử lý phí từ mẫu phí bằng 0 |
| Win rate | 100%; 3/3 lệnh đóng dương, một open không vào mẫu số quan sát | 0%; 0/1 closed; contract wins / toàn bộ closed, hòa vốn vẫn trong mẫu số | Khớp mẫu; FX chưa có hòa vốn/partial để suy tổng quát |
| Risk/Reward | (i) nói average risk reward ratio; response averageRR=0, UI 0.00; tất cả initialSL=null | Đang hiển thị **payoff ratio**: mean(net winners) / abs(mean(net losers)); null → `-` | Hai khái niệm khác nhau. Không suy công thức FX từ tên hoặc biến unknown thành 0 |
| Month Gain/Loss | 16; (i) nói **average** profit/loss | Tổng tháng chứa ngày đóng gần nhất | Khác định nghĩa |
| Week Gain/Loss | 8; (i) nói **average** profit/loss | Tổng tuần T2–CN chứa ngày đóng gần nhất | Khác định nghĩa |
| Daily Gain/Loss | 8; (i) nói **average** profit/loss | Tổng ngày đóng gần nhất | Khác định nghĩa |

Closed FX theo ngày local: **06/02/2019 = 12,5**, **11/02/2019 = 3,5**.
Một tháng, hai tuần và hai ngày có closed trades cho kết quả trung bình lần lượt
**16 / 1 = 16; 16 / 2 = 8; 16 / 2 = 8**: khớp ba field response.
Đây là bằng chứng ủng hộ trung bình trên kỳ có giao dịch, **chưa chứng minh**
mẫu số FX có bỏ mọi kỳ trống hay cách xác định tuần nói chung.
Không gọi số 8 là lỗi do khác ngày replay khi (i) đã nói trung bình.

Local `sessionPeriods(..., 'market')` neo ở **giao dịch đóng gần nhất**, không phải
hôm nay hoặc replay cursor. Mẫu này đóng ngày 05/05/2003 nhưng cursor đã tới
07/05/2003; ba ô vẫn −2,28. Tooltip hiện có ghi ngày neo nhưng thiếu nút (i)
rõ ràng và tương tác bàn phím. Đây là hành vi đã xác minh, chưa đổi trong audit.

## 3. Ba biểu đồ

| Chart | FX quan sát | Bên mình | Quyết định đề xuất |
| --- | --- | --- | --- |
| Equity | Response currentBalance 10004,5 → 10012,5 → 10016; điểm cuối open PnL=0, balance 10016 | Vẽ `equity_curve.points[].equity`; runtime có equity khác balance lúc đang mở, value_basis=account_equity_including_floating_pnl | Giữ equity thật; không thay bằng cumulative closed PnL |
| Monthly Performance | Thanh ngang Feb: profit16, loss0; SVG val16 khớp response | Lãi/lỗ tách phía 0, trung bình tổng tháng cùng tên qua các năm có giao dịch | Giữ công thức và tên trung bình; chưa đủ mẫu FX đa năm để đổi |
| Daily Performance | Monday3,5; Wednesday12,5; SVG khớp response; chỉ xuất hiện ngày có dữ liệu | Tổng PnL theo thứ / số ngày local có closed trades của thứ đó; thứ chưa có mẫu là unknown | Giữ và làm rõ mẫu số; không đổi ngày chưa có mẫu thành thắng/thua 0 |

SVG ba cột số **16; 3,5; 12,5** khớp response và phép cộng closed trades.
Mẫu FX chỉ có một ngày cho mỗi thứ và một tháng lịch, nên tổng và trung bình
cho cùng kết quả: **chưa chứng minh aggregation tổng quát của FX**.
Lượt rê chuột mẫu không lấy được tooltip chart hữu ích; lưu SVG thay vì bịa
giá trị tooltip. Local chart đã có nội dung truy cập nêu đơn vị và mẫu số.

## 4. Settings, số dư và giao dịch gần đây

- **Số dư:** FX summary/current selector = 10.016, settings Account Balance =
  10.000 (ban đầu). Local summary và settings đều = 99.997,72 (hiện tại), trong
  khi persisted starting balance = 100.000. Source đã có `startingBalance` nhưng
  drawer chưa hiện riêng. Cần phân biệt hai nhãn để tránh hiểu nhầm.
- **Phí:** FX có spreads/commissions và slippage; copy slippage nói áp dụng fills
  từ lúc đổi, không sửa lệnh cũ. Local costs chỉ đọc, đóng băng theo phiên;
  commission 1 USD mỗi chiều, tổng phí mẫu 2 USD. Giữ tính tái lập;
  chưa có nhu cầu copy tùy chọn thay đổi chi phí giữa phiên.
- **Ngày:** FX initial/end disabled, auto-update end on và smooth candles off.
  Local snapshot dataset cố định, có replay position; không auto-extend/smoothing.
  Giữ đúng mô hình local. Date labels `Dataset start/end`, `Replay position`
  trong giao diện VI cần dịch cho nhất quán nếu sửa copy.
- **Recent Trades:** FX có cả open row hiển thị $0.00, không có cột status;
  column ROI lại hiển thị số tiền. Local closed-only, Ngày đóng lệnh và PnL ròng
  có đơn vị. Giữ local; không copy cách gọi ROI cho money hoặc open như realized.
- **Range:** FX đang hiện end trước start ở selector/summary (2026 → 2019),
  settings timestamps vẫn chronological. Local đã theo start → end; không copy.
- Strategy/chart layout của FX có picker, local readonly. Không giả vờ có chức
  năng gắn strategy/layout khi local chưa có contract và luồng tương ứng.

## 5. Đề xuất cụ thể để triển khai ở lượt sau

| Ưu tiên | Trước → Sau | Lý do |
| --- | --- | --- |
| 1 | Ba ô tổng kỳ chứa lần đóng gần nhất → **PnL TB/ngày, TB/tuần, TB/tháng** trên kỳ có closed trades; EN `Avg. daily/weekly/monthly P&L` | Theo ý nghĩa (i) FX, bổ sung góc nhìn khác Total PnL; contract của mình phải công bố mẫu số, không tuyên bố công thức FX đã chứng minh |
| 1 | Nhãn có data-tooltip → (i) nhỏ truy cập được bằng chuột/bàn phím, VI–EN cho sáu chỉ số | Giải thích net sau phí, closed-only, hòa vốn, payoff và mẫu số kỳ; chỉ thêm giúp hiểu công thức |
| 1 | Một Account Balance trong settings → **Số dư ban đầu / Số dư hiện tại** (`Initial balance / Current balance`) | Lấy đúng persisted initial và portfolio current; summary vẫn current |
| 2 | Chart tháng/ngày giữ công thức hiện tại → bổ sung (i) định nghĩa trung bình trên kỳ có giao dịch; dịch ba nhãn ngày settings | Không đổi aggregation từ một mẫu không phân biệt tổng/trung bình |
| Giữ | Payoff ratio, unknown `-`, equity thật, Recent Trades closed-only + Net PnL, snapshot/costs cố định | Đúng ý nghĩa dữ liệu local, tránh sao chép điểm mơ hồ của FX |
| Bỏ qua | ROI tiền, RR0 thiếu risk, ngày đảo, auto-extend/smoothing/đổi phí không có model local | Không mang lại độ đúng hoặc tính tái lập |

Nếu sau này cần tổng kỳ hiện tại theo replay cursor, đó là chỉ số riêng cần xác
định rõ anchor, không lẫn với trung bình toàn phiên. Đề xuất chưa phải quyền sửa.

## 6. Giới hạn, kết quả và tiếp tục

- `audit.mjs` **PASS**: cộng closed PnL, balance, win rate, buckets, SVG bars,
  cumulative balance, ứng viên trung bình FX; gross−fees, balance và period model local.
  Có tolerance 1e−9 cho phép tính float; không làm tròn để che sai khác.
- Không kiểm FX với phí khác 0, hòa vốn, partial close, floating khác 0 hoặc
  nhiều năm/ngày trùng thứ. Không audit backend độc quyền hoặc mở page khác.
- Đã đóng settings/popover, tắt Network capture. FX trở lại Dashboard baseline;
  WMREPLAY giữ Sessions/phiên ban đầu; không đổi viewport hoặc restart runtime.
  Khi trở lại Dashboard, FX hiện thông báo update; đã chọn Later. Dashboard sau
  navigation ghi **2.0.3811-prod**. Bằng chứng Sessions phía trên thuộc 2.0.3805;
  chưa kiểm lại Sessions trên bản mới, không trộn hai version thành cùng snapshot.
- Tiếp tục: đọc tài liệu này + `calculations.json`; nếu triển khai chỉ sửa các
  mục được giao và kiểm fixture phân biệt active-day average với per-trade average,
  hai tuần, tháng qua nhiều năm, empty/unknown, timezone và VI–EN.
