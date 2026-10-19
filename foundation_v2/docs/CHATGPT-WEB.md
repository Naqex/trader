# ChatGPT Web cho chiến lược MT5

Core dùng chung nằm trong repo TradingWorkspace tại `tooling/chatgpt-web-core`.
MT5 sở hữu prompt, schema chiến lược, kiểm tra kết quả và trạng thái tác vụ;
core chỉ vận chuyển yêu cầu văn bản tới ChatGPT Web. Không chạy Codex CLI,
Cockpit UI, MCP, shell hoặc subagents từ luồng này.

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

`Login` là bước tương tác do owner thực hiện: mở Chrome riêng, đăng nhập ChatGPT,
đóng cửa sổ để core kiểm tra composer và ghi nhận khả năng model. Không sao chép
cookie từ VI Dubber hoặc tài khoản của app khác. `Serve` chạy foreground,
Ctrl+C dừng provider đó; không cài service/autostart. Chạy `Status` chỉ đọc config
và marker đã có, không chứng minh phiên đăng nhập còn hợp lệ trên mạng.

Mặc định: `127.0.0.1:17851`; home `.runtime/mt5-chatgpt-web` ở workspace.
VI Dubber vẫn giữ core/runtime hiện tại ở port17850. Hai ứng dụng có thể dùng
cùng source trong tương lai nhưng không dùng chung home, token hoặc hàng đợi.
Clone MT5 riêng có thể truyền `-CoreDirectory` và `-RuntimeHome` rõ ràng.

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

Đây là browser automation không chính thức, phụ thuộc đăng nhập, quota và UI
ChatGPT. Prompt được gửi tới ChatGPT; core không biến nó thành inference local.
Model ID được chọn từ catalog, không đóng cứng một alias trong sản phẩm.

## Phạm vi hiện tại

Đây là bước chuẩn bị shared core và runtime MT5. Hai route AI hiện tại của Axum
vẫn báo offline; chưa thay UI chiến lược hoặc tự nối một đường gọi180giây vào
request API có timeout30giây. Lát tích hợp chiến lược cần tác vụ bất đồng bộ,
cancel và kiểm tra context/hash trên boundary AI sẵn có, schema draft được
validate trước khi owner lưu. Core readiness không đồng nghĩa chiến lược đã
chạy được trong engine hoặc đạt whole-product AI acceptance.
