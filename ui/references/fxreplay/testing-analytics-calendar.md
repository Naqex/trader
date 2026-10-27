# Analytics calendar — research ngày26/10/2026

## Kết quả và giới hạn

**Có bằng chứng FX dùng chung thành phần trình bày calendar** giữa Testing
Analytics và Live: cả hai DOM đều có `fxr-ui-calendar-view` và
`fxr-ui-calendar-day-cell`, được đặt trong host khác nhau. Đây không phải bằng
chứng chúng dùng chung backend, công thức tính hoặc mọi control.

Ở lần quan sát đầu, Testing calendar của tài khoản Free có blur/upgrade gate. Chỉ đọc thông tin
trang đã render; không thao tác control nằm dưới gate, không gọi endpoint đoán
mò, không lấy component state nội bộ. Chưa kiểm được menu metric, Month/Year,
ngày chi tiết hay % initial/current bằng thao tác thực tế ở Testing tại thời điểm đó.
Lần owner mở sẵn trang sau đó đã cho phép kiểm các control bình thường; kết quả
bổ sung ở cuối tài liệu. Không refresh hoặc điều hướng lại trang của owner.

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
tổng demo và yêu cầu incomplete marker. Review này áp dụng cho lượt research đầu;
lượt bổ sung dưới đây có bằng chứng thao tác riêng.

## Bổ sung khi owner mở sẵn toàn bộ biểu đồ

Owner nhắc lại đây chỉ là **demo data của FX**. Dùng để khảo sát layout/control/
format và tạo giả thuyết cần kiểm; không dùng nó làm căn cứ xác nhận hoặc đổi
công thức production/local. Cần dữ liệu thật hoặc định nghĩa đáng tin bổ sung.

Đã đọc lại đúng tab hiện có và thấy `Viewing demo analytics`, toàn bộ các nhóm
biểu đồ cùng calendar rõ nét. Không reload/goto, không thay style/gate hoặc đọc
component state. Các lựa chọn sau được thao tác qua control trên trang:

- Menu gồm **Dollar Profit**, **% Profit**, **Risk Reward**. Không phải menu
  net/win rate/count/average R của local hiện tại.
- **Month → Year → Month** hoạt động. Year là 12 lịch tháng thu nhỏ, tô màu ngày;
  số tiền/RR và số giao dịch không hiện trực tiếp trong các ô nhỏ đã quan sát.
- Initial/Current làm thay đổi % như bảng dưới. Radio vẫn còn hiển thị khi chọn
  Dollar Profit hoặc Risk Reward; chưa kiểm mọi tổ hợp metric/basis.
- Click ô ngày9 có2 trades không đổi AX, không mở dialog/detail trong lần thử.
  Chưa kết luận mọi ngày hoặc dữ liệu thật đều không có hành vi chi tiết.
- Risk Reward ở các ngày9/11/15/17 lần lượt là **3.65/0.00/0.00/0.00 RR**.
  Không có raw risk/stop của từng trade để xác minh các0 là giá trị thật hay
  cách xử lý thiếu dữ liệu của demo; không sao chép cách điền0 này vào local.

### Phần trăm quan sát và kiểm số học

| Ngày tháng6/2025 | Dollar Profit | Initial Balance | Current Balance |
| --- | ---: | ---: | ---: |
| 9 | 3652.17 | 3.65% | 3.65% |
| 11 | 4390.00 | 4.39% | 4.24% |
| 15 | -460.00 | -0.46% | -0.43% |
| 17 | 916.00 | 0.92% | 0.85% |

Với vốn đầu100000USD (suy ra từ headline balance108500 trừ PnL8500), cả bốn
Initial khớp `dailyPnL / initialBalance * 100` sau làm tròn2 chữ số.
Current khớp `dailyPnL / (initialBalance + tổng PnL các ngày trước) * 100`:
mẫu số100000,103652.17,108042.17,107582.17. Đây là **suy luận khớp mẫu demo**,
chưa chứng minh backend dùng đúng công thức này khi nhiều phiên, nạp/rút hoặc
nhiều lệnh trong ngày. Chênh1.83USD giữa tổng calendar và headline vẫn chưa rõ.

### Điều chỉnh đề xuất

Học cách điều hướng tháng/năm và Year overview, tiêu đề ngoài card, ngày ngoài
tháng mờ. Có thể bổ sung Dollar/%/R cho Analytics sau khi hợp đồng vốn và R rõ;
không đổi nghĩa average R hiện tại chỉ vì FX ghi Risk Reward. Chỉ hiện basis
Initial/Current khi metric% thực sự dùng nó, tránh control không có tác dụng.
Giữ unknown và coverage của local; không lấy demo làm oracle cho tiền hoặc R.
Day detail chỉ đọc vẫn là đề xuất riêng cho local, không phải hành vi FX đã chứng minh.

Raw bổ sung: `E:/BACKUP-TRADINGWORKSPACE/fxreplay-reference-20261026/testing-analytics/owner-opened/`.
`calendar-interactions.json` lưu text từng state; các ảnh `fx-calendar-*` và full
AX lưu menu, basis, Year và state cuối. Manifest riêng chứa hash các file.
Đã trả về **June2025 / Month / Dollar Profit / Initial Balance**, giữ demo mở;
vị trí cuộn ở các ô ngày có dữ liệu. Tại thời điểm research chưa sửa calendar local hoặc Live.

## Triển khai sau khi owner duyệt

Analytics dùng `AnalyticsCalendar` với điều hướng tháng/năm liên tục, Month/Year,
lưới Monday-first đủ tuần, chi tiết ngày chỉ đọc, (i) VI/EN và tổng kỳ có trọng số.
Giữ bốn metric net/winRate/count/averageR của local. Không thêm công thức% từ demo.
Không giả định Risk Reward của FX bằng average R của local.

Calendar giữ dated rows thiếu PnL trong count và chi tiết, đánh dấu partial và
giữ N/A cho net/win rate chưa biết. Unknown-time hoặc nguồn partial không được
nhận là tổng đầy đủ; hiển thị số lệnh có ngày đã nhận. Tổng R dùng trọng số rCount,
không thay R thiếu bằng0. Frequency giữ scope known-PnL cũ; đây là khác biệt có chủ đích.

`CalendarView` chia sẻ navigation/month grid/day presentation cho riêng calendar
Live. Adapter `calendarWeeks`/`calendarWeekSummary`, broker/manual count, coverage,
selection, ghi chú/review và sidebar giữ nguyên nghiệp vụ. Live tiếp tục Month view;
Year overview mới ở Analytics. Màn hình nhỏ cuộn ngang trong lưới tháng; Year xếp dọc.

Receipt, giới hạn và bằng chứng: `foundation_v2/evidence/analytics-calendar-20261026/RECEIPT.md`.
Đây là hoàn tất lát calendar được giao; các cụm Analytics khác chưa được research
hoặc triển khai trong lần này. Trang FX không bị refresh/điều hướng trong implementation.

## Calendar metrics update — 2026-10-27

Supersedes the earlier local four-metric/no-capital-control decision above.
Owner requested the three FX menu categories and balance basis controls. Fresh
public `chunk-ZI3BTXB2.js` confirms `Dollar Profit`, `% Profit`, `Risk Reward`,
and Initial/Current radios. `formatPosition` reads `percentagePnl`,
`initialBalancePercPnl` and `riskReward` from API-provided daily graphs. It does
not expose their financial calculation. The UI also combines open cumulative
PnL; local Analytics remains closed trades only. FX's RR tooltip says only trades
with SL/TP participate, but daily aggregation is not established by this bundle.

Local menu: net P/L, return (%), return (R). R is explicitly the sum of realized
original-risk R, not average R; any missing trade R makes the day N/A. Daily
details retain win rate, count and average R with coverage. Capital radios are
shown for percentage only. Day-opening balance is initial source capital plus
prior local-day P/L from full supplied history before local filters. It requires
explicit unfiltered/full scope and complete times; unknown past P/L taints future
capital. Different currencies or any invalid source capital prevent a pooled
return. This does not reuse the monthly Current snapshot contract.

Observed zero hour/day groups get neutral thin marks at exact zero; absent
categories and unknown values remain blank. Frequency, curves, rings, radars,
MAE and calendar do not receive invented zero bars. Weekday known win rates,
including 0%, use green badges; N/A has no badge.

Fresh source/hash, tests, screenshots and rollout evidence:
`E:/BACKUP-TRADINGWORKSPACE/analytics-calendar-metrics-20261027/`.
No prepared FX browser tab was refreshed or navigated.
