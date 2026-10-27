# Đối chiếu source chart FX Replay và model local

Ngày review: 2026-10-27. Phạm vi: đọc source công khai đã lưu và model/source local; không thực thi JavaScript của FX Replay, không gọi API hay truy cập tài khoản/broker.

## Kết luận

Source công khai đủ để xác nhận cách client chọn field, dựng series, một số phép tính mô phỏng và toolbar. Nó không chứng minh công thức backend cho các scalar tổng hợp, cách xử lý phí hoặc cutoff trên dữ liệu production. Local nên học hành vi đã chứng minh và giữ các contract dữ liệu chặt hơn đã được owner chọn.

Candidate được đối chiếu có index SHA256 `1bcdfe2881b8fedbeadfc0719b7d56898a1c437e4cd96818eefabba121d132bd`. Mười source/test overlay khớp build receipt, candidate và working tree tại thời điểm review. Independent focused tests: 66/66 PASS. Đây là source/model review, chưa phải browser/runtime hay toàn sản phẩm acceptance.

## Nguồn và cách tái kiểm tra

- `public-source/chunk-BX5OK6OF.js`, SHA256 `b90d30f30f1bbd868e5580acc2981bee8e6767be039db6bd463af705e073c46b`.
- Bản `.pretty.js` chỉ format source để đọc; vị trí dòng dưới đây tham chiếu bản này. Byte offset tham chiếu bản minified gốc, zero-based UTF-8.
- `public-source/chunk-YQ7IBT4T.js.pretty.js:55–68`: client POST `/analytics/calc` và `/analytics/calc/drawdown`, sau đó dùng server payload. Không gọi hai endpoint trong audit này.
- Cùng file dòng38–42: demo copy các constant. Demo data không chứng minh công thức production.
- `source-audit-evidence.json`: function anchors, byte offsets, excerpts, source hashes và hai reproductions. Script `source-audit-repro.mjs` chỉ đọc public JS như text, import các model local.
- `independent-source-hashes.json`: binding candidate/source chính xác. `independent-source-tests.txt`: kết quả 66 tests độc lập.
- Local files nằm trong `foundation_v2/web/src/`: `tradingAnalyticsModel.js`, `analyticsPresentation.js`, `analyticsSimulation.js`, `analyticsViewModel.js`, `reportChartModel.js`, `AnalyticsCharts.jsx`, `FxAnalytics.jsx` và `AnalyticsCalendar.jsx`.

## Luồng data/state local

Read model giữ ledger và provenance/cutoff. `advancedAnalytics` chọn đúng activity/market timestamp đã khai báo, bổ sung realized R từ observation rủi ro ban đầu hợp lệ hoặc ledger/budget dương, lọc từng row rồi tính summary và các nhóm. Missing value được giữ là unknown. Presentation chuyển kết quả thành series, không tự tạo số liệu tài chính. `AnalyticsCurve` chỉ đổi cửa sổ và tọa độ hiển thị, giữ trade ID và giá trị gốc.

## 1. PnL, interval và toolbar

**Public source:** `$s` byte45210, `j_`45390, `H_`45593, `Z_`46314, `ed`46662, `Xs`48661, `To`49254, `rd`50581; pretty dòng830–978.

- `H_` tạo Running PnL/openPos và Closed PnL/closePos.
- All: `Z_` dùng supplied `cummulativePnL` cho closed curve, cộng open PnL cho running curve.
- Daily: `ed` dùng supplied daily cumulative fields, không tính lại từ raw trades tại client.
- Hour/15m: `Xs` cộng `rPnL` trong mỗi bucket, rồi reset bucket. Đây là bucket PnL, không phải cumulative endpoint.
- `To`/`rd` dùng datetime X; toolbar flag, zoom X, không download. Area/line variants khác nhau.

**Local:** `bucketCurve` cố ý giữ **endpoint PnL tích lũy** cho cả bốn interval; nhãn vẫn là Lãi/lỗ ròng tích lũy. Gaps được giữ, không biến missing observation thành0. Origin được neo cùng timestamp đầu tiên đã quan sát, không tạo một thời điểm giả trước đó.

Candidate chuyển PnL sang tọa độ thời gian thực nếu mọi timestamp hợp lệ, không giảm và span>0; timestamp trùng có cùng X. Missing/reversed/đồng thời toàn bộ thì dùng thứ tự quan sát. Zoom/pan/brush hoạt động trên normalized window; cắt plot, giữ điểm lân cận để nối đường đến mép; point selection chỉ cho điểm trong cửa sổ. Chuột kéo suppress click, plain click vẫn mở trade inspector; keyboard +/-/mũi tên/0/Home/Escape được khai báo. UI runtime cần kiểm chứng riêng.

**Quyết định cần giữ rõ:** interval local khác FX hour/15m; không được tuyên bố số liệu giống FX. UI không nên đổi sang bucket sums mà vẫn gọi tích lũy. Contract hiển thị đã được cập nhật để mô tả positioning theo timestamp khi dữ liệu hợp lệ và fallback theo sequence khi không đủ dữ liệu.

## 2. Realized R, ideal R và cơ hội phục hồi

**Public source:** `Lr` pretty2060–2073 đọc `positionSummary`; `hu` byte130030 và `Io`130443, pretty2089+.

- Curve realized/ideal lấy `winningGraph.riskReward`/`idealRR`, X là dateEnd; client loại field null khỏi từng curve.
- Opportunity dùng array `couldHaveProfit` riêng. Tooltip nói các lệnh thua có thể đạt trên1.2R. Các scalar average/max được server cung cấp; không có bằng chứng client tính bằng toàn bộ trade.

**Local:** `realizedRiskValue`, `realizedRiskSeries`, `idealRiskSummary` join theo trade ID và giữ missing slot. Realized R ưu tiên observation `initial_stop_distance`, rồi ledger realized R, rồi net PnL/budget ban đầu dương. Configured SL experiment không thể thay actual risk. Ideal chỉ nhận coverage `complete_week` hợp lệ. Opportunity recoveryCount dựa cờ backend costed có thể net>=0; maximum ideal R giữ trên **mọi eligible filtered trade**, theo contract owner đã chọn. Những khác biệt này có chủ đích; tooltip FX không là công thức chuẩn bắt buộc.

## 3. Breakeven, WR và winner/loser

**Public source:** `Sr` pretty1152–1188, method `breakevenThresholdExclusionMessage()` trong anchor evidence; `C_` byte sau30944 so `abs(riskReward)<=threshold`. Source có thông báo loại lệnh thiếu initial SL khi áp ngưỡng.

**Phát hiện baseline đã sửa trong candidate:** local trước đây so abs tiền với threshold. Candidate so abs **realized R theo từng row**; một lệnh +100 với risk10 (10R) là win, lệnh +100 với risk1000 (.1R) là BE ở threshold1R. Filter outcomes dùng cùng callback row-aware. Threshold0 giữ epsilon PnL cũ.

Khi threshold>0 và thiếu R, candidate giữ row, PnL, trade count, time và frequency; outcome unknown. `classificationComplete` độc lập với financial `complete`; wins/losses/BE/WR/streak/duration và outcome percent summaries thành N/A nếu phân loại thiếu. Như vậy unknown không bị đếm thành BE bằng phép count-wins-losses. Main WR vẫn wins/all closed trades **bao gồm BE** theo owner contract.

Winner/loss percent local tính từng trade net PnL/source starting balance rồi mới lấy mean/extreme; thiếu/zero/negative capital ở bất kỳ row trong group thì cả group N/A. Không dùng pooled balance thay mẫu số từng source.

**Reproductions:** net+5, R.05, threshold10 => BE, wins0, BE1; winner MAE sample0/average null. Equal net+100 với R10/R.1 ở threshold1 => win/BE. Tên field `threshold_money` trong JSON reproduction là tên lịch sử của lỗi baseline; giá trị đang kiểm chứng là threshold R.

## 4. Expectancy và Profit Factor

**Public source:** `rl` pretty1698+ chỉ đọc `positionSummary.expectancy`, `expectancyWin`, `expectancyLoss`, `profitFactor`; `updateProfitFactorGauge()` byte104167 dùng PF/4 cap100 với color bands. Không thể chứng minh server denominator từ binding này.

**Local:** expectancy net money/all closed trades (BE vẫn trong mẫu số). PF Performance gauge dùng sum positive net / abs sum negative net sau phí; threshold phân loại không bỏ số tiền nhỏ. No trades/allzero0; profit/no loss hiện infinity; missing PnL N/A; số thật không cap, ring min(PF/4,1). Candidate `stats.profitFactor` cũng độc lập outcome classification cho trường hợp có loss; ratio contracts khác giữ nguyên. Cap4 chỉ là cap thị giác được owner chọn, không xếp hạng hiệu suất.

## 5. Side donut và win-rate tracks

**Public source:** pretty1309–1314 đọc `buySellSummary.totalTrades`/`winningRate`; `Ld`1339 donut, `Nd`1342 radialBar. Missing thường `||0`.

**Local:** side count/WR tính từ filtered ledger, unknown-side giữ riêng. Buy/Sell WR là hai tỷ lệ độc lập, không là hai phần cộng100. Missing rate giữ N/A; không sao chép phép ép missing thành0 của reference.

## 6. Session radar

**Public source:** pretty1548–1576, `Wd` byte96826, `Rr`97320, `jd`97436. Thứ tự Out Of Session, Asia, New York, London; metrics winningRate/totalTrades/averageRR/profit. `Rr` ép missing0, axis Y hidden, toolbar false. Source client không chứng minh cách backend chọn session/time window.

**Local:** fixed UTC windows theo contract: Outside22–24, Asia00–09, NY13–22, London07–16. Overlap có chủ đích; không cộng session totals. Display zone không đổi group. Signed scale, ticks và zero reference giữ số âm đọc được, missing rate/RR không thành0. Return dùng source capital pool cố định; không lặp mẫu số mỗi trade. Đây là contract đã được kiểm chứng local, không là kết luận suy ra từ frontend FX.

## 7. Hour và weekday

**Public source:** `yr` pretty1597+, `ru` byte101097, `ou`101649. Giữ giờ khi profits/losses khác0; `||null` có thể bỏ knownzero/BE-only hour. Có profit/loss riêng, RR, winRate và mỗi profit/loss % trên initialBalance; chart stacked vertical. Daily `wd` pretty1403 là horizontal stacked bars + supplied WR.

**Local:** giữ zero quan sát được, unknown timestamp không tự fallback. Hour chọn net/RR/return%/WR, day là signed net horizontal + WR riêng. Return theo nguồn vốn contract. Signed net khác stacked gross win/loss là quyết định hiển thị hiện hành.

## 8. Month/year matrix

**Public source:** `gr` pretty1431+, `Yd`1482+, `el/Gd/$d/Ud`1500–1532. Đọc server monthlyPerfCurrentBalance/monthlyPerfInitialBalance, radio current/initial và accum/overall; dùng supplied cumulativeGainPercentage/overallGainPercentage. Negative starting balance có N/A; absent gain khác known0. Client không chứng minh aggregation source capital backend.

**Local:** `analyticsCapitalBases`/`periodReturn` tính mỗi source capital một lần. Accum=sum source return, Overall=pooled net/pool capital; không cộng tiền khác currency. Current chỉ từ explicit account snapshot tại cutoff, không dùng filtered initial+net. Missing/conflicting/nonpositive capital N/A; temporal/financial incomplete chặn year/Total. Không được nhận radio giống nhau làm bằng chứng cùng công thức backend.

## 9. Calendar

**Public source:** pretty1928–1972 `generateCalendarEvents` dùng daily arrays, Dollar Profit/RR/Profit%, BE fields, current/initial; finite RR else N/A. Deposit/withdrawal không là trading PnL.

**Local:** giữ count/WR, date grouping theo declared report basis và display zone; unknown date/money và source partial chặn total đầy đủ; averageR weight known R samples, giữ coverage; empty date không tạo zero money. AnalyticsCalendar dùng day.winRate nên candidate classification unknown giữ N/A.

**Đã cập nhật trong candidate:** exported `calendarPeriodSummary` tại `calendarViewModel.js:21–29` gate cả `classificationComplete` và finite wins trước khi tính win rate; focused calendar tests vẫn PASS.

## 10. Frequency

**Public source:** `Qs` pretty1250–1288, `buildFrequencySummary` byte79784 dùng supplied `monthWeekDayAverageTrades` và `totalAverageTrades`; keys weekday/month/week+month. Không có frontend proof mẫu số averages server.

**Local, sau correction owner:** `frequencySeries` gom trung bình theo thứ, số tuần ISO và tháng qua các năm; tiêu đề là total trades / active periods. Không thêm kỳ trống vào mẫu số. [Audit frequency và phân loại phép tính](analytics-frequency-and-aggregation.md) thay thế định nghĩa chuỗi ngày cụ thể trước đây; vẫn không tuyên bố parity denominator backend FX.

## 11. Drawdown và MAE

**Public source:** `Us` byte46999 (pretty886), `zs`47922 (pretty896). Dùng supplied cumulativeDrawdown/peakBalance/dateStart và backend maxDrawdown/averageDrawdown/recoveryDays/frequency; winner MAE chọn raw rPnL>0. `zs` abs drawdownRR, missing0, cap3R, bin.1/.2 + overflow. Pretty951–978 dựng percent bằng signed DD/peak.

**Local:** account equity drawdown giữ floating loss và coverage segment, không dùng closed balance thay true equity. Không bridge missing data hoặc claim filtered scope có equity đầy đủ. Recovery elapsed24h days có basis riêng. MAE chỉ nhận initial_stop_distance, known>=0, không fabricated0; adaptive bins không cap outlier. Candidate winner MAE theo `trade.outcome` để khớp ngưỡng BE (fallback sign chỉ khi caller chưa có outcome).

## 12. SL/RR simulation

**Public source:** `Ns` byte29049, `__`30944, `Ao` pretty523+: fixed1% initialBalance risk, targetRR, win nếu idealRR>=target else-1R; không OHLC hit-order replay. `ws`38527 proxy adverse/(entry-SL), clamp favorable0, missingSL undefined nhưng missing adverse price0. `Bs`39007, `D_`41078, `go` pretty707: SL reduction proxy, initialRisk fallback fixed1%, scenario R. FX average DD trong Ao/go là mean episode maximum.

**Local:** original exposure/cutoff/costed experiments, ready/ambiguous/unsupported được giữ; scenario comparison cùng eligible set, không unresolved0. RR/SL use local backend hit-order/cost semantics, không thay bằng idealRR shortcut. Local averageDrawdown là mean **underwater observations**, khác mean episode maximum của FX; help mô tả point basis. Giữ rõ định nghĩa hoặc đổi tên nếu owner chọn định nghĩa khác sau này.

## 13. Monte Carlo

**Public source:** `Es` byte24006 lấy accountBalance/winRate/avgGain/avgLoss, `Ps`24185 Box-Muller Normal(mean,stddev), `gs`24294 chạy simulations, `jc`24566 phân nhánh win/loss rồi normal sample, rounding2dec, không floor ruin; `Hc`24880 lấy ending stats/PF/streaks. Normal sample có thể đảo dấu outcome và vốn âm; đó là hành vi code, không phải endorsement.

**Local:** seeded bounded bootstrap ledger hoặc configured constant binary outcomes, floor0, percentile trên mọi run, chỉ30 paths drawn. Model khác FX có chủ đích, dễ tái hiện và không giả distribution/stddev từ dữ liệu thiếu. Không có cơ sở chuyển model chỉ để chart trông giống reference.

## Phát hiện và trạng thái\r?\n
| Mục | Trạng thái ở candidate được bind |
| --- | --- |
| Threshold từng row theo R thay vì tiền | Đã sửa, independent tests/repro PASS |
| Unknown classification bị thành BE | Đã sửa bằng classificationComplete, PASS |
| Profit Factor bị threshold loại tiền nhỏ | Đã giữ tính từ net money, PASS |
| Winning MAE không theo BE threshold | Đã sửa, PASS |
| Irregular time gaps/duplicate time | Model tests PASS; UI gesture cần browser evidence |
| calendarPeriodSummary classification gate | Đã sửa; helper không biến unknown classification thành BE/0, PASS |
| Public backend formulas | Không quan sát được; không claim parity |
| Runtime/whole-product acceptance | Chưa thuộc review này |
