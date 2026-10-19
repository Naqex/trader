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
Desktop dành khoảng 38% chiều rộng cho chat; kéo mép trái hoặc dùng phím mũi
tên/Home/End khi focus separator để đổi độ rộng. Giới hạn 360–760px và chừa
ít nhất 620px cho ứng dụng. Dưới 1100px dùng dialog phủ bên phải, khóa focus
nền và đóng bằng Escape. Trang chào Mentor/composer, header và danh sách chat
theo bố cục FX; không có carousel Resources hoặc Create agent.

**Chat gần đây** giữ nhiều hội thoại thật trong RAM của tab theo workspace;
có mở lại, đổi tên và xóa qua xác nhận. Chat mới giữ chat cũ trong danh sách.
Đóng/mở panel giữ cả lịch sử và bản nháp; đổi workspace hoặc tải lại trang
xóa lịch sử UI. Không lưu database/localStorage. Khi đang gửi, khóa chuyển,
xóa và tạo chat mới để kết quả vẫn thuộc đúng hội thoại. Chỉ gửi lịch sử của
chat đang chọn, gồm các cặp tin nhắn đã hoàn tất và câu hỏi mới;
tin bị lỗi/hủy không đi vào context tiếp theo. Không tự lấy chart, chiến lược
hay dữ liệu tài khoản. Câu trả lời hiển thị dạng văn bản, không thực thi HTML.

Chat dùng cùng model/effort đã chọn trong Settings và catalog nguyên bản của
upstream. Picker trong panel cập nhật cùng lựa chọn này. Chỉ mở panel đọc
trạng thái; nếu API vừa restart, bấm **Nạp kết nối đã lưu** để khởi động core
riêng, không mở Chrome/login tự động. Nếu chưa đăng nhập, dùng liên kết Cài đặt.

Composer dùng một menu model/mức suy luận, thanh trượt chỉ có các mức do
catalog trả về. Kéo chỉ xem trước; thả chuột, kết thúc phím điều chỉnh hoặc
rời thanh trượt mới lưu lựa chọn. Không gửi request theo từng pixel kéo.
Menu đóng trước panel khi nhấn Escape; chọn model giữ effort nếu được hỗ trợ.
Lưu effort giữ menu mở; chỉ khóa thanh trượt trong lúc request đang lưu.
Hai icon chiến lược/biểu đồ ở góc trái đang disabled, có tooltip nêu chưa
kết nối dữ liệu. Chúng chưa gửi chiến lược hay ảnh biểu đồ tới AI.
Màu nhấn dùng token cam của project; lịch sử trống có nút **Chat mới** ở giữa.

Lựa chọn mặc định khi chưa có model hợp lệ đã lưu là GPT‑6 Sol/high nếu có
trong catalog; lựa chọn người dùng đã lưu luôn được ưu tiên. Chrome xử lý
request chạy headless, không tạo cửa sổ. Context khôi phục browser state và dùng
user agent của Chrome cùng phiên bản với login tương tác. Đăng nhập vẫn hiện
cửa sổ riêng; engine, profile và bộ chọn model upstream được giữ lại. Không
fallback sang cửa sổ visible khi request lỗi. `browserStartMinimized` chỉ áp dụng
đường headed legacy, không còn điều khiển inference của Mentor.

Core chỉ đóng gói policy Mentor, snapshot màn hình và hội thoại text; không thêm
Codex harness/MCP hay thông báo thiếu local tools. Bridge đọc riêng nhánh
assistant khi renderer ChatGPT gộp câu hỏi và câu trả lời vào một turn group.
Không lấy user bubble, transcript hoặc tiêu đề screen-reader làm kết quả.
Đầu ra cũ đã lưu trong lịch sử không được tự sửa; dùng Chat mới để kiểm tra.
Smoke có tài khoản đã kết nối (hai câu synthetic, mỗi câu gửi một lần):
`$env:TW_CHATGPT_LIVE_ACCEPTANCE='1'; node run_ai_chat_live_acceptance.mjs`
từ `foundation_v2/web`. Report/screenshot riêng ở `.runtime/ai-chat-live/`.
Receipt kiểm tra runtime ngày19/10:
[Mentor runtime repair](../evidence/mentor-runtime-20261019/CHECKPOINT.md).

Nút cạnh tên Mentor mở cài đặt trợ lý. Tên và mô tả đổi phần hiển thị trong
tab hiện tại; không override prompt hoặc tạo agent. Ô hướng dẫn chỉ đọc, lấy
từ cùng file policy sản phẩm tại lúc build web. Liên kết trong dialog dẫn
đến cài đặt kết nối/model hiện có. Escape đóng dialog trước rồi mới đóng panel;
focus trở về nút đã mở dialog. Engine, login và catalog không thay đổi.

`POST /api/v2/ai/chatgpt/chat` nhận `{messages:[{role,content}],context?:{screen,locale}}` tối đa 48KiB,
63 tin, user/assistant xen kẽ và kết thúc bằng user; trả 202 với ID tác vụ.
`GET /api/v2/ai/chatgpt/chat/{id}` đọc trạng thái/kết quả;
`DELETE` cùng URL hủy đúng tác vụ. Model/effort được backend đọc và kiểm tra
với catalog trước khi gọi core. Không nhận tools, model override hoặc page state tự do.
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
dark/light, kéo/keyboard resize, focus, settings, mở/đổi tên/xóa nhiều chat,
history isolation, gửi nhiều lượt, picker, cancel, lỗi, disconnected/denied.
Các fixture này không chứng minh model thật đã trả lời.

## Vai trò và context của trợ lý

Policy sản phẩm nằm ở `api-rust/src/ai-assistant-policy.md`, được đóng vào binary;
phiên bản `wmreplay-chat-2026-10-19.1` trả trong `grounding.policy_version` của
mỗi tác vụ. Backend giữ policy, frontend không được ghi đè. AI bám trading,
WMREPLAY và các chủ đề liên quan như thống kê/code backtest/tâm lý giao dịch;
chào hỏi tự nhiên, câu ngoài phạm vi được chuyển hướng ngắn. Không lọc bằng
từ khóa hoặc thêm một model phân loại cho mỗi lượt.

UI gửi thêm tên màn hình từ allowlist và locale vi/en. Đây là metadata route
do client khai báo, không phải bằng chứng tài khoản hay authority. Không gửi URL,
ID tài khoản/phiên/dataset, DOM, chart, balance, Equity hoặc PnL tự động. Thông tin
trong cài đặt trợ lý công bố phạm vi này; tên màn hình được giữ cạnh câu hỏi lúc gửi,
kể cả khi người dùng chuyển trang trong lúc đợi. Snapshot đó được trả nguyên
trong `grounding.context`. Client cũ không gửi context nhận unknown/vi.

Backend đóng gói snapshot và câu hỏi cuối thành JSON trong user message;
không nối dữ liệu vào instructions. Lịch sử vẫn chỉ gồm cặp tin đã hoàn tất.
Policy yêu cầu dùng snapshot mới nhất, hỏi dữ liệu còn thiếu, không giả nhìn
thấy chart hay thực hiện thao tác. Không có quyền mở broker, lưu chiến lược
hoặc gọi công cụ. Đây là context cho chat tư vấn; chưa triển khai context dữ
liệu/version/hash và hành động nghiệp vụ thuộc U7.

Browser core chuyển instructions và các role thành JSON/text trong ChatGPT Web,
không có bảo đảm native API role hierarchy. Prompt giúp định hướng, không phải
ranh giới bảo mật tuyệt đối. Quyền và field allowlist vẫn do Rust/core thực thi;
model trả text không được thực thi. Giữ engine, upstream model và login hiện có.
Core tự cấp identity nội bộ cho từng lượt để browser engine nhận quyền sở hữu
lượt đúng; caller vẫn không được gửi metadata/identity của Codex.

Thiết kế dựa trên [Prompt engineering](https://developers.openai.com/api/docs/guides/prompt-engineering),
[Reasoning best practices](https://developers.openai.com/api/docs/guides/reasoning-best-practices)
và [Safety in building agents](https://developers.openai.com/api/docs/guides/agent-builder-safety):
vai trò/phạm vi rõ, dữ liệu tách khỏi hướng dẫn, thiếu dữ liệu thì nêu giới hạn,
kiểm thử các tình huống mong muốn và các yêu cầu lệch phạm vi. Không áp dụng
Agent Builder hay chuyển sang API từ các tài liệu tham khảo này.

`scripts/fixtures/ai_chat_evals.json` giữ tám tình huống và tiêu chí review:
ngoài chủ đề, chủ đề liên quan, câu nối tiếp/số tiền, thiếu dữ liệu, injection,
giới hạn hành động, câu hỏi trộn chủ đề, đổi màn hình/ngôn ngữ. Chạy
`python scripts/ai_chat_evals.py` từ foundation_v2 chỉ kiểm fixture;
thêm `--live` mới gửi tám prompt giả định tới tài khoản/model đang chọn qua
API local. Không đổi model, không retry/fallback hoặc mở login. Report lưu
trong `.runtime/ai-chat-evals/report.json` sau mỗi case để review thủ công;
hoàn tất transport không tự đánh dấu hành vi pass. Rerun khi thay policy,
formatter core hoặc model; kết quả chỉ có giá trị với phiên bản/lựa chọn đã thử.

Kiểm chứng ngày 19/10/2026: Rust 7 test, core typecheck + 16 test và 173 test
transport, integration Rust → core và UI fixture 360/768/1368px dark/light đạt.
UI kiểm thêm màn hình thay đổi trong cùng hội thoại, nhãn màn hình cũ vẫn giữ
đúng câu hỏi, và lỗi model hiển thị rõ câu hỏi chưa gửi. Build web/release API
đạt; main chunk web vẫn có cảnh báo kích thước sẵn có.

Live eval **chưa xác minh hành vi model**: lần đầu phát hiện thiếu turn identity
trong core gọn; đã sửa và kiểm regression bằng parser/ownership helper thật.
Lần sau, GPT‑6 Sol/medium trả `model_version_unavailable` trước khi gửi prompt
("could not be selected and verified"). Chưa kết luận là thiếu entitlement,
lỗi ngôn ngữ hay UI selector thay đổi. Không đổi model/account language để
né lỗi. Bộ tám case dừng ngay case đầu; không có câu trả lời model để chấm.
Chi tiết local: `.runtime/ai-chat-evals/report.json`, `attempt-*.json` và
`provider-diagnostic.json`. API chỉ xuất mã lỗi đã chuẩn hóa, không chuyển raw
browser diagnostic/credential sang frontend. Tám fixture không được tính là
tám behavioral pass; cần chạy lại khi chọn/xác minh model thật thành công.
