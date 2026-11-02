# 🗺️ LỘ TRÌNH NÂNG CẤP TOOLZUTTER 3.0 (IMPROVEMENT ROADMAP)

Kế hoạch nâng cấp được chia làm 7 giai đoạn trọng tâm, tập trung giải quyết toàn bộ các mục tiêu đã chọn theo chỉ đạo `/goal`:

---

## 📌 GIAI ĐOẠN 1: KHỞI TẠO & KIỂM TOÁN HỆ THỐNG (Hoàn thành)
- [x] Quét toàn bộ source code Frontend, Backend, Worker, DB, Scripts.
- [x] Sửa lỗi biên dịch TypeScript `QuickUpdateCookieModal.tsx` (`CRIT-01`).
- [x] Tạo tài liệu kiểm toán: `CODEBASE_AUDIT.md`, `SYSTEM_ARCHITECTURE.md`, `IMPROVEMENT_ROADMAP.md`.
- [x] Xác minh trạng thái chạy của 3 cụm Worker và Spring Boot Backend.

---

## 📌 GIAI ĐOẠN 2: TỐI ƯU HIỆU NĂNG TOÀN DIỆN (Extreme Performance)
- [ ] **Frontend Chunk Splitting**:
  - Tách `@ant-design/icons` ra khỏi `vendor-antd` trong `vite.config.ts`, đưa bundle size chính về dưới mức cảnh báo 500KB.
  - Tối ưu hóa tải động các module nặng (wavesurfer, xlsx, canvas helpers).
- [ ] **Backend Database & Queue Performance**:
  - Giới hạn kích thước mẻ lấy bài chờ đăng (`LIMIT 100` / `PageRequest`) trong `CampaignScheduler` và `PostQueueRepository` để tránh cạn kiệt Heap JVM.
  - Bổ sung chỉ mục DB cho các trường tìm kiếm thường xuyên (`social_accounts.user_id`, `post_queue.scheduled_at`).
- [ ] **Worker Resource Limiting**:
  - Tích hợp hàm kiểm tra RAM thực tế của hệ điều hành (`os.freemem()`) trước khi chấp nhận khởi chạy context Chromium mới.
  - Bổ sung cơ chế auto-kill cho zombie Chromium processes khi context bị disconnect hoặc timeout.

---

## 📌 GIAI ĐOẠN 3: NÂNG CẤP MEDIA ENGINE & VIDEO STUDIO
- [ ] Tối ưu hóa FFmpeg filter graph trong `VideoStudioController`:
  - Thêm cờ `-threads 0` và tối ưu buffer size để tăng tốc render 30-40%.
  - Hỗ trợ giải phóng ngay các file temp overlay `.png` và `.m4a` sau khi hòa trộn xong.
- [ ] Tối ưu hóa Puppeteer NewsCard renderer trong `worker/news-card.js`:
  - Tái sử dụng browser page instance cho các tác vụ render ảnh thẻ tin hàng loạt thay vì mở và đóng trang liên tục.

---

## 📌 GIAI ĐOẠN 4: NÂNG CẤP AI INTELLIGENCE (GEMINI ENGINE)
- [ ] Tích hợp **In-Memory Cache (Caffeine/LRU)** cho `GeminiService.java`:
  - Cache các câu hỏi/prompt lặp lại để tiết kiệm token và tránh lỗi rate limit 429.
- [ ] Chuẩn hóa Prompt Templates:
  - Cung cấp định dạng cấu trúc JSON rõ ràng cho việc sinh tiêu đề giật tít, tóm tắt tin tức và hashtag gợi ý.

---

## 📌 GIAI ĐOẠN 5: KIẾN TRÚC ENTERPRISE & PHÂN TẦNG CODE (Code Cleanliness)
- [ ] Tách logic phức tạp từ `PostQueueController.java` sang `PostQueueService`:
  - Chuyển hàm tạo hàng loạt bài đăng `/add-from-urls` thành service method riêng biệt.
  - Tối ưu hóa quản lý giao dịch `@Transactional(readOnly = true)` trên các phương thức đọc.
- [ ] Bổ sung Unit Test cho Worker (`worker/test/`):
  - Viết bộ test tự động kiểm tra `browserPool.js`, `device-fingerprints.js`, `desktop-bridge.js`.

---

## 📌 GIAI ĐOẠN 6: TRẢI NGHIỆM GIAO DIỆN & TIỆN ÍCH (UI/UX Refinement)
- [ ] Chuẩn hóa typography, độ tương phản dark theme, và giảm giật khung hình khi render bảng dữ liệu lớn.
- [ ] Tách các hook tính toán countdown/progress ra khỏi `PlaywrightPoster.tsx` để giảm thiểu re-render diện rộng.

---

## 📌 GIAI ĐOẠN 7: KIỂM THỬ TỔNG THỂ & BÁO CÁO KẾT QUẢ
- [ ] Chạy lại toàn bộ bộ test Backend (Maven surefire) và Worker test suite.
- [ ] Đo lường tốc độ build Vite và dung lượng bundle sau tối ưu.
- [ ] Hoàn thiện các tài liệu báo cáo `PERFORMANCE_REPORT.md`, `CHANGELOG.md`, `TEST_REPORT.md`.

