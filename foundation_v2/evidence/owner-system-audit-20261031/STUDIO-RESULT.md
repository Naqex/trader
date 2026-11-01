# Studio — kết quả 01/11/2026

Đã chốt lát giao diện native Studio theo [spec](STUDIO-SPEC.md) và
[review độc lập](studio-independent-review.md). Không có provider call, migration
hoặc cập nhật runtime owner trong lát này.

## Thay đổi và luồng state

- Studio thay tên AI và Bot; bốn mục Đội AI / Đánh giá / Model / Kết nối.
  Gateway là chi tiết của kết nối. Link automation cũ replace về Đội AI.
- Header/status/panel state dùng chung; danh sách phẳng, drawer theo modal hiện
  có, history/steps theo hàng. Desktop cap960px, shell giữ gutter. Mobile xếp dọc.
- Provider records giữ owner hiện có. Row và drawer dùng cùng status/tone;
  chỉ intentional stop/no-error/unavailable được coi là đã tắt. Login/start
  failure vẫn cảnh báo ngay cả khi process không chạy. Model catalog không
  chứng minh model còn quota hay credential hợp lệ.
- Iframe đã mở vẫn giữ mount khi đổi trang; host inactive có hidden/inert.
  Đổi ngôn ngữ gửi preference, Retry cho phép tạo lại document. Không clone
  nội dung native Paperclip. Gateway giữ cơ chế sync catalog hiện có khi rời
  management về native UI; fixture intercept đúng một POST trong case này.

Trade-off: reuse React/state/modal/icon/token hiện có, không thêm UI framework.
Status mô tả state kết nối/catalog; readiness của một job AI cần kiểm riêng.
Selected+hover có token theme riêng; reduced-motion tắt animation liên quan.
Contract lâu dài nằm trong `ui/compact-system.md`.

## Kiểm chứng

Isolated production preview `127.0.0.1:5250`. API, integration health và document
nhúng đều được Playwright fulfill/abort; không dùng owner data hoặc service thật.

| Kiểm tra | Kết quả và giới hạn |
|---|---|
| Vite production build | PASS; còn cảnh báo chunk lớn đã có trong sản phẩm |
| `aiStudio.browser.mjs` | PASS dark/light × VI/EN; navigation, cap960, icon/text centres, hover/selected/selected+hover, drawer/error parity, stopped/login failures, focus composer, redirect và 390px overflow |
| `studioEmbed.browser.mjs` | 4/4 PASS: hai nhóm host behavior × 1440/390; draft/document retention, preferences và unavailable/Retry; zero unexpected writes/page errors |
| Independent recheck | 5 findings ban đầu và stopped-login residual đã resolved; AX row description, focus, reduced-motion và error semantics đã probe lại |
| Visual review | Đã mở xem Connections dark VI desktop, Reviews390 và screenshots độc lập; giữ layout phẳng và compact |

Gateway navigation trong fixture390 được resize1440 để truy cập tab; đây không
phải proof thao tác gateway navigation tại390. Document nhúng là HTML tổng hợp,
không thay kiểm chứng UI thật của Paperclip/CLIProxyAPI, xác thực hay job end-to-end.
Key Opus 5.5 đã hết hạn theo owner: pilot cũ chỉ là lịch sử.

Hai ảnh chọn lọc ở `studio-visuals/`; output đầy đủ local nằm ở
`foundation_v2/.runtime/ai-studio-browser` và `studio-embed-fixture`.
Lát này không đóng owner audit O1–O12 hoặc các gate U/Y/W toàn sản phẩm.
