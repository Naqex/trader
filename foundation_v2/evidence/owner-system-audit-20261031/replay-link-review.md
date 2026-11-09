# Replay dataset link review — 2026-11-01

## Kết quả

Đã bỏ tự tạo replay khi chỉ mở `?dataset=X`. Dataset-only đọc danh mục phiên,
mở phiên Backtest khả dụng gần nhất theo `updated_at_utc` của đúng dataset;
nếu danh mục chưa có ứng viên phù hợp thì hiện form tạo đã có sẵn. Không tuyên bố
dataset chưa từng có phiên chỉ từ kết quả danh mục. Phiên nhớ trong browser thuộc
dataset khác không được ghi đè lựa chọn dataset của URL.

`?session=…&cursor=…` tiếp tục ưu tiên phiên/cutoff cụ thể. `fresh=1` tiếp tục mở
form tạo mới, bỏ qua resume. Chỉ nút bắt đầu replay mới POST tạo phiên; khóa
đồng bộ ngăn hai click cùng lượt tạo hai session. Sau tạo/resume, URL có session ID
và cutoff nên reload đọc session, không tạo thêm. Lưu browser dùng helper hiện có
để storage bị chặn không làm URL resume thất bại.

## Contract thực tế và điều chỉnh giả định của brief

Brief `planning/checkpoints/agent-briefs-20261101/replay_link.md` đúng về nguyên
nhân: mount cũ gọi `createSession()` khi dataset-only không có phiên nhớ.
Nhưng giả định `fresh=1` tự POST một lần không khớp code hiện tại:

| Caller | Hành vi đã xác minh từ source | Quyết định |
| --- | --- | --- |
| `QuickSessionDialog.jsx` / Dashboard | Submit tự POST qua `createReplaySession`, rồi navigate URL có session ID; `fresh` bị xóa | Giữ nguyên |
| `MarketAssetCatalog.jsx` Luyện tập/Luyện tick | Sinh link dataset + `fresh=1`, tùy chọn start index | Giữ form prefill, cần click bắt đầu |
| `ReplayWorkspace.jsx` dataset sidebar | Single-asset dùng link `fresh=1`; multiasset có mutation chuyển tài sản riêng | Giữ nguyên |
| `LearnWorkspace.jsx` | Về Replay / liên kết luyện tập mang context dataset/session, không có create command | Dataset-only chỉ đọc/resume hoặc form |
| `JournalWorkspace.jsx` / unavailable routes | Quay về replay với workspace context, không có create command | Giữ context, không tạo phiên ngầm |

Không tìm thấy caller dataset-only nào thực thi thao tác tạo có chủ đích mà cần
giữ auto-create tại mount. Root đã đồng ý giữ contract `fresh=1` là form.

**Read-only ở đây là không tạo/chỉnh session do mở link.** Chart vẫn giữ time
tracking hiện có của `useReplayActivity`: flush có thể POST
`/replay/sessions/{id}/activity`, gồm lúc reload/unmount. Đây là endpoint khác;
root đã đồng ý giữ. Receipt ghi mọi POST và đếm riêng POST `/replay/sessions`.
Không diễn giải 0 create-session POST thành 0 mọi write.

## Thay đổi

- `foundation_v2/web/src/ReplayWorkspace.jsx`: reuse catalog/read/sort/storage
  helpers, resolve dataset-only qua GET, hủy read khi unmount, khóa click tạo.
- `foundation_v2/web/tests/replayDatasetLink.browser.mjs`: focused browser
  regression với API fixture, hard allowlist origin `127.0.0.1:5252`.
- Không sửa main, testing-copy, Dashboard, AI code hay CSS; không stage/commit.

## Kiểm chứng

Frontend Vite riêng cổng **5252**, `--strictPort`, proxy trỏ `127.0.0.1:1`.
Browser intercept `/api/*`, gồm integration health; origin ngoài bị abort.
Playwright không giữ được mọi activity keepalive lúc document reload/pagehide:
Vite ghi các request activity thoát route bị **ECONNREFUSED 127.0.0.1:1**.
Đây là giới hạn interceptor/teardown đã quan sát, không phải API thực. Không có
create-session request thoát route; receipt đếm riêng creation đã bắt được.
Không tuyên bố receipt browser chứa đầy đủ activity keepalive của document cũ.
Không gọi 5180/8010, không dùng backend/provider/broker hay dữ liệu owner.

Lệnh từ `foundation_v2/web`:

```powershell
$env:TW_V2_API_TARGET='http://127.0.0.1:1'
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5252 --strictPort
node tests/replayDatasetLink.browser.mjs
node node_modules/vite/bin/vite.js build --outDir "$env:TEMP\replaylink-build" --emptyOutDir
node --test tests/sessionPicker.test.mjs tests/quick-session-validation.test.mjs
$env:TESTING_UI_ORIGIN='http://127.0.0.1:5252'
$env:TW_QUICK_EVIDENCE_DIR='../evidence/owner-system-audit-20261031/replay-link/quick-order-regression'
node tests/sessionCostsQuick.browser.mjs
git diff --check -- src/ReplayWorkspace.jsx tests/replayDatasetLink.browser.mjs
```

- Build PASS; chỉ cảnh báo chunk size có sẵn.
- Browser **6/6 PASS**, page errors = 0:
  - dataset-only mới + remembered session không liên quan: 0 create POST;
    reload form vẫn 0; double click nút tạo đúng 1; reload chart không tạo thêm;
  - chọn phiên đúng dataset mới cập nhật nhất, bỏ archived/Prop/unavailable;
    reload không tạo phiên;
  - fresh launcher giữ form + start index 12; click đúng 1 create POST;
  - session/cursor cụ thể thắng dataset/fresh; backend GET có `cursor_index=5`;
  - catalog 503 giữ error, không chuyển thành create;
  - blocked storage vẫn resume từ URL, không tạo phiên.
- Existing `sessionCostsQuick.browser.mjs`: **3/3 PASS** BUY/SELL/costs, native
  chart + real clicks trên mock API. Không có page error.
- Session/catalog/quick validation unit tests: **18/18 PASS**.
- Diff whitespace check PASS.
- Đã mở xem screenshot form 390px và 1440px; dùng form/copy có sẵn, không redesign.

Receipt: `replay-link/browser.json`; screenshots `dataset-form-mobile.png`,
`fresh-form-desktop.png`; existing regression receipt
`replay-link/quick-order-regression/browser.json`.

Các lần debug fixture đầu fail do selector dùng raw copy trước localization,
sau đó do fixture chưa mock endpoint activity. Đã sửa fixture theo source;
không dùng thay đổi production để né các lỗi test đó. `replay-link/failure.png`
là screenshot của lượt selector debug cũ, không là trạng thái kiểm chứng cuối.
Lượt kiểm tra teardown trung gian fail do initScript của fixture chạm storage trên
`about:blank`; đã scope initScript đúng origin, lượt cuối 6/6 PASS và 0 page error.

Vite riêng đã được dừng qua đúng exec session/PID của lane; cổng 5252 không còn
listener sau kiểm chứng. Không dừng process dùng chung.

## Giới hạn

Đây là source/build + mock browser acceptance của thay đổi link. Không phải
deployed/runtime/backend/broker acceptance; không chạy các test Dashboard cũ cần
real API vì lane này chỉ được cấp mock origin. Catalog reuse dựa trên summary
hiện có; không thêm backend query hay khẳng định summary là lịch sử đầy đủ.
