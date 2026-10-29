# Phát triển và vận hành

Các lệnh trong tài liệu này chạy tại gốc repository.

[← README](../../README.md)


Workspace giao dịch để backtest, luyện replay, ghi nhật ký và phân tích; có kết nối
Live MT5 được kiểm soát riêng. Source hiện hành nằm trong `foundation_v2/`.

**Đang phát triển, trước 1.0.** Phiên bản nằm trong [VERSION](../../VERSION); đây chưa
phải nghiệm thu toàn bộ sản phẩm. Replay là mô phỏng; kết nối hoặc dựng UI không
đồng nghĩa được phép gửi lệnh broker.

Hiện dùng source và build tại checkout. Đóng gói Windows để phân phối được để
sang đợt sau; [release status](../../docs/releases.md) ghi các kiểm tra còn mở.

## Bắt đầu

Cần Git, Python 3.12, [uv](https://docs.astral.sh/uv/), Node.js 22+ và Rust theo
[rust-toolchain.toml](../../rust-toolchain.toml). Backend cần
PostgreSQL và cấu hình riêng; build frontend không cần MT5 hoặc Advanced Charts.
Các lệnh dưới đây chạy tại gốc repo, không cần checkout toàn bộ Naqex Workspace.

```powershell
git clone https://github.com/Naqex/trader.git
cd trader
uv sync --locked --project foundation_v2 --python 3.12
npm ci --prefix foundation_v2/web --ignore-scripts
npm ci --prefix foundation_v2/data_worker --ignore-scripts
npm run build --prefix foundation_v2/web
uv run --project foundation_v2 python scripts/release.py check
```

Để mở frontend phát triển:

```powershell
npm run dev --prefix foundation_v2/web -- --host 127.0.0.1 --port 5173
```

`/api` mặc định chuyển tới `http://127.0.0.1:8010`; đặt `TW_V2_API_TARGET` để dùng
backend khác. Chưa có backend/dữ liệu thì UI hiện trạng thái thiếu/lỗi tương ứng.

## Backend và cấu hình

PATH-2 dùng Rust/Axum + PostgreSQL. Python giữ adapter/research cần thiết; React/Vite
phục vụ UI. Đọc [runtime guide](../../foundation_v2/docs/API-PLATFORM-RUNTIME.md) và
[native profile](../../foundation_v2/docs/RUST-NATIVE-RUNTIME.md) trước khi khởi động.
Dùng database phát triển riêng: startup/migration có thể tạo hoặc thay đổi schema.

Launcher guard hiện có:

```powershell
./restart-offline-api.bat -CheckOnly -RuntimeProfile native -ReplayStorageProfile compact
```

Lệnh trên chỉ kiểm tra. Các lệnh start/restart phải có cấu hình DB, artifact root,
đúng profile và descriptor được xác minh; không tự thay một runtime đang hoạt động.
Flask/EA gốc và `Start-Windows.bat` là [legacy reference](../../docs/legacy-flask-reference.md).

| Thành phần | Cài đặt / tài liệu |
|---|---|
| Advanced Charts 23.040 | [Cài, xác minh và khôi phục](../../docs/advanced-charts.md); thư viện được cấp quyền riêng, không kèm repo/package |
| Lightweight Charts | Chọn rõ `chart_engine=lightweight` khi không dùng Advanced Charts |
| QDM / Dukascopy | [Setup downloader](../../docs/quantdatamanager.md); installer và dữ liệu lưu riêng |
| Nautilus engine | `uv sync --locked --project foundation_v2/engine_runtime --python 3.12`; runtime tùy chọn, không nằm trong candidate ZIP |
| AI integrations | [ChatGPT Web](../../foundation_v2/docs/CHATGPT-WEB.md), [providers](../../foundation_v2/docs/AI-PROVIDERS.md); cần cấu hình/quyền riêng |

## Phát triển và kiểm tra

```powershell
uv run --project foundation_v2 python -m unittest discover -s tests -p test_release_workflow.py
uv run --project foundation_v2 python scripts/check_paths.py
npm exec --prefix foundation_v2/web -- node --test foundation_v2/web/tests/shellPreferences.test.mjs
cargo test --locked --manifest-path foundation_v2/api-rust/Cargo.toml
```

CI tách hygiene/security, Python contracts, web và Rust. Browser smoke dùng fixture;
broker/DB thật không thuộc public PR CI. Các test tích hợp PostgreSQL dùng instance
bỏ đi, cấu hình `TW_PLATFORM_TEST_PG_BIN` khi cần. Xem [đóng góp](../../CONTRIBUTING.md).

## Cấu trúc và phát hành

- `foundation_v2/api-rust/`: API/native domain; `trading_workspace_v2/`: adapters/oracles.
- `foundation_v2/web/`: UI; `data_worker/`: downloader; `engine_runtime/`: engine riêng.
- `ui/`: hợp đồng UI; `docs/`: hướng dẫn; `.agents/skills/`: quy trình agent của repo.
- [Release policy](../../docs/releases.md), [changelog](../../CHANGELOG.md), [đường dẫn và migration](../../docs/paths-and-migration.md).
- Plan khi dùng workspace nằm tại `../../planning/trader/`; README không là ledger.
  Source/receipts lịch sử giữ nguyên ngày, tên và giới hạn kiểm chứng của lần chạy đó.

Copyright (c) 2026 Naqex. Lịch sử phát triển được giữ trong Git.
Mã ứng dụng theo [Naqex Source Available License](../../LICENSE); xem [third-party notices](../../THIRD_PARTY_NOTICES.md)
và [báo cáo bảo mật](../../SECURITY.md). License của ứng dụng không cấp quyền phân phối
Advanced Charts, terminal, dataset hoặc dependency bên thứ ba.
