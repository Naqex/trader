# UI system audit · 31/10/2026

## Gộp nhật ký Live/Testing và một nút chọn tất cả · candidate

- Scope owner duyệt: Gộp/Tách nhóm cho cả Live và Testing. Chưa triển khai xóa
  giao dịch; hành vi xóa tài khoản vốn có giữ nguyên.
- Nhóm là metadata nhật ký có thể hoàn tác, gồm2–500 giao dịch đã đóng, cùng
  tài khoản/phiên, tài sản và hướng. Không tạo execution tổng hợp, không sửa
  source rows, notes/tags, replay state hoặc analytics. Group header đóng mặc
  định; expand hiện dòng gốc, partial page/filter hiện visible/total, source
  đổi facts hiện nhóm cần kiểm tra. Split chỉ xóa quan hệ nhóm sau xác nhận.
- Dùng chung TradeLedgerGrid cho Testing, broker Live và manual Live; giữ CSV,
  sort/filter/pagination và màu PnL. Live/Testing/Accounts dùng SelectionToolbar
  một nút điều kiện. Select all thêm trang hiện tại (accounts: qua bộ lọc);
  Deselect all hoặc X bỏ mọi selection kể cả trang khác.
- Native GET/POST `/api/v2/trade-groups` dùng catalog theo workspace, CAS và
  receipt idempotent. Broker validation đọc snapshot đã lưu, không gọi terminal.
  Migration0020 đã đăng ký trong Rust checksum authority; chưa áp dụng owner DB.
- Source review độc lập không còn finding chặn. Build UI và3 model tests PASS.
  `trade-merge-selection-regression/report.json`:15 case PASS ở1920/1440/390,
  dark/light và touch, zero writes. Đây là regression toolbar/market/picker
  đọc API owner cũ; group-read warning dự kiến vì API đó chưa có route mới.
  `trade-merge-native-qa3/receipt.json` PASS trên PostgreSQL/Router tạm;
  `trade-groups-native.json` PASS (500 members:0.11s), source records và replay
  analytics giữ nguyên. Browser report:9 hành trình PASS, errors[], broker Live,
  manual Live và Testing×1920darkVI/1440lightEN/390touchVI. Gồm merge/reload/
  expand/split/reload, chặn khác hướng, realCAS refresh, injected503, stale source,
  chọn/bỏ xuyên trang và Accounts toggle. Không có owner/broker write.
  Review độc lập source +4ảnh cuối PASS, không còn blocker trong scope này.
- Lượt native QA1 dừng ở startup schema verification timeout trước domain test.
  Harness dành10s pool/60s request cho fixture Windows; production defaults giữ
  nguyên. Build Rust đầu kéo dài, dừng đúng job sở hữu rồi build lại không
  incremental; dev build cuối PASS. QA2 native PASS nhưng browser phát hiện
  thanh chọn che pagination Testing. Đã dùng ResizeObserver chung dành khoảng
  trống theo chiều cao toolbar tại3consumer; QA3 click chuyển trang bình thường
  PASS. Các failure log được giữ tại backup root.
- API8010/UI5180 chưa thay đổi ở lát này. Rollout cần owner duyệt migration0020
  và cập nhật local sau khi candidate qua native/browser/visual QA.

Evidence/candidate: `E:/BACKUP-TRADINGWORKSPACE/ui-system-20261031/trade-merge-*`.

## Kho dữ liệu, bộ đếm liên kết và thanh chọn dùng chung

- Kho dữ liệu bỏ scrollbar gutter rỗng; đường kẻ chạy hết pane. Cột Danh mục,
  Nguồn và Dữ liệu có đủ chỗ cho nhãn giữa cột, thứ tự sort và nút clear. Giữ
  sort dùng chung; pane hẹp cuộn ngang bảng. Cột thao tác 216px đủ nút tải và
  menu 44px trên touch, không đẩy nút ra khỏi cell.
- Notes picker đếm số đã chọn trong bộ lọc / tổng giao dịch trong bộ lọc.
  Lựa chọn ngoài bộ lọc được giữ và báo riêng; 500 vẫn là giới hạn lựa chọn,
  chỉ hiện khi đạt giới hạn. Cancel không sửa links đã lưu.
- Thanh chọn Live trades, Testing trades và Trading Accounts dùng chung layout:
  icon/count/control cùng trục giữa; Chọn tất cả và Bỏ chọn tất cả là hai action
  riêng. Trades chọn các dòng trên trang, Accounts chọn tài khoản qua bộ lọc;
  Bỏ chọn tất cả xóa selection. Mobile đưa controls xuống hàng riêng, giữ hitbox.
  Reference của design system cũng dùng đúng semantics mới. Sync/delete account
  vẫn giữ handler và permission/busy/uncertain gates.
- Build cuối PASS (2812 modules). Independent source + visual review PASS;
  phát hiện và sửa consumer account reference còn toggle-to-clear.
- `grid-selection-qa6/report.json`: **15 case PASS**, real local API read-only,
  1920 dark / 1440 light / 390 dark touch; 0 page errors, 0 request ghi.
  Gồm select 1/2/all/none ở ba trang, đo alignment, sort/clear, right edge,
  nút touch trong cell, Notes all/partial/none và selection ngoài search filter.
  Clock của test Notes đặt ngày 28/10 theo lịch sử local; default ngày của app
  không đổi, không ghi note owner.
- `grid-selection-market-states-qa1/market-browser.json`: **16 case PASS**;
  demo + GET fixtures được gắn nhãn, empty/filtered/clear ở hai theme/width.
- `grid-selection-native-qa1/browser/report.json`: **12 nhóm PASS**;
  Rust Router/PostgreSQL tạm, synthetic manual/broker trades. Count VI/EN,
  cap500, lưu/reload links và editor, CAS/recovery qua native API thật của fixture.
  API owner/broker không bị ghi hoặc restart.
- UI5180 promote atomic, giữ asset cũ và private files. SHA256 index:
  `adec3ee1ab6a3264703e861281570b7e8d3c2235c057f877c552360c8d096922`.
  `grid-selection-deployed-qa1/report.json`: **15 case PASS**, 0 page errors,
  0 request ghi; kiểm lại ba toolbar, Market và Notes trên UI/API đang phục vụ.
  API8010 `/health`: `ok=true`, `execution_capability=false`; PID owner giữ nguyên.
- Các lượt QA thất bại vẫn giữ: route SSE chưa đóng, locator tự đo `:scope`,
  selector account cũ, ngày review mặc định không có trade. Đây là lỗi harness;
  đã sửa kiểm thử đúng ngữ cảnh rồi chạy lại. QA6 bổ sung coarse touch và đo
  action bounds sau khi tăng cột216px. Không thay dữ liệu để đạt PASS.

Evidence/backup của lát này:
`E:/BACKUP-TRADINGWORKSPACE/ui-system-20261031/grid-selection-*`.
Đây là acceptance của lát được giao, không chứng nhận toàn bộ product/broker.

## Date picker theo ngữ cảnh và mặc định liên kết Notes

- Form giữ textbox gõ ngày; toolbar dùng dropdown gọn. Cả hai dùng
  ProjectDateInput, chung calendar, parser, range draft, top layer và timezone.
  Dropdown vẫn có ô gõ trong popup; nhập sai rồi đóng vẫn hiện lỗi cạnh trigger,
  không che nguyên nhân nút Apply bị khóa. Hover không bị mất khi Clear disabled.
- Analytics truyền đúng SessionFilter thay cho Fragment để compact và lựa chọn
  tạm có hiệu lực. Nhãn có “Phiên”, không lộ record ID lúc catalog chưa về;
  tên dài được rút gọn trong giới hạn 240px. Demo dùng cùng boundary.
- Notes mới chọn sẵn các giao dịch đã đóng trong khoảng ngày, giới hạn 500.
  Đợi các nguồn tài khoản phụ đọc xong trước khi cho sửa note mới; lỗi nguồn
  được hiển thị. Defaults chỉ là display khi note còn trống, không tạo bản ghi.
  Khi sửa thật, IDs đi vào autosave. Saved/recovered/manual empty giữ lựa chọn,
  không tự chọn lại khi polling. Bỏ dòng timezone trong context, giữ payload.
- Review độc lập đã phát hiện và sửa race nguồn phụ, hover khi Clear disabled
  và lỗi ngày bị che sau đóng popup. Source review lại: không còn finding.
- Các lượt thất bại được giữ: lần đầu test cần chuẩn hóa optional empty links
  (`undefined`/`[]`) theo contract; lần hai preview http.server từ chối kết nối
  khi tải nhiều chunk; lần ba phát hiện selector còn lộ ID dài trước catalog.
  Đã sửa cap/copy, đổi preview riêng sang backlog128 và chạy lại acceptance.

Candidate/build, fixture và deployed evidence của lát này nằm dưới
`E:/BACKUP-TRADINGWORKSPACE/ui-system-20261031/date-presentations-*`.

- Build cuối pass; `projectDateInputModel.test.mjs`: 6/6 pass.
- `date-presentations-final-qa4/browser/report.json`: **12 nhóm PASS**, 0 page
  errors; API Rust Router/PostgreSQL tạm, dữ liệu tổng hợp, không ghi dữ liệu owner.
  Gồm nguồn phụ deferred, default3 links lưu thật, pristine close0 writes,
  manual empty reload, cap500, rich/template, CAS/recovery và Testing regression.
  Cả 1920 dark/1440 light/390 dark đi qua dropdown nhập sai→Escape→sửa đúng,
  session compact, focus return và không overflow.
- Review độc lập 6 ảnh fixture + report: **PASS**, không còn finding mở.
  Các response lỗi chủ động trong fixture (422/503/409) không được gọi là
  “không console error”; kết quả 0 errors là 0 page errors.
- UI5180 đã promote atomic; hash index
  `ac327adac24c80e6b93d838089ef77134dafd15998b4a41a4dba1b9f6f72c9c7`.
  Rollback index và receipt:
  `date-presentations-release/ui-before-live-review-20261031-103233/` và
  `date-presentations-release/ui-promotion.json` trong E evidence root trên.
- `date-presentations-release/deployed-qa/report.json`: **12 case PASS**, 0
  page errors, 0 HTTP writes. Notes textbox/type/calendar/picker, Live/Testing
  trades và Analytics compact session/dropdown/hover/Escape/focus; 3 kích thước.
  Đã xem ảnh calendar mobile của bản triển khai, không crop viewport.
  API8010 health `ok=true`, `execution_capability=false`; không restart/migrate.

## Notes drawer theo ảnh owner · cập nhật mới nhất

- Cụm previous/next/menu nằm góc phải, luôn hiện cả khi tạo note mới; arrows
  disable khi chưa có note tương ứng. Chuyển note đi qua autosave drain; note mới
  dùng ID từ receipt sau lần lưu đầu. Menu có đổi tên và liên kết giao dịch.
- Tiêu đề nghiêng và thời gian lưu cùng hàng; trạng thái lỗi/conflict và các nút
  phục hồi vẫn hiện đầy đủ. Chỉ Notes dùng timestamp gọn, các editor khác giữ UI cũ.
- Summary bỏ card/gradient/card con, dùng line trên/dưới full chiều rộng cột trái;
  PnL, win rate và chart vẫn tính từ liên kết thật, thiếu dữ liệu giữ N/A.
- Bỏ UI “Thông tin khác”, vẫn giữ account/strategy metadata trong payload cũ.
- Danh sách liên kết dạng hàng gọn, vạch và PnL theo màu lời/lỗ. Nút + Giao dịch
  và search mở cùng dialog giữa viewport, dùng SearchInput/FxSelect/DateFilter.
  Các bộ lọc chỉ đổi candidates; Apply lưu Map được chọn, Cancel/Escape không
  đổi liên kết. Date filter trong picker độc lập với review range của note.
- Build pass. Native Router/PostgreSQL tạm và browser **8 nhóm case pass**:
  1920 dark/1440 light/390 dark, navigation flush, title/time alignment, summary
  seams, rename focus, date filtering + invalid-date Apply guard, cancel/Escape,
  links+summary, cap500, rich/template persistence, CAS/error/recovery và Testing.
- Review độc lập source + ảnh ba kích thước: PASS. Finding màu PnL sau đổi markup
  đã sửa trên span, không tô toàn hàng. Lượt QA đầu bị lỗi teardown route.fulfill
  khi response đã dispose; đã await route operations để giữ được lỗi có ngữ cảnh,
  rồi hai lượt xác nhận đều pass. Reports cũ được giữ để đối chiếu.
- UI5180 đã promote atomic; index SHA256:
  `1cb2d678bd8e84f399f171ed8245d066ab26aa676e390eaba7f216ff6ad3f545`.
  Giữ private assets và các hashed assets cũ. Không restart API/migration.
- Browser trên bản triển khai: **9 case pass**, ba kích thước, Notes menu/range/
  centered trade picker/Escape và Live/Testing Trades; **0 page errors, 0 writes**.
  API health `ok=true`, `execution_capability=false`.

Fixture/browser evidence:
`E:/BACKUP-TRADINGWORKSPACE/ui-system-20261031/note-drawer-refinement-final-qa/`.
Promotion, rollback index và deployed evidence:
`E:/BACKUP-TRADINGWORKSPACE/ui-system-20261031/note-drawer-refinement-release/`.

## Date/time pickers và loại ghi chú

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

Các mục bên dưới giữ lịch sử của những lượt trước.

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
