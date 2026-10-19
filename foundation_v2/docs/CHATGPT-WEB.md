# Kết nối ChatGPT Web cho MT5

Core dùng chung nằm trong repo TradingWorkspace tại `tooling/chatgpt-web-core`.
MT5 sở hữu prompt, schema chiến lược, kiểm tra kết quả và trạng thái tác vụ;
core chỉ vận chuyển yêu cầu văn bản tới ChatGPT Web. Không chạy Codex CLI,
Cockpit UI, MCP, shell hoặc subagents từ luồng này.

## Đăng nhập từ web MT5

Mở **Settings → ChatGPT → Kết nối ChatGPT**. Backend khởi động core riêng,
mở Chrome với profile của MT5. Đăng nhập trực tiếp trên ChatGPT, sau đó đóng
cửa sổ Chrome riêng để core xác minh và lưu phiên. Không nhập mật khẩu hoặc
paste token trên web MT5. Có thể hủy đăng nhập từ Settings.

Đây là thao tác kết nối được quản lý từ web MT5, còn màn hình xác thực vẫn
nằm ở Chrome riêng. Chưa có OAuth popup/callback hoặc login nhúng trong web.
Owner đã chọn đăng nhập sau; hiện chưa có tài khoản thật được xác minh.

Sau đăng nhập, chọn model/mức suy luận rồi bấm **Kiểm tra kết nối**: core gửi
một câu thử cố định, ngắn và hiển thị thời điểm có phản hồi thành công. Việc
có phiên đã lưu hoặc thấy model trong danh sách chưa chứng minh model đó còn
dùng được. Phiên hết hạn/model không phù hợp/hạn mức lỗi được báo ở phần này.

Kết nối dùng chung giữa các workspace được cấp quyền trên cùng máy local;
UI ghi rõ phạm vi. Không phải đăng nhập người dùng cho một dịch vụ hosted.
Ngắt kết nối xóa state Chrome riêng của MT5, không ảnh hưởng VI Dubber hoặc
phiên ChatGPT trên thiết bị khác. Không tự khởi động khi chỉ mở Settings.

## Chuẩn bị runtime riêng

Tại repo TradingWorkspace, dùng Bun 1.4.2 và dependency lock đã nhập:

```powershell
Set-Location tooling/chatgpt-web-core
bun install --frozen-lockfile --ignore-scripts
bun run typecheck
bun test tests/core.test.ts
```

Tại gốc repo MT5:

```powershell
.\scripts\chatgpt_web.ps1 -Action Init
.\scripts\chatgpt_web.ps1 -Action Status
.\scripts\chatgpt_web.ps1 -Action Login
.\scripts\chatgpt_web.ps1 -Action Serve
```

CLI vẫn dùng được nếu không mở web. `Login` là bước tương tác do owner thực hiện: mở Chrome riêng, đăng nhập ChatGPT,
đóng cửa sổ để core kiểm tra composer và ghi nhận khả năng model. Không sao chép
cookie từ VI Dubber hoặc tài khoản của app khác. `Serve` chạy foreground,
Ctrl+C dừng provider đó; không cài service/autostart. Chạy `Status` chỉ đọc config
và marker đã có, không chứng minh phiên đăng nhập còn hợp lệ trên mạng.

Mặc định: `127.0.0.1:17851`; home `.runtime/mt5-chatgpt-web` ở workspace.
VI Dubber vẫn giữ core/runtime hiện tại ở port17850. Hai ứng dụng có thể dùng
cùng source trong tương lai nhưng không dùng chung home, token hoặc hàng đợi.
Clone MT5 riêng có thể truyền `-CoreDirectory` và `-RuntimeHome` rõ ràng.
Backend cũng nhận `TW_CHATGPT_WEB_CORE`, `TW_CHATGPT_WEB_HOME`,
`TW_CHATGPT_WEB_BUN` (absolute paths) và `TW_CHATGPT_WEB_PORT` từ cấu hình server.
Không nhận các đường dẫn hoặc token từ request UI. Bản core chạy thủ công trên
cổng đã dùng sẽ không được backend tự nhận quyền sở hữu; dừng bản đó trước.

Windows Job Object sở hữu toàn bộ cây Bun/Chrome, dừng cùng API kể cả API crash.
Không thêm service Windows hay sửa profile Codex/Cockpit. Runtime không khởi
động tài khoản/đăng nhập tự động sau khi API restart; owner kết nối lại để nạp
state đã lưu rồi kiểm tra model nếu cần.

## Ranh giới HTTP

- `GET /healthz`: liveness, số request đang chạy và trạng thái marker đăng nhập.
- `GET /v1/models`: catalog được core quảng bá theo khả năng đã ghi nhận lúc login.
  Đây không phải xác minh model trực tiếp với ChatGPT ở mỗi lần gọi.
- `POST /v1/responses`: text-only, không stream, tối đa64KiB/64messages,
  một request đang chạy, deadline180giây, không tự retry/fallback.

Models/responses cần `Authorization: Bearer <controlToken>` từ config runtime
riêng. Chỉ backend đọc token; không đưa token vào browser, Git hoặc log.
Request chỉ nhận model, input, instructions và tùy chọn văn bản/reasoning;
không có tools, previous-response ID, attachments hoặc metadata của Codex.
Core không lưu Responses history; caller gửi lại phần hội thoại cần thiết.

API sản phẩm: `GET /api/v2/ai/chatgpt/account`,
`POST /api/v2/ai/chatgpt/account/{start|login|probe|selection|cancel|disconnect}`.
Yêu cầu workspace được phép, peer/Host loopback và Origin cùng web cho mutation.
Backend giữ bearer token. Login/probe trả operation ngay và UI poll status;
không kéo request API30giây thành request inference180giây. Không tự retry.

Đây là browser automation không chính thức, phụ thuộc đăng nhập, quota và UI
ChatGPT. Prompt được gửi tới ChatGPT; core không biến nó thành inference local.
Model ID được chọn từ catalog, không đóng cứng một alias trong sản phẩm.

## Phạm vi hiện tại

Engine kết nối, account UI và thao tác kiểm tra model đã có. Hai route AI nghiệp
vụ hiện tại của Axum vẫn báo offline; chưa thay UI/luồng chiến lược. Lát tích hợp chiến lược cần tác vụ bất đồng bộ,
cancel và kiểm tra context/hash trên boundary AI sẵn có, schema draft được
validate trước khi owner lưu. Core readiness không đồng nghĩa chiến lược đã
chạy được trong engine hoặc đạt whole-product AI acceptance.

Core lấy chọn lọc tương thích từ upstream v6.1.11; không phải bản full launcher.
Cockpit OAuth dành cho Codex là tham khảo UX, không copy client identity/token
flow vào browser bridge. Có phương án Sign in with ChatGPT chính thức cho app
được đăng ký, nhưng không tự đổi provider hoặc đăng ký ứng dụng bên ngoài trong
lượt này. Xem [OpenAI Docs](https://developers.openai.com/siwc/quickstart).

Kiểm chứng offline: `bun run typecheck`, `bun run test`,
`bun run test:transport` trong core; `cargo test --locked --lib chatgpt_web`
trong `api-rust`; build web; `scripts/chatgpt_web_acceptance.py` chạy PostgreSQL,
Rust/Bun và UI tách biệt, không dùng tài khoản thật hay gửi inference.
