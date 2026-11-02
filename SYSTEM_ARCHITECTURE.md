# 🏗️ KIẾN TRÚC HỆ THỐNG TOOLZUTTER 3.0 (SYSTEM ARCHITECTURE)

Tài liệu này mô tả chi tiết kiến trúc tầng, luồng dữ liệu, luồng điều phối tác vụ và cơ chế bảo mật của nền tảng **TOOLZUTTER 3.0 Enterprise**.

---

## 1. MÔ HÌNH KIẾN TRÚC TỔNG THỂ

Hệ thống được tổ chức theo kiến trúc **Decoupled Asynchronous Micro-Services** kết hợp mô hình phân phối **Dual-Deployment** (Cloud SaaS & Tauri Desktop Offline-First).

```mermaid
flowchart TB
    subgraph UI_Layer ["🖥️ TẦNG GIAO DIỆN & CLIENT"]
        VITE["Vite 8 SPA / React 19\n(Zustand + TanStack Query)"]
        TAURI["Tauri 2.0 Rust Shell\n(Desktop Wrapper + HWID Guard)"]
        EXT["Chrome Extension MV3\n(Session Sync & Quick Cookie)"]
    end

    subgraph Security_Gateway ["🛡️ TẦNG BẢO MẬT & ĐIỀU PHỐI"]
        NGINX["Nginx / Local Reverse Proxy"]
        JWT_GUARD["Spring Security + JWT + Ed25519 Token Filter"]
        ROUTER["WorkerRouterService\n(Account Affinity + Round Robin)"]
    end

    subgraph Backend_Core ["⚙️ TẦNG DỊCH VỤ TRUNG TÂM (SPRING BOOT 3.4)"]
        SCHEDULER["CampaignScheduler\n(Cron & 5s High-Frequency Queue)"]
        QUEUE_SVC["PostQueueService & Co-Admin Balancer"]
        THROTTLE_SVC["NickThrottleService\n(Sliding Window Rate Limiter)"]
        MEDIA_SVC["VideoStudio & NewsCard Services"]
        AI_SVC["GeminiService Engine\n(Key-Pool & Multi-Model Fallback)"]
    end

    subgraph Worker_Cluster ["🤖 CỤM WORKER TỰ ĐỘNG HÓA (NODE.JS PLAYWRIGHT)"]
        W1["Worker Node 1 (:3001)\nBrowserPool + Poster"]
        W2["Worker Node 2 (:3002)\nScraper + Media Fetcher"]
        W3["Worker Node 3 (:3003)\nParallel Queue Runner"]
        BROWSER_POOL["Chromium Process Pool\n(256MB V8 Capped + Context Isolation)"]
    end

    subgraph Media_Engine ["🎬 CÔNG CỤ XỬ LÝ MEDIA ĐA TẦNG"]
        FFMPEG["FFmpeg 7 Engine\n(Lanczos scaling + Waveform + Audio Ducking)"]
        EDGE_TTS["Microsoft Edge TTS / Gemini Speech\n(Sub-word timestamping)"]
        CANVAS_PUPPETEER["Puppeteer 2K Canvas Renderer\n(Transparent News Overlays)"]
    end

    subgraph Storage_Tier ["💾 TẦNG LƯU TRỮ DỮ LIỆU"]
        MYSQL[(MySQL 8.0 / H2 File DB)\nConnection Pool: HikariCP]
        UPLOADS["Local Storage / Media Assets\n(/uploads/ & /downloads/)"]
        STATE_CACHE["Caffeine In-Memory Cache (TTL 30s)"]
    end

    VITE --> NGINX
    TAURI --> VITE
    EXT --> NGINX
    NGINX --> JWT_GUARD
    JWT_GUARD --> Backend_Core

    SCHEDULER --> THROTTLE_SVC
    THROTTLE_SVC --> QUEUE_SVC
    QUEUE_SVC --> ROUTER

    ROUTER -->|Account Affinity| W1
    ROUTER -->|Scraping Load| W2
    ROUTER -->|Parallel Posts| W3

    W1 & W2 & W3 --> BROWSER_POOL
    MEDIA_SVC --> FFMPEG
    MEDIA_SVC --> EDGE_TTS
    MEDIA_SVC --> CANVAS_PUPPETEER

    Backend_Core --> MYSQL
    Backend_Core --> UPLOADS
    Backend_Core --> STATE_CACHE
    AI_SVC -->|Gemini 3.5 Flash / Flash Lite| Google_AI["Google Gemini API"]
```

---

## 2. NGUYÊN TẮC THIẾT KẾ & LUỒNG DỮ LIỆU

### 2.1. Account Affinity Routing (Điều phối định danh)
- Mỗi nick VIA / Profile gắn với một mã nhận dạng `c_user` duy nhất.
- `WorkerRouterService` phân giải `c_user` bằng hàm băm nhất quán để luôn phân công nick đó về cùng một Worker Node (Port 3001, 3002 hoặc 3003).
- **Lợi ích**: Giữ nguyên vẹn Session Cookie, Local Storage và Browser Fingerprint trong thư mục `browser_profiles/` của worker đó, ngăn chặn tối đa việc Facebook phát hiện IP/fingerprint thay đổi liên tục.

### 2.2. Khử N+1 và Tránh Tràn Bộ Nhớ trong Hàng Đợi (Queue Scaling)
- Truy vấn lấy bài chờ đăng sử dụng `LEFT JOIN FETCH p.campaign c LEFT JOIN FETCH c.user u` nhằm triệt tiêu hoàn toàn bài toán N+1 truy vấn JPA.
- Bổ sung `PageRequest` giới hạn kích thước mẻ xử lý (Batch size = 100), loại bỏ nguy cơ tải toàn bộ 10,000 bài viết vào Heap Memory khi hệ thống có lịch đăng lớn.

### 2.3. Pipeline Xử lý Video (Video News Studio)
1. **Phân giải URL & Tải Video**: Tải video nguồn đa luồng, kiểm tra định dạng và trích xuất độ dài bằng `ffprobe`.
2. **Tổng hợp Giọng đọc AI (TTS)**: Gửi văn bản tới Microsoft Edge Neural TTS hoặc Gemini Speech, trích xuất danh sách mốc thời gian từng từ (`word_timestamps`) để dựng phụ đề đồng bộ.
3. **Dựng Khung Đồ họa (Graphic Overlay)**: Puppeteer render mã HTML giao diện báo chí thành ảnh trong suốt chuẩn 2K.
4. **Hòa trộn FFmpeg (Multi-Layer Filter Graph)**:
   - Video gốc được co giãn theo tỷ lệ (1:1, 4:5, 9:16).
   - Khung tiêu đề hiển thị trong $N$ giây đầu (Hook Reveal) rồi áp dụng hiệu ứng mờ dần (`fade out`) hoặc trượt (`slide down`).
   - Âm thanh: Tiếng gốc tự động hạ âm lượng (`audio ducking`) khi giọng đọc AI phát, kết hợp nhạc nền mờ nhẹ.

