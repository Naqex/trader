# Bộ chuẩn giao diện gọn — 09/10/2026

Trang xem và thử: `http://127.0.0.1:5180/?workspace=tenant-a&area=testing&ui_reference=1`.
Đổi sáng/tối trên header; rê chuột, dùng Tab và mở dialog mẫu để xem trực tiếp.
Đây là chuẩn chung đang áp dụng cho WMREPLAY, chưa phải chứng nhận mọi workflow
của sản phẩm. Thông số chuẩn và các ngoại lệ bên dưới được phân biệt rõ.

## Kích thước, chữ và khoảng cách

| Cái nhìn thấy / bấm được | Máy tính | Cảm ứng / màn nhỏ | Cách hiểu |
| --- | --- | --- | --- |
| Nút có chữ, dropdown, ô nhập | Cao 36px | Ít nhất 44px | Nút rộng theo nội dung, không cố định mọi chiều rộng |
| Nút chỉ có icon | Vùng bấm 32×32px | 44×44px | Hình icon bên trong chỉ 16px |
| Tab chọn loại trong dialog | Nút cao28px, cả cụm36px | Nút44px | Gọn hơn nút hành động |
| Tab báo cáo | 36px | 44px | Không đổi chiều cao khi chọn |
| Thanh tab chuyển trang | 48px | Giữ cuộn ngang khi cần | Hover chỉ sáng chữ/icon, chọn có gạch dưới |
| Icon nhỏ / thường / navigation / minh hoạ | 16 / 18 / 20 / 24px | Hình giữ kích thước, vùng bấm tăng | Control dùng nét2 trên grid24; navigation hiện hữu giữ1.8. Không dùng emoji thay icon |
| Chữ phụ | 12px | 12px | Dòng18px, không thu nhỏ chữ để nhét vừa |
| Chữ nút / ô nhập / bảng | 13px | 13px | Dòng20px, đậm vừa500 |
| Nội dung chính | 14px | 14px | Dòng21px, độ đậm400 |
| Tiêu đề cụm | 16px | 16px | Độ đậm600 |
| Tiêu đề dialog / trang | 20 / 22px | Giữ dễ đọc | Không cần IN HOA khắp nơi |
| Số KPI | 28px | 28px | Số và đơn vị cùng hàng; chữ số không đổi độ rộng |
| Bo góc ô nhập / menu-dialog | 8 / 12px | Như desktop | Nút vẫn pill, icon button vẫn tròn |
| Viền cấu trúc | 1px | 1px | Không mọc thêm viền khi hover |
| Dấu focus bàn phím | Ring2px cho nút; viền1px xanh cho ô nhập; dropdown dùng nền + gạch chân | Như desktop | Một dấu; không chồng viền/outline/shadow |
| Khoảng icon–chữ / các nút cùng nhóm | 8px | 8px | Chung đường căn giữa |
| Khoảng các ô / nhóm | 24px | 16–24px | Khoảng trống phân nhóm trước card/viền |
| Khoảng khu vực lớn | 32px | 24px | Không thêm wrapper để lấp chỗ trống |
| Lề trang | 32px | Tablet24px, điện thoại16px | Header, nội dung và footer dùng cùng mép |
| Lề dialog | 24px | 16px | Nội dung dài cuộn ở phần giữa |
| Hàng bảng | Tối thiểu48px | Đủ44px cho thao tác | Hàng nhiều dòng được cao hơn |
| Thanh tiến độ | Cao4px | 4px | Không dành cả cột chỉ cho chữ trạng thái |

Thang khoảng cách dùng lại: **4 / 8 / 12 / 16 / 20 / 24 / 32px**. Không phải mọi
khối đều cùng chiều cao: ô lịch, hàng nhiều thông tin và lựa chọn tài sản có nhu
cầu riêng. Cần ghi rõ ngoại lệ, không đặt một số mới chỉ vì “trông vừa”.

Ngoại lệ màn hẹp dùng chuột: tab chọn loại phiên vẫn cao28px và nút X vẫn32px.
Khi thiết bị dùng cảm ứng, hai vùng bấm này tăng lên44px; hình icon không phóng to.

Icon trợ giúp dùng SVG16px, không giảm còn14px. `TestingIcon` và filter icon
dùng nét2 trên viewBox24; chevron dropdown dùng nét2 trên viewBox20.
Ở icon16px/grid24, nét thực khoảng1.33px, tránh nét dưới1px khi
hiển thị100% trên màn DPR1. Giữ kích thước CSS nguyên và căn giữa control; không
scale bitmap, làm mờ bằng opacity hoặc ép `crispEdges` lên icon tròn/chéo.
Đây là điều chỉnh quang học ở consumer, không đổi version token chung.

## Màu và hover

Nền chung vẫn sáng/tối trung tính. Màu có vai trò, không tô mỗi trang một màu.
Owner đã bỏ phương án hover xanh đục; hover chung dùng hai độ sáng trung tính.

| Vai trò | Dark | Light |
| --- | --- | --- |
| Nền trang | `#080808` | `#FFFFFF` |
| Nút phụ | `#23262A` | `#F3F4F6` |
| Hover control | `#3D4148` | `#DDE1E7` |
| Hover dòng | `#17191D` | `#F3F5F7` |
| Dòng đã chọn | `#1C1C1C` | `#F0F0F0` |
| Chữ chính | `#FFFFFF` | `#15181C` |
| Chữ phụ | `#B8C0C9` | `#505965` |
| Cam nút chính | `#FFAD7C` | `#B85018` |
| Xanh biển focus/thông tin | `#70B5FF` | `#2466AC` |
| Xanh lá thành công/lãi | `#72CFA1` | `#24724B` |
| Đỏ lỗi/lỗ | `#FF828B` | `#B5373C` |
| Đỏ nền xoá | `#C53E48` | `#B5373C` |
| Vàng cảnh báo | `#EAC369` | `#80590B` |
| Tím biểu đồ | `#B49AFF` | `#7154A3` |
| Vàng biểu đồ | `#F3CE59` | `#876A1E` |

| Loại tương tác | Bình thường | Rê chuột | Đã chọn / đang mở |
| --- | --- | --- | --- |
| Nút phụ | Nền control trung tính | Sáng rõ hơn, giữ cùng kích thước | Focus xanh khi dùng Tab |
| Nút trong dòng | Trong suốt | Nền control nổi rõ trên cả dòng đã chọn | Menu mở giữ dấu trạng thái |
| Nút chính | Cam | Cam sáng/tối theo theme | Không chuyển thành xám |
| Nút xoá | Nền đỏ, chữ trắng | Đỏ thay đổi nhẹ, vẫn trắng | Xác nhận thật theo workflow |
| Text link / nút text | Trong suốt | Sáng chữ hoặc gạch dưới | Không biến thành pill |
| X đóng dialog | Trong suốt | Chỉ đổi màu icon | Focus bàn phím vẫn có dấu |
| Dòng dữ liệu | Nền trang | Nền nhẹ | Nền chọn riêng, không giống hover nút |
| Switch | Xám khi tắt | Không đổi vai trò | Xanh biển khi bật; xanh lá dành cho kết quả thành công |
| Option dropdown | Không tô nền lâu dài | Nền hover control | Tích cam phía phải; focus bàn phím dùng nền + gạch chân, không viền |
| Ô nhập | Viền1px | Viền rõ hơn | Viền/focus xanh; lỗi đỏ bên cạnh ô |
| Nút không khả dụng | Giữ chỗ, giảm nhấn mạnh | Không hiện hover enabled | Không bấm/submit được |

Dropdown nằm trong form dùng `FxSelect` với `className="is-field"`: cùng viền
1px, góc 8px và chiều cao một dòng 36px như textbox. Bình thường viền nhẹ,
hover và khi mở dùng nền trung tính `--wm-hover`, không thêm viền sáng.
Focus bàn phím dùng nền và gạch chân nhãn; lựa chọn vẫn giữ tích/checkbox.
Ô ghép tài sản tô hover trên toàn ô ngoài;
không thêm nền/viền riêng cho nút bên trong. Ô số dư chỉ đổi viền ngoài.
Nhãn tài sản cao 26px, nền cam `--project-action`, chữ `--project-on-action`;
giữ màu khi hover cả ô. Nút bỏ mã cao 22px, hover chỉ tăng độ rõ của icon,
không thêm nền hoặc viền; không kế thừa chiều cao của control form.
Focus bàn phím của nút bỏ mã dùng màu chữ trên cam để giữ tương phản.
Ô tài sản và nhãn có thể bấm dùng con trỏ bàn tay; khi vô hiệu hóa dùng con
trỏ thường. Icon bỏ mã dùng SVG 14px, căn giữa vùng bấm 22px và cùng trục
tâm với chữ; không dùng ký tự × phụ thuộc font.
Search trong menu dùng gạch dưới. Dropdown bộ lọc dạng pill vẫn là kiểu riêng.
UI Reference có cả mẫu dropdown form dùng được và không khả dụng.

Chữ nhỏ bình thường cần tương phản ít nhất **4,5:1**; chữ lớn và dấu điều khiển
thiết yếu ít nhất **3:1**. Màu hover dòng cố ý nhẹ để không lấn dữ liệu; selected,
focus và lỗi vẫn cần tích/gạch/viền/chữ đi kèm. Không coi màu là dấu duy nhất.

## Chuyển động và effects

| Hiệu ứng | Thời gian | Cảm giác / giới hạn |
| --- | --- | --- |
| Hover | 120ms =0,12 giây | Đổi màu nhẹ, không làm nút to hay lệch |
| Nhấn | 80ms | Phản hồi ngay |
| Mở menu | 160ms | Mờ dần + dịch tối đa4px |
| Mở dialog | 220ms | Nhẹ, giảm tốc ở cuối |
| Mở drawer | 240ms | Dịch4px từ cạnh phải |
| Đổi số trên thanh tiến độ | 200ms | Nối giữa số đo thật |
| Loading skeleton | Nhịp1400ms | Giữ chỗ nội dung, không nhấp nháy nhanh |
| Thanh chờ không biết tổng | Nhịp1600ms | Báo đang hoạt động; không bịa phần trăm |

Nút đóng/phản hồi không chờ animation chạy xong. Không bounce, zoom lớn, gradient
hay glass mặc định; shadow chỉ dành cho lớp nổi cần tách khỏi nền. Bật **giảm
chuyển động** trong hệ điều hành sẽ tắt animation/transition trang trí và cuộn mượt.
“Mượt như Apple” được áp dụng ở sự tiết chế, phản hồi nhanh, giữ liên tục giữa
lớp nội dung; chưa có cơ sở hứa mọi máy chạy60fps hay giống từng hiệu ứng Apple.

## Vị trí, cụm và grid

- **Toolbar:** tìm kiếm trái → phạm vi/filter/sort → hành động phải. Gap8px trong
  nhóm,24px giữa nhóm. Desktop một hàng ổn định; đổi nhãn không đẩy xuống hàng.
  Màn hẹp: nhóm filter cuộn hoặc xuống hàng có breakpoint rõ, không tràn cả trang.
- **Bảng:** chữ trái, số tiền/số lượng phải; title và cell cùng đường căn. Thao tác
  bắt đầu tại mép nội dung header, icon giữa vùng bấm. Sticky header giữ viền khi
  cuộn; footer phân trang có một divider. Bảng rộng cuộn trong vùng riêng.
- **Ngày/giờ:** `dd/mm/yyyy`, `HH:mm:ss` cho thời điểm đầy đủ. Ô chọn phút dùng
  `HH:mm` theo độ chính xác của field. Múi giờ UTC/server phải rõ; không đổi timezone
  chỉ vì đổi cách hiển thị.
- **Form:** label trên ô, cách8px; mô tả/lỗi dưới ô;24px giữa field. Form rộng có
  hai cột; trên điện thoại một cột. Không đổi draft hoặc value API để đổi layout.
- **Dialog:**440/640/960px theo lượng nội dung; giữa viewport; header/body/footer.
  Huỷ phía trái nút chính tại footer phải; X trên phải. Chỉ phần giữa cuộn.
- **Drawer:** mặc định400px, bên phải; Settings phiên giữ680px vì có nhiều tab.
  Drawer không nên mở dialog lồng chỉ để đọc một chi tiết.
- **KPI:**4→2→1 theo chiều rộng; gap24px. Trang có chart lớn có thể2+2 hoặc3+2,
  miễn cùng đường căn và ý nghĩa dữ liệu.
- **Menu/tooltip:** bám nút mở, tránh mép màn hình, Escape đóng và trả focus.
  Tooltip không giữ thông tin duy nhất để hoàn thành tác vụ.

Tooltip của app dùng `ProjectTooltipLayer` một lần tại root và `data-tooltip`
trên control, thay cho `title` mặc định. Dùng màu `project-raised/text/border`,
chữ13/20px và bo field. Nội dung ngắn rộng theo chữ, tối đa320px, padding8/10px.
Nội dung trên160 ký tự hoặc có nhiều đoạn dùng khổ dọc240px, padding12/14px;
tác giả ngắt đoạn bằng hai ký tự xuống dòng, không ép mỗi câu thành một dòng.
Các đoạn cách8px; phần đọc dài tối đa440px và cuộn bên trong khi cần.

Tooltip cách control8px và mép viewport ít nhất8px. Ưu tiên phía trên, rồi dưới;
nếu hai phía thiếu chỗ thì thử phải/trái. Không cạnh nào chứa đủ thì dùng vùng
trống lớn nhất, giới hạn kích thước và cho cuộn nội dung. Không che control mở.
Tọa độ ngoài được làm tròn theo CSS pixel. Mũi tên đổi đúng cạnh, hướng về control
và cách góc bo ít nhất16px (hoặc nửa chiều tooltip rất ngắn).
Chỉ fade theo motion hover; reduced-motion tắt fade. Cuộn trong tooltip không đóng
nó; cuộn trang đóng để tránh gợi ý treo sai vị trí.
Hover chờ 180ms, focus bàn phím hiện ngay; có 120ms để đi từ control vào tooltip.
Escape, cuộn trang, đổi kích thước hoặc mất anchor đóng gợi ý; tooltip không nhận focus.
Giữ `aria-label` cho tên nút; lớp chung thêm/xóa `aria-describedby` khi hiện/đóng.
`data-tooltip-touch` cho nút trợ giúp cần mở bằng chạm. Không đặt action/link trong
tooltip; dùng popover cho nội dung tương tác. Mẫu thật ở `?ui_reference=1`, mục
Tooltip và dialog. Header cùng order marker do app vẽ trong iframe chart dùng
cùng controller, gắn theo ownerDocument và viewport của iframe. Tooltip dữ liệu
và control do TradingView tự vẽ giữ lifecycle riêng của renderer.
  Menu chọn checkbox có một lề hàng10px và gap8px; “Chọn tất cả” và lựa chọn
  dùng cùng bố cục36px desktop/44px touch. Nhãn cùng điểm bắt đầu; mô tả nằm dưới
  nhãn, không bị space-between đẩy ra mép phải. Số đã chọn chỉ đếm mục có thể chọn;
  chọn tất cả không sửa mục đang bị khóa. Viền bàn phím nằm trong dòng để không
  bị vùng cuộn cắt. Animation dùng translate riêng, không ghi đè transform căn mép.
  Menu phiên giữ chiều rộng300px theo không gian cho phép, không co theo nút mở;
  khi thiếu chiều cao chỉ danh sách cuộn và có thể mở phía trên.
- **Thông báo:** cạnh nội dung nó nói tới, phân biệt chưa có dữ liệu, filter trống,
  lỗi, stale và partial. Toast không thay lỗi cần sửa tại field.
- **Căn thị giác:** trong cùng danh sách có checkbox/radio/switch, dùng vùng dấu
  chọn28px để các tâm nằm trên một trục; chữ bắt đầu cùng vị trí sau gap8px,
  line-height20px. Dấu checkbox/radio vẫn16px, switch28px; không kéo giãn dấu nhỏ.
  Căn số với đơn vị theo chân chữ; icon với dòng chữ theo tâm. Không thêm offset
  từng control khi có thể sửa bằng một grid chung.

## Trạng thái dữ liệu và phạm vi hiển thị

Có **6 trạng thái nền**: loading, ready, empty, unavailable, error, denied.
Độ mới/đầy đủ là thông tin bổ sung: current, stale, partial, unknown. Vì thế
“có dữ liệu nhưng đang cũ” khác “không có dữ liệu”. Refreshing là đang đọc lại;
filtered-empty là query hợp lệ không khớp bộ lọc, không phải nguồn hoàn toàn trống.

| Tình huống | Cách hiển thị |
| --- | --- |
| Đọc lần đầu | Skeleton của cụm đang đọc; không hiện số0 trước khi có kết quả |
| Nguồn chung trống | Một empty state cho toàn cụm phụ thuộc; gợi ý bước đầu tiên |
| Có dữ liệu, filter không khớp | Giữ filter và cho xoá/sửa; không mời tạo dữ liệu mới |
| Đọc lại cùng phạm vi | Giữ kết quả cũ, chỉ báo đang cập nhật ở tiêu đề cụm |
| Đổi tài sản/phiên/phạm vi | Không giữ số cũ của phạm vi trước như thể của phạm vi mới |
| Nguồn chung lỗi hoặc thiếu quyền | Một lỗi ở cụm cha; con không lặp lỗi/empty |
| Một nguồn độc lập lỗi | Lỗi và retry tại cụm đó; giữ phần còn dùng được |
| Dữ liệu một phần/cũ | Giữ dữ liệu có thật; ghi phần thiếu, cutoff/thời điểm nếu có |
| Chỉ số chưa tính được | Hiện —; số0 chỉ dùng khi đã biết thật sự bằng0 |

**Quy tắc:** trạng thái do cụm nhỏ nhất sở hữu toàn bộ dữ liệu bị ảnh hưởng quản lý.
Không gom cả trang chỉ vì chúng nằm cạnh nhau, cũng không lặp thông báo ở mỗi card.
Skeleton có thể gồm nhiều ô để giữ layout, nhưng chỉ một thông báo đang tải cho cụm.

Ví dụ Tổng quan: nguồn backtest chưa có phiên thì các KPI/chart phụ thuộc backtest
cùng dùng một empty state. Có phiên nhưng chưa đóng giao dịch thì tên/tài sản/thời
gian luyện tập vẫn có thể dùng được; cụm kết quả giao dịch hiện một empty state,
không hiện win rate0%. Không suy rằng Prop Firm trống chỉ vì backtest chưa có phiên.
Nếu KPI và chart cùng response/API thì chung loading/error; chart lỗi riêng chỉ hợp
lý khi nó thật sự có nguồn hoặc bước tính độc lập.

Trang mẫu có lựa chọn **Luồng Tổng quan minh hoạ** để thử các tình huống. Đây là
minh hoạ; DashboardPerformance thật đã áp dụng cùng nguyên tắc qua nguồn overview:
loading có một skeleton; error/denied/unavailable/blocked/no-session có một thông
báo và không dựng KPI/chart phụ thuộc. Có phiên nhưng không có giao dịch đóng vẫn
giữ thời gian đo được, số giao dịch0, win rate— và một thông báo cho cụm chart.
Khoảng ngày không có giao dịch có lời nhắc đổi bộ lọc; partial có số phiên đọc được
hiển thị rõ. Refresh cùng phạm vi giữ dữ liệu, lỗi refresh báo stale; đổi phạm vi
ẩn số cũ ngay.401/403 khi đọc lại xóa dữ liệu cache, không giữ như stale.
DashboardSessions và PropAnalytics tiếp tục đọc nguồn riêng; không suy trạng thái
của chúng từ overview. Catalog và Prop đã giữ kết quả đã xác minh (kể cả empty)
qua refresh/retry, hiện stale khi đọc lại lỗi;401/403 xóa cache. Catalog chưa xác minh
thì khóa sửa/xóa/nhân bản và submit dialog. Prop trả cấu trúc sai được xử lý tại
nguồn, không làm sập phần Dashboard khác. Các nguồn chi tiết/metadata có retry
riêng; không coi lỗi metadata là danh sách phiên trống.

## KPI, card và biểu đồ báo cáo

Áp dụng cho Dashboard/Analytics/Prop/report, **không phải chart giao dịch**.

| Thành phần | Quy chuẩn |
| --- | --- |
| KPI | Label13px, giá trị28px/đậm600/dòng1,2; ghi chú12px; icon18px nếu giúp hiểu |
| Số và đơn vị | Cùng đường chân chữ; chữ số cố định độ rộng; nêu gross/net, tiền tệ, phạm vi |
| KPI card | Padding24px desktop/16px mobile; bo12px; viền1px; cùng chiều cao trong cùng hàng |
| KPI strip | Không card con; gap24px hoặc divider có lý do; giữ cùng đường căn giá trị |
| Card thường | Header16px/đậm600; nội dung14px; ghi chú12px; padding24/16px; gap16/24px |
| Card tĩnh | Không hover, không cursor bàn tay; không shadow mặc định |
| Card hành động | Có nút/link thật, focus và tên truy cập; vùng bấm rõ; không nested link/button |
| Card chọn được | Dấu chọn có ý nghĩa và aria-state; nền nhẹ; không thêm vạch dọc đầu trái |
| Chart báo cáo | Header16px; trục/legend12px; đường2px, grid1px; nền chung; không hiệu ứng phát sáng |
| Màu chuỗi | Xanh biển chính; cam so sánh; tím/vàng khi cần; xanh/đỏ chỉ theo nghĩa lãi/lỗ |
| Nhãn ngưỡng trên chart | Bốn góc vuông (radius0), cao20px; chữ11px/đậm600 màu đen; rộng theo chữ thực tế + đệm6px mỗi bên. Nền và viền1px cùng màu xanh/đỏ đặc; theme sáng dùng sắc đủ sáng để chữ đạt contrast4,5:1. Đáy nối sát đường ngưỡng; nếu phải dời nhãn để tránh chồng, có đường nối về đúng mức. Không áp radius0 này cho card hoặc nhãn khác. |
| Tooltip chart | Ngày dd/mm/yyyy, giờ khi độ chính xác cần; giá trị/đơn vị rõ, cùng rounding với KPI |
| Trục | Nêu đơn vị; bar số lượng bắt đầu0; line có miền trục rõ; không che/đánh lừa độ biến động |
| Nhiều chuỗi | Giữ màu/label ổn định giữa trang; legend/text ngoài màu; thiếu dữ liệu là gap, không0 |
| Responsive | KPI4→2→1 hoặc grid phù hợp số lượng; chart có vùng riêng, trục không thu nhỏ dưới12px |
| Loading/empty/error | Theo cụm và nguồn dữ liệu đã quy định; không lặp3 empty message cho3 chart cùng nguồn |

Trang mẫu có card tĩnh, KPI và chart minh hoạ. Adapter đã gom giá trị KPI thật
Dashboard/Analytics về28px, title/axis của chart Dashboard về16/12px. Chưa migration
toàn bộ renderer báo cáo, không coi contract này là mọi chart đã đồng bộ.

## Kiểm kê tổng thể và phần còn cần áp dụng

| Nhóm | Tình trạng |
| --- | --- |
| Màu/chữ/spacing/motion/control cơ bản | Có token và adapter; đã test các trang đại diện |
| Checkbox/radio/switch | Checkbox thật và mark menu dùng một hình/timing; switch bật xanh; radio giữ hình tròn riêng |
| Focus/hover/disabled/selected | Một dấu focus cho field, nút có ring; selected nền trung tính, không vạch trái |
| Form validation | Có quy tắc label/required/help/error; cần audit flow submit, pending, success và server conflict từng form |
| KPI/card/report chart | Có chuẩn và mẫu; migration typography một phần; cần audit chart/tooltip/legend từng renderer |
| Trạng thái page/cụm | Có contract/mẫu; Dashboard áp theo nguồn Performance/catalog/Prop/detail/metadata; các trang khác vẫn cần audit riêng |
| Search/filter/sort/pagination | Có control và pattern; cần kiểm tra thống nhất debounce, reset/default và URL qua từng trang |
| Table/grid | Có chuẩn alignment/sticky/empty; cần kiểm kê selection, resize, virtualisation khi workflow cần |
| Dialog/drawer/menu/tooltip | Có anatomy và motion; một số composite/vùng chạm có ngoại lệ đã ghi |
| Toast/banner/inline error | Có contract vị trí/role; cần audit nơi dùng toast thay lỗi có thể sửa tại field |
| Upload/export/download | Có pattern tiến độ và unknown; cần contract huỷ/lỗi/retry riêng theo capability thật |
| Slider/accordion/badge/chip | Có design contract; reuse implementation khi có workflow; chưa claim đều có component reusable |
| Accessibility/zoom/performance | Focus/reflow/reduced motion đã kiểm tra có phạm vi; axe/native zoom/frame pacing vẫn là gate riêng |

“Có bộ chuẩn” khác “mọi trang đã dùng hết”. Ưu tiên lần lượt: control/focus →
state ownership → KPI/card/chart → edge cases/khả năng truy cập; mỗi migration
cần state fixtures và kiểm chứng thật, không dùng một CSS override để che logic lỗi.

## Cái đã sửa và ngoại lệ còn giữ

| Phát hiện | Xử lý |
| --- | --- |
| Dashboard ép cả control con44px và hover background chung | Bỏ luật hover tràn phạm vi, hạ specificity luật form |
| Nút/field ở Research, Risk, Settings, Prop, Learn cao khác nhau | Áp vai trò36/32/44 chung; rich content không ép cùng chiều cao |
| Hover gần/trùng hover dòng | Hai màu độc lập, tăng độ sáng cho control; bỏ xanh đục theo phản hồi owner |
| Thời gian đổi màu rải140/160/180ms | Dùng token120ms và cùng đường giảm tốc |
| Field của dialog tạo/chỉnh phiên focus trắng/xám | Dùng role xanh; composite asset field cũng có focus xanh |
| Chuẩn chỉ áp Testing/Live | Mở foundations cho toàn shell; từng flow vẫn giữ semantics |
| Lề, font meta và action weight rải trong component | Token và alias chung; header/KPI/controls có vai trò riêng |
| Dialog CSV bo18px khác dialog khác | Dùng12px |

Ngoại lệ có lý do: chart TradingView/vendor giữ geometry và màu nến; toolbar ứng
dụng cạnh chart có một số control30–38px để hợp anatomy chart. Rich session select
hiện nhiều dòng; calendar là ô ngày lớn; chip remove và nút lịch là control con
trong một composite field. Cần kiểm tra cả vùng bấm khi dùng cảm ứng. Những phần
vendor nội bộ không được mô tả là đã refactor source.

## Portal, dialog, popover và ô ngày

Đây là adapter của WMREPLAY, không đổi snapshot `annam-compact@0.1.1`.
Mẫu chạy tại `?area=testing&ui_reference=1`, mục **Lớp nổi**.

| Thành phần | Owner và hành vi |
| --- | --- |
| Dialog React dùng portal | `LegacyModal` sở hữu stack, backdrop, khóa scroll nền, inert nền và focus. Chỉ dialog trên cùng nhận Escape/Tab; đóng dialog con trả focus về control trong dialog cha. Lớp cuối đóng mới khôi phục nền. |
| Dialog lệnh | Dùng `LegacyModal`; form, validation, cutoff chỉ đọc và engine vẫn do order model/panel sở hữu. Không tạo focus trap thứ hai trong consumer. |
| Dialog native | Giữ `showModal()` và top layer của trình duyệt; không thay bằng portal chỉ để đồng nhất source. |
| Popover | `LegacyPopover` bám anchor khi scroll/resize, đảo lên trên khi cần, chừa mép viewport8px và cuộn nội dung dài. Trong dialog, portal nằm trong dialog đó để không rơi ra ngoài vùng inert/top layer. |
| Select | `FxSelect`; ô form dùng `is-field`. Mũi tên/Home/End chọn mục khả dụng, Escape đóng select trước dialog, Tab ra khỏi select theo thứ tự form. Disabled không mở menu và đóng menu đang mở. |
| Multi-select có ràng buộc domain | Dùng `showSelectAll={false}` nếu chọn hàng loạt không được domain hỗ trợ. Dataset picker vẫn kiểm tra từng tài sản; không dùng “Chọn tất cả” để đi vòng giới hạn. |
| Ngày/giờ | `ProjectDateInput` giữ ISO ở form boundary, hiển thị dd/mm/yyyy. So sánh min/max bằng ISO trước khi format; giờ hiển thị trong lịch phải khớp giá trị đã phát ra sau clamp. Mũi tên/Home/End di chuyển trong grid hiện tại, không tự chuyển tháng. |
| Resource status | Popup giải thích trạng thái có mép16px, giới hạn chiều cao, đóng khi click/focus ra ngoài. Escape chỉ consume khi popup đang mở. Không thay dữ liệu cũ bằng empty khi refresh. |

Escape thuộc lớp nhỏ nhất đang thao tác: lịch → menu → dialog. Handler cha
phải tôn trọng `defaultPrevented`; không bắt phím mũi tên của grid/input con.
Click ngoài chuyển focus tới đích người dùng vừa chọn; chỉ Escape/đóng dialog
mới chủ động trả focus về control mở. Opener đã bị gỡ hoặc nằm trong vùng inert
không được nhận focus.

Portal ngoài `.fx-app` phải mang `.wm-ui-portal` và `data-theme` để nhận alias
màu, control, focus và reduced motion. CSS nền của modal/popover được import
bởi chính component; không phụ thuộc việc chart đã tải CSS trước hay chưa.
Không chồng outline/shadow lên border focus của field; nút X hover chỉ đổi màu
icon. Trên touch/mobile, nút lịch và xoá ngày có vùng bấm riêng44×44px, input
chừa chỗ cho cả hai; calendar day và menu row cao ít nhất44px.

Layer riêng của project: `--wm-layer-chart-popup:10000`,
`--wm-layer-modal:11000` (tăng theo stack), `--wm-layer-notification:12000`.
Native dialog/calendar dùng top layer; tăng z-index không thay thế được quy tắc
top layer. Không tăng số riêng ở từng consumer để chữa lỗi chồng lớp.

LegacyModal nhỏ dùng440px, order640px; viewport luôn có khoảng hở. Header
sticky, modal cũ cuộn cả panel; dialog tạo phiên có vùng body/footer riêng vẫn
giữ anatomy đó. Không coi mọi dialog đã chuyển sang body-only scroll. Motion
dùng token menu160ms/dialog220ms, reduced motion tắt cả portal bên ngoài shell.

Kiểm chứng và giới hạn của lượt rà soát:
[UI-system audit 20/10/2026](../foundation_v2/evidence/ui-system-audit-20261020/CHECKPOINT.md).

## Dùng cho tính năng sau này

Đã có contract cho button, text action, icon action, field, select, checkbox/radio,
switch, slider, chip, badge, tabs, tooltip, toast, progress, accordion, pagination,
drag/drop, modal/drawer, loading/empty/error. Đây là **chuẩn thiết kế**, không tạo
một đống component giả trước khi cần. Lấy control đã có, dùng đúng role; chỉ tạo
component/ngoại lệ mới khi workflow thật yêu cầu.

Nguồn chung: [Compact contract](../../../UI-Systems/core/tokens/compact/0.1.1/CONTRACT.md),
token JSON có version, CSS được xuất tự động. Quy tắc gắn dữ liệu trading nằm ở
project/domain; không đổi dữ liệu, model, quyền broker hay logic tải vì refactor UI.
Kết quả kiểm chứng: [follow-up receipt](../foundation_v2/evidence/compact-states-20261009/RECEIPT.md),
[baseline receipt](../foundation_v2/evidence/compact-system-20261009/RECEIPT.md),
[Dashboard states/alignment receipt](../foundation_v2/evidence/dashboard-states-20261009/RECEIPT.md).

Rà soát tiếp theo: [menu/source audit và giới hạn](../foundation_v2/evidence/menu-audit-20261009/RECEIPT.md),
[review độc lập](../foundation_v2/evidence/menu-audit-20261009/INDEPENDENT-REVIEW.md).

Rà tiếp toàn bộ nhóm component: [alignment receipt và coverage](../foundation_v2/evidence/component-alignment-20261009/RECEIPT.md).
Checkbox/mark dùng margin0 và khoảng cách8px tới chữ; label nhiều dòng căn mark
theo dòng đầu. Trong bảng, checkbox/nút thao tác căn giữa, chữ căn trái và số căn
phải; tiêu đề dùng cùng mép với dữ liệu. Cột có thể bật/tắt gắn vai trò theo key,
không theo vị trí. Search và dropdown cùng toolbar dùng cùng chiều cao theo role;
các hàng stack trên mobile không bị ép chung một trục tâm.

Tiêu đề bảng có sắp xếp dùng `wm-table-sort`: toàn ô nhận hover/bấm, chữ kế thừa
màu tiêu đề, focus nằm trong ô và giữ `aria-sort` trên `th`. Mặc định cao44px;
bảng tài khoản dùng60px để cùng tâm với thanh quay lại/hướng dẫn kết nối.
Hai bảng hiện có (tài khoản và trade ledger) dùng chung recipe trong
`compact-system.css`, không dùng text-action cho nút sắp xếp.
