# ToolZutter Personal cho Windows

## Sử dụng

Mở bộ cài `ToolZutter-Personal-1.0.1-Setup.exe`, làm theo hướng dẫn rồi mở ToolZutter Personal từ Start Menu.
Nếu đang dùng bản cũ, đóng ứng dụng trước rồi cài đè vào cùng thư mục.
Không cần cài Docker, Java, Node.js hay MySQL. Lần đầu cần mạng để ứng dụng tự tải Chromium (khoảng 250 MB).
Tạo tên đăng nhập và mật khẩu chủ khi ứng dụng yêu cầu; bản này không yêu cầu mã kích hoạt.
Khóa API AI và kết nối các tài khoản mạng xã hội được thiết lập trong ứng dụng khi cần dùng.

Dữ liệu nằm trong thư mục dữ liệu ứng dụng `com.phusocial.autopost.personal` của tài khoản Windows.
Ứng dụng không tự cập nhật từ kênh phát hành bản thương mại; cài bản Personal mới để cập nhật.

## Build lại (dành cho người phát triển)

Cần Node.js 22, JDK 17+ với JAVA_HOME, Rust và Visual Studio C++ Build Tools.
Trong thư mục frontend, chạy:

```powershell
npm ci
npm run sidecar:prepare
npm run desktop:build:personal
```

Bộ cài nằm trong `frontend/src-tauri/target/release/bundle/nsis/`.
Feature Rust `personal` chọn mô-đun chạy riêng và truyền chế độ này tới backend.
Các lệnh build không có feature này vẫn yêu cầu cấu hình máy chủ bản quyền như trước.

## Sửa lỗi 1.0.1

Chuẩn hóa đường dẫn Windows do Tauri cung cấp trước khi truyền cho Java/Node.
Sửa lỗi Java báo `An unexpected error occurred while trying to open file \\?\...\backend.jar`.
Đã chạy thử JRE và JAR trong bản cài tại đường dẫn có dấu cách, khởi động backend với dữ liệu thử riêng
có ký tự tiếng Việt, xác nhận health UP và thiết lập tài khoản vẫn yêu cầu token phiên.

Chạy lại kiểm tra với bản đã cài (từ frontend/src-tauri):

```powershell
$env:TOOLZUTTER_SIDECAR_DIR='E:\ToolZutter Personal\sidecar'
cargo test --features personal --test runtime_paths_smoke -- --include-ignored --nocapture
```
