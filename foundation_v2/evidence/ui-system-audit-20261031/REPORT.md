# UI system audit · 31/10/2026

## Date/time pickers và loại ghi chú · cập nhật mới nhất

- DateFilter tái sử dụng ProjectDateInput thay cho calendar riêng. Date, wall
  datetime, time và range dùng chung icon, calendar tháng/năm, top-layer popover,
  focus và touch target. InstantDateInput vẫn sở hữu chuyển đổi timestamp/múi giờ.
- Range chọn hai đầu rồi mới phát một thay đổi; Escape sau đầu thứ nhất hủy phần
  đang chọn. Cho phép gõ trực tiếp, giữ nội dung lỗi, không ghi đè ngày hợp lệ cũ.
  Giờ giữ được giây và so sánh đúng biên `17:00`/`17:00:00`. Bàn phím điều hướng
  ngày qua ranh giới tháng bằng mũi tên/PageUp/PageDown.
- Context Notes dùng một range field và picker theo component nhãn hiện có:
  tìm/tạo, đổi tên/màu và kéo thứ tự. Bốn loại mặc định không có nút xóa, API cũng
  từ chối xóa/ẩn chúng. Loại tự tạo lưu ở server và xóa bằng tombstone; ghi chú cũ
  còn giữ được loại đó khi đọc/sửa/lọc. Thứ tự là preference của trình duyệt.
- Catalog có revision/CAS, idempotency và workspace scope. Đã sửa lỗi danh sách
  Notes đọc `tags.length` dù API cho phép thiếu tags, và lỗi mất focus khi control
  đang lưu bị disable khiến Escape có thể đóng nhầm drawer.
- Phản hồi danh mục đến muộn không ghi đè revision mới hơn; lỗi GET cũ không
  thay dữ liệu đã được xác nhận qua cập nhật trong cùng workspace bằng defaults.
- Đã đối chiếu các hướng [DayPicker](https://daypicker.dev/selections/range-mode)
  và [React Aria](https://react-aria.adobe.com/DateRangePicker/useDateRangePicker).
  Chọn mở rộng component hiện có; không thêm dependency.

### Kiểm chứng và rollout

- Node model tests: **18/18**; Rust unit bảo vệ loại mặc định: **1/1**.
- Native Router/PostgreSQL tạm: CAS, idempotency, workspace isolation, vòng đời
  custom type và sửa note có type đã xóa đều pass; template/media regression pass.
- Browser picker: **6 nhóm case**, 1920 dark/1440 light/390 dark; tạo/lưu/tải lại,
  đổi tên/màu/xóa loại tự thêm, bảo vệ loại mặc định, lỗi ngày và Escape; pass.
- Notes filters: **5 nhóm case**, pass; không có request ghi. Luồng rich Notes,
  template, links, autosave failure/conflict và Testing trade editor cũng pass ở
  ba kích thước. Đây là dữ liệu thử biệt lập, không phải broker acceptance.
- Build UI, API và worker release pass. Sau xác nhận riêng của owner, đã áp dụng
  `0019_note_types.sql`; số dòng của mọi bảng hiện có không đổi trong cutover.
  Backup database PostgreSQL18 và **4.142 artifacts** đã được kiểm tra trước đó.
- API8010: `trading-workspace-api-note-picker.exe`, SHA256
  `7dd2aa45866cb753ab2b42029c361a335f056c4afc3e510c230afddef03e310d`.
  Worker cùng schema19, native/compact và capability descriptors được giữ.
- UI5180 index SHA256:
  `82cdd188186a436d1ad752e069691c52e886ce8de5c31e93633d412906010a59`.
  Atomic promotion giữ private root files và assets cũ.
- Deployed browser: **9 case**, ba kích thước, Notes picker + Live/Testing Trades;
  không page error, không overflow ngang, **0 request ghi dữ liệu**.
- `/health`: `ok=true`, `execution_capability=false`. Sau restart có lỗi tạm
  `mt5_worker_failed`; retry đang có tự phục hồi về connected/ready, `stale=false`,
  snapshot `2026-10-31T02:31:34.651972+00:00`. Không gọi sync/reconnect hay restart
  terminal. Nguyên nhân transient chưa xác định; chưa có kiểm chứng ổn định dài hạn.

Receipts, screenshot, candidate và backup riêng tư:
`E:/BACKUP-TRADINGWORKSPACE/ui-system-20261031/note-picker-release/`.
Fixture receipts:
`E:/BACKUP-TRADINGWORKSPACE/ui-system-20261031/note-picker-types-final-qa2/`,
`note-picker-filter-final-qa2/`, `note-picker-review-qa2/`.
Lượt xác nhận candidate cuối: `note-picker-final-confirmation2/`; deployed cuối:
`note-picker-release/deployed-final-qa/`. Lượt thử trước đó có hai lỗi ở test:
gate giữ GET dùng chung khiến chính thao tác cần kiểm tra bị khóa, và assertion
đọc nhãn ngay sau reload trước khi catalog tải xong. Đã bỏ gate không phù hợp,
chờ đúng nhãn được tải rồi chạy lại; giữ report thất bại để đối chiếu.

Các mục bên dưới giữ lịch sử của những lượt trước; trạng thái triển khai mới nhất
là mục này.

## Phạm vi và bằng chứng

- Kiểm kê tĩnh `foundation_v2/web/src`: 152 module JSX; 50 module có dialog, drawer, popover, menu hoặc lớp nổi; 30 module có SVG inline trước lượt gom icon.
- Build candidate: `npm run build -- --outDir E:/BACKUP-TRADINGWORKSPACE/ui-system-20261030/candidate2` — pass, 2,810 modules transformed.
- Smoke browser candidate: Live trades ở 1.440px dark, 1.920px light và 390px dark; không có page error, không tràn ngang ở viewport; thanh chọn giao dịch vẫn mở đúng.
- Runtime/API/5180 chưa được restart hoặc promote. Candidate dùng dữ liệu fixture hiện có; không ghi broker hay dữ liệu owner.

## Sau khi được cho phép rollout

- API8010 đã cutover sang `trading-workspace-api-live-review-note.exe`, SHA256 `e3156e9186740dcc64a33ccba907a68b7eb28e3d3502343972055af94a7fcdad`.
- Preflight và readiness đều PASS; database không cần migration, không có broker order hoặc submission chưa reconcile.
- UI5180 đã promote drawer Notes rồi promote tiếp candidate audit UI bằng thay thế `index.html` atomic. Hash phục vụ trước lượt chỉnh drawer cuối: `30503c38361676b76db5164c7762240119b0838847f22a8858f9d3e2e6aacf2e`.
- Backup trước rollout: `E:/BACKUP-TRADINGWORKSPACE/live-note-review-20261030/ui-before-live-review-20261031-073938` và `E:/BACKUP-TRADINGWORKSPACE/ui-system-20261030/ui-before-live-review-20261031-074108`.
- Kiểm tra deployed: Notes drawer mở được ở 1.920px và 390px; Live trades và Testing trades mở được ở 1.440px; không có page error hoặc overflow.

## Cập nhật drawer theo reference FXReplay

- Notes drawer: giữ editor ở bên phải, làm gọn context bên trái, đổi ngày thành hai control dạng pill, note type thành semantic pill, và chia summary thành PnL/Return chính cùng win rate và tổng giao dịch. Trạng thái `N/A` và dữ liệu thiếu vẫn giữ nguyên.
- Trade detail drawer: mặc định sidebar còn khoảng 28% chiều rộng ở desktop để vùng ghi chú rộng hơn; resize thủ công và giá trị đã lưu của người dùng vẫn được tôn trọng.
- Build cuối: `npm run build -- --outDir E:/BACKUP-TRADINGWORKSPACE/ui-system-20261031/note-context-candidate3` — pass, 2,810 modules transformed.
- UI5180 đã promote candidate3 bằng thay thế `index.html` atomic; hash phục vụ cuối: `2c01b87d225ee043727573017d867fcc0cf6d1d222d3c5c29d745d6b08b429ad`.
- Backup ngay trước promote cuối: `E:/BACKUP-TRADINGWORKSPACE/ui-system-20261031/ui-before-live-review-20261031-082704`.
- Deployed QA: Notes ở 1.920px và 390px; Live/Testing trades ở 1.440px và 390px; không page error, không overflow ngang; API readiness vẫn `ok=true`, `execution_capability=false`. Không restart API trong lượt UI-only này.

## Đã áp dụng

| Nhóm | Thay đổi | Quyết định |
|---|---|---|
| Icon | Thêm `AppIcon` dùng Lucide React 1.65.0, import tree-shakable; alias theo ngữ nghĩa; giữ geometry riêng cho drawing tools và logo/biểu đồ. | Lucide có SVG inline, nét tùy chỉnh và license ISC; license được giữ tại `public/licenses/lucide.txt`. |
| Icon cũ | `ChartIcon`, `TestingIcon`, rail, select, ngày tháng, notification và nhiều action dùng adapter chung. | Không dùng emoji/ký tự glyph làm icon thao tác. |
| Màu | Thêm semantic alias `*-soft`, `*-solid`, `on-*` trong adapter product; tái sử dụng soft palette 0.3.0. | Chưa tạo palette version mới; tránh tăng cấp màu không có vai trò. |
| Mật độ | Desktop adapter: control 32px, icon action 28px, page gutter 24px, group 20/24px, row 44px. Touch/coarse giữ control/action 44px và row 48px. | Đây là overlay của product, không sửa đè snapshot `annam-compact@0.3.0`. |
| Overlay | Modal, select, search, date input và bảng dùng biến padding/row chung; disabled không còn bị làm mờ toàn bộ box. | Giữ focus ring và hitbox mobile. |
| Notification | Giữ provider, dedup, timeout, pause, persistent và vị trí chart; đổi mark/close sang SVG semantic và dùng màu soft theo tone. | Không thay semantics order/broker và không chuyển blocking notice thành toast. |

## Bảng chi tiết thừa cần duyệt

Chưa xóa những mục dưới đây. Cột “khuyến nghị” là đề xuất để duyệt sau khi xem candidate.

| Vị trí/chi tiết | Vấn đề | Khuyến nghị | Rủi ro nếu bỏ |
|---|---|---|---|
| Các nút close còn viết glyph trong một số AI/vendor surface | Hình phụ thuộc font, chưa cùng adapter | Migrate dần sang `AppIcon close` khi chạm module | Thấp; cần giữ SVG minh họa và brand mark |
| Các SVG minh họa chart/empty state | Không phải icon thao tác | Giữ nguyên | Bỏ sẽ mất ngữ cảnh trực quan |
| Helper text lặp lại trong dialog đã có label rõ | Tăng chiều cao và lặp thông tin | Chỉ bỏ từng dòng sau khi kiểm tra lỗi/unknown state | Có thể làm người dùng thiếu hướng dẫn |
| Header phụ lặp tiêu đề ngay dưới page title | Tạo hai cấp tiêu đề giống nhau | Gộp ở các màn hình xác nhận được không có state riêng | Có thể mất landmark hoặc trạng thái |
| Card bọc một control đơn trong form | Thêm viền và khoảng rỗng, không thêm grouping | Bỏ wrapper, giữ label/focus/error | Có thể ảnh hưởng grid responsive |
| Các nút “Thông tin” chỉ lặp lại label | Tạo click giả và tooltip rỗng | Xóa nếu không có nội dung giải thích độc lập | Mất hỗ trợ định nghĩa domain nếu đang có |
| Bulk action nhiều giao dịch | User đã yêu cầu để giai đoạn sau | Giữ nguyên; chưa mở thêm delete/merge | Tránh mở workflow chưa được duyệt |

## Cần rà tiếp trước khi gọi toàn bộ acceptance

- Migrate inline SVG còn lại theo nhóm: AI custom, chart renderer, vendor/brand và các action nhỏ.
- Kiểm tra từng overlay ở light/dark, keyboard/Escape/focus return, empty/error/stale/unknown.
- Chạy independent UI review và browser regression suite; candidate build chưa phải promotion.
- Notification có thể giữ trong đợt này vì đã dùng provider chung; các copy/tone domain riêng cần review cùng product behavior.
