# FX Replay public bundle audit — 27/10/2026

Đây là lượt đọc tĩnh bundle public của bản FX Replay đang phục vụ ngày
27/10/2026. Không refresh tab FX, không đọc cookie/token, không gọi API có
đăng nhập và không thực hiện mutation. HTML được lấy bằng một HTTP request độc
lập; 254 chunk được liệt kê từ `main-MOUNHJVD.js`, 244 tải được và 10 chunk
được chọn để đối chiếu route/component.

Raw bundle tạm thời: `C:/Users/MIIKEY/AppData/Local/Temp/fxreplay-bundle-20261027/`.
Không đưa bundle production vào Git; các hash dưới đây đủ để nhận diện đúng
lượt đọc.

## Source fingerprints

| Asset | SHA-256 |
| --- | --- |
| `main-MOUNHJVD.js` | `0A376D941D9405C4D364B122C29445293DE9AF6573E4C4F76523655DE8D07E8A` |
| `chunk-XVHG5UTB.js` | `817471DF2BB208ACEA4D0EF9B09F5594F38560140FC826533C21DC1EF566D6A3` |
| `chunk-5LTAVIVO.js` | `53F7788D0EA642690AFC10F7D0582C57B804A79D6B68240809B96D128221D3F2` |
| `chunk-HIXL6TZD.js` | `F8071843633D9480041EFA95986995332710775F7E4B250AA7A17A9672545A17` |
| `chunk-5MQSOSRU.js` | `687DD0C7C06E9380CE6213F9474895E455327B929715B0DAA20928EEFDF50C80` |
| `chunk-3EHNF3KO.js` | `F63F47651A7FAD39F83D9417A60130774A6510BAE83FB8759C4F32F35795C628` |
| `chunk-SPMOKJBN.js` | `3EB14F4EC7065BF86090D0E864A0E144F03644E8D4B41B09BF62AE0B2EFCD55C` |
| `chunk-PNLM7NI4.js` | `E55606CC024E523A51C7BFD3CCEBCEA4A1F318E8E41685E0A6150EE26A88529C` |
| `chunk-VICQFUGP.js` | `B0793BF5D55FFE98E937B634D70E88D6125683A9B22C04C6266F14E5D5B1FC29` |
| `chunk-IVID2IVR.js` | `EC018FDC7554E49F681D8AEF0EBEC7D53FCEEAC150B7C6A2661476A7F28314EE` |

## Findings by page

### Testing Dashboard

- `chunk-XVHG5UTB.js` defines four metric cards: time invested, historical
  time replayed, trades taken with Buy/Sell split, and overall win rate.
- The chart family is three charts: time invested by period, daily win rate and
  trades by symbol. The source uses project type `Backtesting`, `Battles`,
  `Prop Firm`, `All` and ranges `Last week`, `Last month`, `Lifetime`.
- The source treats the dashboard as a read with request-version protection;
  a late response must not replace a newer filter selection. Lifetime time
  invested is reconciled against the current month instead of inventing a
  future bucket.
- Local `dashboardModel.js`/`DashboardPerformance.jsx` already implement the
  important contracts with stricter provenance, explicit partial/blocked/empty
  states, activity-time filtering and no synthetic dates. No new code change is
  justified from the bundle alone.

### Testing Sessions và Prop Firm

- `chunk-5LTAVIVO.js` exposes separate analytics resources for private,
  drawdown, journal, Prop Firm, public, session and strategy reports. The
  current client posts private and drawdown calculations separately and loads
  session analytics by `/analytics/calc/session/:id`.
- `chunk-5MQSOSRU.js` keeps the session summary fields separate from the
  analytics payload: `positionSummary`, `buySellSummary`, daily/hourly/monthly
  groups and `allTrades`. It also reads `currentBalance` independently from
  the initial balance.
- Local Sessions/Prop already keep session identity, revision/cursor and phase
  fences in the read model. They also keep current balance, equity and closed
  balance separate. Copying the FX demo constants would weaken those guards,
  so no formula or default was changed.

### Testing Trades

- `chunk-3EHNF3KO.js` confirms the public contract: `/api/trades`,
  `/api/trades/filters/options`, `/api/trades/filters/context-options` and
  `/api/trades/scroll`.
- The filter schema includes session/source, assets, side, status, outcome,
  date/year/month/day/hour, notes, include/exclude tags with AND/OR, sort field
  and direction, page and limit. Testing and Live intentionally reject
  unsupported fields instead of silently ignoring them.
- Default Testing sorting is `entryDate DESC`, page size 10; missing
  `createdAt` stays nullable. Live uses a separate account/cursor contract.
- Local Trades already has applied filter chips, server-style pagination,
  explicit unknown values and the owner-requested Chart/Realtime radios inside
  the drawer. The radios are a local product decision; they are not claimed to
  be an FX control. No further copy of FX behaviour is safe without a matching
  backend fixture.

### Live: Calendar, Trades, Notes, Tags, Accounts, Transactions

- `chunk-5LTAVIVO.js` exposes the Live journal analytics routes:
  `/api/journaling/analytics/calc/journal`, `/v2-1/analytics/filters`,
  `/trading-account/options` and symbol options. The report has separate
  `pnlAnalytics`, `winRateAnalytics`, `avgPnlAnalytics`, a cumulative PnL
  series and tag overview.
- `chunk-SPMOKJBN.js` distinguishes manual/file/sync accounts and exposes
  account balance fields (`initialBalance`, deposits, withdrawals, fees,
  `totalPnl`, `currentBalance`). The Live Trades contract is deal based and
  supports account/date/asset/side filters with cursor scrolling.
- Local `liveWorkspaceModel.js` keeps manual closed trades separate from broker
  deals, requires complete profit/commission/swap/fee before a financial curve
  is certain, and applies tags per record across mixed sources. This is the
  correct local adaptation of the source boundary; no source-backed change was
  missing.

### Backtest charting

- `chunk-PNLM7NI4.js` confirms the public client-side simulation assumptions:
  fixed 1% initial-balance risk for its RR simulator, supplied `riskReward` /
  `idealRR` fields, cumulative-R series and a separate Monte Carlo path that
  samples win/loss parameters.
- The public bundle also contains the month matrix's `min-width:1024px` and
  hard-coded empty-value fallbacks. Those are presentation/runtime choices, not
  requirements. Local intentionally keeps responsive width, unknown values,
  source-capital provenance and an explicit ruin floor.
- Local chart controls, timestamp positioning, zoom/pan/reset, risk sizing and
  scenario eligibility are already covered by the accepted chart receipts.

## Apply decision

The current bundle audit found **no unimplemented source-backed contract** in
the remaining pages. The matching behaviour is already present in the accepted
commits `2a1d537`, `7bd7ab4`, `5ff3f98`, `c8cd642` and `5499ed0`. The deliberate
differences are safety/data contracts: unknown is not zero, incomplete Live
costs stop a financial curve, and Prop/Live chart formulas are not inferred
from the backtest demo.

The bundle does reveal two behaviours that remain intentionally out of scope:
FX's production backend aggregation and populated Live partial-fill/cashflow
reconciliation. They need a controlled fixture or an official contract before
they can be applied without guessing.

## Time basis: Analytics, chart replay và Live

Source này không có một cờ thời gian dùng chung cho toàn bộ sản phẩm. Có hai
khái niệm phải giữ riêng:

1. **Mốc thời gian của dữ liệu**: timestamp của lệnh/sự kiện dùng để lọc và
   gom báo cáo.
2. **Đồng hồ và timeframe của chart**: cursor hiện tại của replay/live và độ
   dài mỗi nến dùng để lấy/render bars.

| Bề mặt | Mốc thời gian chính | Vai trò của chart timeframe | Có dùng realtime wall-clock không? |
| --- | --- | --- | --- |
| Testing Analytics / Sessions / Trades / Prop | Timestamp sự kiện backtest/replay; filter request chứa `backtestingDate`, `days`, `time`, `timezone` | Không quyết định bucket báo cáo; chỉ liên quan khi user đi từ chart vào đúng scope | Không |
| Chart backtest/replay | `currentReplayTimeMs` / `replayClockMs` | Có. Feed tính `fromTimestamp` bằng `timeframeMinutes` và làm tròn theo replay clock (`Math.floor(replayClockMs / timeframeMs)`) | Không; “Go to realtime” chỉ đưa viewport về mép dữ liệu/replay hiện tại |
| Chart Live | live server clock (`liveServerClock.nowMs()`) và live stream | Có. Timeframe vẫn quyết định aggregation/render bars | Có |
| Calendar dùng chung | `currentDateMs` của surface, bucket theo `chartTimezone`; ở replay đây là replay clock, ở Live là clock hiện tại | Không gom theo timeframe của nến | Chỉ ở Live |

### Bằng chứng source

- `chunk-PNLM7NI4.js`: default analytics state có `backtestingDateFilters` và
  `timezoneFilters`; `eo()` chuyển date/day/time/timezone thành request DTO,
  trong đó `backtestingDate` là khoảng ngày cụ thể, không phải `now`.
- `chunk-HIXL6TZD.js`: các route gọi `/analytics/calc/session/:id` và
  `/analytics/calc/prop-firm`; `formatFilterParams()` vẫn gửi
  `backtestingDate`, `time` và `timezone`.
- `chunk-XVHG5UTB.js`: chart data request truyền đồng thời `timeframeMinutes`
  và `replayClockMs`; `ge()` căn `fromTimestamp` theo timeframe và replay
  clock. Cùng chunk, `footerClockNowMs()` chỉ trả live server clock khi
  `liveMarketDataMode.isLive()`, còn replay dùng `currentReplayTimeMs`.
- Cũng trong `chunk-XVHG5UTB.js`, calendar builder nhận `replayClockMs` và
  `chartTimezone`; event tương lai bị ẩn/countdown theo clock của surface.

### Quy tắc áp dụng cho WMREPLAY

- Giữ **một time-basis contract cho từng surface**, không dùng một biến
  `realtime` toàn cục để điều khiển cả báo cáo và chart.
- Analytics backtest/session/prop dùng timestamp market/replay của bản ghi và
  timezone đang chọn. Không lấy `Date.now()` để phân loại ngày hoặc tính PnL.
- Chart replay dùng replay cursor để cắt dữ liệu; timeframe chỉ ảnh hưởng nến,
  viewport và indicator window.
- Live chart/account dùng server realtime; timeframe vẫn chỉ là resolution của
  chart.
- Radio `Chart / Realtime` của WMREPLAY là lựa chọn sản phẩm bổ sung cho dữ liệu
  có cả `close_time_utc` và `report_time_utc`; nó không phải control được xác
  nhận là FX có trong Analytics. Nhãn `Chart` nên được hiểu là **market/chart
  timestamp**, không phải timeframe hiện tại.

### Riêng các biểu đồ Performance trong Analytics

Với các biểu đồ trong tab Performance (Lãi và lỗ, theo giờ/ngày/tháng, equity,
drawdown), basis cần dùng để đạt parity với FX là **market/chart event time**:

- payload FX trả series `equityPositionAnalytics.pnlGraph` với `dateStart` và
  `dateEnd`; export `allTrades` cũng chỉ chuyển hai mốc này sang UTC;
- các nhóm `dailyPositionSummary`, `hourlyPositionSummary` và
  `timeSessionSummary` được tạo từ cùng analytics result, không có một trường
  `report_time`/wall-clock riêng;
- `timezoneFilters`/`timezone` chỉ đổi cách bucket và hiển thị ngày/giờ, không
  đổi event timestamp thành giờ hiện tại của máy.

Do đó điểm `07:18` trong chart demo là **thời gian của event trong phiên
backtest** (ví dụ thời điểm đóng lệnh), không phải thời điểm người dùng đang
ngồi xem. “Realtime” chỉ phù hợp khi WMREPLAY đang phân tích `report_time_utc`
hoặc dữ liệu Live; không dùng nó làm basis mặc định cho các chart Performance
backtest.

## Verification

- Static bundle scan: 254 chunk references; 244 downloaded; selected route
  chunks hash-pinned above.
- Local analytics/chart model suite: use the existing receipts for 103/103
  model tests, 66/66 independent source tests and deployed chart/regression QA.
- No FX tab refresh, no authenticated API call, no write, no broker action.

## Local recheck after audit

- Re-ran the focused Dashboard/Sessions/Trades/Analytics/Calendar/Live model
  suite on the current checkout: **109 tests passed, 0 failed**.
- Rebuilt the frontend with `npm run build`: passed; only the existing Vite
  chunk-size warning remains.
- This recheck confirms the apply decision above; it did not require a source
  change because the matching behavior is already in the accepted commits.
