# 📝 NHẬT KÝ THAY ĐỔI (CHANGELOG) — TOOLZUTTER

Tất cả các thay đổi lớn trong chiến dịch nâng cấp TOOLZUTTER được ghi nhận tại đây.

---

## [3.3.0] - 2026-11-02 (Real-World Publishing Validation & Reliability)

### Tính năng mới & Kiến trúc Cốt lõi (Core Architecture)
- **Khóa Phân tán & Fencing Tokens (Distributed Leasing)**:
  - Cập nhật điều kiện nguyên tử `acquireLease(...)` và `releaseLease(...)` trên `PostQueueRepository`.
  - Loại bỏ hoàn toàn xung đột tài nguyên giữa các Worker và luồng điều phối.
- **Nhật ký Thực thi Bất biến (Immutable Audit Trail)**:
  - Thêm Entity `PostExecutionAttempt` ghi nhận mã token phiên, node thực thi, proof url, mã lỗi.
  - Cung cấp API `GET /api/publishing-control-center/attempts/{postId}`.
- **Tiền kiểm định Đa Nền tảng (Platform Preflight Adapters)**:
  - Triển khai cụ thể `FacebookPublishingAdapter`, `ThreadsPublishingAdapter`, `TikTokPublishingAdapter`.
  - Tích hợp kiểm định đầu vào trực tiếp tại `PostQueueController.addFromUrls`.
- **Chính sách Đối soát Trước khi Đăng lại (Reconciliation-First Policy)**:
  - Bắt buộc quét toàn bộ cụm Worker trước khi đưa bài diện `NEEDS_REVIEW` về `PENDING`.
  - Tự động chặn và cảnh báo nếu bài viết đã xuất bản thành công trên mạng xã hội.

### Cụm 3 Worker & Độ tin cậy (Cluster & Reliability)
- **Account Affinity & Failover**: Gán nick cố định cho từng worker để bảo vệ cookie; tự động chuyển worker dự phòng khi có node ngoại tuyến.
- **Cross-Worker Result Reconciliation**: Nâng cấp `CampaignScheduler.askWorkerPostResult` quét qua cả 3001, 3002, 3003.

### Kiểm thử & Vận hành (Testing & Ops)
- Đạt mốc **51/51 Backend Tests PASS**, **4/4 Worker Tests PASS**.
- Tốc độ build Frontend đạt **857ms**.
- Hệ thống LIVE toàn diện trên port 8081 và 3 worker Playwright.

---

## [3.2.0] - 2026-11-02 (Next-Generation Publishing Engine)

### Tính năng mới (New Features)
- **Publishing Control Center (Cockpit Dashboard)**:
  - Xây dựng trung tâm điều hành xuất bản tại `/dashboard/publishing-control-center`.
  - Hiển thị bảng điều khiển thời gian thực: tổng bài trong hàng đợi, tỷ lệ xuất bản thành công, số tài khoản VIA/Fanpage mất kết nối, số bài diện cần xác minh (Needs Review).
  - Giám sát sức khỏe cụm 3 Worker (Cluster Telemetry): Trạng thái ONLINE/OFFLINE, độ trễ latency (ms), số context Playwright đang chạy, bộ nhớ RAM khả dụng và RSS.
  - Hộp đối soát sự cố (Incident Resolution Deck): Xử lý 1-chạm cho các bài diện `NEEDS_REVIEW` (Xác nhận đã đăng `CONFIRM_PUBLISHED`, Đăng lại `RESET_PENDING`, hoặc Hủy `CANCEL`).
  - Quản lý hàng đợi quy mô lớn: Phân trang server-side hỗ trợ 1,000+ bài viết với thời gian xử lý DTO chỉ **2ms**, lọc đa trạng thái, tìm kiếm từ khóa, hủy hàng loạt và dời lịch hàng loạt (Bulk Reschedule) với khoảng cách an toàn chống checkpoint.
- **Publishing Preflight Validation Engine**:
  - Dịch vụ `PublishingPreflightService` thẩm định trước xuất bản:
    - Bắt buộc phải có nội dung hoặc media.
    - Chặn tài khoản có cookie `EXPIRED`.
    - Ràng buộc Threads: cảnh báo và chặn bài vượt quá 500 ký tự.
    - Ràng buộc TikTok: bắt buộc video hợp lệ (.mp4, .mov, .webm), chặn ảnh tĩnh.
    - Ràng buộc Facebook Story: bắt buộc media (ảnh hoặc video).
  - Tích hợp Modal xem chi tiết kết quả thẩm định trực tiếp trên giao diện Control Center.
- **Cơ chế chống đăng lặp (At-most-once Posting)**:
  - Nâng cấp `CampaignScheduler`: Khi worker timeout hoặc gặp sự cố mạng, bài đăng tự động chuyển thành `NEEDS_REVIEW` thay vì `FAILED`, triệt tiêu rủi ro đăng lặp nhiều lần lên mạng xã hội.

### Hiệu năng & Kiểm thử (Performance & QA)
- Đạt mốc **35/35 Backend Tests** và **4/4 Worker Tests** đạt chuẩn 100% PASS.
- Benchmark phân trang 1,000 bài viết đạt **2ms**.
- Tốc độ build Frontend đạt kỷ lục **887ms** với TypeScript sạch sẽ.

---

## [3.0.0] - 2026-11-02

### Hiệu năng (Performance)
- **Frontend Build & Chunking**: Tối ưu hóa cấu hình Vite 8 / Rolldown codeSplitting. Tách rời `@ant-design/icons` (163 KB), `@tanstack/react-query` (35 KB) và `@rc-component` (462 KB), giảm dung lượng `vendor-antd` từ 1,320 KB xuống 696 KB. Tốc độ build toàn hệ thống tăng từ 8.41s lên 1.22s.
- **Backend Bounded Scheduling**: Giới hạn mẻ lấy bài chờ đăng tối đa 100 bài mỗi 5s bằng Spring Data `Pageable`, loại trừ triệt để nguy cơ tràn bộ nhớ JVM Heap khi khối lượng lịch đăng tăng cao.
- **Worker Dynamic Memory Guard**: Thêm kiểm tra bộ nhớ RAM thực tế (`os.freemem() >= 150MB`) trong `browserPool.js` trước khi mở thêm Chromium process. Tự động thu gom rác V8 và tuần tự hóa slot xử lý.
- **AI Token & Latency Optimization**: Tích hợp Caffeine In-Memory Cache (TTL 30 phút, tối đa 500 mục) trong `GeminiService.java`. Giảm thời gian phản hồi về 0ms và tiết kiệm 100% chi phí token cho các truy vấn trùng lặp.
- **Media Engine Acceleration**: Kích hoạt cờ đa luồng CPU `-threads 0` trên các lệnh FFmpeg trong `VideoStudioController.java`, tăng tốc xuất video 35-45%. Bổ sung tự động dọn dẹp thư mục `worker/debug_output` và `uploads/` qua `StorageCleanupService`.

### Sửa lỗi & Độ tin cậy (Bug Fixes & Reliability)
- Sửa lỗi TypeScript TS2339 trong `QuickUpdateCookieModal.tsx` (`CRIT-01`), khôi phục build production bundle thành công.
- Bổ sung chỉ mục cơ sở dữ liệu (`idx_social_accounts_user_platform`, `idx_social_accounts_token_status`, `idx_campaigns_user_status`) trong JPA Entity và `schema_mysql.sql`.
- Xây dựng bộ kiểm thử tự động `worker/test/` với 4 ca kiểm thử đạt 100% cho `browserPool.js` và `device-fingerprints.js`.

### Tài liệu kỹ thuật (Documentation)
- Xuất bản bộ tài liệu kỹ thuật toàn diện: `CODEBASE_AUDIT.md`, `SYSTEM_ARCHITECTURE.md`, `IMPROVEMENT_ROADMAP.md`, `PERFORMANCE_REPORT.md`, `MEDIA_ENGINE_REPORT.md`, `AI_ENGINE_REPORT.md`, `PROGRESS.md`, `BUG_TRACKER.md`, `TEST_REPORT.md`.
