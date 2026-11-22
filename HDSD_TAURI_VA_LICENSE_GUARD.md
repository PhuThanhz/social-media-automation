# 🛡️ HƯỚNG DẪN VẬN HÀNH TAURI DESKTOP & HỆ THỐNG QUẢN LÝ BẢN QUYỀN (REMOTE KILL-SWITCH)

Tài liệu này hướng dẫn chi tiết cách bạn (chủ phần mềm) vận hành, tạo mã License Key phân phối cho khách hàng, và sử dụng cơ chế **Khóa Từ Xa (Remote Kill-Switch)** tức thì khi cần thu hồi quyền truy cập.

---

## Cách hoạt động

1. Khách nhập key → app (Rust) gửi `key + HWID` lên License Server.
2. Server gắn key với máy, trả về **token ký Ed25519** (chứa key, HWID, hạn license, hạn offline).
3. Rust kiểm tra chữ ký bằng public key nhúng lúc build, lưu token trong thư mục dữ liệu app (không phải localStorage). Sửa token → chữ ký sai → bị từ chối.
4. Cứ 3 phút Rust ping server lấy token mới. Admin khóa key → app báo và tự đóng.
5. Mất mạng: app chạy tiếp tới hết hạn offline (`TOKEN_TTL_HOURS`, mặc định 72h), sau đó bắt buộc online lại. Chặn domain server không còn là cách dùng chùa.
6. HWID = SHA-256 của UUID máy do hệ điều hành cấp (macOS IOPlatformUUID, Windows MachineGuid, Linux machine-id). Cài lại Windows sẽ đổi HWID → dùng nút Reset HWID.

### Backend + Worker đi kèm app

Khách **không cần cài Java, Node hay MySQL**. Bản cài chứa sẵn:

| Thành phần | Nằm ở | Ghi chú |
|---|---|---|
| Backend Spring Boot | `sidecar/backend.jar` + JRE rút gọn `sidecar/jre/` | profile `desktop`, DB **H2** (file) |
| Worker Playwright | `sidecar/worker/` + Node `sidecar/node/` | Chromium tự tải lần đầu (~250MB) |

Trình tự khi mở app: kiểm tra bản quyền → **chỉ khi hợp lệ** mới khởi động backend (cổng 47081) + worker (47001) → mở giao diện.
- Cả hai chỉ nghe trên `127.0.0.1` và đòi **token phiên ngẫu nhiên** (đổi mỗi lần mở app). curl/website lạ gọi vào đều bị 401. File tĩnh `/uploads/`, `/downloads/` và health check được miễn để ảnh/video hiển thị.
- Tắt app, bị khóa key, hoặc app bị force quit → backend/worker tự thoát trong ~5 giây.
- Dữ liệu khách nằm trong thư mục dữ liệu app (macOS: `~/Library/Application Support/com.phusocial.autopost/`): `db/` (H2), `backend/uploads/`, `worker/` (bản copy worker + trạng thái), `ms-playwright/`, `logs/` (backend.log, worker.log để hỗ trợ khách).
- Các thay đổi trong backend/worker chỉ bật khi có biến môi trường của bản Desktop; chạy dev/server như cũ không bị ảnh hưởng.

---

## 🚀 1. Trang Quản Trị Bản Quyền (License Server Online 24/7)

Hệ thống quản lý bản quyền và khóa từ xa đã được triển khai **chính thức trên Render.com** (miễn phí, hoạt động 24/24):

* **Đường dẫn Admin Dashboard:** **[https://social-media-automation-750a.onrender.com/admin](https://social-media-automation-750a.onrender.com/admin)**
* **Đăng nhập bằng Admin Secret:**
  ```text
  (xem biến ADMIN_SECRET trên Render — không ghi vào repo)
  ```
* **Public Key Ed25519 nhúng trong app:**
  ```text
  011W-RpKxTyzSe0BDHcMR7y64ag30hpdwwruRHYBf8o
  ```

*(Nếu muốn chạy test local trên máy tính: `cd license-server && npm start` ➔ mở `http://localhost:5050/admin`)*

---

## 💻 2. Cách Đóng Gói (Build) Bộ Cài Đặt (.exe cho Windows và .dmg cho Mac)

### 👉 CÁCH 1: Tự động 100% qua GitHub Actions (Khuyên dùng nhất - Không cần mượn máy Windows)

Hệ thống đã cấu hình sẵn GitHub Workflow (`.github/workflows/build-tauri.yml`) tự động cài đặt JDK 21, build backend sidecar, và đóng gói cho cả 2 hệ điều hành:

1. Truy cập: **[https://github.com/PhuThanhz/social-media-automation/actions](https://github.com/PhuThanhz/social-media-automation/actions)**
2. Nhìn cột bên trái, bấm vào: **Build Desktop App (.exe & .dmg)**
3. Bấm nút **Run workflow** (màu xanh bên phải).
4. Đợi GitHub chạy xong: Tải 2 file cài đặt tại mục **Releases** trên GitHub:
   * **Bản Windows:** File `ToolZutter-Setup.exe` (hoặc `.msi`)
   * **Bản macOS:** File `ToolZutter.dmg`

---

### 👉 CÁCH 2: Đóng gói thủ công trên máy cục bộ

#### Trên macOS (build file .dmg):
```bash
cd frontend
npm run sidecar:prepare
LICENSE_SERVER_URL=https://social-media-automation-750a.onrender.com npx tauri build
```
*Kết quả xuất ra:* `frontend/src-tauri/target/release/bundle/dmg/ToolZutter.dmg`

#### Trên Windows (build file .exe):
Cần kéo code sang máy Windows có JDK 21 và Node 22, sau đó chạy:
```bash
cd frontend
npm run sidecar:prepare
set LICENSE_SERVER_URL=https://social-media-automation-750a.onrender.com
npx tauri build
```
*Kết quả xuất ra:* `frontend\src-tauri\target\release\bundle\msi\` hoặc `bundle\nsis\ToolZutter-Setup.exe`

Lưu ý: macOS cần ký + notarize bằng Apple Developer ID, nếu không khách sẽ bị Gatekeeper chặn mở app; Windows nên có chứng chỉ ký code để tránh cảnh báo SmartScreen.
