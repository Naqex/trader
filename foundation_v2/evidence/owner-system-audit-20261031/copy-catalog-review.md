# Khóa dịch bị ghi đè — 01/11/2026

Esbuild của fixture notification báo24 duplicate object keys trong catalog
VI/EN. JSON.parse lấy giá trị cuối nên test locale cũ2/2 vẫn pass.

Đã thêm regression đọc raw catalog trước parse, phát hiện key trùng theo layout
top-level mỗi key trên dòng riêng. Test mới fail với đúng24 keys trước sửa.
Đã gỡ24 entries bị ghi đè (66 dòng), giữ bản cuối đang có hiệu lực.
Script so sánh hai object parsed trước/sau bằng equality: không đổi nội dung
dịch hoặc placeholder. Giữ CRLF, không format lại toàn bộ registry.

`node --test tests/testingCopy.test.mjs`:3/3 PASS sau sửa. Vite production build
PASS, không còn duplicate-key warning; cảnh báo chunk lớn vẫn tồn tại. Không
đổi lookup/t()/say runtime hoặc thêm hệ thống dịch mới. Test raw-key có giả
định layout catalog; không chứng minh mọi câu dịch/literal JSX đúng ngữ cảnh.
