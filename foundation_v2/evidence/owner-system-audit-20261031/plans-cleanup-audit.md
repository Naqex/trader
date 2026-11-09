# PLAN, trạng thái và cleanup — khảo sát 31/10/2026

WORK: ACTIVE/PARTIAL · REVIEW: REVIEWED-PARTIAL · DOC: FULL

Read-only audit; không sửa PLAN/ledger/STATE, không move/delete hoặc chạy runtime.
Baseline sản phẩm `884d04f2`; Product Plan có WIP Rust-native extension được giữ nguyên.
Receipt này là bằng chứng cho scope mới, không là tracker hoặc acceptance ledger thứ hai.

## Kết luận

Authority chain hiện có đủ; nên thêm một **scope amendment cho single-owner audit**
được Product Plan dẫn tới, rồi cập nhật route ngắn trong CURRENT-CONTEXT/entrypoint.
Không tạo master PLAN mới hoặc làm lại UI exploration. Việc AI autonomy đang học
được tạm dừng, giữ điểm tiếp tục trong brief đã có.

### Tiến độ có thể nói chính xác

| Mẫu số | Kết quả đọc được | Không được suy thành |
|---|---|---|
| 37 task được đăng ký trong STATE lịch sử | 37/37 có `status=accepted`, export revision 389 | 100% sản phẩm; các task chỉ own scope trong packet cũ |
| 26 yêu cầu Y01–Y26 của Product Plan | Y12/Miro và Y26/Figma deferred theo current scope; 24 yêu cầu còn lại cần map evidence hiện hành | 24 requirements có trọng lượng/effort bằng nhau hoặc đã đạt |
| 8 tài liệu điều hướng/PLAN đã kiểm liên kết | 96 Markdown links tổng; 0 missing local-path targets | Content còn đúng, runtime đang khỏe, historical path là canonical |
| UI quality config | `acceptanceStatus=partial-local-validation`, production propagation=false | UI đã accepted toàn bộ hoặc chưa có gì làm |

Để báo % cho owner, dùng hai số riêng sau khi inventory được khóa:
**đã khảo sát N/M phạm vi** và **đã sửa/kiểm chứng K/L finding**. Mỗi mẫu số dẫn
đến danh sách cụ thể trong receipt/plan. Chưa nên đưa một % hoàn thiện sản phẩm
cho tới khi 24 yêu cầu và bốn hành trình A–D đã có matrix source/fixture/runtime.
Không dùng đánh giá cảm quan 80% hoặc 37/37 task làm số thay thế.

## Đối chiếu các mảng hiện hành

Nguồn: CURRENT-SCOPE-20261029.md, TRADER-UI-MASTER-PLAN.md, Product Plan,
operational RESUME và exported STATE. Đây là đối chiếu tài liệu/evidence scope,
không phải browser/API QA mới của các tính năng.

| Phạm vi | Đã có bằng chứng/scoped implementation | Phần chưa đóng cần phân biệt |
|---|---|---|
| UI / shell / design system / journal | FX-aligned code, shared compact token pin, nhiều receipt page/state | U1/U3/U4 partial; W7/W8/full integrated acceptance chưa đóng |
| Data | QDM/Dukascopy isolated import, catalogs, provenance/scope guards | U2 partial; licensed representative pipeline và data quality tổng thể |
| Replay/chart | Renderer/replay, protection/margin fixtures, chart-state receipts | Toàn chart performance, touch/pinch/manual WCAG và semantics scope chưa đủ |
| Research | Reference/native adapters, deterministic slices, OOS/stress wiring | U5 partial; whole-engine durable crash restore, horizon/no-signal/floating-path |
| Analytics/Prop | Scoped report/CSV/lifecycle tests và metrics read models | U6 partial; representative integrated metrics/Prop source-specific checks |
| AI | Provider-neutral/offline boundary và typed advisory context | U7 partial; không mở provider thật/broker từ UI task |
| Demo/live | Account-specific demo evidence có giới hạn | U8 live mở; demo proof không là authority tiền thật |
| Cleanup/setup/runtime | Migration source-delivery receipt, CI và recovery assets | U9 chưa đóng; current build/runtime identity phải kiểm lại; packaging deferred |

Config `ui/project-ui.json` giữ các gate native zoom, axe/WCAG, golden,
long-duration-memory, full-bleed-promotion. Một số receipt đã có proof hẹp cho
chúng; không xóa gate hoặc rerun mặc định: kiểm proof có khớp source và scope
hiện tại rồi chỉ bổ sung delta cần thiết.

## Findings điều hướng

| ID | Finding / vị trí | Sửa nhỏ nhất phù hợp |
|---|---|---|
| PC-01 | CURRENT-CONTEXT.md:3 đang mở đầu bằng autonomy research; task hiện tại chuyển sang audit Trader trước | Đặt section hiện hành 31/10 cho scope audit; giữ link brief và điểm resume bài học |
| PC-02 | Product Plan:61 vẫn gọi multi-user/máy/account là ưu tiên hiện hành; owner nay ưu tiên latency cho đúng một user | Amendment mới ghi performance workload một owner; giữ tenant isolation/auth và thiết kế dài hạn; không dựng scale infrastructure |
| PC-03 | CURRENT-CONTEXT.md:85–88 gọi `Resume hiện tại` nhưng nội dung October2/3 và absent ports là snapshot cũ | Đổi nhãn phần này thành historical operational snapshot và dẫn receipt hiện hành; không cập nhật PID mới vào mọi doc |
| PC-04 | EXECUTION-ENTRYPOINT.md:15 heading hiện tại bao bảng r144/r219 dù run đã r389 | Ghi rõ đây là planner snapshot 22–23/09; newest current authority vẫn RESUME/ledger. Không sửa accepted history |
| PC-05 | Product Plan:43/49/61/201 và các legacy Figma/Miro clauses còn sống xen kẽ; current scope 29/10 đã defer | Link amendment/current scope ngay đầu, không cần rewrite mọi requirement hoặc sửa receipt cũ |
| PC-06 | TRADER-UI-MASTER-PLAN.md:418 còn WIP/hash old snapshot; không bao latest Live/notes/group slices | Thêm routing tới current audit receipt; preserve old scope/hash; không claim full W8 |

PC-03/04 là narrative drift có thể làm agent tiếp tục sai việc; kiểm local links
không phát hiện nó. Historical path vẫn tồn tại nên `Test-Path=true` không là
bằng chứng nên dùng checkout cũ.

### Xử lý doc-only — 01/11/2026

Chỉ sửa routing/nhãn trong planning; không đổi ledger/STATE, verdict U/Y/W hoặc
receipt lịch sử. WIP sẵn có của các file được giữ ý định.

| ID | Trạng thái | Đã sửa |
|---|---|---|
| PC-01 | FIXED | CURRENT-CONTEXT mở đầu bằng audit 31/10, ghi rõ PAUSED BY OWNER và trỏ checkpoint; AI tiếp tục theo §6 brief |
| PC-02 | FIXED | Product Plan đổi nhãn "Ưu tiên hiện hành" 26/09 thành lịch sử, dẫn ưu tiên latency một owner của phụ lục |
| PC-03 | FIXED | Snapshot 02–03/10 có nhãn lịch sử; "Ưu tiên mới nhất" và "Trạng thái hiện tại" đổi thành nhãn có ngày |
| PC-04 | FIXED | Entrypoint ghi STATE r389 và coi r144/r219 là snapshot; thêm route tới audit đang pause |
| PC-05 | FIXED | Đầu Product Plan dẫn current scope và ghi Figma/Miro/Y12/Y26/multi-user là lịch sử/dài hạn; prompt mẫu §16 có ghi chú hoãn Figma Make |
| PC-06 | FIXED | UI Master Plan dẫn checkpoint audit, ghi pause và đánh dấu pointer RESUME 01/10 là lịch sử |
| PC-07 | FIXED | Phụ lục audit từng ghi candidate dùng 5218; cổng này sau đó dành cho preview AI Research/Paperclip. Phụ lục yêu cầu kiểm listener và chọn cổng trống |
| PC-08 | OPEN | `CHECKPOINT.md` bước 4 vẫn ghi `5218`; receipt đó thuộc root, lane này không sửa |
| PC-09 | OPEN | Authority note 01/10 ở cuối Product/UI Plan vẫn trỏ `workspace-next-stage/RESUME.md`; giữ nguyên làm lịch sử, nhãn đầu file đã route sang nguồn hiện hành |

Kiểm link sau sửa: 75 Markdown link local trong năm file planning đã sửa, 0
thiếu đích; receipt này không có link local. Chỉ kiểm path tồn tại, không kiểm
anchor hoặc URL ngoài.

## Cleanup manifest ban đầu

| ID / path | Owner / Git | Consumer/unique evidence | Quyết định hiện tại | Điều kiện thay đổi / rollback |
|---|---|---|---|---|
| C-01 `planning/trader/PRODUCT-COMPLETION-PLAN.md` | Workspace; pre-existing dirty Rust-native extension | Current scope/acceptance owner | KEEP; patch nhỏ có tách diff của task mới | Không stage/commit WIP ngoài scope; review staged diff |
| C-02 `projects/evidence/ledger-design-system-20261012` | Workspace untracked, 6 files | Canonical product folder cũng 6 files nhưng 0 giống hash, 4 khác, 2 không tồn tại đích; có failure.json/png | KEEP; provenance chưa rõ, không xóa như duplicate | Backup ngoài repo + source/hash manifest; review mỗi unique file trước archive; giữ negative evidence |
| C-03 `projects/mt5-tradingview-backtester` | Checkout/runtime lịch sử | Migration receipt nêu 6 source WIP + evidence + runtime ownership ở checkout cũ | KEEP, không retire trong cleanup thẩm mỹ | Guarded cutover, backup/restore, command-line/runtime identity và owner gate |
| C-04 `planning/trader/*.md` | Workspace, 51 top-level Markdown files | Canonical scope/spec/history; nhiều incoming anchors | KEEP; rút routing hiện hành trước | Review từng nhóm, preservation map/hash và resume-read test trước compact/archive |
| C-05 `projects/trader/foundation_v2/evidence/` | Product, 385 directories lúc khảo sát | Historical successes, failures, fixtures, regression and rollback | KEEP; thêm focused receipt/index | Không bulk-delete vì số lượng; chỉ archive nhóm đã đối chiếu caller/writer/hash |
| C-06 product `.runtime`, `.artifacts`, `.venv`, DB/artifacts/config | Product/runtime, phần lớn ignored | Runtime state/user data hoặc rebuild assets | KEEP | Exact owner/process/data map; không dùng gitignored=disposable |
| C-07 `projects/vi-dubber` dirty/untracked | Product khác | Scope user đang defer | KEEP/OUT OF SCOPE | Không stage/revert/publish hoặc cleanup cùng Trader |

Không có file nào được chứng minh đủ điều kiện delete trong lane read-only này.
Lợi ích cleanup hiện tại nằm ở routing/state clarity và gom primitive/dead CSS
sau proof của lane implementation, không nằm ở xóa dữ liệu/evidence.

## Cấu trúc plan đề nghị (phụ lục của Product Plan)

1. **Baseline và inventory:** source HEAD/WIP, runtime build identity, routes +
   hidden surface list, frontend/API/DB workload map. Khóa mẫu số inventory.
2. **Shared contracts/reference:** compact geometry, semantic states, icons,
   motion, menu/dialog/grid contracts, VI/EN conventions; reuse owners hiện có.
3. **Ưu tiên latency:** đo navigation/filter/paging/drawer và query before/after
   với cùng data; sửa bottleneck lớn trước; giữ raw samples/error cases.
4. **Remediation theo finding cluster:** disjoint files/owner, meaningful focused
   regression + screenshot review; không đồng thời rewrite tiền và di chuyển file.
5. **Integrated route/state validation:** theme, locale, 360/768/1440 và 1920,
   keyboard/focus, hover+selected, reduced-motion, empty/error/stale/unknown.
6. **Cleanup C1/C2 có chọn lọc:** bỏ dead code/CSS sau consumer checks; docs routing
   và review-resume trước compact; preserve unrelated WIP/immutable receipts.
7. **Báo cáo/rollout:** simple matrix đã làm/còn thiếu, audited denominator,
   measured latency + limitations; candidate source/build khác active runtime;
   rollout/migration/human/broker/provider gates riêng.

Mỗi slice phải có allowed files, reuse map, evidence locator, rollback và next
action. New scoped plan own audit findings/remediation, Product Plan own U/Y
acceptance, old run ledger own những task đã đăng ký; không tạo new master ledger.

## Các lệnh/bằng chứng đã dùng

- Read-only `Get-Content`/`rg` các instruction, authority và receipt được dẫn.
- Parse STATE.json: revision 389; 37 tasks, tất cả accepted; không sửa/export.
- Read-only Markdown-target existence check trên 8 canonical docs: 96 links,
  không thiếu local path; không kiểm remote URL/anchor semantics.
- File inventory + SHA256 comparison cho 6 misplaced evidence files, không move.
- Không chạy product test/build/browser, không runtime/API/DB/broker call.

Next action cho root: tích hợp audit receipt vào scoped plan; dùng findings các
lane còn lại và runtime baseline để khóa denominator/first remediation packet.

## Delta root 01/11 sau owner tiếp tục

PC-01/04/06 đã đổi routing pause sang ACTIVE/PARTIAL, giữ snapshot lịch sử.
PC-08 resolved: CHECKPOINT đầu file giữ bước resume/cổng hiện hành; hướng dẫn
5218 cũ nằm dưới nhãn lịch sử. PC-09 resolved bằng nhãn historical authority
và route đầu file tới owner audit; không sửa ledger/verdict cũ. Studio hiện có19
sidebar destinations; source overlay scan51 owners là inventory, không QA count.
Manifest C-01–07 vẫn giữ quyết định keep/defer; không có bulk-delete.
