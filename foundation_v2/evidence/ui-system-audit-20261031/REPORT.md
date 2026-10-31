# UI system audit · 31/10/2026

## Phạm vi và bằng chứng

- Kiểm kê tĩnh `foundation_v2/web/src`: 152 module JSX; 50 module có dialog, drawer, popover, menu hoặc lớp nổi; 30 module có SVG inline trước lượt gom icon.
- Build candidate: `npm run build -- --outDir E:/BACKUP-TRADINGWORKSPACE/ui-system-20261030/candidate2` — pass, 2,810 modules transformed.
- Smoke browser candidate: Live trades ở 1.440px dark, 1.920px light và 390px dark; không có page error, không tràn ngang ở viewport; thanh chọn giao dịch vẫn mở đúng.
- Runtime/API/5180 chưa được restart hoặc promote. Candidate dùng dữ liệu fixture hiện có; không ghi broker hay dữ liệu owner.

## Sau khi được cho phép rollout

- API8010 đã cutover sang `trading-workspace-api-live-review-note.exe`, SHA256 `e3156e9186740dcc64a33ccba907a68b7eb28e3d3502343972055af94a7fcdad`.
- Preflight và readiness đều PASS; database không cần migration, không có broker order hoặc submission chưa reconcile.
- UI5180 đã promote drawer Notes rồi promote tiếp candidate audit UI bằng thay thế `index.html` atomic. Hash phục vụ cuối: `30503c38361676b76db5164c7762240119b0838847f22a8858f9d3e2e6aacf2e`.
- Backup trước rollout: `E:/BACKUP-TRADINGWORKSPACE/live-note-review-20261030/ui-before-live-review-20261031-073938` và `E:/BACKUP-TRADINGWORKSPACE/ui-system-20261030/ui-before-live-review-20261031-074108`.
- Kiểm tra deployed: Notes drawer mở được ở 1.920px và 390px; Live trades và Testing trades mở được ở 1.440px; không có page error hoặc overflow.

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
