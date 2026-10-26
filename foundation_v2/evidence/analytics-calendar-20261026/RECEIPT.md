# Analytics / Live calendar — 26/10/2026

## Scope đã thực hiện

Owner duyệt triển khai calendar sau research. Analytics làm trước; chỉ calendar
presentation được áp dụng sang Live. Không sửa toàn bộ Live hoặc các nhóm biểu đồ
khác. FX là demo reference; không dùng số demo làm oracle hoặc mở FX/reload trang.

- Analytics: Month/Year, nút tháng/năm đi qua tháng trống, lịch đủ tuần Monday-first,
  title ngoài card + help VI/EN, daily read-only detail và tổng tháng/năm.
- Dated unknown-PnL rows vẫn vào calendar/count/detail. Thiếu PnL giữ N/A và partial;
  thiếu timestamp hoặc partial nguồn không được coi là tổng đầy đủ. R có coverage.
- Win rate gộp wins/count; average R gộp averageR×rCount/rCount. Zero, empty và unknown
  phân biệt. Không suy ra mẫu số Current Balance hoặc thay R thiếu bằng0.
- Live dùng chung navigation/grid/day; giữ adapter tiền/coverage, totals tuần/tháng,
  MT5 filled deals/manual trades, account selection, note/review và sidebar.
- Mobile Month cuộn ngang trong calendar để giữ số; Year xếp lại theo chiều rộng.
  Không có page horizontal overflow trong các cỡ đã kiểm.

Data flow: raw ledger → buildAnalyticsModel → advancedAnalytics calendar day stats
→ AnalyticsCalendar weighted summaries → CalendarView. Live payload/deals/filters
→ calendarWeeks (coverage/DST) → CalendarView; summary/review vẫn do Live quản lý.

## Validation và rollout

Raw/script/report/ảnh giữ local tại
`E:/BACKUP-TRADINGWORKSPACE/analytics-calendar-20261026/`.

- Build từ tracked HEAD65260f1 + task overlays, dùng dependency hiện có; loại WIP
  ReplayWorkspace/learnIntegration/visual-polish không liên quan, giữ release CSS
  overlays đã chấp nhận. Manifest `build.json` ghi hash từng source/index.
- 46 focused model tests PASS: calendarViewModel, analyticsCapital,
  analyticsAdvancedMetrics, liveWorkspaceModel, liveCalendarAccounts. Có leap month,
  DST/timezone midnight, weighted ratios, missing PnL/time/R và partial source.
- Preview và deployed Analytics QA12/12 PASS mỗi lượt: actual GET-only session ở
  1920VI dark/768EN light/320VI dark/390EN light; month/year, ngày rỗng, keyboard,
  help bounds. Fixture weighted/unknown/undated/partial/stale/empty/denied/error.
- Actual sample: net−2.28USD/count1/win rate0/R unknown, không viết dữ liệu.
- Live partial multiaccount fixture2/2 ở1920/390: subtotal25, partial ở day/week/month,
  unknown day không biến thành0, day detail. Independent adapted account flow3/3:
  multi/single/search/reload/none/mixed currency/unavailable, cả VI/EN/light/dark.
- Independent review PASS (`independent-review.json`), bắt được ngày12 xuống dòng
  mobile; đã sửa nowrap/flex-shrink và kiểm lại screenshot/geometry.
- Atomic UI promotion, giữ old assets + private branding; không restart API/MT5.
  Index trước `7781d432151f8ebab0b45b17759aa2be5fcc9cf6b1c100f9ba9e705b18804d00`;
  served index mới `72eb2fb23571239862379878f8764a361bee44eef5d915f4fedfbbb266165aa2`.
  `promotion.json` và `deployed-runtime.json` xác nhận hash; rollback index/private
  assets ở `ui-before-release/`. Preview5197 do task sở hữu được tắt sau kiểm.

Các lần QA thất bại được giữ/ghi nhận: kỳ vọng money text cũ không theo shared
currency formatter; test dùng empty-calendar khi page thực tế có empty state;
tooltip bị scroll event sau focus đóng lại (probe xác định event ordering, bài test
đợi scroll render trước Enter); stale status locator theo copy cũ và account picker
selector/glyph cũ. Sửa kỳ vọng theo source/DOM hiện tại; không thay tooltip/status
hoặc logic tiền để làm xanh bài kiểm. `preview-qa-tooltip-attempt.json`,
`tooltip-probe.*` và `independent-live-accounts/attempt-1-report.json` giữ bằng chứng.

## Giới hạn

Live browser dùng labeled fixtures và chặn broker; không phải xác nhận dữ liệu broker
thật hoặc quyền giao dịch. Analytics real read không chứng minh mọi dataset/scale.
Không xác nhận công thức/backend FX từ demo. Chưa thêm calendar% hoặc basis mới;
không thay đổi state/formula của các chart khác hoặc tự công nhận toàn bộ Analytics.
