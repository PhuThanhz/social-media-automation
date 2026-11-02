# 🔍 BÁO CÁO TOÀN DIỆN SOURCE CODE TOOLZUTTER 3.0 (CODEBASE AUDIT)

**Thời gian kiểm toán:** Tháng 11/2026  
**Phiên bản dự án:** TOOLZUTTER Enterprise 3.0  
**Phạm vi:** Toàn bộ hệ thống (Frontend React 19 / Vite 8, Backend Spring Boot 3.4 / Java 21, Worker Node.js / Playwright, Database MySQL 8.0, Desktop Tauri 2.0).

---

## 1. TỔNG QUAN HỆ THỐNG HIỆN TẠI

TOOLZUTTER là nền tảng Social Media Automation SaaS & Desktop cao cấp, phục vụ:
- **Tự động hóa xuất bản đa kênh**: Facebook Pages, Groups, Profiles, Stories, Threads, TikTok.
- **AI Media Studio**: News Card Studio (tạo ảnh thẻ tin tức 2K HTML Canvas/Puppeteer), Video News Studio (biên tập video đa tầng với hook 5s reveal, Waveform, Edge-TTS/Gemini Voice, FFmpeg render).
- **Hệ thống Quản lý và Điều phối Tài khoản**: Phân bổ Nick VIA, Co-Admin rotation, Rate limiting, Remote kill-switch qua Ed25519 token.

### Quy mô Codebase đo đạc thực tế:
- **Frontend**: ~45 trang và components lớn, tổng cộng hơn 25,000 dòng TSX/CSS.
- **Backend**: 18 Controllers, 12 Repositories, 14 Services, 4 Schedulers, ~15,000 dòng Java.
- **Worker**: `server.js` đơn lẻ 13,644 dòng cùng các module vệ tinh, ~18,000 dòng JavaScript.
- **Trạng thái Build & Test ban đầu**:
  - Frontend: Có lỗi TypeScript chặn `npm run build` tại `QuickUpdateCookieModal.tsx` *(Đã sửa)*.
  - Backend: Build thành công, 23/23 Unit/Mock test ĐẠT (100%).
  - Worker: Thiếu thư mục test (`node --test test/` báo lỗi thiếu thư mục).

---

## 2. MA TRẬN PHÂN LOẠI VẤN ĐỀ THEO MỨC ĐỘ ƯU TIÊN

| Mã | Hạng mục | Vấn đề phát hiện | Mức độ | Tác động |
| :--- | :--- | :--- | :--- | :--- |
| **CRIT-01** | Frontend Build | Lỗi TS2339 trong `QuickUpdateCookieModal.tsx` thiếu thuộc tính `fullCookie` | **CRITICAL** *(Đã sửa)* | Chặn build production bundle |
| **CRIT-02** | Worker Architecture | `worker/server.js` là file đơn 13,644 dòng, gộp chung routing, logic đăng bài, buffer eng, cào dữ liệu | **CRITICAL** | Khó bảo trì, rò rỉ bộ nhớ, crash 1 luồng ảnh hưởng toàn worker |
| **HIGH-01** | Backend DB & Concurrency | `findByStatusAndScheduledAtBeforeOrderByScheduledAtAscIdAsc` chạy mỗi 5s KHÔNG LIMIT | **HIGH** | Khi hàng đợi lớn (>5,000 bài), kéo toàn bộ vào RAM mỗi tick, gây spike CPU/GC |
| **HIGH-02** | Frontend Component Size | `PlaywrightPoster.tsx` (6,064 dòng, 83 useState), `BuffEngagement.tsx` (4,920 dòng, 72 useState) | **HIGH** | Re-render diện rộng, lag UI khi gõ caption hoặc nhận websocket/polling |
| **HIGH-03** | Frontend Bundle Size | `vendor-antd` đóng gói nguyên khối 1,320 KB (409 KB gzip), bao gồm toàn bộ `@ant-design/icons` | **HIGH** | Chậm First Contentful Paint (FCP) khi truy cập dashboard |
| **HIGH-04** | Video Studio Controller | Endpoint `/api/video-studio/render` chạy FFmpeg đồng bộ chặn HTTP thread lên đến 300s | **HIGH** | Giữ kết nối HTTP quá lâu, dễ timeout cổng Nginx hoặc cạn HTTP Worker Pool |
| **MED-01** | AI Service Architecture | `GeminiService.java` chưa có persistent cache cho các prompt giống nhau và thiếu structured JSON schema | **MEDIUM** | Tốn quota token Gemini không cần thiết khi re-generate |
| **MED-02** | Worker File Retention | Thư mục `debug_output`, `uploads`, `scratch` trong worker không có cron dọn dẹp theo dung lượng đĩa | **MEDIUM** | Đầy ổ đĩa sau thời gian dài vận hành |
| **MED-03** | Worker Unit Testing | `worker/package.json` định nghĩa `node --test test/` nhưng thư mục `test/` không tồn tại | **MEDIUM** | Không có automated regression test cho luồng worker |
| **LOW-01** | Database Indexing | Một số quan hệ tra cứu `social_accounts.user_id` và `post_queue.scheduled_at` độc lập chưa có index riêng | **LOW** | Chậm query khi dữ liệu đạt hàng chục nghìn records |

---

## 3. CHI TIẾT TỪNG PHÂN HỆ

### 3.1. Frontend (React 19 + Vite 8 + Ant Design)
- **Điểm mạnh**:
  - Giao diện đã có dark theme tương đối hoàn chỉnh, hệ thống icon phong phú.
  - Sử dụng React 19, Tailwind CSS, TanStack Query v5 với `staleTime: 15s`.
  - Định tuyến đã cấu hình `React.lazy` và `Suspense`.
- **Điểm yếu**:
  - Kiến trúc component "God Component": Các trang cốt lõi (`PlaywrightPoster`, `BuffEngagement`, `NewsCardStudio`, `Connections`) ôm đồm quá nhiều state cục bộ thay vì tách hook/sub-component.
  - Chunking chưa tối ưu: `vendor-antd` gộp cả antd + icons + rc-component khiến file JS đơn lẻ vượt quá 1.3MB.

### 3.2. Backend (Spring Boot 3.4.1 + Java 21)
- **Điểm mạnh**:
  - Cấu hình HikariCP tối ưu (`maximum-pool-size: 20`, `cachePrepStmts=true`).
  - Sử dụng Caffeine Cache ngắn hạn (30s) cho dropdown UI.
  - Đã có `WorkerRouterService` phân bổ tải thông minh giữa 3 worker (3001, 3002, 3003) với cơ chế Affinity theo tài khoản VIA.
  - Đã có `NickThrottleService` và `PostingWindowService` bảo vệ tài khoản khỏi checkpoint.
- **Điểm yếu**:
  - `PostQueueController.java` (1,856 dòng) đóng vai trò God Controller, chứa trực tiếp hàng trăm dòng logic xử lý nghiệp vụ (`/add-from-urls`, `/post-story`).
  - Truy vấn scheduler mỗi 5s chưa có phân trang/giới hạn (`LIMIT 100`).

### 3.3. Worker Engine (Node.js Playwright)
- **Điểm mạnh**:
  - `browserPool.js` tối ưu thông minh với cờ trình duyệt tiết kiệm RAM (`--disable-gpu`, `--js-flags=--max-old-space-size=256`), context pooling, watchdog timer.
  - `desktop-bridge.js` và `desktop-mode.js` quản lý phiên bản Desktop cách ly.
- **Điểm yếu**:
  - `server.js` 13,644 dòng cần được module hóa các router con (`routes/postFacebook.js`, `routes/newsScraper.js`, `routes/videoStudio.js`, `routes/buffEngagement.js`).
  - Lưu trạng thái vào file JSON đồng bộ (`post_results.json`, `buff_queue.json`) dễ gặp race condition khi ghi đồng thời từ nhiều luồng.

---

## 4. KẾT LUẬN & ĐỊNH HƯỚNG

Source code của TOOLZUTTER sở hữu nền tảng nghiệp vụ phong phú và thực chiến. Việc nâng cấp lên TOOLZUTTER 3.0 sẽ tập trung mạnh mẽ vào:
1. Tối ưu kích thước bundle và chia nhỏ các God Component ở Frontend.
2. Tối ưu hóa truy vấn Database và phân tầng Service/Controller ở Backend.
3. Module hóa và tăng cường khả năng chịu tải, giới hạn tài nguyên động ở Worker.
4. Tăng tốc Media Engine (FFmpeg & Canvas Rendering).
5. Nâng cấp bộ đệm và xác thực cấu trúc AI Gemini.

