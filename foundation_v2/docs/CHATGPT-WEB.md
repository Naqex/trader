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

Nút tia sáng **Chat AI** trên topbar mở panel bên phải, có mặt cả trong replay.
Desktop dành riêng 400px cho chat; dưới 1100px dùng dialog phủ bên phải, khóa
focus nền và đóng bằng Escape. Đóng panel giữ hội thoại trong tab; cuộc trò
chuyện mới, đổi workspace hoặc tải lại trang xóa hội thoại UI. Không lưu vào
database/localStorage. Chỉ gửi các cặp tin nhắn đã hoàn tất và câu hỏi mới;
tin bị lỗi/hủy không đi vào context tiếp theo. Không tự lấy chart, chiến lược
hay dữ liệu tài khoản. Câu trả lời hiển thị dạng văn bản, không thực thi HTML.

Chat dùng cùng model/effort đã chọn trong Settings và catalog nguyên bản của
upstream. Picker trong panel cập nhật cùng lựa chọn này. Chỉ mở panel đọc
trạng thái; nếu API vừa restart, bấm **Nạp kết nối đã lưu** để khởi động core
riêng, không mở Chrome/login tự động. Nếu chưa đăng nhập, dùng liên kết Cài đặt.

`POST /api/v2/ai/chatgpt/chat` nhận `{messages:[{role,content}]}` tối đa 48KiB,
63 tin, user/assistant xen kẽ và kết thúc bằng user; trả 202 với ID tác vụ.
`GET /api/v2/ai/chatgpt/chat/{id}` đọc trạng thái/kết quả;
`DELETE` cùng URL hủy đúng tác vụ. Model/effort được backend đọc và kiểm tra
với catalog trước khi gọi core. Không nhận tools, model override hoặc page state.
Một tác vụ trên core; thay đổi account bị khóa trong lúc chat. Backend giữ
kết quả trong RAM để poll, không log nội dung, không cache HTTP. Kết quả hết
khả năng truy cập sau 10 phút, tác vụ kế tiếp hoặc API restart. Transport chờ
tối đa 190 giây, core giới hạn 180 giây. Cancel ngắt HTTP tới Bun, signal truyền
tiếp tới browser engine; không xóa nội dung đã được gửi trên phía ChatGPT.
Không tự retry hoặc đổi model. ID và kết quả gắn cả workspace lẫn local identity.

Hai route AI nghiệp vụ `/ai/status` và `/ai/request` vẫn offline: chúng dành
cho context/hash và các job chiến lược/research, không được kích hoạt bởi chat
văn bản. Luồng chiến lược sẽ mở rộng boundary này sau khi owner xác định hành
vi, schema và quyền lưu draft. Chat transport chưa là whole-product U7 acceptance.

Core lấy chọn lọc tương thích từ upstream v6.1.11; không phải bản full launcher.
Cockpit OAuth dành cho Codex là tham khảo UX, không copy client identity/token
flow vào browser bridge. Có phương án Sign in with ChatGPT chính thức cho app
được đăng ký, nhưng không tự đổi provider hoặc đăng ký ứng dụng bên ngoài trong
lượt này. Xem [OpenAI Docs](https://developers.openai.com/siwc/quickstart).

Kiểm chứng offline: `bun run typecheck`, `bun run test`,
`bun run test:transport` trong core; `cargo test --locked --lib chatgpt_web`
trong `api-rust`; build web; `scripts/chatgpt_web_acceptance.py` chạy PostgreSQL,
Rust/Bun và UI tách biệt, không dùng tài khoản thật hay gửi inference.
`scripts/chatgpt_chat_acceptance.py` kiểm Rust → core handler thật với responder
synthetic, gồm gửi/poll, scope, khóa single-flight và cancel tới signal Bun.
`web/run_ai_chat_acceptance.mjs` kiểm giao diện bằng fixture 360/768/1368px,
dark/light, focus, gửi nhiều lượt, picker, cancel, lỗi, disconnected/denied.
Các fixture này không chứng minh model thật đã trả lời.
