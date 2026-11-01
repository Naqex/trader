# Candidate sidebar census — 01/11/2026

**76/76 route cases đạt assertions của census lỗi/unavailable; PC-01 đã khép bằng
focused rerun4/4 trên bundle final `index-C_fM6QLT.js`.** Kết quả này không
nghiệm thu healthy workflow, loaded data, provider, native Paperclip hay sản phẩm.

## Phạm vi và oracle

Preview riêng do root sở hữu: `http://127.0.0.1:5250`. Lane chỉ sửa
`web/tests/ownerSystemCensus.browser.mjs` và evidence này; không build/restart,
không sửa source sản phẩm. Full run kết thúc UTC **14:58:45.611**, trước lượt
root thông báo build sửa persistent controls. Source working tree có WIP; không
coi HEAD `b11e258b` là identity đầy đủ của bundle đã phục vụ.

Mẫu số cố định **19 sidebar destinations**: Testing5, Live7, Strategies1,
Studio4 (Paperclip/Reviews/Models/Connections), Learn1, Settings1. Gateway và
detail/chart routes không thuộc mẫu số sidebar. Test không mở session/chart.

| Config | Route cases | Kết quả |
|---|---:|---|
| 1920×940 / dark / VI | 19 | pass |
| 1440×940 / light / EN | 19 | pass |
| 768×940 / light / VI | 19 | pass |
| 360×940 / dark / EN | 19 | pass |

Oracle hẹp: route content có chữ, thoát skeleton ban đầu, không pageerror,
không horizontal overflow >1px. Paperclip đọc persistent host visible thay vì
`.fx-content` đang hidden. Chưa click vào các thao tác, form/dialog hoặc thử
success→reload/persistence trong census này. settledMs gồm chờ networkidle của
test, không phải benchmark tốc độ sản phẩm.

## Network và fixture

- Service worker bị chặn; WebSocket đóng; method ngoài GET/HEAD/OPTIONS abort.
- Toàn bộ `/api/*`, `/integrations/*`, `/health*` trả fixture503 có nhãn;
  events trả204. Không để health bridge của preview gọi dịch vụ thật.
- Chỉ root document và asset static có tên/path được allowlist trên cùng origin
  tới preview. Request ngoài origin hoặc ngoài allowlist bị abort và làm run fail.
- Full run ghi **295 fixture reads**, **0 writes**, **0 external attempts**,
  **0 unexpected requests**, **0 page errors**, **0 overflow**. Fixture count gồm
  event reconnect, không dùng làm workload hay metric hiệu suất.

Máy chủ API, DB, broker, health integration và provider không được gọi trong
test này. Không có thao tác credential/model; pilot provider trước đây không
chứng minh credential hiện còn dùng được.

## Attempts và visual review

Run đầu fail harness: allowlist bỏ sót `/project-palette.css` và SVG favicon
resourceType other, tạo152 blockedUnexpected. Đã giữ summary âm trong
[harness-attempts.json](candidate-census/harness-attempts.json), sửa đúng static
allowlist rồi chạy lại đủ76 cases; không đổi guard API/integration/health.

Đã xem ảnh Dashboard1920 darkVI, Models1440 lightEN, Paperclip768 lightVI và
Settings360 darkEN. Bố cục unavailable của Dashboard/Models/Settings không có
finding mới trong lượt này. PC-01: Retry/Open separately trên Paperclip persistent
host hiển thị native button/link vì shared control CSS chỉ scope `.fx-content`.
Root xác nhận và sửa source; lane không sửa product code.

### Delta PC-01 — đã khép trong phạm vi controls/unavailable

Focused phase `paperclip-controls` chỉ mở Models unavailable làm normal-control
reference rồi Paperclip unavailable, cùng4 configs. Trên bundle
`index-B0dcRTxH.js`, cả4 cases fail đúng fontFamily: Retry inherit
`"Nunito Sans", Inter, ui-sans-serif, system-ui, sans-serif`, còn normal Models
Reload dùng `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
"Segoe UI", sans-serif`. Height đã khớp tại assertion trước đó. Giữ kết quả âm
trong [font-family mismatch](candidate-census/paperclip-controls-font-mismatch.json).

Sau root sửa font owner, bundle `index-DCea-pPn.js` khớp family/height/radius,
nhưng Open separately vẫn14px trong khi normal control/Retry13px. Giữ
[link-font mismatch](candidate-census/paperclip-controls-link-font-mismatch.json).
Hai record display flex/inline-flex trong lượt này là test oracle quá chặt:
flex item blockify inline-flex là hành vi CSS hợp lệ. Test đã so cùng flex
formatting context, tiếp tục giữ parity typography/height/padding/radius.

Root sửa source typography selector cho `.wm-button` gồm cả anchor và dùng chung
font token. Rerun4 configs trên **đúng `index-C_fM6QLT.js`**: **4/4 pass**,
controlDifferences đều rỗng. Retry và Open separately cùng height32px ở
1920/1440/768; ở360 dùng44px đúng touch target. Inter13px, weight500,
line-height20px, radius999px, padding-inline12px, không underline; padding-block
5px trên desktop/tablet và11px ở360.
Retry giữ primary orange; Open separately giữ neutral role. DOM semantics vẫn
BUTTON/A. Không iframe được mount khi health fixture503.

Đã xem [ảnh sau sửa](candidate-census/ai-paperclip-controls-768-light-vi.png):
controls hiển thị đúng pill system, không thấy lỗi bố cục mới. Focused run không
có pageerror/overflow/writes/external/unexpected request. Không rerun76 route sau
CSS scoped vì root chỉ sửa controls/font owner; full census trước đó và focused
delta có phạm vi riêng, không giả thành full76 chạy trên bundle mới.

## Artifacts và lệnh

- [Full census JSON](candidate-census/census.json), SHA256
  `3485d3e5e5a0cd9c3b3cd61a3e928fa8bfeb0905e576bbdbd7bcfe7d35ebf77c`.
- [Focused controls JSON](candidate-census/paperclip-controls.json) giữ kết quả
  delta final4/4, không ghi đè full census. SHA256
  `a5e02aa54015a4c1421184b4f5dcf7836bd084973c3877acceb91e6aeb56321e`.
- [Dashboard desktop](candidate-census/dashboard-1920-dark-vi.png),
  [Models desktop](candidate-census/ai-models-1440-light-en.png),
  [Paperclip trước sửa controls](candidate-census/ai-paperclip-768-light-vi.png).
  Bốn ảnh full-run và một ảnh delta được giữ nhỏ để đối chiếu trước/sau; không
  có dump trace/network hoặc ảnh cho toàn76 cases.

Từ `foundation_v2/web`:

```powershell
node tests/ownerSystemCensus.browser.mjs http://127.0.0.1:5250 ../evidence/owner-system-audit-20261031/candidate-census candidate
node tests/ownerSystemCensus.browser.mjs http://127.0.0.1:5250 ../evidence/owner-system-audit-20261031/candidate-census paperclip-controls index-C_fM6QLT.js
```

Doctor UI-QA ready=true, productAcceptance=NOT_EVALUATED; node syntax check pass.
Test source SHA256 `72f94072c09491c53e0ac0d519387c51d437536689199ed2b59cee421d8e4ce1`.
Không stage/commit theo ownership lane. Root giữ quyết định tích hợp và các gate
healthy workflow/runtime/provider/broker ngoài scope.
