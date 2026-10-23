# AI providers: gateway và harness của WMREPLAY

Quyết định kỹ thuật ngày 23/10/2026: ưu tiên **CLIProxyAPI upstream, ghim phiên bản,
chạy thành process riêng và nối bằng adapter nhỏ trong backend**. Chưa có lý do
để fork gateway hoặc tự viết lại OAuth, token refresh và account pool. Tối ưu
WebGPT bridge hiện tại được hoãn theo yêu cầu owner.

Owner xác định AI sẽ được dùng thường xuyên ở nhiều tính năng. Thiết kế nền chung,
ranh giới reuse/SDK, persistence/concurrency/context và tiêu chí chuyển đổi nằm ở
[AI-PLATFORM-ARCHITECTURE.md](AI-PLATFORM-ARCHITECTURE.md). Adapter hiện tại là lát
kết nối đầu tiên, chưa phải nền runtime đầy đủ cho mục tiêu đó.

Provider đã được tích hợp vào source backend và khu vực **AI và Bot → Kết nối** của sản phẩm.
Owner đã chấp nhận thử CLIProxyAPI local với rủi ro tài khoản; đăng nhập vẫn do
owner thực hiện thủ công; agent không tự đăng nhập hoặc nhập token. Catalog từ
account đã lưu hiện đã sẵn sàng, nhưng chưa gửi inference hoặc nghiệm thu pool
thật. Receipt tích hợp ban đầu nằm ở
[ai-provider-integration-20261023](../evidence/ai-provider-integration-20261023/).
Tiến độ toàn sản phẩm vẫn thuộc Product Completion Plan của workspace.

Lát nền tiếp theo đã có trong source: chat/profile/run/event lưu bền và pilot worker
LangGraph dùng cùng admission. Xem [receipt chat](../evidence/ai-runs-20261023/RECEIPT.md)
và [receipt workflow](../evidence/ai-workflows-20261023/RECEIPT.md). Migration0012–0013
đã áp vào database local sau backup/restore verification; API và UI mới đã chạy qua
[kiểm chứng triển khai](../evidence/ai-platform-deployment-20261023/RECEIPT.md).
Chưa nghiệm thu inference/pool/throughput thật. Chat/profile và workflow không tự
kế thừa tools của Gemini/Antigravity.

## Khu vực AI và Bot

Sidebar đặt **AI và Bot** dưới đường phân cách sau Chiến lược, có đường phân cách
bên dưới. Bốn tab dùng route `view=ai`, giữ workspace và ngôn ngữ hiện hành:

- **Trò chuyện** (`section=assistant`): Mentor toàn trang, dùng cùng instance,
  lịch sử và harness với panel mở từ các trang khác.
- **Kết nối** (`section=connections`): tải lười danh sách CLIProxyAPI và ChatGPT
  Web; mỗi kết nối có drawer bên phải để đăng nhập, quản lý và xem chi tiết.
- **Model** (`section=models`): tải lười cấu hình mặc định hệ thống, lựa chọn
  riêng của Chat và các role workflow thử nghiệm. Giá trị kế thừa được hiển thị.
- **Bot** (`section=automation`): trạng thái chưa khả dụng, chưa có nút kích
  hoạt, API thực thi hoặc polling nền.

Mở trang không tự đăng nhập, đổi provider hoặc gửi prompt. Chat từ khu vực này
dùng context `screen=settings` trong contract backend hiện hành vì đây là
ngữ cảnh cấu hình; không mở rộng quyền giao dịch. Provider/model vẫn theo vòng
đời và phạm vi máy đã mô tả bên dưới, không tự chuyển thành cấu hình workspace.
Kiểm chứng điều hướng, tải lười, vi/en và local API được lưu riêng tại
[ai-workspace-redesign-20261023](../evidence/ai-workspace-redesign-20261023/RECEIPT.md).

Kết nối là cấu hình máy; profile model tách theo workspace/subject. Xem hoặc quản
lý kết nối không thay provider/model mặc định. Số credential đã lưu không đại diện
cho pool khỏe; catalog không chứng minh inference thành công. Quota chưa có nguồn
dữ liệu hiển thị là chưa có dữ liệu. Chỉ poll trong lúc đăng nhập/kiểm tra đang
chạy; mở trang không gửi inference hoặc tự bật dịch vụ.

Luồng quản lý gateway/OAuth trên web đã triển khai local sau khi owner cho phép
restart API. Kiểm chứng UI → API → gateway rỗng và trạng thái MT5 phục hồi nằm ở
[ai-gateway-managed-20261023](../evidence/ai-gateway-managed-20261023/).
Chưa thực hiện đăng nhập Google hoặc inference thật.

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
hành ứng dụng ổn định**. Fork hay tự build không giải quyết hạn chế này. Owner
đã chọn thử nghiệm local có rủi ro tài khoản, chưa cho đăng nhập tự động.
Không tự chuyển sang API có phí hoặc lấy token từ app đang đăng nhập.

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

`api-rust/src/ai_assistant.rs` giữ harness dùng chung và transport WebGPT;
`ai_gateway.rs` giữ adapter Responses cho gateway; `ai_gateway_runtime.rs` quản lý
process gateway và CLI OAuth qua `owned_process` hiện có. Không thêm trait/framework
hoặc dependency. `AiProviderSettings.jsx` quản lý kết nối, `AiModelProfiles.jsx`
quản lý mặc định model; `AiChatPanel.jsx`
gọi routes trung lập `/api/v2/ai/assistant/*`. Harness giữ:

- Policy do server sở hữu ở `ai-assistant-policy.md`.
- Hội thoại xen kẽ user/assistant, tối đa63 tin/48KiB; context chỉ `{screen,locale}`.
- Context được đóng gói như dữ liệu, không chèn vào system instructions.
- Task202 → SSE/read/cancel; conversation/run/event lưu PostgreSQL, gắn workspace và subject.
- Catalog dùng chung; lựa chọn theo conversation và profile tính năng/role, snapshot bất biến cho từng run.
- Response text có giới hạn256KiB, timeout hữu hạn, không tự retry/fallback.
- Boundary loopback/Origin/Host, bearer backend-only và HTTP no-store.

Transport WebGPT cũ và alias `/api/v2/ai/chatgpt/*` được giữ, luôn gọi WebGPT.
Tên model gateway lấy nguyên catalog; không bịa mức reasoning giống ChatGPT.
UI chọn provider/model; lỗi dịch vi/en theo nguyên nhân.
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
concurrency hữu hạn: global4, gateway3, WebGPT1, workspace3 model calls. Hàng đợi
tối đa64 toàn cục/16 mỗi workspace. Dispatcher không tạo task ngủ cho từng item.
Số tài khoản trong pool không tự tăng các giới hạn này.

Mỗi turn giữ provider/model đã chọn đến cuối. Lịch sử bounded hiện tại
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

## Cấu hình và sử dụng local

Tại gốc repo sản phẩm, helper kiểm hash v8.0.40 trước mỗi thao tác:

```powershell
.\scripts\ai_gateway.ps1 -Action Init
.\scripts\ai_gateway.ps1 -Action Status
```

`Init` đã chạy trên checkout này. Không chạy lại để ghi đè: helper từ chối home
đã tồn tại. Home `.runtime/mt5-ai-gateway` chứa config/key/auth riêng, được Git
ignore và kiểm ACL chỉ current Windows user. Đây không phải mã hóa credential;
app khác chạy cùng user vẫn có thể đọc. Không lấy credential từ app khác.

### Kết nối trên web

Trong **AI và Bot → Kết nối**, chọn **CLIProxyAPI local**, rồi bấm **Kết nối Google**.
Backend bật gateway đã ghim phiên bản và chạy CLI OAuth với `--no-browser`.
Frontend mở URL Google đã được kiểm tra trong tab riêng; owner tự xem quyền và
đăng nhập. Nếu popup bị chặn, dùng liên kết **Mở trang đăng nhập**. Không đọc
profile trình duyệt, lấy token từ Antigravity hay dùng management API.

Trang chỉ poll trong lúc đăng nhập; dừng khi hoàn tất/hủy và tạm dừng khi lỗi mạng.
Backend áp timeout 5 phút ngay cả khi rời trang. Nút **Hủy đăng nhập** dừng process
OAuth; không xóa các tài khoản đã lưu. Đăng nhập xong chọn model trong catalog;
nếu catalog chưa cập nhật kịp có thể bấm **Tải lại model**. **Thêm tài khoản Google**
lặp lại OAuth để gateway lưu thêm credential, chưa phải nghiệm thu routing pool thật.

Những lần sau bấm **Bật kết nối** để dùng tài khoản đã lưu. **Tắt kết nối** chỉ dừng
gateway do API này tạo, không xóa credential. Gateway chạy nền theo vòng đời API,
không cần terminal PowerShell, không cài Windows service/autostart. Dừng/crash API
sẽ dừng process tree thuộc API. Chỉ mở trang hoặc đổi provider không tự đăng nhập
hay bật gateway. Tài khoản mới vẫn cần owner đồng ý OAuth trên Google.

Các POST `account/start`, `login`, `cancel`, `stop` dùng boundary local peer,
same-origin và workspace hiện có. Chỉ cấu hình mặc định loopback/key path đã khởi
tạo được quản lý. Mỗi lần start kiểm SHA256 binary và các ràng buộc kết nối.
`managed.yaml` là cấu hình lưu bền; không sinh đè sau mỗi lần bật. Nếu chưa có,
bootstrap từ `config.yaml` cũ hoặc profile mặc định. Provider/routing/model mapping
do gateway sở hữu, được giữ qua restart. Cấu hình sai host/port/auth-dir, thiếu
inference key của app, mở remote management/discovery/pprof hoặc auto-update panel
sẽ bị từ chối khi bật lại; không tự ghi đè để sửa. Đây là guard lúc managed start,
không là sandbox cho administrator đang chỉnh gateway trực tiếp.
Chỉ đếm file credential, không đọc nội dung token hay đưa tên/email/key về web.
Không nhận/tắt process chỉ vì nó đang chiếm port; gateway chạy thủ công vẫn dùng
được qua adapter, cần dừng bản đó trước khi chuyển sang quản lý trong ứng dụng.

### Chạy thủ công khi cần chẩn đoán

Từ gốc repo, owner vẫn có thể dùng luồng CLI (agent không tự đăng nhập):

```powershell
& .\.runtime\ai-gateway-evaluation\cliproxyapi-v8.0.40\cli-proxy-api.exe `
  --antigravity-login --config .\.runtime\mt5-ai-gateway\managed.yaml
.\scripts\ai_gateway.ps1 -Action Serve
```

`Serve` chạy foreground tại127.0.0.1:17852, Ctrl+C để dừng; không service/autostart,
không tự login hoặc nhận process có sẵn. Gateway vẫn có thể tải metadata phiên
bản dù bật `--local-model`. Request/usage logs mặc định tắt; commercial mode giảm
middleware và đã kiểm không lưu body lỗi401. `Serve` ưu tiên `managed.yaml`, chỉ
dùng `config.yaml` cho home cũ chưa chuyển; không tái tạo hai cấu hình song song.

### Trang quản trị CLIProxyAPI

Reuse [Management Center chính thức v1.26.7](https://github.com/router-for-me/Cli-Proxy-API-Management-Center/releases/tag/v1.26.7)
với backend ghim v8.0.40. Panel MIT là HTML bundle riêng, không đưa vào bundle app
hoặc fork. Asset SHA256 `8c9c6b7d3fb311e6aad5d06e1993e53a2d28389e640448a1bc6304ed20b057b5`;
runtime kiểm digest trước khi bật panel. Không tự tải/cập nhật panel trong gateway.

```powershell
.\scripts\ai_gateway.ps1 -Action InstallManagement
```

Helper tải đúng release qua HTTPS vào `E:\BACKUP-TRADINGWORKSPACE\ai-gateway-admin-20261023`,
kiểm digest rồi copy asset vào home private. Không tự restart/login. Khi bật lại
gateway từ ứng dụng, migration một lần bật management local và tạo `management.key`
ngẫu nhiên, riêng inference key; upstream lưu hash trong YAML. Các lần sau giữ
nguyên YAML và khóa. Sai key giữa file và config sẽ bị từ chối khi start.

Vào tab **CLIProxyAPI**, hoặc **Kết nối → Chi tiết CLIProxyAPI → Mở trang quản trị**.
Tab hiển thị nguyên panel tại `http://127.0.0.1:17852/management.html` trong iframe
khác origin, chiếm toàn bộ vùng nội dung dưới điều hướng. Giữ UI/menu upstream;
không fork, sửa DOM/CSS hoặc chép source panel vào app. Tải lười ở lần mở đầu;
shell giữ một iframe khi chuyển tab/khu vực, ẩn và inert khi không dùng. Đổi
workspace hoặc reload app mới hủy document; không tự bật gateway. Gateway chưa bật/lỗi có
nút về Kết nối và thử lại. URL trực tiếp vẫn dùng được độc lập. Mở trang không
đổi profile/model của app. Lấy khóa cho lần đăng nhập đầu bằng lệnh trong thư mục repo:

```powershell
.\scripts\ai_gateway.ps1 -Action CopyManagementKey
```

Iframe giữ cơ chế refresh/polling của upstream cả khi bị ẩn; ẩn không đóng băng
JavaScript. Chưa có contract pause/resume với upstream. WMREPLAY chỉ đọc metadata
khi mở/quay lại tab hoặc bấm Thử lại, không poll nền. Lỗi metadata không tự hủy
document; Thử lại khi gateway sẵn sàng sẽ tải mới panel. Nâng bản panel chỉ áp
dụng sau lần tải mới, không ngắt form đang nhập. WMREPLAY
không inject theme/locale hoặc key, không đọc DOM/storage khác origin. Sandbox
cho phép script, storage, form, popup OAuth, download và clipboard-write; không
cho frame điều hướng top-level. OAuth popup/storage phụ thuộc trình duyệt, cần
nghiệm thu theo provider trước khi sử dụng; test nhúng chỉ đăng nhập quản trị và
đọc trang Providers, chưa thực hiện OAuth/provider inference. Tích hợp này dành
cho app local cùng máy với gateway;127.0.0.1 không là gateway remote.

Lệnh chỉ copy vào clipboard Windows, không in khóa, không trả secret qua API/native
UI hoặc query URL. Panel chính thức nhận khóa trực tiếp; tùy chọn Remember password
lưu bằng reversible obfuscation, không là mã hóa. Khóa trong clipboard cần được
owner xử lý như secret. Đăng nhập panel là quyền administrator có thể sửa gateway,
xem credential hoặc làm gián đoạn inference; không tự cấp quyền tools/broker cho AI.

Panel có provider/auth/OAuth, mapping, quota theo hỗ trợ, logs và cấu hình. Không
giả mọi provider/capability đã được WMREPLAY nghiệm thu. Add provider không tự bật
API có phí. UI native chỉ nhận URL cố định/version, không management key. Làm mới
model sau khi đổi cấu hình ở panel. Source/tests/rollout:
[receipt quản trị](../evidence/ai-gateway-admin-20261023/RECEIPT.md).

Mở **AI và Bot → Kết nối → Chi tiết CLIProxyAPI → Tải lại model**, rồi chọn
model ở tab **Model** hoặc trong Chat.
Catalog có model chưa chứng minh inference thành công. Muốn thêm account phải
đăng nhập riêng từng account do owner kiểm soát; chưa kiểm routing pool thật.

Cấu hình chỉ ở backend, không nhập endpoint/key trong web:

| Biến | Mặc định |
| --- | --- |
| `TW_AI_PROVIDER` | `chatgpt-web`; có thể đặt `local-gateway` |
| `TW_AI_GATEWAY_BASE_URL` | `http://127.0.0.1:17852/v1`; chỉ IP loopback HTTP và port>=1024 |
| `TW_AI_GATEWAY_KEY_FILE` | Đường dẫn tuyệt đối tới `.runtime/mt5-ai-gateway/inference.key` của repo |
| `TW_AI_GATEWAY_MODEL` | Trống; phải chọn model có trong catalog |

Profile model lưu PostgreSQL theo workspace/subject, có revision và tồn tại qua
restart. Run snapshot lựa chọn lúc enqueue; cấu hình mới không đổi run đang chạy.
Legacy `account/provider` và `account/selection` vẫn giữ mặc định RAM để tương
thích client cũ; env chỉ bootstrap khi chưa có profile.

Các route dưới `/api/v2/ai/assistant`:

- `GET connections/{provider}`, `POST connections/{provider}/{action}` quản lý
  rõ `local-gateway` hoặc `chatgpt-web`, không thay default. Không chấp nhận action
  `provider`/`selection`; giữ local-origin/workspace/no-store boundary.
- `GET profiles`, `PUT profiles/{feature}/{role}` quản lý profile có revision.
- `POST chat`, `GET/DELETE chat/{id}` và SSE events dùng persistent run lifecycle;
  lựa chọn riêng của conversation được giữ, không tự fallback sang model khác.

Effort chỉ dùng khi catalog quảng bá hỗ trợ; gateway hiện gửi null. Admission
giới hạn global/provider/workspace, không còn một turn chung cho toàn ứng dụng.
Catalog cache30s, không poll nền khi trang Kết nối đứng yên. Không tự retry/fallback.

## Điều kiện nghiệm thu còn lại

HTTP fixtures đã kiểm harness/policy/context, catalog, lỗi auth/quota/malformed/
incomplete/oversize, hủy tác vụ và quyền workspace. Browser fixtures kiểm
provider/model, lỗi/empty/cancel, Việt–Anh, desktop/mobile và sáng–tối.
Gateway binary thật đã kiểm với config private rỗng, không login/inference.

Chỉ sau khi cấu hình upstream được owner cho phép mới chạy một prompt synthetic
thật trên model được chọn. Inference đơn phải pass trước pool; sau đó kiểm2account
độc lập, refresh/revoke/quota, routing/affinity, max concurrency và số attempt.
Gate inference/pool này chưa đạt. Không gọi fixture hoặc preflight là nghiệm thu
Gemini, account pool, tool calling hay chart analysis.

Nguồn bổ sung:
[config v8 ghim phiên bản](https://github.com/router-for-me/CLIProxyAPI/blob/v8.0.40/config.example.yaml),
[auth file store](https://github.com/router-for-me/CLIProxyAPI/blob/v8.0.40/sdk/auth/filestore.go),
[client version updater](https://github.com/router-for-me/CLIProxyAPI/blob/v8.0.40/internal/misc/antigravity_version.go),
[Google AI Studio subscription benefits](https://blog.google/innovation-and-ai/technology/developers-tools/google-one-ai-studio/).
