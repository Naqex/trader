# Analytics: phân biệt tổng, số lượng, tỷ lệ và trung bình

27/10/2026. Lượt sửa theo chú thích owner về Average trade frequency.
Thay thế định nghĩa frequency gồm kỳ trống trong các reference trước đó.

## Bằng chứng FX và giới hạn

- Đọc tab demo đang mở, không refresh/navigate: ngày Avg 1.25, tuần 2.5,
  tháng 5. Trục ngày Mo/Tu/We/Su; tuần 24/25; tháng Jn.
- Tải source công khai độc lập, không dùng cookie/token và không gọi analytics
  calculation API. Các asset lịch sử đã trả 404; script lấy entry HTML mới để
  tìm route/import hiện tại, không reload tab có demo của owner.
- [Client chart](https://app.fxreplay.com/en-US/chunk-ZI3BTXB2.js) dùng
  `monthWeekDayAverageTrades`, lấy cột từ `averageTradesPerInterval` và số tiêu đề
  từ `totalAverageTrades`. Formatter dùng ISO weekday, số tuần và tên tháng.
- [Demo/service source](https://app.fxreplay.com/en-US/chunk-DCSYQC3C.js) có
  weekday values 1:2, 2:1, 3:1, 7:1; tuần 24:4, 25:1; tháng 6:5.
  Client nhận số tổng hợp; không chứng minh được mẫu số backend production,
  nhất là các kỳ lặp qua nhiều năm. Có demo constant khác không nhất quán,
  nên không suy công thức backend chỉ từ tên field/demo.

Local chọn định nghĩa active-period rõ ràng dưới đây, kiểm bằng oracle riêng.
Đây là lựa chọn có giải thích và phù hợp mẫu quan sát, không tuyên bố parity
backend FX. Manifest hash, byte anchors, source, AX snapshot và script nằm tại
`E:/BACKUP-TRADINGWORKSPACE/analytics-frequency-20261027/`.

## Hợp đồng frequency hiện tại

| Phần | Cột | Số trung bình ở tiêu đề |
| --- | --- | --- |
| Ngày | Tổng lệnh của mỗi thứ / số ngày có lệnh thuộc thứ đó; T2–CN | Tổng lệnh / số ngày có lệnh |
| Tuần | Tổng lệnh cùng số tuần ISO / số tuần có lệnh thuộc nhóm đó qua các ISO year; chỉ hiện số tuần có dữ liệu | Tổng lệnh / số ISO year-week có lệnh |
| Tháng | Tổng lệnh cùng tháng / số year-month có lệnh thuộc nhóm đó; T1–T12 | Tổng lệnh / số year-month có lệnh |

- Active nghĩa là có ít nhất một giao dịch đã đóng trong scope đang lọc.
  Kỳ trống không vào mẫu số; category chưa có quan sát có average null, không
  vẽ cột 0. Không lấy trung bình cộng các category để tạo số ở tiêu đề.
- Một kỳ tính một lần kể cả nhiều source session có lệnh cùng kỳ. Weekday,
  ngày và tháng theo timezone đang chọn; ISO week bắt đầu thứ Hai, tuần 1 chứa
  ngày 4/1. ISO year-week được tách trước khi gom cùng số tuần qua nhiều năm.
- Timestamp vẫn do report basis quyết định: market dùng Chart close time,
  activity dùng recorded report time. Không dùng thời gian máy hiện tại.
- Thiếu PnL vẫn đếm được lệnh. Thiếu timestamp không phân bổ; cảnh báo partial
  vẫn hiện. Các average của scope partial chỉ mô tả tập có timestamp nhận được,
  không tự nhận là trung bình đầy đủ của toàn bộ scope.
- Model phân biệt `tradeCount`, `periodCount`, `average`. Không dùng trường
  `count` để chứa một giá trị trung bình. Tooltip hiện cả phép chia và kết quả;
  cột/số tiêu đề giữ phần thập phân. Nhãn trục được đo theo text thực tế.

Oracle: 5 lệnh trên 4 ngày (T2 có 2 lệnh, T3/T4/CN có 1), 2 tuần, 1 tháng
cho 1.25/ngày, 2.5/tuần, 5/tháng. Nếu hai ngày T2 có tổng 3 lệnh, cột T2 là
1.5, không phải 3. Tháng 1 của hai năm có tổng 6 lệnh: cột T1 là 3.

## Rà soát các biểu đồ Analytics còn lại

Đọc lại các projection/component hiện tại và chạy các oracle có sẵn; các dòng
dưới giữ nguyên phép tính. Không chuyển mọi biểu đồ sang average vì tiêu đề
chung của một nhóm khác có từ Average.

| Biểu đồ/chỉ số | Loại phép tính và mẫu số |
| --- | --- |
| PnL và balance curve | Giá trị cộng dồn/quan sát cuối bucket; không phải PnL trung bình theo thời gian |
| Total trades, winners/losers, breakeven, side donut | Số lượng; donut là tỷ trọng số lệnh, không phải win rate |
| Win rate tổng/side/session/weekday/calendar | Số thắng / tổng lệnh của chính nhóm, có BE; không lấy trung bình tỷ lệ các nhóm |
| Realized/ideal RR | Cột/đường là từng giao dịch; số Average là trung bình mẫu R hợp lệ, Max là cực trị, thiếu R không thay bằng 0 |
| Expectancy | Tổng net PnL / tổng lệnh đã đóng, gồm BE |
| Profit factor | Tổng net dương / độ lớn tổng net âm; đây là tỷ số hai tổng |
| Average win/loss, duration, streak | Trung bình các lệnh hoặc chuỗi thuộc nhóm tương ứng; extreme/max là phép khác |
| Session radars | Count là số lệnh, WR là tỷ lệ, averageR là mean mẫu R, profit% là return trên vốn nguồn; cửa sổ chồng lấn không cộng count để ra tổng |
| Hour performance | Chọn net: tổng; R: mean mẫu hợp lệ; WR: tỷ lệ; return%: tỷ số trên vốn nguồn |
| Weekday performance | Tổng net của từng thứ và WR riêng; không phải tần suất hoặc mean PnL/ngày |
| Month matrix / Tổng năm | Return từ net tổng và vốn đã chọn hoặc tổng return từng source; không phải mean của 12 tháng, không compound |
| Calendar | Số lệnh/tổng net; WR và mean R tính từ mẫu lệnh, không trung bình các ô ngày |
| Drawdown | Mỗi cột là quan sát; average là mean điểm dưới peak; frequency là số đợt; recovery là mean thời gian chu kỳ đã phục hồi |
| MAE histogram / winning MAE | Histogram là số mẫu từng bin; số mean/min/max dùng các winner có observation đủ điều kiện |
| SL/RR scenario | PnL cộng dồn trên cùng tập lệnh đủ điều kiện; average DD trên các điểm DD dương; WR có denominator ghi riêng trong help |
| Monte Carlo | Mean/median/percentile của số dư cuối các lượt; xác suất chia số lượt; không phải số lượng giao dịch |

Sessions và Prop dùng chung `FxAnalyticsReport`; thay đổi frequency áp dụng sau
adapter/fence scope tương ứng. Live có projection và broker/manual contracts
riêng; lượt này không thay phép tính Live hay calendar của Live.

## Kiểm chứng

- Model: 86 focused tests qua build scoped HEAD + intentional overlays; có
  oracle riêng cho lặp weekday/month, tuần 53/ISO year, DST/timezone, filter,
  missing PnL/time, empty và các phép tính tổng/tỷ lệ/mean khác.
- Browser: 8 ca preview và deployed, 1920/1440/390px VI/EN, fixture reference,
  multi-year fractional means, 53 tuần, partial, empty, demo và phiên thật GET-only.
- Screenshot desktop/mobile; kiểm nhãn không đè, số lẻ không bị làm tròn về
  integer, không tràn ngang document và chỉ `.fx-content` cuộn dọc.
- Independent source review và 58 focused tests độc lập: pass.
- Receipt rollout và giới hạn: [RECEIPT](../../../foundation_v2/evidence/analytics-frequency-20261027/RECEIPT.md).
