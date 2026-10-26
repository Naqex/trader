# Analytics calendar — research ngày26/10/2026

## Kết quả và giới hạn

**Có bằng chứng FX dùng chung thành phần trình bày calendar** giữa Testing
Analytics và Live: cả hai DOM đều có `fxr-ui-calendar-view` và
`fxr-ui-calendar-day-cell`, được đặt trong host khác nhau. Đây không phải bằng
chứng chúng dùng chung backend, công thức tính hoặc mọi control.

Testing calendar của tài khoản Free đang có blur/upgrade gate. Chỉ đọc thông tin
trang đã render; không thao tác control nằm dưới gate, không gọi endpoint đoán
mò, không lấy component state nội bộ. Chưa kiểm được menu metric, Month/Year,
ngày chi tiết hay % initial/current bằng thao tác thực tế ở Testing.

Nguồn chính thức bổ sung: [Analytic Metrics Defined](https://support.fxreplay.com/articles/analytic-metrics-defined)
mô tả calendar theo ngày, hỗ trợ tháng/năm cùng % và RR. Tài liệu không xác định
đủ mẫu số, phí và timing cho mọi trường hợp; không suy thành parity công thức.

## Đối chiếu cụ thể

| Phần | FX quan sát | Local xác minh | Hướng đề xuất |
| --- | --- | --- | --- |
| Header | Title ở ngoài card; (i) mô tả daily P/L | Title ngoài wrap, thiếu (i) riêng calendar | Giữ title ngoài; thêm định nghĩa net/clock/timezone/unknown vào (i) |
| Điều hướng | Nút tháng trước/sau và năm trước/sau | Analytics chỉ chọn tháng có giao dịch bằng dropdown | Cho duyệt cả tháng trống bằng nút trước/sau; không giới hạn vào tháng có giao dịch |
| View | Testing có Month/Year; Live mẫu đang chỉ tháng | Analytics tháng, Live tháng | Month mặc định; Year là lớp trình bày có thể thêm sau khi định nghĩa metric đủ rõ |
| Metric | Testing hiển thị Dollar Profit + Initial/Current Balance; menu chưa kiểm được | Net, win rate, count, average R; không có calendar return % | Giữ metric có nguồn dữ liệu thật; không dựng menu FX chưa kiểm hoặc % thiếu mẫu số |
| Lưới | Bắt đầu thứHai; có ngày mờ ngoài tháng | Analytics bỏ trống ô đầu và không điền ô cuối; Live đủ tuần | Dùng cùng quy tắc lịch đủ tuần; ngày ngoài tháng mờ, không tính vào total tháng |
| Ô ngày | Ngày, P/L, số trades, màu lãi/lỗ | Analytics có các phần này; màu luôn theo net kể cả khi đổi metric | Giữ ngữ nghĩa màu net nhưng giải thích trong (i); tránh khiến màu bị hiểu là win-rate/R |
| Tổng | Live có cột Total tuần, tổng tháng, count | Live local có cả hai, Analytics không có | Tổng tuần là tùy chọn của Live; Analytics nên có tổng tháng theo metric đúng công thức |
| Chi tiết ngày | Live có open week trades, ghi chú/review | Live local chọn ngày có danh sách deals; Analytics chỉ tooltip | Analytics mở chi tiết chỉ đọc của ngày; thao tác ghi chú/review giữ riêng Live |
| Shared calendar | Cùng2 tag lịch/ngày, host khác | `FxAnalytics.jsx:PerformanceCalendar` và `LiveSurfaces.jsx:Calendar` riêng | Chốt Analytics trước; tái dùng lưới/header/cell ở Live sau, giữ adapter dữ liệu riêng |

## Logic local đã lần theo

`analyticsViewModel.js:buildAnalyticsModel` chuẩn hóa raw ledger. Trong
`tradingAnalyticsModel.js:advancedAnalytics`, Testing market scope dùng
`close_time_utc`; activity scope dùng `report_time_utc`. `calendarParts` chia
ngày theo IANA timezone Settings, rồi `stats` tổng hợp nhóm ngày:

- `stats` chỉ tính tổng net khi toàn bộ rows của nhóm có PnL đã biết; calendar
  hiện lọc thiếu PnL/time trước khi chia bucket. Count là số giao dịch trong
  nhóm ngày đã qua bước lọc đó. Tổng tháng tương lai cần incomplete marker để
  không trình bày tổng phần đã biết như toàn bộ tháng.
- Win rate = wins/count×100, gồm hòa vốn ở mẫu số. Ngưỡng hòa vốn theo report.
- Average R = trung bình những R đã biết, có `rCount`; hiện calendar không hiển
  thị coverage của R. Không biến thiếu R thành0. Nên đưa coverage vào chi tiết.
- Giao dịch thiếu timestamp/PnL không vào bucket ngày. `datesComplete` /
  `incomplete` giữ thông tin thiếu; một ngày vắng giao dịch chưa chứng minh lịch
  sử đã bao phủ ngày đó. Không điền zero cho ngày chưa đủ coverage.

`FxAnalytics.jsx:PerformanceCalendar` hiện chỉ nhận `items, timezone, currency`,
chọn tháng cuối có dữ liệu. `data.calendar` đã có `profitPct`, nhưng UI chưa dùng.
Nếu thêm % phải quyết định rõ gộp source capital và basis, tái dùng
`analyticsCapitalBases`/`periodReturn`; không cộng/trung bình các % tùy tiện.

Live calendar hiện có các contract cần bảo toàn:

- `liveWorkspaceModel.js:dealNet` = profit + commission + swap + fee, thiếu một
  thành phần thì unknown. Broker counts là **filled deals**, có thể khác số trade
  đã đóng của Testing; manual counts có nghĩa khác. Không đổi nhãn thành trades
  chỉ để khớp mẫu khi chưa có adapter positions.
- `calendarWeeks` chứng minh coverage toàn ngày bằng timezone/dayBoundary;
  phân biệt covered-zero, partial và unknown, kể cả DST và nhiều tài khoản.
- % chỉ mở khi manual account có opening capital hợp lệ. Không áp mẫu số của
  Testing lên broker cashflow/snapshot hoặc tự suy ra vốn ban đầu.
- Tổng tuần/tháng chỉ lấy ngày đủ điều kiện trong tháng; không tính ngày ngoài
  tháng. Adapter nguồn và note/review không nằm trong phạm vi shared calendar.

## Kiểm số học và UI thật

Response local đang chọn có một row: gross−0.28USD, fees2USD, net−2.28USD;
close epoch1052093880 → ngày05/05/2003 ở Asia/Ho_Chi_Minh. Tính độc lập từ raw
khớp nhóm calendar: net−2.28, count1, win rate0%, R null. UI lần lượt hiển thị
−2,28 /0% /N/A khi đổi metric; đã trả về net. Tổng ngày khớp report.

FX demo DOM cho bốn ngày3652.17,4390,−460,916USD, tổng8498.17USD; headline
8500USD, lệch1.83USD. Không đủ bằng chứng giải thích chênh lệch (demo/rounding/
phí/phạm vi), vì vậy không dùng demo làm financial oracle. Không gọi đây là lỗi
backend FX. Hai tháng Live quan sát đều rỗng, chưa có mẫu khác0 để audit.

Script `calendar/audit.mjs` chạy offline, PASS. Lần đầu strict equality gặp sai
số float ở gross−fees; đã dùng tolerance1e−9, không thay số nguồn. Bằng chứng
gồm raw local response, DOM/ảnh của hai FX surfaces, ảnh các metric local và
`calculations.json`. Network capture đã tắt, FX Live trả tháng10/2026 rồi về
Testing Analytics; local ở Analytics/net. Chưa thay đổi calendar của bên nào.

## Lát triển khai đề xuất tiếp theo

1. Analytics calendar: điều hướng tháng/năm, đủ tuần, (i) định nghĩa, đơn vị và
   trạng thái unknown/zero rõ; chi tiết ngày chỉ đọc và tổng tháng. Net/count có
   thể cộng; win rate dùng tổng wins/count; average R dùng tổng R/rCount.
2. Kiểm fixture timezone qua nửa đêm/DST, tháng28–31ngày, leap year, ngày rỗng,
   thiếu timestamp/PnL/R, % thiếu vốn; cộng total không lẫn tháng bên cạnh.
3. Sau khi Analytics đạt, chỉ tái dùng phần calendar presentation cho Live;
   giữ broker/manual adapters, coverage, account selection và note/review.
4. Year và các basis % mới làm sau khi dữ liệu/định nghĩa đủ; không để lớp UI
   tạo số giả. Không mang share/upgrade banner, nested wrapper hoặc controls
   không dùng từ FX vào sản phẩm.

Đây là research và đề xuất cho lát calendar, không phải toàn bộ Analytics đã
kiểm chứng, và chưa là receipt triển khai calendar.

Review độc lập source/reference/raw PASS. Gap ban đầu do AX snapshot chỉ chứa
no-change đã được sửa bằng full AX và bounded rendered HTML JSON của cả hai FX
surfaces; script đọc số tiền từ raw thay vì hard-code. Reviewer xác nhận lại tags,
tổng demo và yêu cầu incomplete marker; các giới hạn phía trên vẫn giữ nguyên.
