# TOOL AUTOMATION POST (SaaS Platform)

Hệ thống tự động hóa đăng bài, tạo thẻ tin tức (News Card Studio), săn tin viral từ Facebook/Reddit/TikTok và quản lý đa kênh mạng xã hội.

---

## 🚀 Kiến trúc hệ thống

- **Frontend**: React + TypeScript + Vite + Tailwind CSS + Lucide Icons (Giao diện người dùng, News Card Studio, Viral Hunter).
- **Backend**: Java 17 + Spring Boot 3 + Spring Data JPA + MySQL.
- **Worker**: Node.js + Puppeteer (Cào bài viết, tải video, chụp ảnh).
- **Extension**: Chrome Extension Manifest V3 (Bắt token, cookie, đồng bộ tài khoản Facebook).

---

## 🛠️ Cài đặt & Khởi động nhanh bằng Docker

### 1. Chuẩn bị biến môi trường
Tạo file `.env` từ file mẫu:
```bash
cp .env.example .env
```
Điền `GEMINI_API_KEY` của bạn vào file `.env`.

### 2. Khởi chạy toàn bộ hệ thống
```bash
docker-compose up -d --build
```

Hệ thống sẽ tự động khởi động:
- **Frontend Web**: [http://localhost](http://localhost) (Port 80)
- **Backend API**: [http://localhost:8080](http://localhost:8080)
- **Worker Scraper**: [http://localhost:3001](http://localhost:3001)
- **MySQL Database**: Port 3306

---

## 📦 Cài đặt Chrome Extension
1. Mở Chrome và truy cập: `chrome://extensions/`
2. Bật chế độ **Developer mode** (Chế độ dành cho nhà phát triển) ở góc trên bên phải.
3. Bấm **Load unpacked** (Tải tiện ích đã giải nén) và chọn thư mục `extension/`.
