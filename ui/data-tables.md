# Bảng dữ liệu

Consumer pin: [data-table@0.2.0](../../../UI-Systems/components/data-table/0.2.0/CONTRACT.md).
Giữ palette `annam-compact@0.1.1`; không thay token pin.

## Ownership

- `DataTable.jsx` / `data-table.css`: native table, scroll owner, sticky header,
  hover/selected/action và căn số.
- `SortableColumn`: toàn ô header là nút, icon có slot riêng; multi-sort dùng số
  ưu tiên và `aria-sort` cho cột ưu tiên đầu. `useTableSort.js` dùng chung state,
  thêm/đổi chiều/xóa, thông báo truy cập và reset trang cho grid local;
  `tableModel.js` so sánh giá trị và giữ unknown ở cuối.
- `PaginationFooter`: count trong phạm vi lọc, pager, page size; thu gọn theo chiều
  rộng của footer. Popup dùng overlay có sẵn.
- Consumer giữ cách lấy dữ liệu, tính tiền, quyền thao tác và trạng thái đọc.

## Cuộn và bảng dài

`DataTable` giữ native scroll hai chiều trong cùng viewport, không xử lý wheel
bằng JavaScript. `contained` là opt-in giới hạn layout/paint; hiện áp dụng cho
Trades sau kiểm tra sticky header, focus và overlay. Không bật trên mọi bảng.
Footer là sibling bên ngoài; trang Trades không thêm scrollbar dọc thứ hai.

`VirtualTableBody` là biến thể cho bảng dài có dòng cao cố định, không thay thế
server paging. Trades hiện vẫn dựng tối đa page_size (10/25/50/100) dòng native.
Biến thể nhận `rows`, `columns` (key/className/render), `getRowKey`, `viewportRef`,
`rowHeight` (mặc định 60), `overscan` (6), `headerRows` (1), `getRowProps` tuỳ chọn.
Consumer khai báo `colgroup`, fixed table layout và `aria-rowcount` gồm header;
component giữ row index thật, spacer ẩn và tối đa một dòng đang focus ngoài cửa sổ.
Scroll ngang không cập nhật state cửa sổ dòng. Scope/filter/sort và selection
vẫn do consumer giữ; không tải cả ledger thật để dùng virtualization.

Chỉ hỗ trợ cell một dòng, clip/ellipsis nội dung dài; control phải nằm trong
chiều cao đã chọn. Dòng nhiều dòng, mở rộng chi tiết hoặc chiều cao thay đổi vẫn
dùng bảng native. Tìm trong trang/in/Tab tuần tự chỉ thấy dòng đang dựng; dùng
native paging khi cần duyệt đầy đủ bằng các cách đó.

Mẫu 10.000 dòng: `?workspace=tenant-a&area=testing&ui_reference=1#virtual-table`.
Mẫu hỗ trợ cả hai chiều, nhảy đầu/cuối, lọc, sort và giữ chọn bằng ID. Không đọc
hay ghi giao dịch thật. Contract mới không thay palette/token pin.

Trades giữ tên cột thời gian một dòng (`Vào lệnh (Realtime)`, `Vào lệnh (Chart)`
và tương tự cho thoát lệnh). Múi giờ dùng chung với Settings, chọn ở đồng hồ
cạnh Không gian làm việc ở sidebar; màn hình chart không có sidebar giữ đồng hồ
trên toolbar. Không lặp lại trong footer của grid. Giữ tên IANA để tính
đúng offset tại mỗi mốc lịch sử/DST.

Tên, nhãn và thời gian căn trái; số căn phải; trạng thái/badge, checkbox và
thao tác căn giữa. Header và nội dung dùng cùng trục và padding; icon sort nằm
trước nhãn số, còn nhãn căn giữa có khoảng icon cân xứng hai bên để không lệch tâm.

Các grid có header sort dùng click thường để thêm cột/đổi chiều, gồm bảng mẫu
design system, Kho dữ liệu, Tài khoản/Dòng tiền, broker/manual và giao dịch gần đây.
Header đang sort có viền cam mảnh phủ toàn ô với góc vuông; các ô kề nhau dùng
chung đường phân cách ở giữa, không tạo khe hoặc viền đôi. Nền pha cam nhẹ, chữ
theo theme và SVG mũi tên bo nét, số ưu tiên nhỏ màu cam dạng superscript; không
dùng màu để thay cho thứ tự bằng số. Slot điều khiển rộng 28px, còn nhãn giữ
kích thước tối thiểu theo nội dung để không bị dồn vào icon; bảng cuộn ngang khi
viewport không đủ chỗ. Nút bỏ sort có slot 28px riêng, không có vạch ngăn bên
trong header và không đè lên text hoặc icon. Ô `#` chuyển thành nút `×` có nền
pha cam và chữ theo theme khi có sort; xóa hết sẽ trở lại `#`. Header sở hữu
viền cam vuông phủ toàn ô, kể cả ô reset; button không vẽ thêm viền. Các cạnh
ngang chạy hết chiều rộng ô, cạnh dọc chung chỉ do ô bên trước vẽ, tránh viền
đôi hoặc góc khuyết khi ô reset sát header đang sort.
`SortResetColumn` dùng chung, không làm dịch các cột khi bật/tắt. Nhãn truy cập
giữ rõ chức năng xóa. Trades tổng hợp tiếp tục gửi toàn bộ thứ tự sort tới server;
grid local lọc và sort toàn bộ phạm vi trước phân trang. Bảng metric/luật Prop
không có header sort giữ thứ tự nghiệp vụ.

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

Các grid giữ thứ tự mặc định phù hợp nhưng không tô header hay hiện mũi tên như
sort người dùng đã chọn: Kho dữ liệu/Tài khoản theo tên, giao dịch/Dòng tiền mới
nhất trước. Bấm header lần đầu sort tăng dần, lần tiếp theo đổi chiều; đổi sort
về trang đầu. Chỉ lúc đó header mới hiện viền, nền và mũi tên (cùng `aria-sort`).
Mẫu bảng trong design system áp dụng cùng hành vi. Kho dữ liệu không
tự mở chi tiết khi URL còn dataset từ trang trước. Mở chi tiết qua thao tác của
người dùng; Tuỳ chọn bảng dùng trigger chữ và chevron tiêu chuẩn.

## Consumers và kiểm tra

Áp dụng cho Trades, Kho dữ liệu, danh mục lịch sử broker, Tài khoản/Dòng tiền,
broker deals, giao dịch thủ công/nhãn, bảng gần đây trong báo cáo, bảng chi tiết
scenario và mục tiêu Prop. Docks đặt lệnh/position trong chart giữ contract riêng.

Mẫu tương tác: `?workspace=tenant-a&area=testing&ui_reference=1#data-table`.
Dữ liệu minh hoạ có 35 dòng, Nhóm B ở trang cuối, đủ trạng thái ready/loading/
empty/error/stale/unknown. Không ghi dữ liệu thật.

Bằng chứng task: `foundation_v2/evidence/grid-system-20261025/RECEIPT.md`.
Cuộn/virtualization: `foundation_v2/evidence/table-scroll-performance-20261027/RECEIPT.md`.
