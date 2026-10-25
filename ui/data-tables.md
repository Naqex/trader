# Bảng dữ liệu

Consumer pin: [data-table@0.1.0](../../../UI-Systems/components/data-table/0.1.0/CONTRACT.md).
Giữ palette `annam-compact@0.1.1`; không thay token pin.

## Ownership

- `DataTable.jsx` / `data-table.css`: native table, scroll owner, sticky header,
  hover/selected/action và căn số.
- `SortableColumn`: toàn ô header là nút, icon có slot riêng, `aria-sort` chỉ ở cột
  đang chọn. `tableModel.js` so sánh giá trị và giữ unknown ở cuối.
- `PaginationFooter`: count trong phạm vi lọc, pager, page size; thu gọn theo chiều
  rộng của footer. Popup dùng overlay có sẵn.
- Consumer giữ cách lấy dữ liệu, tính tiền, quyền thao tác và trạng thái đọc.

Trades giữ tên cột thời gian một dòng (`Vào lệnh (Realtime)`, `Vào lệnh (Chart)`
và tương tự cho thoát lệnh). Múi giờ dùng chung với Settings, chọn ở đồng hồ
cạnh Không gian làm việc ở sidebar; màn hình chart không có sidebar giữ đồng hồ
trên toolbar. Không lặp lại trong footer của grid. Giữ tên IANA để tính
đúng offset tại mỗi mốc lịch sử/DST.

Tên, nhãn và thời gian căn trái; số căn phải; trạng thái/badge, checkbox và
thao tác căn giữa. Header và nội dung dùng cùng trục và padding; icon sort nằm
trước nhãn số, còn nhãn căn giữa có khoảng icon cân xứng hai bên để không lệch tâm.

Trades multi-sort dùng click thường để thêm cột/đổi chiều. Header đang sort có nền
xám và SVG mũi tên bo nét, số ưu tiên nhỏ màu cam dạng superscript; không dùng màu
để thay cho thứ tự bằng số. Slot 26px đủ cho ưu tiên hai chữ số. Nút bỏ sort nằm
trong padding mép header, không thêm một vùng flex riêng hoặc placeholder; chiều
rộng và trục text không đổi khi bật/tắt sort. Ô `#` chuyển thành nút `×` màu cam
khi có sort; xóa hết sẽ trở lại `#`. Nhãn truy cập giữ rõ chức năng xóa.

## Data contract

Luôn lọc **toàn bộ phạm vi** rồi sort, đếm và lấy trang. Trades tổng hợp gửi
`filters/extra_filters`, sort, page, page_size đến `/api/v2/replay/trades`.
Server trả `ledger` tối đa page_size, `filtered_count`, `page_count`, facets của
toàn scope. Request cũ bị hủy/bỏ qua khi query đổi. Không tải full ledger về để
lọc trên trang hiện tại. Các catalog nhỏ có đủ dữ liệu dùng pipeline tương tự
trong bộ nhớ; chưa chuyển chúng sang server paging khi chưa có nhu cầu đo được.

Đổi filter/scope/sort/page size về trang đầu; chọn dòng giữ qua đổi trang và sort,
nhưng xóa khi đổi scope/filter. Checkbox header chỉ chọn trang hiện tại.

Kho dữ liệu sort trực tiếp trên tám header. `Mới cập nhật` giữ trong Tuỳ chọn
bảng vì khác với ngày kết thúc lịch sử. Sort ngày dùng đúng metadata đang hiển
thị, thống nhất epoch seconds/milliseconds và ISO. Tìm không dấu hoặc nhiều từ
khác thứ tự dùng chuẩn search chung; server Trades dùng cùng quy tắc.

## Consumers và kiểm tra

Áp dụng cho Trades, Kho dữ liệu, danh mục lịch sử broker, Tài khoản/Dòng tiền,
broker deals, giao dịch thủ công/nhãn, bảng gần đây trong báo cáo, bảng chi tiết
scenario và mục tiêu Prop. Docks đặt lệnh/position trong chart giữ contract riêng.

Mẫu tương tác: `?workspace=tenant-a&area=testing&ui_reference=1#data-table`.
Dữ liệu minh hoạ có 35 dòng, Nhóm B ở trang cuối, đủ trạng thái ready/loading/
empty/error/stale/unknown. Không ghi dữ liệu thật.

Bằng chứng task: `foundation_v2/evidence/grid-system-20261025/RECEIPT.md`.
