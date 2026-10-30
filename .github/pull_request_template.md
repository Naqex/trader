## Thay đổi và lý do

Link issue `Naqex/workspace#…` khi có. Dùng `Refs` nếu acceptance còn chờ;
chỉ dùng `Fixes` khi merge đủ điều kiện đóng issue.

## Kiểm chứng

Ghi lệnh đã chạy, kết quả và phạm vi chưa kiểm. Phân biệt fixture với runtime/broker thật.

## Tương thích và vận hành

Breaking change, migration, license hoặc rollout/rollback nếu có.

## Agent

Nếu có AI: role (triển khai/review), tool, requested model ID và nguồn danh tính.
Không biết model thì ghi `unknown`. Reported model chỉ ghi khi runtime xác nhận.
Reviewer ghi SHA đã xét; commit mới cần đánh giá lại phần bị ảnh hưởng.
