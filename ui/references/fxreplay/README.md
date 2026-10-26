# FX Replay — tham chiếu sản phẩm

Reference do owner yêu cầu ngày 26/10/2026: đi từng trang, kiểm chứng hành vi,
logic tính toán và hiển thị giữa FX Replay web với WMREPLAY trước khi quyết định
học theo, điều chỉnh hoặc lược bỏ.

| Trang | Reference | Phạm vi đã làm |
| --- | --- | --- |
| Testing → Dashboard | [Đối chiếu ngày 26/10/2026](testing-dashboard.md) | UI đăng nhập thật, đổi kỳ FX, API và source WMREPLAY |

## Cách đọc và tiếp tục

- **Quan sát:** kết quả nhìn thấy trong UI hoặc DOM của phiên đang mở.
- **Xác minh source:** lần theo source WMREPLAY và đối chiếu response runtime.
- **Suy luận:** giả thuyết có bằng chứng gợi ý, chưa đủ để khẳng định công thức.
- **Chưa rõ:** cần dữ liệu đối chứng hoặc tài liệu chính thức; không coi là parity.

FX Replay là reference, không phải oracle mặc định cho mọi công thức. Frontend
và tooltip không chứng minh implementation backend. Hai bên chưa có cùng bộ
giao dịch nên không so số tuyệt đối để kết luận đúng/sai.

Mỗi lần kiểm tra sau phải ghi version, scope, dữ liệu và ngày kiểm tra; giữ lại
bằng chứng cũ. Đề xuất trong reference chưa tự trở thành quyết định triển khai
hay trạng thái hoàn thành của Product Plan.

Ảnh, DOM snapshot và response thô nằm ngoài Git tại
`E:/BACKUP-TRADINGWORKSPACE/fxreplay-reference-20261026/testing-dashboard/`.
Chúng có dữ liệu tài khoản, chỉ dùng local. Manifest trong thư mục này ghi hash
để đối chiếu; ghi chú trong repo vẫn đọc được khi ổ bằng chứng không gắn.
