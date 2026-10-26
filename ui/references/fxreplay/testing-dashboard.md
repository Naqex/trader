# Testing → Dashboard: FX Replay và WMREPLAY

Ngày kiểm tra: **26/10/2026**, Asia/Ho_Chi_Minh. Đây là lượt đối chiếu đầu tiên
của trang Tổng quan; chưa triển khai thay đổi từ các đề xuất bên dưới.

## 1. Môi trường và cách kiểm chứng

| | FX Replay | WMREPLAY |
| --- | --- | --- |
| Runtime | Web đã đăng nhập, Free, `2.0.3777-prod` | UI `127.0.0.1:5180`, API `127.0.0.1:8010`, native Rust |
| Trang | `/en-US/auth/testing/dashboard` | `area=testing&section=dashboard&view=overview` |
| Baseline | Backtesting · Lifetime | Backtest · Tất cả · dữ liệu thật · tenant-a |
| Source baseline | Không có backend source | `f37f474f6c0299a94ec18b2782eda597f18eecc5` cùng source hiện tại của các module được dẫn |
| Viewport DOM khi chụp | 2292 × 1080 | 1920 × 940 |

Dùng Playwright qua browser đang đăng nhập để đọc DOM, kiểm tra bộ lọc và lưu
ảnh; đọc source và GET API local để xác minh bên mình. Không trích cookie,
không tạo/xóa/sửa phiên và không thay runtime. Ảnh FX có vùng đen dư bên phải/
dưới do bề mặt capture; không dùng để kết luận sai lệch pixel hoặc responsive.
Đã trả FX về Backtesting · Lifetime và xóa viewport override tạm thời.

## 2. Baseline nhìn thấy

| Thành phần | FX Replay | WMREPLAY | Kết luận hiện tại |
| --- | --- | --- | --- |
| Thứ tự | 3 lối bắt đầu → Performance → Recent Sessions | 3 lối bắt đầu → Phiên gần đây → Hiệu suất | Khác ưu tiên đọc trang; chưa có lý do tự đảo thứ tự hiện tại |
| Time invested | 16 giờ 3 phút | 2 giờ 2 phút | Cùng ý nghĩa tổng quát là thời gian thực; cách đo idle/đa tab của FX chưa rõ |
| Historical replayed | 4 tháng 10 ngày 13 giờ | 2 ngày 4 giờ 8 phút | Cùng phân biệt thời gian thị trường với thời gian thực; cách tính chi tiết chưa chứng minh tương đương |
| Trades taken | 76; Buy 52,63%, Sell 47,37% | 1; Buy 0%, Sell 100% | Mình đếm các fill đóng; không mặc định FX dùng cùng đơn vị |
| Overall win rate | 50% | 0% | Mình xác minh được công thức; FX chưa rõ mẫu số |
| Biểu đồ | Thời gian theo tháng, win rate theo tháng, số lệnh theo mã | Cùng ba nhóm | Cấu trúc thông tin tương ứng |
| Recent Sessions | 1 trong 2; có cảnh báo phiên cũ bị ẩn sau 1 tuần | 3 trong 3; gồm Backtest và Prop | Danh sách phiên và Performance có scope riêng; 76 lệnh và 1 phiên hiện không chứng minh lỗi |
| Badge cạnh tên phiên | `5 days`; DOM class `retention-tag` | Ngày thị trường còn lại, lặp với dòng “Còn lại” | Không nên coi hai badge là cùng nghĩa |
| Trợ giúp | Có mini (i) ở metric/chart | Tooltip trên nhãn metric, chưa có nút (i); overall win rate chưa có giải thích công thức ở component này | Nên bổ sung điểm mở trợ giúp rõ, dùng được bằng bàn phím |

**Không dùng chênh lệch số làm lỗi:** hai tài khoản đang có dữ liệu khác nhau.

## 3. Hành vi bộ lọc FX đã quan sát

Các giá trị dưới đây được đọc lại sau khi response đã cập nhật; snapshot ngay
sau click có thể còn giữ số kỳ cũ, nên không dùng snapshot chuyển tiếp làm oracle.

| Kỳ FX | Time invested | Historical replayed | Trades taken | Overall win rate |
| --- | --- | --- | --- | --- |
| Lifetime | 16 giờ 3 phút | 4 tháng 10 ngày 13 giờ | 76 | 50% |
| Last week | 29 phút | 1 tháng 6 ngày 17 giờ | 19 | 75% |
| Last month | 11 giờ 15 phút | 3 tháng 2 ngày 18 giờ | 59 | 80% |

Source menu FX có Backtesting, Battles, Prop Firm, All; chỉ đọc lựa chọn,
chưa kiểm chứng dữ liệu từng source. Chưa thấy ngày bắt đầu/kết thúc cụ thể của
Last week/Last month nên chưa xác nhận rolling window hay kỳ lịch hoàn chỉnh.

**Điểm cần giữ mở:** 19 lệnh và win rate 75% không khớp phép chia một số nguyên
lệnh thắng cho 19, nếu đây là cùng mẫu số và làm tròn thông thường. Vì vậy chưa
thể khẳng định `Trades taken = số lệnh đóng` hoặc `win rate = wins / Trades taken`
của FX. Có thể khác tập lệnh hoặc cách aggregate; chưa xác định nguyên nhân.

## 4. Logic WMREPLAY đã xác minh

Luồng hiện tại:

`Dashboard filters → GET /api/v2/overview → Rust analytics → performance → metric/chart`.

### Số lệnh, hướng lệnh và tỷ lệ thắng

- Chọn nguồn Backtest/Prop/All bằng danh tính phiên. Overview có thể tổng hợp
  phiên archived; Recent Sessions có bộ lọc hiển thị riêng.
- Aggregate các **closed fill**; gộp lịch sử thừa kế trong cùng root lineage
  để tránh đếm trùng khi fork. Chưa kiểm chứng FX xử lý fork hoặc partial close
  giống cách này.
- `wins = count(net_pnl > 0)`, `losses = count(net_pnl < 0)`;
  `breakeven = total - wins - losses`.
- `win_rate_pct = wins / total_closed_fills × 100`; hòa vốn vẫn nằm trong mẫu số.
  Không có lệnh thì tỷ lệ là `null`, không tự coi là 0%.
- Buy/Sell lấy cùng tập closed fill; UI chỉ vẽ split khi tổng hai hướng khớp total.

Nguồn: [analytics.rs](../../../foundation_v2/api-rust/src/analytics.rs), các hàm
`counts`, `trade_origin`, `dashboard_performance`;
[routes.rs](../../../foundation_v2/api-rust/src/analytics/routes.rs),
`dashboard_source_ids`; [DashboardPerformance.jsx](../../../foundation_v2/web/src/DashboardPerformance.jsx).

### Thời gian và kỳ thống kê

- Dashboard dùng **activity time**: ngày thao tác thực tế, không phải ngày nến
  lịch sử. Chi tiết analytics của phiên có luồng market time riêng.
- Time invested cộng hợp các khoảng wall clock đã ghi nhận, lấy union để không
  cộng hai lần các khoảng trùng nhau giữa phiên được chọn; chia tháng theo múi giờ.
- Historical replayed cộng các timestamp delta của bước tiến thành công.
  Counter hiện tại là tổng toàn phiên, **chưa có breakdown theo ngày thao tác**.
- Bộ lọc kỳ áp dụng cho thời gian luyện tập và closed fill có timestamp thực.
  **Không áp dụng cho historical counter** (`historical_date_filters_apply=false`).
- Last week của mình là Mon–Sun tuần trước; Last month là tháng lịch trước.
  Chưa chứng minh hai nhãn này có cùng ranh giới với FX.
- Mình hiển thị ngày/giờ/phút, không đổi ngày thành tháng khi chưa có quy ước
  tháng rõ ràng. Quy ước tháng của FX chưa xác minh.

Runtime GET đã đối chiếu: Lifetime = `7351.419` giây luyện tập và `187680` giây
lịch sử; kỳ 19–25/10/2026 = `740.141` giây luyện tập, nhưng lịch sử vẫn `187680`.
FX đổi kỳ thì cả hai giá trị thay đổi. Đây là **khác biệt hành vi đã xác minh**;
muốn học theo cần lưu delta replay kèm thời điểm thao tác, không chỉ đổi text.

Nguồn: [dashboardModel.js](../../../foundation_v2/web/src/dashboardModel.js),
`dashboardRequestUrl`, `dashboardPeriodRange`, `dashboardDurationParts`;
[analytics.rs](../../../foundation_v2/api-rust/src/analytics.rs), `dashboard_timing`;
[presentation.rs](../../../foundation_v2/api-rust/src/analytics/presentation.rs),
`activity_months`, `dashboard_activity`.

### Vì sao tổng win rate 0% nhưng biểu đồ trống?

Response thật: `closed_trade_count=1`, `losses=1`, `win_rate_pct=0`, `months=[]`,
`recording_coverage.unknown_close_count=1`. Lệnh cũ không có timestamp đóng theo
activity time; all-time vẫn biết kết quả nhưng không biết xếp vào tháng nào.

Đây **không phải lỗi bỏ số 0**: `MonthlyChart` nhận giá trị `>= 0`, domain tỷ lệ
chấp nhận 0–100. Không lấy ngày nến năm 2003 hoặc ngày hôm nay để lấp dữ liệu.
Khi áp kỳ ngày, lệnh thiếu timestamp không được tự gán vào kỳ đó.

Nguồn: [activity.rs](../../../foundation_v2/api-rust/src/analytics/activity.rs),
`view` và test `legacy_missing_close_keeps_alltime_money_but_never_invents_date_or_equity_history`;
[reportChartModel.js](../../../foundation_v2/web/src/reportChartModel.js).
Test này được **đọc**, chưa chạy lại trong lượt audit chỉ đọc này.

### Recent Sessions

Mình dùng ngày còn lại hai lần: badge cạnh tên và dòng dưới progress.
Date range là **toàn dataset**, progress là `(cursor_index + 1) / row_count`.
FX hiển thị `5 days` tách biệt với `Remaining days: 2812`; class `retention-tag`
và cảnh báo Free gợi ý badge là thời gian giữ phiên. Đây là **suy luận**, chưa
đọc được tooltip xác nhận. Không đổi badge của mình thành retention/streak giả.

Nguồn: [DashboardSessionCard.jsx](../../../foundation_v2/web/src/DashboardSessionCard.jsx),
[DashboardSessions.jsx](../../../foundation_v2/web/src/DashboardSessions.jsx).

## 5. Đề xuất cho trang này, chưa triển khai

| Hành động | Đề xuất | Lý do |
| --- | --- | --- |
| Giữ | 4 metric và 3 biểu đồ tương ứng | Đủ đọc thời gian luyện, khối lượng và kết quả; chưa cần thêm KPI |
| Học theo | Mini (i) truy cập được cho metric/chart | Giúp hiểu công thức và scope ngay tại chỗ; reuse tooltip hiện có |
| Điều chỉnh | Nhãn số lệnh phản ánh rõ closed fills, giải thích partial close/hòa vốn trong (i) | Không ngầm đánh đồng với FX Trades taken |
| Điều chỉnh | Empty state của chart khi thiếu activity timestamp | Phân biệt chưa có lệnh với có kết quả nhưng thiếu ngày; không dựng lịch sử |
| Điều chỉnh tiếp theo | Historical replayed theo kỳ, sau khi có recording đủ | Làm scope của bộ lọc thống nhất; hiện tại cần giải thích scope trong trợ giúp |
| Lược bỏ | Badge ngày còn lại lặp cạnh tên phiên | Đã có thông tin ở progress; không có cơ chế retention tương ứng |
| Giữ khác FX | Recent Sessions đứng trước Performance | Thuận tiện tiếp tục công việc; không tự đảo chỉ để giống mẫu |
| Không copy | Upsell/retention Free, Battles chưa có consumer, scrollbar ngang thường trực khi ít cột | Không phục vụ nhu cầu hiện tại |
| Giữ đơn giản | Màu chart hiện có, không bắt buộc gradient | Gradient không làm công thức hoặc khả năng đọc đúng hơn |

**Bước kế tiếp đề nghị:** chốt định nghĩa và trợ giúp của bốn metric Performance
trước khi sửa hình thức. Chứng minh parity số học cần cùng fixture có thắng,
thua, hòa vốn, partial close và mốc activity; chưa đạt trong lượt này.

## 6. Bằng chứng và giới hạn

Raw evidence:
`E:/BACKUP-TRADINGWORKSPACE/fxreplay-reference-20261026/testing-dashboard/`.
Danh sách/hashes: [manifest](testing-dashboard-evidence.json).

- `fxreplay-top.jpg`, `fxreplay-performance.jpg`: bố cục FX.
- `fxreplay-lifetime.txt`, `fxreplay-last-week.txt`, `fxreplay-last-month.txt`:
  snapshot sau cập nhật các kỳ.
- `fxreplay-tooltips.json`: bốn tooltip được frontend khai báo trong DOM.
- `wmreplay-top.jpg`, `wmreplay-performance.jpg`, `wmreplay-lifetime.txt`:
  bố cục/trạng thái thật bên mình.
- `wmreplay-overview.json`, `wmreplay-last-week.json`: response local dùng để
  đối chiếu coverage, tháng và phạm vi thời gian.

Đã kiểm tra runtime read-only và source liên quan; chưa chạy fixture parity,
chưa kiểm idle/multi-tab/rewind của FX, cách tính phí/hòa vốn/partial close của
FX hoặc công thức tiến độ phiên FX. Không đánh dấu product acceptance hoặc sửa
ledger từ kết quả này. Không triển khai hoặc restart dịch vụ.
