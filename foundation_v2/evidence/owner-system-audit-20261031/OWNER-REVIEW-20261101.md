# Đối chiếu yêu cầu owner — 01/11/2026

**Đã sửa được nhiều lỗi cụ thể; đợt audit toàn hệ thống vẫn chưa hoàn tất.**
Phần còn thiếu lớn nhất là chạy các chuỗi lớp nổi/trạng thái ẩn với dữ liệu
healthy/error trên cùng candidate. Inventory matrix đã có; chưa có bằng chứng
đợt này chạy trên runtime owner.

## Cập nhật sau tích hợp của root

- Studio `b11e258b`: build,4 tổ hợp light/dark × VI/EN,390px layouts,
  status/error/expected-stop/login-failure, focus và independent review pass.
  `STUDIO-RESULT.md` giữ luồng state/trade-off/giới hạn. Fixture iframe4/4
  pass cho draft/navigation/preferences/retry; không chứng minh native app/model.
- Replay `6b1701bc`:6/6 browser,18/18 unit;3/3 quick-order regression theo
  receipt lane. Dataset-only không tự create; activity tracking vẫn giữ.
- `overlay-matrix.md` map51 source owners và phân fixture/historical/source-only;
  số file không là số dialog đạt. Có8 chuỗi ưu tiên để khép seam, chưa chạy đủ.
- Notification timing đã được root chạy:9/9 fixture cases PASS,0 page errors;
  `notification-timing/report.json`. Không kiểm stacking trong native dialog.
- `candidate-census.md`:76/76 unavailable/error route cases theo19 destinations
  ×4 configs, không overflow/pageerror/writes; host-control delta4/4 final build.
  `copy-catalog-review.md`: gỡ24 duplicate keys, giữ nguyên effective values;
  regression3/3. Phần kết luận
  snapshot dưới giữ đúng lịch sử trước các lát này. Không dùng unavailable-only
  census làm healthy-workflow acceptance.
- Root environment `1f704cc`: skill/reference/helper; audit0 lỗi/cảnh báo,
  unit/CLI8/8. Chưa deploy/migration hoặc dùng lại provider hết hạn.

Source cuối của lát này: `3617b917` (host controls), sau `07df8176` (copy).
O10 đã có error-state census và overlay inventory, vẫn partial vì thiếu chuỗi
healthy/nested trên cùng candidate. O12 rollout readiness còn mở. Bước tiếp là
8 chuỗi ưu tiên trong overlay matrix, rồi kiểm workload owner ở môi trường
được cấp; không cần research lại UI hoặc chạy lại mọi receipt lịch sử.

## Review đối chiếu ban đầu (snapshot trước tích hợp)

Đây là review tổng hợp cho [phạm vi O1–O12](../../../../../planning/trader/OWNER-SYSTEM-AUDIT-20261031.md),
không thay PLAN, ledger hoặc acceptance U/Y/W. Review đọc source/history và
receipts, không tự chạy lại build/test/API/DB. Baseline `884d04f2`; HEAD khi đọc
`a5a079d0`; Studio còn WIP và đang được root hoàn thiện. Các kết quả test bên
dưới thuộc đúng lát/fixture được dẫn, không là acceptance của toàn HEAD + WIP.

## Yêu cầu ban đầu → bằng chứng → phần còn thiếu

| Yêu cầu owner | Đã có / bằng chứng | Phần còn lại |
|---|---|---|
| Rà frontend, backend và database | `routes-audit.md`, `route-census.md`, `frontend-performance-audit.md`, `api-database-audit.md`, `db-measure.md`: route/reader/native-adapter/schema/index và các điểm khuếch đại công việc | Chưa kiểm mọi endpoint/query/state; chưa có workload, query plan và latency của dữ liệu owner. Inventory source không phải toàn hệ thống đã QA |
| Spacing, vị trí, kích thước, alignment; icon và chữ thẳng nhau | F01–F07 trong `foundations-audit.md`; token thực 32/28/24/44 desktop, target touch 44; portal icon/checkbox; `ui-feedback/report.json` có 20 ảnh selection/bulk tags/template ở 1440/390, light/dark | Reference fixture và một số dialog đã kiểm; các route/detail/chart còn cần computed geometry và screenshot review. F09 vẫn mở, không mass-replace CSS theo search count |
| Normal, hover, selected, selected+hover, focus, disabled; motion | F05 giữ màu selected khi hover, không đổi chiều cao; F02/F03 kiểm checkbox light/dark và portal; Studio thêm token selected+hover và reduced-motion trong WIP | Chưa có matrix toàn consumer, nested action, keyboard, light/dark, giảm chuyển động. Không suy từ một row/reference sang mọi bảng |
| Dialog, popup, tooltip, notification, lớp ẩn | RW-01/02/03/04/06: shared confirmation, picker đóng khi disabled, bỏ Delete cụt, preset dùng LegacyPopover, tooltip chuẩn ở các site được liệt kê. `420efc86` thay confirm bỏ bản nháp bằng shared dialog | Matrix overlay 49 owner files là inventory cũ, chưa là 49 dialog đã test; chưa phủ mọi Escape/focus/async/error/nested layer và notification |
| Pagination, grid, lazy loading | Có shared DataTable/VirtualTableBody/PaginationFooter/SelectionToolbar; FE-01/02 loại waterfall; route census ghi owner và reads; receipt lịch sử có trade sort/paging scope cụ thể | Chưa có current candidate matrix sort/filter/count/page reset/overflow/selection xuyên trang cho mọi bảng. Không thêm virtualization khi chưa đo bottleneck |
| VI/EN tự nhiên, dễ hiểu, wording nhất quán | `ef97e0e9`, `a5a079d0` bổ sung Settings/Learn/Playbook/Risk/Prop/replay và PnL; `testingCopy` 2/2 + build pass cho lát cuối | Dictionary pass không phát hiện hết literal JSX hoặc câu dịch thiếu ngữ cảnh. Chưa browser sweep VI/EN toàn route, lỗi/empty/hidden surface; Studio copy đang WIP |
| Nhanh và nhẹ cho một owner | FE-01–04/07 đã sửa; DB-01/03/04/06 đã triển khai; giữ React/Rust/PG và cache owner hiện có | Chưa có số đo tốc độ toàn app/owner runtime. FE-05 polling đo được nhưng chưa đổi; FE-06, FE-08, DB-02/05 có lý do hoãn; DB-07 đóng có điều kiện |
| Workflow thực sự dùng được, không nút cụt/giả lưu | Shared confirm, presets, disabled picker; Data Desk mở trang GET-only và refresh theo click (`96a65f45`); template Apply chỉ hiện khi có `onApply`, bulk tags ghi rõ preview | RW-08 vẫn chưa có bulk tag/template persistence contract; bốn hành trình A–D chưa có packet chạy trọn trên cùng build. Census còn nêu auto-create replay theo dataset link và gateway refresh khi rời trang cần review semantics riêng |
| Reuse/design system đồng bộ | Reuse Lucide/AppIcon, FxSelect, LegacyModal/Popover, ConfirmationDialog, shared selection/grid/editor/query owners; F08 giữ incumbent; labels dùng một state owner | Chưa chứng minh tất cả consumer tuân contract; Studio đang root review. Không có lý do đã đo để thêm framework/icon package mới |
| Dọn repo, plan và đường tiếp tục | PC-01–07 sửa routing/nhãn lịch sử; 75 local Markdown links ở 5 planning files không thiếu đích; cleanup C-01–07 có keep/defer/provenance | Không có path nào đủ proof để bulk-delete. PC-08 checkpoint/cổng cũ và PC-09 pointer lịch sử cần root reconcile; không làm mất WIP, failure evidence, runtime/data |
| Đánh giá Jev/TypeSafe có ích ở đâu | PLAN ghi hướng typed judgment cho phán đoán ngôn ngữ như tìm ghi chú/gợi ý nhãn; code giữ workflow và số tiền | Chưa có evaluation về chất lượng/cost/privacy cho task cụ thể; chưa tích hợp provider trong audit. Căn lề, lọc, đổi trang, tính tiền và mở popup dùng code hiện có |
| Tiến độ thật và candidate có thể review | `requirements-matrix.md` map đủ 26 Y và A–D, giữ historical/fixture/owner-runtime riêng; report này reconcile SHA mới hơn các receipt WIP | Chưa candidate-accepted, chưa rollout; không suy 37/37 historical tasks hoặc số finding đã sửa thành % sản phẩm |

## O1–O12 hiện tại

| ID | Trạng thái review | Căn cứ / điều kiện còn thiếu |
|---|---|---|
| O1 Inventory | Partial | Có route/deep-link/overlay source inventory. Baseline 20 sidebar; AI mở rộng thành 21 trong census; Studio WIP hiện còn **19** (5 Testing + 7 Live + 1 Strategies + 4 Studio + Learn + Settings). Cần census candidate theo danh sách mới |
| O2 PLAN → evidence | Đủ cho đầu ra đối chiếu | 26/26 Y đã map, 2 deferred; 4/4 hành trình có source/scoped proof. Không nâng Y/U acceptance |
| O3 Geometry/icon | Partial | F01–F07 và selection/dialog samples có proof; thiếu toàn route/detail matrix |
| O4 States/motion | Partial | Reference checkbox/row/portal đã kiểm; selected+hover/motion Studio và toàn consumer chưa nghiệm thu tích hợp |
| O5 Lớp nổi | Partial | Sửa RW bounded sites; thiếu overlay keyboard/state/error matrix |
| O6 VI/EN/workflow | Partial | Copy và workflow cụ thể đã sửa; literal/hidden surfaces và chain A–D còn thiếu proof |
| O7 Frontend performance | Partial | Causal overlap, note index, shared labels có fixture parity; polling/Prop handoff/build retention chưa khép |
| O8 API/DB | Partial | Batching/index/cache + PG fixtures có giới hạn rõ; owner latency/query cost chưa đo |
| O9 Grid/paging/lazy | Partial | Có primitives và proof cũ theo scope; chưa toàn route current build |
| O10 Integrated matrix | Mở | Chưa có cùng-source candidate route + overlay matrix. Baseline 20/20 route error census dùng API 503 fixture không chứng minh healthy data workflow |
| O11 Cleanup/handoff | Partial | Manifest/routing có; checkpoint dừng và census cũ cần supersession; không bulk cleanup |
| O12 Candidate/rollout | Mở | Studio WIP, integrated review chưa xong. Build/test từng lát không thay candidate acceptance; chưa có active-runtime rollout đợt này |

Theo đúng bảng này: **1/12 đầu ra đã đủ cho phạm vi riêng (O2), 9 partial,
2 mở**. Các đầu ra khác effort và chất lượng khác nhau; đây là số trạng thái,
không quy đổi thành phần trăm sản phẩm hoặc lượng công việc.

## Những con số có mẫu số và phạm vi rõ

- **26/26** yêu cầu Y được đối chiếu; 24 giữ, 2 deferred. Mức proof cao nhất
  trong matrix: 13 R, 9 F, 2 P; R là từng có owner/local receipt đúng scope,
  không có nghĩa runtime hôm nay đã verified. **4/4** A–D có map; **0/4** được
  cấp full-current-build acceptance từ lượt đối chiếu này.
- **7/7 F01–F07** có bounded implementation + reference fixture; 4/4
  light/dark × 1440/390 browser cases. F08 là quyết định reuse; F09 deferred.
- **5/8 FE findings** đã sửa: FE-01/02/03/04/07. FE-05 measured/unchanged,
  FE-06 deferred, FE-08 open. FE-01/02 chứng minh thứ tự request, không phải
  latency live. Note index median 19,94 → 0,81 ms là workload offline
  2.000 notes + 500 lookups, 9 samples, có preparation và parity.
- **4/7 DB findings** có thay đổi code: DB-01/03/04/06; DB-02/05 deferred;
  DB-07 wontfix đến khi có triệu chứng. DB-01 disposable PG: 2/2 tests,
  validation SELECT cho 0/14/500/unchanged links = 0/1/2/0. Không dùng số
  này để claim latency tiết kiệm. DB-03/04 PG empty-index path và unit
  non-empty parity có scope khác nhau, xem `api-database-audit.md`.
- DB-06 `d5713738`: summary có LRU riêng 1.024 mục/64 MiB; report/page giữ
  lane 24 mục. `cargo test --lib analytics` 32/32 và `cargo check --all-targets`
  pass theo receipt root bàn giao; chưa PG owner latency benchmark.
- `420efc86`: browser fixture kiểm Cancel/Escape giữ draft, confirm mới tải
  bản server; không native dialog/ghi API; build pass theo receipt bàn giao.
  Dòng RW-01 cũ nói giữ `window.confirm` đã được SHA này supersede.
- `96a65f45`: fixture mở Data Desk = **0 writes**, click refresh = đúng
  **1 POST** vào route được intercept. Không gọi catalog provider thật.
- Studio: production build + 4 tổ hợp light/dark × VI/EN, mỗi tổ hợp có
  1440/390 đã pass ở lượt mock trước theo bàn giao. Root đang sửa review
  delta, gồm bridge-health mock; chưa gọi lượt đó là nghiệm thu final WIP.

## Hành vi và luồng state đã thay đổi

Read route độc lập bắt đầu song song; các gate denied/error/confirmed-empty vẫn
quyết định UI. LiveSurfaces giữ catalog nhãn rồi truyền xuống các consumer nên
mutation/retry cập nhật cùng một state. Note presence và journal/assignment
lookup dùng index theo identity/nguồn hiện có, giữ unknown khác empty/false.

Backend note-link validation gom nguồn trong transaction cũ; cache summary vẫn
key theo workspace/record/revision/timezone/basis. Không đổi công thức tiền,
thứ tự sort toàn cục hoặc isolation để đổi lấy benchmark. Trade-off là thêm
index/cache memory có giới hạn, thay vì thêm hạ tầng một nghìn người dùng.

Các thao tác bỏ draft/xóa dùng shared confirmation; Data Desk chỉ refresh theo
click. Bulk tag/template chưa có persistence contract không được trình bày như
đã lưu. Studio WIP gom navigation thành Đội AI / Đánh giá / Model / Kết nối,
giữ gateway là detail của Kết nối; còn phải chốt bằng review delta hiện hành.

## Việc nên làm tiếp

1. Root chốt Studio, lưu reviewed SHA/build và kết quả test sau review fixes;
   cập nhật checkpoint/routing với denominator 19 nếu nav giữ như WIP hiện tại.
2. Khóa danh sách route/detail/overlay cần kiểm, rồi chạy candidate matrix có
   data healthy/error/empty/unknown, theme/locale/width, keyboard/focus và
   selected+hover/reduced-motion. Đây là gate còn thiếu quan trọng nhất.
3. Chỉ mở thêm tối ưu DB/API sau số đo workload cụ thể. DB-02/05 và FE-05/08
   có thể tiếp tục defer nếu owner không có triệu chứng; giữ căn cứ mở lại.

Theo thông tin owner mới cung cấp, key Opus 5.5 đã hết hạn. Pilot/inference
receipt cũ chỉ là lịch sử, không là provider readiness hiện tại. Không retest
provider hoặc dùng một provider khác để tự vượt gate.

Chưa chạy provider/broker/service, chưa migration/deploy, chưa viết DB owner
trong lượt review này. Kết luận phù hợp hiện tại là **audit tiếp tục, đã có
remediation được kiểm theo scope; chưa hoàn tất toàn sản phẩm**.
