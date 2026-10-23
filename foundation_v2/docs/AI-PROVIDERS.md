# AI providers: gateway và harness của WMREPLAY

Quyết định kỹ thuật ngày 23/10/2026: ưu tiên **CLIProxyAPI upstream, ghim phiên bản,
chạy thành process riêng và nối bằng adapter nhỏ trong backend**. Chưa có lý do
để fork gateway hoặc tự viết lại OAuth, token refresh và account pool. Tối ưu
WebGPT bridge hiện tại được hoãn theo yêu cầu owner.

Đây là kết quả nghiên cứu và preflight, **chưa tích hợp provider mới vào sản phẩm**.
Chưa đăng nhập Google, nhập token, gửi inference, bật pool thật hoặc thay API8010.
Tài liệu này giữ quyết định và contract dự kiến; tiến độ sản phẩm vẫn thuộc
Product Completion Plan của workspace.

## Giới hạn quan trọng của subscription

Google AI Pro/Ultra, Gemini app, Gemini CLI, Antigravity và Gemini API là các
kênh có quyền sử dụng/hạn mức riêng. Một subscription không tự biến thành API
credits sử dụng tùy ý. Google có công bố lợi ích Google AI trong AI Studio;
phải kiểm tra quyền lợi và billing cụ thể, không mặc định mọi request bên ngoài
được trừ vào quota subscription.

[FAQ Antigravity chính thức](https://www.antigravity.google/docs/faq/) hiện nói
truy cập Antigravity qua phần mềm bên thứ ba vi phạm điều khoản và có thể bị
đình chỉ/chấm dứt tài khoản. Wrapping `agy` trong ứng dụng/agent bên thứ ba và
tự động xoay tài khoản consumer cũng không được hỗ trợ. FAQ hướng người dùng
sang Google AI Studio API key hoặc Gemini Enterprise.
[Gemini CLI FAQ](https://geminicli.com/docs/faq/) cũng không cho phép lấy OAuth
của CLI để dùng trong công cụ khác.

Vì vậy, CLIProxyAPI là ứng viên kỹ thuật phù hợp nhất trong nhóm đã khảo sát,
nhưng pool subscription Antigravity **không phải kênh được Google hỗ trợ để vận
hành ứng dụng ổn định**. Fork hay tự build không giải quyết hạn chế này. Cần
owner chọn rõ thử nghiệm có rủi ro tài khoản hay dùng kênh API được hỗ trợ trước
khi kích hoạt tài khoản. Không tự chuyển sang API có phí hoặc lấy token từ app
đang đăng nhập.

## So sánh theo nhu cầu hiện tại

| Phương án | Bằng chứng đã kiểm tra | Quyết định |
| --- | --- | --- |
| [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI/tree/v8.0.40) upstream | MIT; Go; bản Windows; API tương thích OpenAI/Responses; hỗ trợ Gemini/Antigravity, nhiều credential và routing | Chọn để đánh giá; pin release, dùng config riêng, không fork ban đầu |
| Fork CLIProxyAPI | Có source MIT nhưng phải tự theo upstream khi giao thức/auth đổi | Chỉ fork nếu có lỗi bắt buộc mà config/adapter không giải quyết được; patch nhỏ có thể gửi upstream |
| [Antigravity Manager](https://github.com/lbjlaq/Antigravity-Manager/tree/v4.9.8) | Desktop Tauri/React/Rust; [LICENSE CC BY-NC-SA 4.0](https://github.com/lbjlaq/Antigravity-Manager/blob/v4.9.8/LICENSE) có điều kiện phi thương mại | Không chọn làm nền dependency/fork cho sản phẩm này |
| [Sub2API](https://github.com/Wei-Shaw/sub2api/tree/v0.2.17) | Go/Vue, PostgreSQL15+, Redis7+, quản trị người dùng/quota/billing; LICENSE LGPL3.0 | Quá nhiều thành phần cho nhu cầu một app local; chỉ xét lại khi có nhu cầu quản trị nhiều người dùng thật |
| Tự viết gateway mới | Phải sở hữu OAuth, refresh, routing, quota, dịch protocol, streaming và các thay đổi upstream | Không chọn: chi phí bảo trì lớn, không tạo lợi thế cho WMREPLAY |

Không dùng số sao GitHub để kết luận chất lượng. Đây là khảo sát có chọn lọc,
không phải kiểm toán toàn bộ dependency hay khẳng định tốt nhất trong mọi trường
hợp. `router-for-me/CLIProxyAPIPlus` trả404 ở thời điểm khảo sát; không dựa vào
tên đó để chọn một fork chưa xác minh được.

## Luồng và ownership

```text
Chat UI → backend WMREPLAY: policy, context, history, quyền, task lifecycle
        → provider adapter
          ├─ WebGPT core hiện có (giữ làm lựa chọn cũ)
          └─ gateway local tương thích OpenAI
             → credential đủ điều kiện → upstream model
```

Pool giữ nhiều credential riêng và chọn credential đủ điều kiện cho request;
không nối token thành một credential, không cộng context window và không làm
một request sinh token nhanh hơn theo số account. Không coi account rotation là
cách vượt giới hạn của nhà cung cấp. Model và upstream phải rõ ràng; không âm
thầm thay model, thay provider hoặc chuyển sang kênh có phí.

Gateway sở hữu OAuth, refresh, protocol translation và việc chọn credential.
WMREPLAY sở hữu policy, context, quyền tools, hội thoại, kiểm tra kết quả và vòng
đời tác vụ. Không để gateway quyết định tool permissions; không đưa management
key/OAuth token về browser. Inference key của gateway, management key và token
Google là ba loại secret khác nhau.

### Cái có thể reuse và chỗ cần sửa

Source hiện tại chưa có provider abstraction: `AiChatPanel.jsx`,
`ChatGptAccount.jsx`, `SettingsWorkspace.jsx`, `AppState` và route
`/api/v2/ai/chatgpt/*` đều gắn với ChatGPT. Không thể chỉ đổi URL rồi gọi là đã
thêm provider.

`api-rust/src/chatgpt_web.rs` đang chứa cả transport lẫn harness hữu ích:

- Policy do server sở hữu ở `ai-assistant-policy.md`.
- Hội thoại xen kẽ user/assistant, tối đa63 tin/48KiB; context chỉ `{screen,locale}`.
- Context được đóng gói như dữ liệu, không chèn vào system instructions.
- Task202 → poll/cancel; ID gắn workspace và subject; kết quả ở RAM, hết hạn10phút.
- Response text có giới hạn256KiB, timeout hữu hạn, không tự retry/fallback.
- Boundary loopback/Origin/Host, bearer backend-only và HTTP no-store.

Nên tách phần này thành harness dùng chung rồi giữ transport WebGPT như adapter
cũ. Thêm adapter `openai-compatible` cho gateway; tên model Gemini lấy từ catalog
được allowlist/cấu hình, không gán mọi model là GPT hoặc bịa các mức reasoning
giống ChatGPT. UI chọn provider/model/capability; lỗi dịch vi/en theo nguyên nhân.
Endpoint và secret do cấu hình backend sở hữu, không nhận URL tùy ý từ browser.

Harness hiện chỉ chat text: **chưa có agent/tool loop**, không tự đọc chart,
balance, lệnh, file, shell, MCP hoặc thực thi broker. Thêm provider không tự thêm
các quyền đó. Luồng `/api/v2/ai/status`/`ai/request` khác không chứng minh chat đã
được tích hợp. Không cần nhúng Codex/Cockpit harness vào app để đổi model.
Model qua API cũng không tự mang theo lịch sử, bộ nhớ, browsing, IDE tools hoặc
cấu hình agent của Gemini app/Antigravity. Capability cần được kiểm tra trên đúng
endpoint; tools của sản phẩm vẫn phải do WMREPLAY triển khai và cấp quyền.

### Hiệu suất và hành vi lỗi

Giữ kết nối HTTP qua client dùng lại; lấy catalog khi cần và cache ngắn có
invalidation, không probe model/gọi inference mỗi lần mở panel. Bắt đầu bằng
concurrency hữu hạn; pool không tự loại bỏ giới hạn một turn toàn cục hiện có.
Nếu cần nhiều người dùng đồng thời, đổi thành task map theo scope có global cap,
TTL cleanup và cancel thật, không chỉ tăng số credential.

Mỗi turn giữ provider/model đã chọn đến cuối. Lịch sử đầy đủ bounded hiện tại
không phụ thuộc conversation ID của upstream. Nếu thêm cache/resume stateful,
phải chứng minh session affinity, không chuyển credential giữa một response
đang stream. Hủy client ngắt request nhưng không hứa hoàn tác request upstream.
Giới hạn retry ở một tầng; `request-retry: 0` của gateway chỉ tắt các vòng bổ sung,
không tự chứng minh chỉ có một attempt trên mọi credential. Cần kiểm tra cap
credential với nhiều account trước khi bật routing/failover.

Chưa có benchmark inference. Chỉ so browser với gateway sau khi chạy cùng model,
prompt, lịch sử, số request đồng thời và điều kiện mạng; đo TTFT, tổng latency,
CPU/RAM, lỗi và hủy. Pool có thể tăng throughput cho các request độc lập khi
upstream cho phép, không được hứa scale tuyến tính hay latency tốt hơn trước đo.

## Preflight local đã thực hiện

Pin [release v8.0.40](https://github.com/router-for-me/CLIProxyAPI/releases/tag/v8.0.40),
commit `d946c4fba6fc9a5cfbca1f3d85184d62ad2fb683`.
Windows AMD64 ZIP được đối chiếu SHA256 với digest GitHub release asset:
`a5c4ca84350e1b31a11331a573a50bcffd9fc775b8f9111fd2caec480e826e57`.
Executable sau giải nén có SHA256:
`0fd1f03b80a4acac69515e3737fc9f4445de69221e4750e20a3c70038a3b8443`.
Không suy ra chữ ký binary/attestation chỉ từ checksum hoặc chữ ký commit.

Chỉ chạy process tạm, auth home mới rỗng, môi trường child tách khỏi profile thật,
không service/autostart, không nhập token. Bind127.0.0.1:17852; dùng `--local-model`,
discovery off, management key rỗng, control panel/update panel off, local key giả.
Mỗi lần kiểm tra tự dừng đúng process đã tạo. Binary/config/log tạm ở `.runtime/`
được Git ignore; không vendor code upstream vào sản phẩm.

Receipt ở [ai-provider-research-20261023](../evidence/ai-provider-research-20261023/).

| Kiểm tra | Kết quả |
| --- | --- |
| `/v1/models` không có inference key | 401 |
| Catalog với local key giả, auth home rỗng | 200,0models; không chứng minh upstream hoạt động |
| `/v0/management/auth-files`, `/v8/management/auth-files`, `/management.html` | 404 với management tắt |
| Synthetic inference request thiếu key | 401, không gửi model inference |
| Listener của đúng process | Chỉ127.0.0.1:17852 |
| Credential JSON được tạo | 0 |
| Process sau kiểm tra | Đã dừng |

Phát hiện thực tế cần đưa vào cấu hình triển khai:

1. Với `request-log: false` và `logging-to-file: false`, mặc định vẫn ghi request
   body của lỗi401 vào error log. Assertion ban đầu coi mọi entry trong auth-dir
   là credential nên fail; kiểm tra cho thấy đó là `logs/`, không phải token.
   Receipt ban đầu và run xác minh được giữ riêng. Bật `server.commercial-mode:
   true` đã tránh tạo file body trong case này. Đây là tên chế độ upstream tắt
   middleware có overhead, không phải mua license thương mại. Chưa chứng minh
   mọi nhánh lỗi/cơ chế log khác đều không ghi dữ liệu.
2. `--local-model` không làm gateway offline. Log/source xác nhận nó vẫn tự tra
   phiên bản client Antigravity và Grok/npm dù không có account. Chưa audit toàn
   bộ egress. Pin binary không pin mọi metadata runtime.
3. Auth file store upstream lưu JSON credential; Unix0600 không chứng minh mã hóa
   DPAPI hoặc ACL Windows đúng. Phải kiểm tra ACL và secret lifecycle trước dùng
   tài khoản thật; không coi loopback là boundary chống app khác cùng user.

Lệnh tái hiện sau khi tải đúng release từ upstream và kiểm checksum:

```powershell
.\.venv\Scripts\python.exe -B foundation_v2/scripts/ai_gateway_preflight.py `
  --gateway-dir .runtime/ai-gateway-evaluation/cliproxyapi-v8.0.40 `
  --report foundation_v2/evidence/ai-provider-research-20261023/cliproxyapi-preflight.json
```

Script dùng stdlib, kiểm hash executable trước chạy, không tải/cài/login, không
đọc profile thật và chỉ gửi request synthetic. Nó cần port17852 trống và để lại
home/log synthetic riêng để điều tra; không dùng output catalog latency làm
benchmark model. Không dùng config key giả của bài kiểm tra cho triển khai thật.

## Lát tích hợp tiếp theo và điều kiện nghiệm thu

Sau lựa chọn kênh truy cập của owner: tách harness, thêm adapter backend, nối
provider/model selection vào Settings/panel, giữ đường WebGPT cũ. Kiểm offline
với HTTP fixture cho lịch sử/policy, lỗi auth/quota/timeout, partial response,
cancel, boundary workspace và không lộ secret. Không cài app quản trị thứ hai
hoặc framework mới; reqwest/tokio/axum hiện có đủ cho adapter.

Chỉ sau khi cấu hình upstream được owner cho phép mới chạy một prompt synthetic
thật trên model được chọn. Inference đơn phải pass trước pool; sau đó kiểm2account
độc lập, refresh/revoke/quota, routing/affinity, max concurrency và số attempt.
Gate này chưa đạt. Không gọi preflight hiện tại là nghiệm thu Gemini, account
pool, tool calling, chart analysis hay tích hợp UI.

Nguồn bổ sung:
[config v8 ghim phiên bản](https://github.com/router-for-me/CLIProxyAPI/blob/v8.0.40/config.example.yaml),
[auth file store](https://github.com/router-for-me/CLIProxyAPI/blob/v8.0.40/sdk/auth/filestore.go),
[client version updater](https://github.com/router-for-me/CLIProxyAPI/blob/v8.0.40/internal/misc/antigravity_version.go),
[Google AI Studio subscription benefits](https://blog.google/innovation-and-ai/technology/developers-tools/google-one-ai-studio/).
