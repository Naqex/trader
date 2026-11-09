# Cổng dịch vụ local

`foundation_v2/local-services.json` giữ cổng của các dịch vụ riêng cho Trader.
Frontend, Paperclip launcher và gateway Rust đọc cùng file này. Không dùng cổng
mặc định của app cài riêng trên Windows hoặc tự kết nối vào process chiếm cổng.

| Dịch vụ | Cổng loopback | Owner |
|---|---:|---|
| UI xem trước AI | 5218 | `web/serveAiPreview.mjs` |
| CLIProxyAPI của Trader | 17852 | API Rust, `ai_gateway_runtime.rs` |
| Paperclip UI/API | 17860 | workspace `tooling/paperclip/run-local.mjs` |
| Paperclip PostgreSQL | 17861 | cùng instance Paperclip |
| Paperclip Vite HMR | 27860 | upstream quy định UI/API + 10000 |

CLIProxyAPI Windows đang dùng `8317` là instance ngoài workspace. Không sửa
config, auth, key hoặc lifecycle của nó. Bản Trader giữ home riêng tại
`projects/trader/.runtime/mt5-ai-gateway/`, không import tài khoản từ Windows.
Trong runtime Trader, gateway được bật qua API Trader; mở UI preview không tự
khởi động nó. Owner có thể yêu cầu chạy standalone dùng cùng config/auth; PID/log
được ghi tại `.runtime/paperclip/gateway-owner.json` của workspace. Dừng đúng
standalone owner trước khi giao quyền quản lý gateway lại cho API Trader.

AI preview kiểm tra trang quản trị qua GET cố định
`/integrations/cliproxyapi/health`, rồi nhúng trực tiếp origin17852. Bridge không
đọc khóa, không proxy management API và không giả lập trạng thái kết nối của
Trader. Khi host trả `ui_preview_services_not_connected`, panel dùng bridge này
và không gửi refresh tới API Trader khi rời tab; runtime Trader giữ luồng cũ.

## Khi thêm dịch vụ hoặc đổi cổng

1. Kiểm listener và command line/owner trước khi cấp cổng. Cổng trong bảng là
   cổng đã chọn cho workspace, không phải bảo đảm Windows luôn để trống.
2. Sửa JSON và consumer liên quan; cập nhật bảng này. Dành `17850–17879` cho
   integration mới khi còn trống. HMR và OAuth callback có quy tắc riêng.
3. Nếu cổng bận, báo conflict; không kill process lạ, tự tăng cổng hoặc fallback
   sang instance bên ngoài. Paperclip launcher kiểm cả API, HMR và database.
4. Với instance có dữ liệu, backup trước; dừng đúng owner, đổi port trong private
   config, build lại frontend và restart dịch vụ liên quan. Không reset database
   hoặc đổi home chỉ để đổi cổng. JSON Rust được nhúng khi compile: đổi gateway
   port cần rebuild API, không chỉ restart binary cũ.
5. Kiểm health/iframe và instance identity sau đổi cổng. Quyền broker/provider
   không thay đổi theo port. Không suy từ một listener khỏe rằng đó là app của mình.

Gateway OAuth Google hiện dùng callback cố định `51121` theo binary đã pin;
port này chỉ mở trong luồng đăng nhập, không là gateway HTTP listener. Không chạy
hai luồng login cùng lúc khi chưa có callback isolation được kiểm chứng.

UI/API Trader chính giữ profile runtime hiện hữu; preview AI không thay thế API
Trader và không tự chuyển database chính. Hướng dẫn Paperclip, private config và
rollback nằm ở workspace `tooling/paperclip/README.md`.

Sidebar cấp sản phẩm giữ lựa chọn thu gọn/mở rộng của người dùng trên desktop,
kể cả khi mở Paperclip. Mobile tiếp tục dùng navigation drawer theo kích thước màn hình.
