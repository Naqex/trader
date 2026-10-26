# Testing Dashboard — kiểm tra nhẹ ba biểu đồ

Ngày: **26/10/2026**, timezone **Asia/Ho_Chi_Minh**. WMREPLAY HEAD
`e1be2190c663ab1cbd9d78e0661553179fa4ccb9`. FX dùng tab web đã đăng nhập, source
Backtesting, Free; không kiểm tra lại version trong lượt này. Version ghi ở
[baseline trước](testing-dashboard.md) chỉ là thông tin của lượt trước.

Thực hiện theo [workflow dùng lại](verification-workflow.md). Lượt này chỉ audit
và lưu reference, không sửa công thức/UI hoặc restart dịch vụ.

## 1. Bằng chứng đã lấy

- Playwright/DOM của tab hiện tại; hover thật 8 điểm Lifetime, đọc ba (i).
- Quan sát ba response UI của `/analytics/api/v1/analytics/calc/global`, query
  `timezone=Asia/Ho_Chi_Minh`, `projectTypes[]=app`, `analyticsRange` lần lượt
  `lastWeek`, `lastMonth`, `lifetime`. Chỉ giữ JSON nghiệp vụ, không lưu headers/cookie.
- Đối chiếu **mọi cột** của ba biểu đồ với response trong mỗi kỳ bằng script offline:
  giá trị SVG đều khớp. Đây là xác minh mapping response → biểu đồ, không phải
  xác minh công thức backend FX.
- Đọc bốn dòng Trades có thể truy cập và Summary của phiên `test2`, sau đó trả
  FX về Dashboard → Backtesting → Lifetime; Network debug đã tắt.
- GET API WMREPLAY ở Lifetime/tuần lịch trước/tháng lịch trước, đọc source component
  và bộ lọc; không dùng hai bộ dữ liệu khác nhau làm oracle số tuyệt đối.

## 2. Các số đã quan sát trực tiếp

| Scope FX | Cột thời gian / win rate | Tổng thời gian API | Tổng cột thời gian | Lệnh theo mã = ô total |
| --- | --- | ---: | ---: | ---: |
| Lifetime | Theo tháng; 09 và 10/2026 | 57.825 giây | 57.816 giây | 55 + 15 + 2 + 4 = **76** |
| Last week | Theo ngày; 19–26/10, 8 bucket | 1.743 giây | 8.604 giây | 15 + 4 = **19** |
| Last month | Theo ngày; 26/9–26/10, 31 bucket | 40.500 giây | 40.428 giây | 55 + 4 = **59** |

Lifetime, dữ liệu thô của các cột:

- Time Invested: **7,43 giờ** tháng 9, **8,63 giờ** tháng 10. Tooltip tương ứng
  hiển thị **7,4** và **8,6** giờ; trục dọc dùng giờ, trục ngang dùng tháng.
- Win Rate: **41,18%** và **80%**. Tooltip là **41,2%** và **80%**; trục 0–100%.
- Trades by symbol: EURNZD **55**, OANDA:EURAUD **15**, OANDA:EURUSD **2**,
  PEPPERSTONE:COCOA **4**. Thanh ngang, trục số nguyên, không phải phần trăm.

Ngày đầu/cuối trên là timestamp bucket sau chuyển timezone, không tự chứng minh
cutoff giờ chính xác của bộ lọc. Ví dụ Last week có cả hai ngày biên; không gọi
đó là tám ngày đầy đủ hoặc kết luận server dùng đúng cửa sổ nào.

## 3. Kết luận chắc và phần chưa rõ

**Mapping hiển thị khớp response.** Ba kỳ đều có tổng allocation theo mã bằng
`tradesTaken.total`. Lifetime lệch tổng giờ 9 giây, Last month lệch 72 giây; hai
chênh lệch nhỏ này phù hợp với khả năng làm tròn các cột hai số lẻ.

**Last week có khác biệt scope/tổng cần giữ mở.** Tổng cột là 2 giờ 23 phút
24 giây, trong khi `timeInvested` là 29 phút 3 giây: lệch **6.861 giây**.
Ngay cả giả sử sai số tới 0,01 giờ mỗi cột (288 giây cho 8 cột), vẫn không giải
thích được. Nếu bỏ bucket đầu 19/10 (1,9 giờ), phần còn lại chỉ lệch 21 giây.
Đây là gợi ý về ranh giới kỳ/ngày, **chưa phải nguyên nhân đã xác minh** và
không đủ để gọi backend FX tính sai. Chênh lệch nằm ngay trong response ổn định,
không do mình đọc frame trước khi tải xong.

**Chưa chứng minh công thức win rate của FX.** Payload có `averageWinRate` theo
kỳ và `overallWinRate`, không có tử/mẫu từng bucket. Lifetime có hai cột 41,18%
và 80%, nhưng số tổng là 50%; trung bình đơn giản 60,59% không phải phép tổng hợp
đang hiển thị. Các ngày không có kết quả dương cũng được response trả 0, nhưng
không có số lệnh mỗi ngày để phân biệt không giao dịch với thực sự thắng 0%.
Không suy công thức từ tên field `averageWinRate`.

**Mẫu Trades không đủ cho toàn Dashboard.** Chỉ xem được bốn dòng COCOA:
ba Closed có PnL dương 3,5 + 8 + 4,5 = 16 và một Open có Return N/A. Summary
của phiên đó hiển thị Win Rate 100%. Allocation COCOA của Dashboard là 4, nhưng
còn lịch sử/phiên bị Free retention ẩn, nên chưa lấy sự trùng số này làm bằng
chứng rằng global chart luôn đếm open. Đặc biệt không chia ba lệnh thắng đang
thấy cho global total 19 rồi kết luận 75% sai: đó là hai scope khác nhau.

**Copy trợ giúp FX có chỗ quá chung.** (i) của chart thời gian/win rate mô tả theo
ngày và toàn lịch sử, trong khi Lifetime thực tế là tháng, các kỳ ngắn có scope
khác. Bên mình nên diễn giải đúng kỳ/đơn vị đang xem, không copy nguyên văn.

**WMREPLAY đã đối chiếu số học tại runtime:** cả ba kỳ đều có tổng
`activity_months` khớp `time_invested_seconds`, và tổng số lệnh theo mã khớp số
closed fill. Lifetime có một closed fill thiếu ngày activity nên không có điểm
win rate theo tháng; giới hạn này được hiển thị rõ, không tự gán ngày.

## 4. Khác WMREPLAY và đề xuất cụ thể

| Phần | Bên mình hiện tại | Đề xuất |
| --- | --- | --- |
| Độ chi tiết | Hai chart thời gian/win rate luôn theo tháng, kể cả kỳ ngắn | **Nên học theo:** kỳ ngắn có projection theo ngày, kỳ dài theo tháng; cần backend dữ liệu ngày, không bịa breakdown từ tháng |
| Tooltip tỷ lệ | Dashboard làm tròn phần trăm về số nguyên | **Nên điều chỉnh:** tooltip giữ ít nhất 1 số lẻ; axis vẫn có thể dùng số nguyên |
| Tooltip thời gian | Giờ/phút rõ nghĩa; axis giờ | **Giữ:** dễ đọc hơn số giờ thập phân bị làm tròn quá sớm |
| Theo mã | Thanh ngang, đếm closed fill trong scope, có nhãn rõ | **Giữ:** layout phù hợp; chưa đổi sang định nghĩa Trades taken chưa xác minh |
| Ranh giới kỳ | Tuần trước Mon–Sun; tháng lịch trước | **Cần làm rõ khi muốn giống FX:** phạm vi cột FX Last month ở lượt này kéo từ 26/9 đến 26/10, khác tháng lịch 1–30/9. Chưa đổi semantics chỉ dựa trên tên Last month |
| Tổng và bucket | Cùng scope hoạt động; giờ cộng từ union intervals; win rate có mẫu số closed fills sau phí | **Giữ tính nhất quán:** không copy chênh lệch tổng giờ ở Last week hoặc trung bình tỷ lệ chưa biết trọng số |

Các đề xuất trên **chưa triển khai trong lượt audit này**. Không có bằng chứng
buộc thay công thức tài chính của WMREPLAY. Lượt sửa tiếp hợp lý nhất là độ chi
tiết theo ngày/tháng cùng độ chính xác tooltip; ranh giới kỳ cần được ghi rõ.

### Lượt triển khai tiếp — 26/10/2026

Owner giao tiếp tục sau audit. Đã bổ sung projection theo **ngày thực tế** khi
khoảng lọc có đủ hai đầu và tối đa 31 ngày lịch trong timezone Settings; Lifetime,
khoảng dài hơn hoặc thiếu một đầu dùng tháng. `activity_days` nhóm các khoảng
thực đo sau clipping/union; `days` nhóm đúng closed fills đã lọc và loại trùng
lịch sử nhánh. Không chia tổng tháng thành ngày giả, không điền 0% cho ngày vắng
giao dịch. Các trường tháng cũ giữ nguyên để tương thích.

Tooltip win rate hiển thị một chữ số thập phân, trục vẫn 0–100%. Copy trợ giúp
VI/EN phản ánh ngày/tháng đang xem. Bộ lọc kỳ vẫn là tuần/tháng lịch trước;
không đổi sang cửa sổ trượt chưa được xác minh của FX.

QA custom range còn phát hiện selector nhãn `label > span` bắt nhầm wrapper
`ProjectDateInput`, làm ô ngày bị absolute và tràn ngang. Đã giới hạn selector
vào span nhãn; phạm vi sửa chỉ ở Dashboard.

Receipt và bằng chứng triển khai:
[Dashboard chart granularity](../../../foundation_v2/evidence/dashboard-charts-20261026/RECEIPT.md).

## 5. Điểm dừng và dữ liệu lưu

Theo ý owner, dừng ở mức nhẹ. Không thử tạo giao dịch FX, trả phí để mở lịch sử,
reverse backend, hay kiểm idle/đa tab/rewind/partial close/hòa vốn/fork của FX.

Raw evidence local:
`E:/BACKUP-TRADINGWORKSPACE/fxreplay-reference-20261026/testing-dashboard-charts/`.
Có response, DOM, tooltip, ảnh, script `analyze.py` và `calculations.json` chạy lại
được. [Manifest hash](testing-dashboard-charts-evidence.json) dẫn tới các artifact.
