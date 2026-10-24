# Khám phá MCP native của MT5

Ngày 24/10/2026. Owner yêu cầu kết nối thử để học tính năng và chọn phần hữu ích
cho WMREPLAY. Đây là research trên terminal đang chạy; chưa tích hợp MCP vào sản
phẩm hoặc thay đường thực thi broker. Không khởi động AI Assistant/model, không
gọi lệnh trade, gắn EA/script, sửa file terminal hoặc chạy Strategy Tester.

## Bằng chứng thực nghiệm

- Kết nối trực tiếp JSON-RPC/HTTP loopback `127.0.0.1:22346/mcp`; xác thực bằng
  key owner cung cấp, chỉ giữ trong môi trường của tiến trình thử nghiệm. Không
  ghi key vào repo, artifact hoặc persistent Codex config.
- `initialize` trả `MetaTrader 5 MCP` version `1.0`, protocol `2025-06-18`.
  Terminal build 6230. `tools/list` có **67 tools**, không có annotations/readOnlyHint.
  Client thử nghiệm dùng allowlist các tool đọc đã xem description/schema.
- Thực hiện **19 tool calls chỉ đọc**: 18 trả dữ liệu thành công; lần đầu đọc
  calendar change ID trả `ok:false`. Lần thử lại có giới hạn sau đó thành công
  nhưng mất 19,7 giây. HTTP/tool transport thành công không đủ chứng minh payload
  hợp lệ; cần kiểm cả `isError`, `ok`, schema và dữ liệu.
- Đã đọc workspace/capability, giờ terminal, tài khoản, vị thế/lệnh, metadata symbol,
  5 nến M1, danh mục indicator và tham số Moving Average, lịch kinh tế và mô tả
  một event. Positions/orders trước và sau lượt probe đầu đều rỗng, không đổi.
- `list_open_charts` và danh mục expert đều rỗng. Chưa thử đọc buffer indicator
  đang gắn chart vì không có chart; chưa chạy tester hoặc gọi getter cần run ID.
- Port MetaEditor 22345 không lắng nghe trong lần kiểm tra. Không coi terminal
  discovery là nghiệm thu MetaEditor, compile hoặc AI Assistant.

## Phần đáng đưa vào project

| Ưu tiên | Đã quan sát | Ứng dụng và cách tích hợp đề xuất |
| --- | --- | --- |
| 1 | Symbol có `category`, description, base/profit/margin currencies, calculation mode, swap và các trade flags; EURUSDm thuộc Majors, BTCUSDm thuộc Crypto | Nâng asset catalog: broker metadata giữ nguyên nguồn, map sang nhóm UI có kiểm tra, heuristic hiện tại chỉ dùng khi thiếu. Ưu tiên lấy metadata tương đương từ SDK hiện có; không thêm MCP call theo mỗi tick. `category` do broker định nghĩa không phải taxonomy chuẩn liên broker. |
| 2 | Lịch kinh tế trả dated values, actual/forecast/previous, revision, event IDs; event lookup có tên, đơn vị, importance và source URL | Thêm nguồn macro data riêng, cache ngoài đường realtime; join event description với dated values. `impact_type` của kết quả không thay thế mức importance của event. Đây không phải lịch PnL/calendar journal hiện tại. |
| 3 | Danh mục indicator có group/subwindow; Moving Average có bộ input mặc định | Reuse ý tưởng catalog + typed parameters cho AI/chart. Nếu cần giá trị indicator MT5, đọc từ chart/indicator đúng ID; không coi buffer MT5 tự tương đương indicator trên Advanced Charts. |
| 4 | Có tool schema cho tester prepare/run/status/report và journal | Một adapter nghiên cứu/offline riêng có thể điều khiển tester sau khi có scope/job rõ. Hiện mới kiểm danh sách/schema, chưa nghiệm thu chạy EA hoặc độ đúng backtest. Không tự thay engine replay/research của project. |
| 5 | Workspace trả capability, compiler, read/write roots và limits | Reuse cách công bố capability và lỗi có cấu trúc cho agent tools. Quyền read/write/trade của app vẫn do Rust/workspace/generation admission quyết định. |

Hiện source của WMREPLAY đã có `ai_context.rs` dựng evidence cho replay/journal/
completed research, nhưng chưa có live broker context hay arbitrary MCP tool loop.
Worker MT5 hiện chỉ trả danh sách tên symbol và instrument tối thiểu;
`mt5SymbolCategory.js` phân nhóm bằng tên. Như vậy priority 1 có một gap cụ thể,
không cần tạo thêm gateway/agent framework để giải quyết.

## Các điểm không được tin nguyên trạng

1. **Giờ:** hai lần `get_time_information` trả UTC 06:40/06:42, local 13:40/13:42,
   nhưng `local_utc_offset_minutes:0`. Cùng máy được Python xác nhận offset +420
   phút. Đây là dữ liệu tự mâu thuẫn trong mẫu thử, chưa kết luận nguyên nhân
   upstream. Không dùng field offset đó để đổi giờ hoặc tự kết luận giờ phiên.
   `trade_server_last_known_time` không phải thời gian tick của symbol; không dùng
   nó làm bằng chứng quote mới hoặc thị trường đang mở.
2. **Thông số giá:** MCP trả EURUSDm `tick_size:0` và `tick_value:0`, trong khi GET
   app qua SDK trả tick_size `0.00001`. Không đưa các giá trị zero này vào sizing,
   SL/TP hoặc validation. Giữ execution theo SDK và bộ guard hiện có.
3. **Độ trễ/lỗi:** các đọc local trong mẫu thường khoảng 1–19 ms, còn calendar
   0,7–19,7 giây và có một `ok:false`. Đây là mẫu đơn lẻ, không phải benchmark
   p95/throughput. Không đặt calendar/MCP request trên critical path realtime.
4. **Phiên giao dịch:** chưa có session schedule trong dữ liệu đã đọc; inventory
   không có tool session riêng. Giữ session unknown, không suy từ tick age.
5. **Quyền:** terminal công bố cả công cụ trade/file mutation và
   `mcp_trade_allowed:true`. Khám phá capability không cấp quyền cho AI dùng chúng.
   MCP client sản phẩm phải có allowlist và kiểm scope/identity tại mỗi call;
   mọi broker effect vẫn đi qua execution domain hiện có.

## Hướng tích hợp

Giữ `UI → Rust → worker/SDK → MT5` cho giá và giao dịch. Dùng MCP như adapter bổ
sung cho tools có giá trị mà SDK path chưa có, ưu tiên đọc/caching ngoài luồng tick.
AI chỉ nhận snapshot có provenance/time/identity và dữ liệu đã chuẩn hóa. Kết quả
MCP luôn là dữ liệu đầu vào, không phải chỉ thị hay quyền thực thi.

Không hard-code một endpoint cho mọi tài khoản: server MCP thuộc một terminal
cụ thể; nhiều terminal cần port/key riêng, lifecycle rõ và account binding kiểm
lại khi reconnect. Worker hiện dọn config khi cold-start nên một key được bật
thủ công hôm nay chưa là kết nối sản phẩm bền vững.

Không sao chép binary/source nội bộ của MT5. Phần tái sử dụng là public tool
contract, hành vi đã thử và ý tưởng thiết kế; việc gọi native capability sau này
cần adapter cùng điều kiện sử dụng của MT5.

## Artifact và giới hạn

Inventory/schema đầy đủ, client tạm, sanitized probe và đối chiếu SDK nằm ở
`E:/BACKUP-TRADINGWORKSPACE/mt5-native-mcp-20261024/`:
`inventory.json`, `probe.json`, `followup.json`, `sdk-comparison.json`,
`discover.py`, `probe.py`, `followup.py`.
Không đổi Codex global/project MCP config, không mở port mới hoặc cài package.
AI environment audit: 0 errors/warnings; active instructions 20.203/65.536 bytes,
reserve 45.333 bytes. Runtime thử qua HTTP không có nghĩa tools đã được đăng ký
vào tool namespace của Codex hoặc Mentor.

Nguồn chính thức đối chiếu:
[Configuration](https://www.metatrader5.com/en/terminal/help/mcp_and_ai/configuration),
[Capabilities](https://www.metatrader5.com/en/terminal/help/mcp_and_ai/capabilities).
Các kết quả cụ thể phía trên dựa trên probe local, không suy từ danh sách tài liệu.
