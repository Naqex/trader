# Thực thi hệ thống solo — bằng chứng và các ranh giới còn mở

Owner mở rộng mục tiêu ngày 15/11/2026: chat này tự chịu trách nhiệm cả
alpha/portfolio lẫn hệ thống; không phụ thuộc kết quả thread gốc. Trạng thái
chiến dịch nằm ở [plan workspace riêng](C:/Users/MIIKEY/.codex/worktrees/solo-prop-system/TradingWorkspace/planning/research/SOLO-PROP-SYSTEM-PLAN-20261115.md).
Tài liệu này ghi source map và bằng chứng kỹ thuật của Trader; không là sổ
trạng thái tài khoản hoặc chứng nhận chiến lược đủ điều kiện Challenge.

## Luồng đã đối chiếu trong source

| Ranh giới | Owner/component hiện có | Contract và giới hạn |
|---|---|---|
| Source → nến/tick đã admit | Workspace `prop_campaign_source.Prices`, source proofs/decoders | Cutoff, hash, integer grid, Bid/Ask và same-ms ordering; code nguồn có thể dùng chung, outputs không dùng chung campaign |
| Nến đã đóng → tín hiệu | Registered generator `prop_atlas_scan.candidates`, XAU A frozen generator | Rule/version và known-at; raw cohort khác fills; không đổi cohort sau nhìn profit |
| Tín hiệu → giả lập entry/exit | Native paired tick realization; explicit fee/SL/deadline | SL theo executable quote side, fees/lot/point; không coi bar proxy là đường tick |
| Các strategy → một sổ nghiên cứu | `prop_campaign_accounts.Account` + portfolio adapter | Một balance/phase/reset/funding/reserve cho portfolio; hiện adapter V3 chỉ Gold/EUR |
| Saved observations → shadow advisory | [mt5_shadow_step.py](../../foundation_v2/scripts/mt5_shadow_step.py) | Fixed EURUSD H4; settled/complete hours, predecessor/hash; PnL/fills không được mô hình hóa |
| Historical replay → checkpoint | [forex_forward.py](../../foundation_v2/trading_workspace_v2/forex_forward.py) | Indicators, queued decisions, financing, risk latches và cursor cùng snapshot; có CAS chống writer cũ |
| Demo intent → unknown → reconcile | [mt5_demo_session.py](../../foundation_v2/scripts/mt5_demo_session.py) | Ghi intent trước POST, resume cùng request ID; không resend sau timeout chưa rõ kết quả |
| Gửi lệnh được cấp quyền | [automation_grants.rs](../../foundation_v2/api-rust/src/automation_grants.rs), native broker admission | Một owner/account, reservations tính cả unknown; research report không cấp execution grant |
| Runtime/source ownership | [run_api_platform.py](../../foundation_v2/scripts/run_api_platform.py) | Checkout riêng cần output/DB/port riêng; manifest có process identity và binding |
| Artifact/recovery | [artifacts.py](../../foundation_v2/trading_workspace_v2/artifacts.py), [artifact_backup.py](../../foundation_v2/trading_workspace_v2/artifact_backup.py) | Immutable publication, hash/provenance, quiesced DB+artifact backup; restore không chỉ copy file |

Luồng research, shadow advisory và Demo client là các consumer khác nhau.
Hiện chưa có bằng chứng A+EUR/GBP đã chạy thành một bot broker end-to-end.
Không đưa tín hiệu vào send endpoint trước khi bind semantics/cost/account/risk
và có quyền thực thi đúng account. Đây là integration gap phải hoàn thành sau
khi candidate đủ cổng, không được che bằng test một helper riêng lẻ.

## Diễn giải vận hành cho owner

- **Dừng tự động không phải đã flat.** STOP/expiry chặn yêu cầu gửi mới;
  opening đã khớp nhưng close chưa được xác nhận vẫn cần attention/reconcile.
- **Mất phản hồi không có nghĩa lệnh thất bại.** Đối soát intent cũ trước;
  không gửi lại chỉ vì timeout hoặc agent đã khởi động lại.
- **Process còn chạy không chứng minh dữ liệu mới.** Heartbeat, data timestamp,
  trạng thái retry, source quality và accepted decisions là các trường riêng.
- **Khôi phục state khác khôi phục edge.** Restore đúng sổ/artefact chỉ chứng
  minh kỹ thuật; chiến lược vẫn có thể lỗ hoặc không đủ tần suất.
- **Xem error không phải tắt guard.** Source/cost/correctness failure phải có
  nguyên nhân và run mới có scope khi cần; không đổi lịch sử fail thành pass.

## Bằng chứng hiện có của lượt này

- Venv riêng ở `foundation_v2/.venv`, lock hiện hành; không sửa venv/runtime gốc.
- Recovery audit: 171 scoped offline tests đạt; receipts/logs ở
  `.artifacts/solo-system-20261115/recovery/`. Các trường hợp gồm orphan pages,
  crash/resume, stale writer, unknown send, pending exit, DST và signed/triple swap.
- Launcher linked-worktree default đã tái hiện đi tới mocked DB trước sửa.
  Bản sửa chặn trước DB/build khi thiếu root/DB/port riêng, giữ đường primary;
  56 Python tests và 53 subtests đạt. Review độc lập đã kiểm metadata Git hỏng,
  cấu hình provider kế thừa và root riêng. Commit `7241a8b0`.
- Optional AI được tắt rõ trong profile cách ly; không đọc credentials, gọi
  provider hoặc khởi chạy MCP kế thừa. Native Rust AI tests: 26 đạt, 6 bài cần
  PostgreSQL bị ignore trong suite này, không tính là đạt.
- AI skill/reference hiện có đã qua audit 0 lỗi/0 cảnh báo, 4 liên kết và 7
  trường hợp routing; không tạo framework/skill mới hay sửa global config.
- Native `mt5-shadow` đã build từ đúng checkout bằng toolchain riêng; process
  supervisor đạt 4/4 bài synthetic loopback. PostgreSQL metadata/artifact
  restore đạt 16/16 kiểm tra, đối soát 47 bảng trong cụm dùng một lần.
- Rehearsal đầu tiên của artifact restore gặp lỗi Windows temp path >260 ký
  tự trước backup. Bản sửa dùng native long paths, giữ nguyên khóa tương đối.
  Một lỗi cache khác có thể bỏ sót ghi đè nhanh rồi trả lại mtime cũ: giờ kiểm
  cả ChangeTime/USN và chặn writer trong lúc đọc; không có revision đáng tin thì
  hash lại toàn bộ. Commit `a60db1e5`, review độc lập trên đúng source hash.
  Sáu suite đạt 71 bài, 14 subtests; 1 bài symlink thiếu capability được skip.
  Sau hiệu chỉnh phân loại lỗi, 10 bài cache và 5 case độc lập đạt.
- Native Demo grant crash/restore đạt 5/5 kiểm tra, 47 bảng khớp; đã dừng đúng
  cụm riêng. Rehearsal phát hiện test seed có hai credential đua nhau nhưng
  test restore chỉ nhận một phía. Chỉ sửa fixture chọn đúng winner đã lưu;
  production grant logic giữ nguyên. Bằng chứng hai phía race được lưu riêng.

Receipts/logs chi tiết nằm trong `.artifacts/solo-system-20261115/recovery/`,
`.artifacts/solo-runtime-isolation-20261115/` và output riêng nêu dưới đây.
Các cụm PostgreSQL dùng data directory/port/identity riêng; không dùng database
của owner. Một wrapper cũ đã nhầm marker PID âm của initdb và thử TCP cổng
5432 khi cleanup; có listener trả lời nhưng không xác thực, gửi SQL hay sửa
state. Sai sót và lần fail được giữ trong receipt; wrapper đã chỉ nhận PID
dương và port của cụm tự tạo. Không diễn giải thành hoàn toàn không có tiếp xúc
với cổng khác.

Build target và toolchain nằm dưới
`E:/BACKUP-TRADINGWORKSPACE/solo-system-20261115-04e2/`. Portable Microsoft
compiler packages có exact payload hashes và chữ ký publisher được kiểm trước
thực thi; manifest tổng có mismatch được giữ trong receipt, không gọi toàn
manifest đã verified. Không installer, system PATH, registry hoặc global config.

## Điều kiện tích hợp tiếp

1. Đóng findings cụ thể bằng regression và review trên commit tương ứng.
2. Chạy native/synthetic process và restore rehearsal trên DB cluster tự tạo;
   xác nhận cleanup đúng PID/data root. Không dùng DSN inherited của owner.
3. Candidate research phải có đủ source/path, economics và robustness trước
   khi đầu tư nối strategy mới vào runtime; vẫn tiếp research độc lập song song.
4. Cùng recipe phải cho cùng quyết định khi chạy historical và shadow trên
   cùng stream có cutoff, rồi mới xem gap giữa mô hình và broker được cấp quyền.
5. Commit/PR riêng và handover dễ đọc. Không promote vào runtime/thread gốc,
   không mở holdout hoặc gửi broker chỉ vì CI đạt.

Các mục còn mở là việc phải làm tiếp, không phải lý do quay lại chờ thread
gốc. Goal tổng chưa đạt khi chưa có ứng viên Challenge-qualified.
