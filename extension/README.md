# 🚀 Hướng Dẫn Cài Đặt & Sử Dụng ToolZutter Chrome Extension

Extension giúp bạn **cào link bài viết, Reels, Video Facebook & Threads 1-chạm** và **đồng bộ Cookie FB** trực tiếp vào hệ thống ToolZutter SAAS mà không gặp lỗi bị chặn hay link rút gọn.

---

## 📦 Cách Cài Đặt Vào Trình Duyệt Chrome (Chỉ mất 15 giây)

1. Mở trình duyệt Chrome (nơi bạn đang đăng nhập tài khoản Facebook/Threads của bạn).
2. Nhập vào thanh địa chỉ: `chrome://extensions/` và nhấn **Enter**.
3. Bật công tắc **"Chế độ dành cho nhà phát triển" (Developer mode)** ở góc trên cùng bên phải.
4. Nhấn nút **"Tải tiện ích đã giải nén" (Load unpacked)** ở góc trên bên trái.
5. Chọn thư mục:
   ```
   /Users/huynhthanhphu/Documents/TOOLZUTTER/auto-post-saas/extension
   ```
6. Nhấn vào biểu tượng mảnh ghép (Extensions) trên thanh công cụ Chrome và **Ghim (Pin)** icon **ToolZutter** để sử dụng tiện lợi.

---

## ⚡ Các Tính Năng & Cách Dùng

### 1. Nút nổi "⚡ Lưu bài này" trực tiếp trên Facebook
- Khi bạn lướt Facebook Feed, xem Group hoặc Fanpage, trên mỗi bài viết sẽ tự động xuất hiện nút **"⚡ Lưu bài này"** ở góc phải trên.
- Chỉ cần bấm nút đó -> Bài viết sẽ được tự động gửi ngay vào Hàng Đợi ToolZutter!

### 2. Bắt link bài viết / Reel đang xem
- Khi đang mở xem 1 Reel hoặc 1 bài post trên Facebook hoặc Threads, bấm vào biểu tượng Extension ToolZutter.
- Extension sẽ tự động lấy link sạch (đã chuẩn hoá, loại bỏ mã tracking thừa) và tiêu đề bài.
- Bấm **"🚀 Đẩy Vào Hàng Đợi Tool"** hoặc **"📋 Copy Link Sạch"**.

### 3. Quét Hàng Loạt (Batch Scrape)
- Khi đang ở trên trang Fanpage, Group Feed, hoặc Profile cá nhân:
  - Mở Extension -> Chuyển sang tab **"🔍 Quét Hàng Loạt"**.
  - Bấm **"⚡ Quét Bài Đang Thấy"** (quét nhanh bài đang có trên màn hình) hoặc **"📜 Tự Động Cuộn & Quét Sâu"** (bot tự cuộn trang để gom 20+ bài viết).
  - Chọn các bài bạn muốn rồi bấm **"🚀 Đẩy Tất Cả Bài Đã Chọn Vào Hàng Đợi"**.

### 4. Lấy & Đồng Bộ Cookie Facebook 1-Chạm (Dùng cho mọi Profile Chrome)
- Chuyển sang tab **"🔑 Cookie FB"**.
- Extension tự động đọc Cookie tài khoản FB đang đăng nhập trong Chrome Profile đó.
- Bấm **"⚡ Đồng Bộ Nick Này Sang ToolZutter (1-Chạm)"**: Nick Facebook sẽ tự động được gửi và lưu vào ToolZutter ngay lập tức!
- Hoặc bấm **"📋 Copy Chuỗi Cookie"** nếu muốn dán thủ công.

### 5. Tự Đồng Bộ Cookie Threads (bản 1.2.0)
- Giữ 1 tab **threads.com** đăng nhập trên Chrome.
- Bấm icon ToolZutter → tab **"🧵 Threads"** → **"Đồng Bộ Ngay"** lần đầu. Nick sẽ tự xuất hiện ở trang **Đăng Threads** của ToolZutter.
- Sau đó extension tự gửi cookie mới mỗi khi Threads đổi cookie và định kỳ 30 phút — nick trong hệ thống không bị hết hạn. Có thể tắt ô "Tự động đồng bộ" trong tab này.
- Lưu ý: bấm **Đăng xuất** trên Chrome sẽ làm phiên trong hệ thống hết hạn theo.

### 6. Mở bài lần lượt bằng từng Page
- Đảm bảo Chrome đang đăng nhập đúng tài khoản Facebook quản lý các Page.
- Trong ToolZutter, vào **Tăng tương tác → Tương tác từng Page**.
- Quét và chọn Page, dán link bài viết rồi bấm **Tạo checklist**.
- Bấm **Mở Page tiếp theo**. Extension sẽ chuyển danh tính Page và mở đúng bài trong tab mới.
- Bạn tự bấm Like/Cảm xúc trên Facebook, sau đó quay lại ToolZutter chọn **Tôi đã tương tác** để tiếp tục Page kế tiếp.
- Extension không tự bấm Like/Cảm xúc. Nếu vừa cập nhật mã nguồn, hãy mở `chrome://extensions/` và bấm **Tải lại** tiện ích trước khi dùng.

---

## ⚙️ Cấu Hình Mặc Định
- **Backend URL**: `http://localhost:8081`
- **Worker URL**: `http://localhost:3001`
*(Có thể đổi trong tab ⚙️ Cài Đặt của Extension)*
