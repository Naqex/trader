# Testing Analytics — đối chiếu theo từng cụm

**Bổ sung cùng ngày:** owner đã mở rộng scope sang toàn bộ Sessions/Prop, Live và
chart backtest. Xem [audit mở rộng](analytics-live-charting-audit.md) cho trạng thái
hiện tại. Các dòng “chưa audit trong lượt này” và giới hạn calendar-only dưới đây
ghi lại checkpoint ban đầu, không còn là phạm vi hiện hành.

Owner giao ngày26/10/2026: research từng phần vì có nhiều biểu đồ, công thức và
trạng thái. Calendar làm bên Analytics trước, rồi áp dụng phần phù hợp cho **riêng
khu vực calendar của Live**. Không lấy việc dùng chung lịch làm lý do sửa toàn bộ
Live, toolbar, tài khoản, nhật ký hoặc các trang khác.

## 1. Thứ tự và mức bằng chứng

| Cụm | Nội dung | Trạng thái |
| --- | --- | --- |
| Calendar | Ngày/tháng/năm, chỉ số, màu, phạm vi dữ liệu; liên hệ Live | [Research và triển khai calendar](testing-analytics-calendar.md); receipt `foundation_v2/evidence/analytics-calendar-20261026/RECEIPT.md` |
| PnL + RR | Curve/bucket, số tổng, win rate/BE, RR thực hiện/ideal | Chưa audit trong lượt này |
| Expectancy + Profit factor + Winners/Losers | Mẫu số, phí, chuỗi, thời gian giữ, edge cases | Chưa audit trong lượt này |
| Side + phiên + giờ/ngày/tháng + frequency | Timestamp/timezone, gộp nhóm, return %, số kỳ rỗng | Chưa audit trong lượt này |
| Drawdown | Equity/balance, %, episode/recovery, sắp xếp dọc | Chưa audit trong lượt này |
| Simulation | Input, mô hình, seed, phạm vi suy diễn | Chưa audit trong lượt này |

Mỗi cụm dùng workflow đã lưu: UI/(i) → response quan sát được → source local →
phép tính độc lập → đề xuất rõ trước/sau. Không so số tuyệt đối giữa hai dataset.
Raw giữ local trên E; ghi chú này không phải ledger dự án hay dấu hoàn thành
toàn trang. Calendar là lát research đầu tiên, các dòng khác chỉ định vị phạm vi.

## 2. Baseline

- FX: `https://app.fxreplay.com/en-US/auth/testing/analytics-backtesting`,
  version2.0.3828-prod, Free, Sessions/Performance, demo analytics. Calendar
  Testing có blur/upgrade gate ở lần đầu. Sau khi owner mở sẵn toàn bộ biểu đồ,
  đã xác minh menu calendar, Initial/Current và Month/Year bằng UI bình thường;
  xem phần bổ sung trong reference calendar. Giữ nguyên document, không refresh.
  Không thử gọi control bị khóa hoặc API ẩn.
- Local: Testing/Analytics/Sessions/Performance, phiên đang chọn có một giao dịch
  đã đóng; timezone Settings Asia/Ho_Chi_Minh, market clock, USD. Source baseline
  `66c091b`; thay đổi Trades help trong cùng lượt không đổi Analytics.
- FX Live chỉ được mở để so **calendar**: cùng version, hai tài khoản đã được chọn
  sẵn. Xem tháng10 và9/2026, rồi trả tháng10; đều không có giao dịch. Không sửa
  tài khoản, ghi chú, review hoặc giao dịch. Đã trả FX về Testing Analytics.

Evidence: `E:/BACKUP-TRADINGWORKSPACE/fxreplay-reference-20261026/testing-analytics/`.
