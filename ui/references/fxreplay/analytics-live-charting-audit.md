# FX Replay — Analytics, Live và charting

Kiểm tra 26/10/2026, FX web `2.0.3828-prod`, tài khoản Free. Owner mở sẵn
Analytics demo và yêu cầu mở rộng từ calendar sang Sessions/Prop firm, các trang
Live và chart backtest. Phạm vi này thay thế giới hạn calendar-only của lượt trước.

Raw local: `E:/BACKUP-TRADINGWORKSPACE/fxreplay-audit-20261026/`.
`manifest.json` giữ hash; `RESUME.md` hướng dẫn tiếp tục. Snapshot AX, ảnh và
thông tin tài khoản không đưa vào Git. Đọc cùng [workflow](verification-workflow.md).

## Mức tin cậy

- Quan sát bằng UI/DOM đang render; không refresh document demo gốc, đọc token,
  framework state hay gọi API ẩn. Các control công khai được mở rồi đóng.
- Sessions và Prop là **demo**. Không có cùng dataset giữa FX và local.
- Source và fixture độc lập xác minh local; không suy ra backend FX từ tooltip.
- Live FX đang rỗng trong các scope quan sát: biết cấu trúc/tương tác, chưa biết
  công thức chạy với giao dịch thật. Không tạo dữ liệu để thử.
- Chart chỉ kiểm backtest truy cập được. Chưa có bằng chứng chart Prop/Live FX.

## Analytics Sessions

| Cụm | Quan sát FX | Quyết định local |
|---|---|---|
| PnL và balance | All/Day/1 Hour/15 Min; Total PnL, Balance, WR, trades, BE | Giữ cùng chức năng; không nối đường qua observation thiếu |
| Win rate | Demo 3 thắng, 1 thua, 1 BE; WR 75% = 3/4 | Giữ wins/all closed, gồm BE; help và calendar thống nhất định nghĩa local |
| Expectancy | Tooltip trung bình PnL/trade, gồm BE; demo 1699.60 | Dùng net sau phí / toàn bộ closed trades có đủ PnL; thiếu dữ liệu là unavailable |
| PF | Gross profits / độ lớn gross losses; demo 19.47 | Giữ ratio thật, vòng gauge cap 4 theo yêu cầu owner; không dùng profit/(profit+loss); không copy lời phán chất lượng chiến lược |
| Winners/losers | Best/average %, duration, consecutive run; hai nhóm | Local giữ hai card, đơn vị rõ; chuỗi BE ngắt run; không bình quân tiền từ nhiều currency |
| Realized RR | Average/Max RR, tooltip Average có diễn đạt thiên về winners | Local dùng net realized R hoặc original risk budget; không đổi công thức theo tooltip mơ hồ |
| Ideal RR | Nhìn tối đa một tuần sau mở lệnh | Chỉ dùng cửa sổ đủ dữ liệu trong cutoff; không dùng dữ liệu tương lai chưa có ở replay cursor |
| Could profit/BE | Help FX nói losing trades có cơ hội >1.2R, kèm nhận định marketing | Giữ định nghĩa local net >=0 sau phí trong cửa sổ đủ; không quảng cáo hiệu quả cải thiện |
| Side | Total trades + win rate, Buy/Sell | Đã có dùng chung; mỗi side có mẫu số riêng, side rỗng là N/A |
| Phiên | Out of Session/Asia/New York/London; bốn chỉ số | Giữ fixed UTC windows có overlap, help rõ không DST và không cộng các phiên thành tổng |
| Giờ/ngày | Menu Total Profit/Loss, Risk-Reward, % Profit, Win Rate | Giữ net, average R, % trên vốn hợp lệ, WR; đếm lệnh độc lập với PnL |
| Tháng | % theo Initial/Current và phép gộp phiên | Giữ initial vs current snapshot có xác minh; không dùng filtered ending balance thay current vốn tài khoản |
| Calendar | Month/Year và chỉ số; dùng chung presentation Live | Đã hoàn thành riêng trong receipt calendar; giữ adapter từng nguồn |
| Frequency | Demo 5 lệnh / 4 weekday hoạt động =1.25; tuần 2.5, tháng5 | Local tính cả kỳ lịch rỗng giữa ngày đầu/cuối (đã ghi help); không đổi sang active weekdays vì demo |

### Demo không phải oracle số học

Headline PnL 8500 trong khi tổng day/calendar là **8498.17**. WR75% dùng mẫu số4
trong tổng5 lệnh. Không “sửa” local để khớp các số này. SVG giờ/ngày có giá trị
`4390,3652.17,916,-460`; menu % hiện `4.39,3.65,.92,-.46`, gợi ý vốn100k,
nhưng chưa chứng minh cách chọn vốn cho mọi nguồn.

### Drawdown và Simulation

- FX drawdown: equity, $/% of Peak, max/average/recovery/frequency; MAE theo R.
  Demo có `∞/-∞` trên nhóm rỗng. Local giữ N/A và tách equity khỏi closed balance.
- Equity chỉ hợp lệ nếu snapshot đúng account scope; lọc closed trades không chứng
  minh equity của phạm vi đó. Peak/recovery không được xuyên qua khoảng thiếu.
- FX Stop Loss/RR có Run Simulation và upgrade; không chạy. Monte Carlo có số
  simulations/trades, start balance, average gain/loss, win rate, disabled Start
  trước cấu hình. Tooltip Monte Carlo mang nhầm tên calendar; không copy.
- Local Monte Carlo giữ seed, bootstrap/parametric, giới hạn workload, p05/median/
  p95 và ruin floor. Kết quả chưa chạy phải là chưa chạy, không giả zero.
- Hai link tài liệu FX Drawdown/RR Simulator không đọc được bằng công cụ web trong
  lượt này; không tuyên bố đã xác minh thuật toán sản phẩm từ các link đó.

## Analytics Prop firm

FX ban đầu không có challenge; đã mở **Show demo data** công khai. Có common
report + Challenge Objectives, Drawdown, Simulation trên trang dài. Demo objectives
10 ngày, daily loss2000, overall5000, target8000; không có rule trace để đối chứng.

Local giữ evaluator và snapshot riêng: profile/terms/phase/currency, replay
session/dataset hash/branch/cursor/event sequence phải khớp. Giao dịch carry được
gắn theo close phase. Lọc chart không đổi kết luận vi phạm rule. Không sao chép
status demo hay dùng filtered closed balance thay equity/rule state. Giữ tab
Performance/Drawdown/Simulation để giảm chiều dài; không cần clone trang dài FX.

## Các trang Live

| Trang FX đã mở | Quan sát | Áp dụng/giữ lại ở local |
|---|---|---|
| Calendar | Tháng rỗng, account selection, note/review ngày/tuần | Shared calendar đã có; coverage/currency/account scope vẫn của Live |
| Trades | Chọn all accounts vẫn rỗng; account/assets/outcome/date/tag filters | Giữ manual closed trades tách filled broker deals; không đặt WR round-trip lên deal count |
| Add trade | Draft có entry/exit, size, SL/TP, gross P/L, fees, Return, multiple fills, tags/media/note | Chỉ mở draft, không nhập/lưu. Local closed-trade schema đủ hiện tại; partial fills cần contract/import riêng |
| Notes | Group by None/Note type/Day/Week/Month/Year; folder/template/filter | Giữ notes/search/tags local; grouping là enhancement tùy chọn, chưa thêm taxonomy rỗng |
| Tag analysis | Equity curve, Tag group/Trades/WR/Total PnL, Smart Picks | Giữ thống kê theo tag và cảnh báo overlap; không thêm Smart Picks không có mẫu |
| Analytics | Filter assets/side/outcome/tags/accounts/day/timezone/date; không có series thật | Giữ tính net=profit+commission+swap+fee; unknown costs chặn cumulative curve; manual và broker basis riêng |
| Trading accounts | Connect/Transactions, source/status/balance/updated, CSV/manual/broker gallery | Giữ connector/source thực sự đã hỗ trợ; không tạo gallery giả hay sync trong research |
| Transactions | All/Withdrawals/Deposits/Fees, amount/date/type; rỗng | Giữ cashflow riêng khỏi trade PnL, provenance/reconciliation theo account |

Không đồng bộ broker, tạo account/trade/note, upload CSV/media hay gửi giao dịch.
Scope account FX không có mẫu → chưa xác minh công thức return, partial fills,
realized win rate, reconciliation và live latency của FX.

## Chart backtest

Mở existing session có thể truy cập. Header symbol/interval/type/indicators/order
flow/analytics; drawing toolbar; OHLCV; timezone/%/log/auto; floating replay controls;
order dock và balances. Không chạy replay, nhảy cursor, đặt lệnh, vẽ hoặc lưu layout.

### Risk sizing xác minh từ draft

| Input | FX hiển thị | Kiểm số học |
|---|---|---|
| Initial10000, risk1%, entry2261.1, SL2238.5 | distance22.6, size4.42, loss99.89 | 22.6×4.42=99.892, làm tròn size xuống bước .01 |
| Current10016, cùng risk/distance | size4.43, loss100.12 | budget100.16, 22.6×4.43=100.118 |
| Buy Limit draft2261.0 | SL2238.4, distance22.6 | Giữ khoảng SL khi đổi draft entry; không có fill để kiểm |

Đã trả draft Initial/Market/SLoff/quantity2 trước đóng. Local `ChartOrderPanel`,
`orderProtection`, `replayOrderModel` đã có cùng basis/preview/step; phải dùng
tick/contract/currency/cost model của instrument, không copy công thức đơn giản
price-distance×quantity cho mọi asset. Prop reuse replay sizing nhưng rule evaluator
có thể chặn; Live phải dùng quote/account/spec và broker permissions riêng.

Settings Session: Info/Balance & assets/Costs/Date range. Chart: Symbol/Status/
Scales/Canvas/Layout/Sync/Trading. Đã Cancel, không Save. FX Trading có One-click
Buy/Sell, Edit SL/TP without confirmation, Close without confirmation. **Không áp
default bỏ xác nhận sang Live local**. UI tương tự không mở rộng quyền broker.

Shortcuts lưu đầy đủ trong raw: Alt1 play, CtrlSpace next, Alt2/3 speed,
CtrlAltR previous; drawing/navigation/trading keys. Giữ shortcut local đã có và
chặn khi typing/dialog; chưa đổi phím để tránh conflict và vô tình trade Live.
Click Analytics từ chart dẫn về full Analytics page, không phải panel số liệu inline.

## Lỗi local đã xác minh và sửa

1. Adapter curve bỏ null → renderer nối qua gap, lấy số dư cũ khi endpoint thiếu.
   Giữ null/tradeId/index; bucket không xóa gap nội bộ. Fallback DD không biết peak
   sau gap; tổng DD/recovery giữ unavailable khi thiếu observation.
2. Group time lọc cả unknown PnL → mất trade count/frequency. Group mọi dated row;
   count giữ đủ, financial bucket N/A nếu thiếu PnL; undated rows vẫn không phân bổ.
3. Live aggregate manual+broker hiển thị tag filter nhưng bỏ qua vì `manual=false`.
   Filter tag per record, broker không có tag bị loại khi chọn tag; clear trả đủ rows.
   Account change tiếp tục reset filter; currency/coverage guard giữ nguyên.

Source owner: `analyticsViewModel.js`, `analyticsPresentation.js`,
`tradingAnalyticsModel.js`, `liveWorkspaceModel.js`, `LiveSurfaces.jsx`,
`FxAnalytics.jsx`. Regression: `analyticsCoverageRegression.test.mjs`.

Owner clarified the full chart logic/display scope on27/10. Follow-up canonicalR,
sparse RR/Ideal, signed radar, scenario eligibility and Monte Carlo fixes plus
the all-chart acceptance matrix are recorded in
[analytics-chart-calculations.md](analytics-chart-calculations.md). The three
coverage/tag fixes above are not the complete chart audit.

## Để lại khi có dữ liệu/quyền truy cập

- Charting Prop/Live FX và các tính năng Pro bị khóa; không bypass.
- FX production formula của Ideal RR/MAE/intrabar, stop-loss/RR simulation và Monte
  Carlo: cần dữ liệu export có thể kiểm hoặc tài liệu thuật toán, không suy từ demo.
- Live partial fills, broker cashflow/returns, populated tag statistics và sync/error
  journeys: cần account có mẫu/fixture được owner cho phép; chưa tạo record để thử.
- Order fill/slippage/tick timing, chart rendering performance và broker execution
  acceptance là kiểm chứng riêng, chưa được chứng minh bằng research UI này.

Không mở thêm hạ tầng hay rewrite chart engine chỉ để giống FX. Receipt kiểm thử
và rollout của lát sửa này: `foundation_v2/evidence/fxreplay-audit-20261026/RECEIPT.md`.
