# Đánh giá tĩnh DB-02 / DB-05 / DB-06 / DB-07 (2026-11-01)

Phạm vi: chỉ đọc migrations `foundation_v2/migrations/*.sql` và code Rust tại
HEAD `9e1e8e05`. Không chạy migration, không truy vấn PG owner/8010, không đo
latency. Mọi nhận định về chi phí là suy luận từ code, chưa phải số đo.

## Index liên quan (đã có)

| Bảng | Index/khóa | Phục vụ query |
|---|---|---|
| `workspace_records` | PK `(workspace_id, kind, record_id)`; `idx_workspace_records_kind_updated (workspace_id, kind, updated_at_utc DESC)` | `records()`, `record_heads()`, `catalog_records()`, `load_record_inner` |
| `workspace_record_revisions` | PK `(workspace_id, kind, record_id, revision)` | join head→revision, `format()` |
| `replay_execution_revisions` | PK `(workspace_id, record_id, revision, dataset_id)` | `load_prefix` |
| `replay_execution_events` | PK `(workspace_id, record_id, dataset_id, sequence)` | `hydrate_payload` range `sequence<=$4 ORDER BY sequence` |
| `live_records` | PK `(workspace_id, record_id)`; `live_records_list (workspace_id, updated_at_utc DESC, record_id)` | `live_ledger::list` ORDER BY + subquery account archived |
| `live_record_revisions` | PK `(workspace_id, record_id, revision)` | join head→revision |

Không thấy thiếu index cho bốn mục này. Chi phí nằm ở số bản ghi được đọc và
CPU hydrate/validate trong Rust, không phải ở scan thiếu index.

## Đánh giá từng mục

| Mục | Query / code | Chi phí thực tế | Rủi ro với 1 user | Kết luận |
|---|---|---|---|---|
| DB-02 | `analytics/routes.rs:193` `records()` đọc mọi replay hiện hành; mỗi bản compact gọi `replay_storage.rs:292` `hydrate_payload` = `format()` + `load_prefix` + đọc toàn bộ events + `ValidatedBarPrefix::import` (dòng 339) để kiểm hash/certificate. Lọc `sid`/`selected` chỉ diễn ra trong `build_dashboard_performance_*`. | O(số session × số event) mỗi lần cache miss, 3–4 query/session. Cache `performance-v4` theo `heads` nên chỉ cold khi có mutation hoặc bị evict. `open_trades::project` (dòng 463) cũng cần toàn bộ records, nên lọc trước hydrate không loại hết công việc. | Thấp–trung bình. Vài chục session, vài nghìn event: dự kiến dưới 1 giây. Chỉ đáng lo khi lịch sử replay lớn. | **Hoãn, không migration.** Mở lại nếu cold `/api/v2/replay/trades?session_id=…` đo được > ~1 s trên dữ liệu owner. Hướng sửa khi cần: hydrate theo ID được chọn cho report, giữ nguồn đầy đủ cho open-trade projection và giữ lỗi `trade_ledger_source_invalid`. |
| DB-05 | `live_ledger.rs:279` `list`: `SELECT … ORDER BY updated_at_utc DESC` cho mọi account/trade/note chưa archive, trả nguyên `payload_json` gồm `note_document`. Giới hạn 10.000 record (`live_ledger.rs:530`), `note_document` ≤ 200.000 byte (`note_library.rs:137`), text ≤ 20.000 ký tự. | Query dùng đúng `live_records_list`; subquery archived là lookup PK. Response tăng tuyến tính theo số note. Điểm khuếch đại thêm: `web/src/LiveNoteEditor.jsx:74` tải lại toàn bộ list chỉ để mở một note. | Thấp hiện tại. Ví dụ 500 note × 10 KB ≈ 5 MB JSON; trần lý thuyết lớn nhưng 1 user khó chạm. | **Hoãn, không migration.** Là thay đổi contract API, chỉ làm khi đo response > ~5 MB hoặc parse > ~300 ms. Bước rẻ nhất khi cần: endpoint đọc một record theo ID cho editor; sau đó mới tính list rút gọn không kèm `note_document`. |
| DB-06 | `analytics/routes.rs:782` sort `profit` gọi `summary()` (dòng 80) cho **mọi** session khớp filter, tuần tự; mỗi `summary` miss gọi `replay_service::load_record` (hydrate đầy đủ). Sort ngày chỉ tải tối đa `page_size` ≤ 25 (mặc định 6). | `ProjectionCache` giới hạn **24 mục tổng** và 64 MB (`routes.rs:59`), dùng chung với report/page. Khi số session > ~20, sort profit tự evict summary của chính nó, nên request lặp lại vẫn tính lại toàn bộ. | Trung bình nếu owner có > 20 session và dùng sort profit; thấp với sort ngày. | **Đã sửa — commit `d5713738`.** Summary có lane LRU riêng trong `ProjectionCache` (1024 mục, 64 MB), key vẫn theo workspace/record/revision/timezone/basis; report/page giữ lane 24 mục cũ. Không đổi API, không migration. Đã kiểm: unit test `profit_sort_summaries_survive_more_than_shared_cache_capacity` (40 summary vẫn hit sau 29 mục report; revision mới miss). Chưa đo latency trên PG owner/8010. |
| DB-07 | Projection/clone/validate chạy inline trong handler async (`routes.rs:413–554`, `replay_storage.rs:319–348`), transaction mở suốt phần CPU. Đã có tiền lệ `spawn_blocking` (`replay_service.rs:275`, `data_routes.rs:84`). | Runtime `#[tokio::main]` đa luồng (worker = số core). Một report nặng chiếm một worker; request khác chạy trên worker còn lại. Pool PG mặc định 8 (`config.rs:82`). | Thấp với 1 user trên máy nhiều core. | **Đóng (wontfix) đến khi có triệu chứng.** Mở lại nếu đo được request nhẹ chậm rõ khi report lớn đang chạy. Khi chuyển sang `spawn_blocking` phải giữ snapshot transaction và không kéo dài giữ connection. |

## Thứ tự đề xuất

1. DB-06: đã sửa (`d5713738`); còn thiếu số đo hai request profit trên dữ liệu thật.
2. DB-02 và DB-05: chờ số đo (cold latency, response bytes) trên dữ liệu thật.
3. DB-07: đóng.

Chưa xác minh: số session/note/event thực tế của owner, latency, kích thước
response, query plan (`EXPLAIN`) trên PG owner.
