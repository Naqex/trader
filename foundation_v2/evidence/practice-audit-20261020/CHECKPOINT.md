# Luyện tập, chart và order — audit 20/10/2026

Đã sửa các lỗi tái hiện được và kiểm tra các luồng dưới đây. Đây là receipt cho lượt audit của owner, không thay trạng thái Product Completion Plan và không chứng nhận toàn sản phẩm không còn lỗi.

## Thay đổi

| Vấn đề | Nguyên nhân và cách sửa | Bằng chứng |
| --- | --- | --- |
| Đổi timeframe khi Play và có vị thế có thể làm sập chart | Trục giá tạm rỗng nhưng overlay gọi getter cũ, ném `Value is null`. Dùng Price Scale API, chờ range hợp lệ, thử fit lại khi range sẵn sàng. | Tái hiện trước sửa; sau sửa Play qua 5m/15m/1m giữ cùng iframe, cursor tiếp tục tăng, nhãn vị thế cập nhật và không có lỗi mới. Unit test mô phỏng null, detached, range lỗi và phục hồi. |
| Lệnh đầu tiên không bật được SL/TP | Form đòi execution đã khởi tạo. Dùng quote preview từ cấu hình instrument/cost/spread của phiên; chỉ khởi tạo tài khoản thật khi lưu. | Phiên mới bật SL/TP, chia TP, từ chối tổng 127%, chia đều về 100%, lưu lệnh đầu tiên thành công. Preview không sửa replay; quote tick đã lưu luôn được ưu tiên. |
| Một số nút chọn/hover thiếu tương phản | Accent trên hover của palette đã pin có cặp dưới 4.5:1. Dùng text trung tính ở đúng trạng thái này. | Contrast test kiểm tra các cặp màu thực sự dùng; không đổi shared palette. |
| Tỷ số lãi/lỗ trung bình hiện 0 khi chưa có lệnh thắng | JavaScript biến `null / số` thành 0. Giữ unknown là `—`. | Browser trên phiên có 3 khoản lỗ và 1 hòa vốn; trung bình thắng và tỷ số cùng là `—`, PnL tổng vẫn -52.03 USD. |
| Tiền trong popup đóng một phần để ký hiệu sau số | Popup có formatter riêng. Reuse formatter hiện có, giữ dấu âm trước ký hiệu. | Browser tiếng Việt: `$0,00`; xác nhận đóng 100% vẫn hoạt động. |
| Cảnh báo Volume mỗi lần dựng chart | Override `smoothedMA.visible` không tồn tại trong thư viện hiện tại. Bỏ override đó, giữ override SMA hợp lệ. | Mở lại chart và tua lùi/khôi phục không sinh cảnh báo mới. |
| Restart API qua đường dẫn tương đối thất bại sau preflight | Supervisor đổi cwd sang foundation_v2. Resolve các path tùy chọn trước cả preflight và start. | Managed native/compact stop/start với đường dẫn capability tương đối thành công; API 8010 ready. |
| Test Data Desk cũ thất bại | Test còn đòi retry counter/nút thủ công đã được thay bằng shared read recovery. | Cập nhật wiring assertion theo implementation hiện có; behavior recovery có suite riêng. Không thêm lại UI retry cũ. |

## Data/state và trade-off

- Quote preview chỉ phục vụ nhập lệnh; backend vẫn là nguồn sự thật cho spread, fill, revision, SL/TP và số dư. Tick thật chưa khởi tạo không bị giả làm quote bar.
- Overlay chờ price scale sẵn sàng trong lúc đổi timeframe, thay vì gọi API deprecated. Giá/SL/TP đã lưu không thay đổi.
- Tua lùi dựng lại cutoff an toàn và khóa đặt lệnh; về mốc mới nhất khôi phục đúng trạng thái canonical. Không dùng dữ liệu tương lai để dựng account ở cutoff cũ.
- Compact response giảm dữ liệu truyền, nhưng vẫn còn chi phí kiểm tra/lưu lịch sử khi phiên dài. Không thay engine hoặc thêm hạ tầng trong lượt này.

## Kiểm chứng

| Lớp | Kết quả | Receipt |
| --- | --- | --- |
| Node, `node --test tests/*.test.mjs` từ web | 404 pass, 0 fail | node-tests.txt |
| Rust lib, `cargo test --locked --lib --manifest-path api-rust/Cargo.toml --target-dir api-rust/target/native-candidate` | 149 pass, 16 ignored, 0 fail | rust-unit-tests.txt |
| Rust integration: rust_replay_core_differential, session_trading_options, session_slippage, rust_prop_differential | 15 pass, 0 fail | rust-financial-tests.txt |
| Native full/compact mutation parity, stages 0/500/5000, 2 samples | 20 checks pass, 12 samples | mutation-parity/receipt.json |
| HTTP native runtime + PostgreSQL riêng | 14 checks pass qua 39 requests | http-journeys.json |
| Production Vite build | Pass; còn cảnh báo chunk chính >500 KB | build.txt |

HTTP kiểm tra SELL bị lỗ khi giá tăng, đóng một phần, đóng hết, SL âm, hai TP khớp chính xác, 4 loại BUY/SELL limit/stop queue/cancel, stale revision không ghi, idempotency không trùng, workspace isolation và cutoff không lộ event tương lai. Số dư sau đóng khớp chính xác tổng net PnL; Equity = Balance + floating PnL.

Browser thực chạy trên fixture riêng: tạo phiên từ dashboard, SL/TP trước lệnh đầu, validation ngày/tỷ lệ TP, chia đều TP, partial close, Play/step và đổi timeframe, full close âm, PnL ngoài thanh tài khoản biến mất khi flat, bảng lệnh đã đóng, analytics, chi tiết trade, sửa/lưu mô tả phiên, tua lùi chỉ đọc và về canonical, dark/light và analytics 390px không tràn ngang. Screenshot lưu trong thư mục này.

Ứng dụng chính 5180 đã phục vụ bundle mới `index-CXDH0eie.js`; dashboard có dữ liệu, không có console error trong smoke test. Chỉ đọc trên origin chính; toàn bộ thao tác đặt/đóng lệnh dùng fixture 6.500 nến M1 tổng hợp trên API 18011 và PostgreSQL tạm. Không gọi broker/provider hoặc mở holdout.

## Hiệu năng đã đo, không suy rộng

- 98 bước browser `step-v1`: median 22.3 ms/request; body 3190–6580 bytes. Đây là fixture local, không phải cam kết độ trễ cho mọi dataset hoặc thời gian paint.
- Native Router cùng trạng thái ở stage 5000: full median 212.402 ms, body 3,109,509 bytes; compact median 174.037 ms, body 3,325 bytes. Chỉ 2 mẫu/view, chưa phải benchmark p95/capacity; không bao gồm TCP/browser paint. Các con số này kiểm chứng đường compact hiện có, không phải mức cải thiện mới do lượt sửa UI.
- Raw sample và giới hạn đo nằm trong browser-network.json và mutation-parity/receipt.json.

## Dọn môi trường và giới hạn

Đã dừng API/PG fixture và Vite 5181, đóng tab QA, reset viewport. API 8010 và preview 5180 của owner vẫn chạy. Giữ nguyên các WIP ngoài phạm vi, gồm ReplayWorkspace.jsx, learnIntegration.css, visual-polish.css và api_platform_acceptance.py.

16 Rust test ignored không được tính là pass. Tick/provider thật, mọi tổ hợp multi-asset/Prop trong browser, stress nhiều người dùng và toàn bộ chức năng chart vendor chưa được chứng nhận bởi lượt audit này. Test parity có kiểm tra portfolio full và từ chối compact chưa hỗ trợ. Không mở quyền live hoặc thay trạng thái gate của plan.
