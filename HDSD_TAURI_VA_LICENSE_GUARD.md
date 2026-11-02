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

## 🚀 1. Trang Quản Trị (License Server)

```bash
cd license-server
npm start
```
Mở **http://localhost:5050/admin**.

Cấu hình trong `license-server/.env` (không commit):
```env
ADMIN_SECRET=chuoi_ngau_nhien_it_nhat_12_ky_tu   # bắt buộc, thiếu là server không chạy
CORS_ORIGINS=http://localhost:5173                # origin được gọi Admin API từ trình duyệt
TOKEN_TTL_HOURS=72                                # thời gian dùng offline tối đa
TRUST_PROXY=1                                     # chỉ bật khi chạy sau nginx/Cloudflare
```

Lần chạy đầu server tự sinh `keys/private.pem` (khóa ký, **tuyệt đối giữ bí mật + sao lưu**; mất file này thì mọi bản app đã phát hành không xác thực được nữa) và `keys/public.b64` (public key nhúng vào app). Khi đưa lên VPS, copy cả thư mục `keys/` theo, hoặc đặt PEM vào biến `LICENSE_PRIVATE_KEY`.

### Đăng nhập & phân quyền
- Lần đầu: chọn "Đăng nhập bằng Admin Secret" (quyền Chủ) → tab **Tài khoản admin** → tạo tài khoản cho bạn và nhân viên. Từ đó đăng nhập bằng tên đăng nhập + mật khẩu.
- **Chủ:** toàn quyền, xóa key/khách, quản lý admin · **Nhân viên:** tạo / gia hạn / khóa key, đổi máy, quản lý khách · **Chỉ xem:** không sửa được gì.
- Nhật ký ghi rõ ai làm gì. Khóa hoặc đổi mật khẩu một admin → phiên đang mở của người đó bị đăng xuất ngay. Phiên đăng nhập hết hạn sau 12 giờ.

### Key bản quyền
- **+ Tạo Key Mới:** chọn khách có sẵn hoặc nhập khách mới, thời hạn, *số tài khoản tối đa* (Via + Fanpage + TikTok + Threads; Nhóm FB không tính), *số người dùng trong app*, số tiền đã thu. Key tự copy vào bộ nhớ tạm.
- **Gia hạn:** +1 tháng / +3 tháng / +1 năm / vĩnh viễn hoặc tự nhập ngày, kèm số tiền + ghi chú. Cộng từ hạn hiện tại (đã hết hạn thì tính từ hôm nay và tự mở lại). App khách đang mở nhận hạn mới trong 3 phút.
- **Gói:** nâng/hạ số tài khoản, số người dùng, chuyển key sang khách khác.
- **Khóa / Mở khóa** (kill-switch: app khách tự đóng trong ≤ 3 phút), **Đổi máy** (Reset HWID), **Xóa** (chỉ Chủ).
- Bảng hiện: online hay lần cuối, IP, mã máy, hệ điều hành + phiên bản app. Lọc nhanh: Đang online · Sắp hết hạn (7 ngày) · Bị khóa / Hết hạn.

### Khách hàng
- Hồ sơ: tên, SĐT, Zalo, email, ghi chú. Key cũ được tự gom theo tên khách ở lần chạy đầu.
- Bấm tên khách: danh sách key, **lịch sử thanh toán + tổng đã trả**, hoạt động gần đây, tạo thêm key cho khách.

### Trong app khách (bản Desktop)
- Lần đầu mở app: tạo **tài khoản Chủ** (không còn tài khoản mặc định `admin@gmail.com / 123456`). Sau đó mọi người phải đăng nhập.
- Chủ vào menu **Người dùng** để thêm / khóa / xóa / đặt lại mật khẩu trong giới hạn gói; xem gói đang dùng (x/y người dùng, x/y tài khoản). Mỗi người có dữ liệu riêng.
- Thêm tài khoản vượt gói → bị chặn, báo liên hệ nâng gói. Backend tự kiểm chữ ký token để áp giới hạn, không tin frontend.

---

## ☁️ 2. Triển khai License Server

Đưa `license-server/` lên một VPS (Node 22+), chạy sau nginx có HTTPS, ví dụ `https://license.tenmien.com`. Bản Cloudflare Worker hiện **chưa dùng được** (không ký token).

---

## 💻 3. Cách Đóng Gói (Build) Ứng Dụng Desktop Cho Khách Hàng

### Bước 1: Chuẩn bị backend + worker (sidecar)
```bash
cd frontend
JAVA_HOME=/đường/dẫn/jdk-21 npm run sidecar:prepare
```
Script build jar trong thư mục tạm (không đụng `backend/target` đang chạy), tạo JRE bằng jlink, chép mã nguồn worker (**không chép dữ liệu của bạn**: cookie, browser_profiles, file .json trạng thái) và `npm ci` mới, rồi chép Node. Node của Homebrew không mang đi được; script sẽ báo lỗi, khi đó tải Node từ nodejs.org và đặt `NODE_BINARY=<đường dẫn>`. Build lại nhanh chỉ backend: `SKIP_JRE=1 SKIP_WORKER=1 npm run sidecar:prepare`.

**Phải build trên đúng hệ điều hành của bản cài** (JRE, Node, ffmpeg là binary theo nền tảng): bản Windows build trên máy Windows.

### Bước 2: Build bộ cài
```bash
cd frontend
LICENSE_SERVER_URL=https://license.tenmien.com LICENSE_PUBLIC_KEY=$(cat ../license-server/keys/public.b64) npx tauri build
```
Build release sẽ **báo lỗi và dừng** nếu thiếu `LICENSE_SERVER_URL` hoặc URL không phải https. `LICENSE_PUBLIC_KEY` bỏ trống thì tự đọc `license-server/keys/public.b64`.

Trang "Quản lý bản quyền" tự ẩn trong bản Desktop; bạn quản lý key qua `/admin` của License Server hoặc bản web.
*(Hoặc dùng lệnh Rust: `cargo tauri build` bên trong thư mục `frontend/src-tauri`)*

### Kết quả xuất ra:
- **Trên máy macOS:** File `.dmg` hoặc `.app` trong thư mục `src-tauri/target/release/bundle/dmg/`
- **Trên máy Windows:** File `.msi` hoặc `.exe` cài đặt tự động trong thư mục `src-tauri/target/release/bundle/msi/`

Lưu ý: macOS cần ký + notarize bằng Apple Developer ID, nếu không khách sẽ bị Gatekeeper chặn mở app; Windows nên có chứng chỉ ký code để tránh cảnh báo SmartScreen.
