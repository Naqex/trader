# Quy trình đối chiếu một page với FX Replay

Owner yêu cầu lưu cách làm ngày 26/10/2026. Dùng cho các page tiếp theo, bắt đầu
bằng mức kiểm tra nhẹ. Đây là reference thao tác, không cấp quyền sửa dữ liệu
FX, tạo giao dịch, đổi runtime hay tự mở rộng Product Plan.

## 1. Chốt phạm vi và ghi baseline

- Một page mỗi lượt. Ghi URL, tab, ngôn ngữ, timezone, source, kỳ, phiên và trạng
  thái tài khoản/retention. Version không đọc được thì ghi chưa rõ.
- Đọc reference đã có và source bên mình trước. Ghi Git HEAD, dữ liệu thật/demo;
  không kết luận lỗi chỉ từ chênh lệch số giữa hai bộ dữ liệu khác nhau.
- Tạo thư mục bằng chứng riêng trên E, lưu checkpoint sau từng kỳ. Browser đang
  đăng nhập cần app còn kết nối; checkpoint giúp tiếp tục khi app restart, không
  cần sao chép profile, cookie hoặc phiên đăng nhập ra một browser khác.
- Nếu owner mở sẵn trạng thái tạm và yêu cầu không refresh, chỉ bind tab hiện có,
  lưu screenshot/full AX trước rồi thao tác trong document. Không goto lại cùng
  URL, reload hoặc chuyển route để tìm trạng thái; chụp ảnh và đối chiếu tab khi
  tool thấy khác ảnh owner. Không tự bật demo thay trạng thái owner đã chuẩn bị.

## 2. Đi từ UI đến số liệu đang vẽ

1. Đọc tiêu đề, (i), trục, đơn vị, legend, số tổng, tooltip từng điểm mẫu.
2. Giữ nguyên source, đổi một bộ lọc mỗi lần. Với Dashboard: Lifetime → Last
   week → Last month → Lifetime. Chờ dữ liệu cập nhật, không dùng frame vừa click.
3. Ưu tiên DOM/Playwright trong tab đã mở. Với SVG, đọc nhãn và thuộc tính số
   gắn trực tiếp vào cột; không đọc state nội bộ Angular/React/ApexCharts.
4. Rê chuột bằng API hover nếu có. Nếu không có, dùng CDP
   `Input.dispatchMouseEvent` với tọa độ lấy từ DOM của đúng phần tử đã quan sát.
   Đọc lại tooltip sau mỗi lần rê; lưu một ảnh đủ ngữ cảnh để kiểm chứng.
5. Ghi rõ zero, null/unknown, không có mẫu và dữ liệu chưa tải; không tự coi chúng
   là cùng một trạng thái. Đừng tự lấp ngày thiếu bằng ngày thị trường/hôm nay.

## 3. Khi đọc được response của chính trang

Chỉ quan sát request phát sinh từ thao tác UI đã được giao. Không tạo API client
riêng, trích token, đọc cookie, gọi endpoint đoán mò hoặc bỏ qua paywall.

CDP trong tab hiện hỗ trợ quy trình đã dùng thành công:

```text
Network.enable
cursor = readEvents(methods=[Network.responseReceived]).cursor
thao tác bộ lọc bằng locator UI đã quan sát
readEvents(afterSequence=cursor, methods=[Network.responseReceived])
chọn đúng response của page dựa trên URL thực tế vừa quan sát
Network.getResponseBody(requestId)
lưu JSON nghiệp vụ local; bỏ request/response headers và cookie
đối chiếu response với DOM và tooltip sau khi tải xong
Network.disable trong bước dọn dẹp
```

Chỉ giữ metadata cần thiết như pathname, query scope, status. Không dump toàn bộ
network event ra chat: event có thể chứa headers. Nếu capability không hỗ trợ,
dùng UI/tooltip và ghi giới hạn; không cài thêm công cụ chỉ cho đủ bằng chứng.

Ví dụ Dashboard đã quan sát: `/analytics/api/v1/analytics/calc/global`, query
`timezone`, `analyticsRange`, `projectTypes[]`. Đây là endpoint tham chiếu của
lượt này; page khác phải lấy endpoint từ thao tác của page đó.

## 4. Kiểm tra số học có thể làm độc lập

| Loại dữ liệu | Kiểm tra |
| --- | --- |
| Thời gian/số tiền | Chuẩn hóa đơn vị, cộng các bucket, so với tổng; ghi sai số làm tròn |
| Số lệnh theo mã/hướng | Cộng nhóm so với total trong đúng scope; phân biệt open/closed/partial fill |
| Tỷ lệ | Cần tử số và mẫu số cùng scope; không lấy trung bình các tỷ lệ khi chưa biết trọng số |
| Kỳ và ngày | Đọc timestamp + timezone thật; đếm bucket, kiểm ngày đầu/cuối; phân biệt kỳ lịch với cửa sổ trượt |
| Hiển thị | Response → giá trị gắn vào cột → tooltip; phân biệt lỗi tính toán với lỗi format/axis |

Nếu danh sách giao dịch truy cập được, kiểm một mẫu nhỏ. Ghi filter, pagination,
retention, số dòng đang mở/đã đóng và PnL sau phí. Summary của một phiên không
phải oracle cho Dashboard toàn bộ phiên. Không mở rộng thành audit page Trades.

## 5. Kết luận và điểm dừng

Mỗi kết luận ghi một trong: **quan sát UI**, **khớp response**, **xác minh source
bên mình**, **suy luận**, **chưa rõ**. Response chỉ chứng minh dữ liệu frontend
nhận được, không tự chứng minh cách backend tạo ra con số.

Dừng mức nhẹ khi đã có một vòng bộ lọc, điểm mẫu/response và kiểm tra số học.
Nếu vẫn thiếu mẫu số, lịch sử bị ẩn hoặc cần reverse backend, ghi chưa rõ và bỏ
qua phần đó theo ý owner. Không phải truy ra mọi công thức mới hoàn thành audit.

Đề xuất cụ thể theo bốn loại: giữ, học theo, điều chỉnh, bỏ qua. Với mỗi đề xuất,
ghi hành vi trước/sau và lý do. Đề xuất chưa phải quyền triển khai. Đổi độ chi
tiết ngày/tháng cần dữ liệu hoặc projection tương ứng; không chia dữ liệu tháng
thành ngày giả chỉ bằng formatter.

## 6. Lưu kết quả và dọn dẹp

- Trong Git: ghi chú tự đọc được, workflow, manifest hash, đề xuất và giới hạn.
  Raw response, giao dịch, DOM và ảnh tài khoản giữ local trên E.
- Raw folder: `context.json`, response từng scope, DOM/ảnh mẫu, `calculations.json`,
  `manifest.json`, `RESUME.md`. Có thể lưu script tính toán offline để chạy lại.
- Trả page/source/filter về baseline; đóng modal, bỏ viewport override, tắt Network
  debug đã bật. Không đóng tab của user. Ghi rõ phần nào chưa làm.
- Review diff và commit riêng phần reference; không trộn WIP hay triển khai UI.

Mẫu ngắn dùng cho page mới:

```text
Page/ngày/version/HEAD:
Scope nguồn + kỳ + timezone + tập dữ liệu:
Chỉ số/biểu đồ | định nghĩa UI | trường response | công thức source bên mình
Điểm mẫu + phép tính độc lập:
Khớp/khác/chưa rõ + mức bằng chứng:
Giữ/học theo/điều chỉnh/bỏ qua:
Giới hạn + trạng thái đã khôi phục:
Raw evidence path + hashes:
```

Lượt mẫu: [Dashboard charts](testing-dashboard-charts.md).
