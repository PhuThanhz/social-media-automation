# 🚀 HƯỚNG DẪN KHỞI CHẠY DỰ ÁN NHANH (QUICK START GUIDE)

Chào bạn! Đây là bản hướng dẫn từng bước để kéo code về và khởi chạy toàn bộ hệ thống Social Media Automation SaaS trong 3 - 5 phút.

---

## 🛠️ 1. Yêu Cầu Môi Trường (Prerequisites)
Đảm bảo máy tính đã cài đặt:
- **Node.js**: Phiên bản 18 trở lên (Khuyên dùng Node 20 LTS).
- **Java JDK**: Phiên bản 17 hoặc 21.
- **Maven**: (Nếu chạy dòng lệnh, hoặc dùng Maven tích hợp sẵn trong IntelliJ IDEA / VS Code / Eclipse).
- **MySQL**: Phiên bản 8.0+ đang chạy ở cổng `3306`.
  - Database name: `autopost_saas`
  - User mặc định: `root`
  - Mật khẩu mặc định: `26082003` *(Nếu máy bạn dùng mật khẩu khác, mở file `backend/src/main/resources/application-dev.yml` để sửa lại `password`)*.

---

## ⚡ CÁCH 1: KHỞI CHẠY TỰ ĐỘNG 1-CLICK (KHUYÊN DÙNG)

Để tiện lợi nhất mà không cần mở nhiều cửa sổ Terminal:
- **Trên macOS / Linux**: Mở Terminal tại thư mục gốc và chạy:
  ```bash
  ./start.sh
  ```
- **Trên Windows**: Nhấp đúp chuột vào file `start.bat` (hoặc mở CMD gõ `start.bat`).

Script sẽ tự động kiểm tra Node/Java, cài đặt thư viện thiếu, tải trình duyệt Chromium cho Playwright và bật sẵn sàng cả 3 dịch vụ!

---

## 🏃 CÁCH 2: CÁC BƯỚC KHỞI CHẠY THỦ CÔNG TỪNG DỊCH VỤ

Hệ thống gồm 3 thành phần chính chạy độc lập: **Backend (Spring Boot)**, **Worker (Playwright Engine)** và **Frontend (React Vite)**.

### 🔹 Bước 2.1: Chạy Backend (Spring Boot - Port 8081)
Mở cửa sổ Terminal 1:
```bash
cd backend
mvn spring-boot:run
```
*(Hoặc mở thư mục `backend` bằng IntelliJ IDEA / Eclipse rồi bấm nút **Run** file `BackendApplication.java`)*.

> ℹ️ **Lưu ý**: Lần đầu chạy, hệ thống sẽ tự động tạo bảng trong MySQL và nạp sẵn tài khoản Admin:
> - **Email**: `admin@gmail.com`
> - **Mật khẩu**: `123456`

---

### 🔹 Bước 2.2: Chạy Worker Automation (Node.js Playwright - Port 3001)
Mở cửa sổ Terminal 2:
```bash
cd worker
npm install
npx playwright install chromium
node server.js
```
> ⚠️ **RẤT QUAN TRỌNG**: Lệnh `npx playwright install chromium` chỉ cần chạy 1 lần duy nhất lúc mới tải code để tải trình duyệt Chromium tương thích về máy.

---

### 🔹 Bước 2.3: Chạy Frontend (React + Vite - Port 5173)
Mở cửa sổ Terminal 3:
```bash
cd frontend
npm install
npm run dev
```

---

## 🌐 3. Đăng Nhập & Bắt Đầu Sử Dụng

1. Mở trình duyệt truy cập: **`http://localhost:5173`**
2. Đăng nhập với tài khoản:
   - **Email**: `admin@gmail.com`
   - **Mật khẩu**: `123456`

---

## 📋 4. Luồng Thiết Lập Nhanh Cho Người Mới (3 Bước Đơn Giản)

### 👉 Bước 1: Thêm Nick Facebook & Fanpage Quản Trị
1. Vào mục **KÊNH & TÀI NGUYÊN** ➔ **Quản lý kết nối** (`/connections`).
2. Bấm nút **"Thêm Via Facebook"**:
   - Có thể dán chuỗi Cookie Facebook vào ô duy nhất (hệ thống tự bóc tách `c_user` và `xs`).
   - Hoặc bấm nút **"Đăng nhập Facebook"** để mở cửa sổ Chrome tự động đăng nhập.
3. Sau khi lưu Via, bấm **"Kiểm kê quyền Page"**: Hệ thống sẽ tự động quét toàn bộ các Fanpage mà nick Via đó đang làm quản trị viên.

### 👉 Bước 2: Khai Báo Nhóm Facebook Cần Đăng
1. Vào mục **Quản lý nhóm** (`/groups`).
2. Bấm nút **"Khai Báo Nhiều Group Cùng Lúc"**.
3. Dán danh sách link hoặc ID các nhóm Facebook bạn muốn đăng bài (mỗi dòng 1 nhóm) ➔ Bấm **"Khai báo"**.

### 👉 Bước 3: Đăng Bài Tự Động & Lập Lịch
1. Vào mục **NỘI DUNG** ➔ **Đăng tự động** (`/playwright-poster`).
2. Chọn hình thức đăng:
   - **Chỉ đăng Fanpage**
   - **Chỉ đăng vào Nhóm Facebook**
   - **Đăng lên Fanpage và tự động chia sẻ vào Nhóm**
3. Chọn Fanpage/Nick đại diện và tích chọn các Nhóm nhận bài.
4. Dán link bài viết (Facebook, TikTok, Threads, Shorts...) hoặc tự gõ caption / tải ảnh lên.
5. Bấm **"Đăng ngay"** hoặc cài đặt **"Giãn cách hẹn giờ"** ➔ Playwright Worker sẽ tự động mở trình duyệt ngầm và xuất bản bài viết an toàn!

---

## 💡 Cấu Hình AI Google Gemini (Tùy Chọn)
Nếu muốn sử dụng các tính năng AI tự động tóm tắt tin tức, viết lại caption viral hoặc lồng tiếng video:
1. Nhấp vào mục **HỆ THỐNG** ➔ **Cấu hình AI (Gemini)** trên thanh Menu Sidebar.
2. Dán mã `GEMINI_API_KEY` của bạn (lấy miễn phí tại [Google AI Studio](https://aistudio.google.com/)).
3. Bấm **"Lưu cấu hình"**.
