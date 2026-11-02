# TOOLZUTTER 3.3 — NHẬT KÝ THAY ĐỔI TOÀN DIỆN (CHANGELOG)
## (NEXT-GENERATION REAL-WORLD PUBLISHING & RELIABILITY)

**Ngày phát hành:** 2026-11-02  
**Phiên bản:** TOOLZUTTER 3.3.0 Enterprise

---

### 1. Kiến trúc Cốt lõi & Chống Đăng trùng (Anti-Duplicate & Distributed Leasing)
- **Cơ chế Khóa Phân tán (Distributed Lease):**
  - Bổ sung các trường `locked_by`, `lock_token`, `locked_at`, `lease_expires_at`, `attempt_count`, `last_attempt_id` vào entity `PostQueue`.
  - Triển khai phương thức cập nhật điều kiện nguyên tử `PostQueueRepository.acquireLease(...)` và `releaseLease(...)`.
  - Loại bỏ hoàn toàn khả năng 2 Worker hoặc 2 luồng Backend cùng tranh chấp xử lý 1 bài đăng.
- **Thực thể Nhật ký Thực thi Bất biến (`PostExecutionAttempt`):**
  - Tạo mới bảng `post_execution_attempt` và repository `PostExecutionAttemptRepository`.
  - Lưu trữ đầy đủ lịch sử từng lần thử đăng bài, gắn với Fencing Token, tên Worker Instance, thời gian bắt đầu/kết thúc, trạng thái và Proof URL.
- **Quy trình Đối soát Bắt buộc trước khi Đưa bài về Chờ (`Reconciliation-First Policy`):**
  - Nâng cấp `PublishingControlCenterService.verifyPost`:
    - Khi nhận lệnh `RESET_PENDING`, hệ thống không còn phụ thuộc vào thời gian 2 phút mơ hồ mà bắt buộc truy vấn toàn bộ cụm 3 Worker (`askWorkerPostResult`).
    - Tự động chặn và trả về HTTP 400 nếu Worker đang xử lý (`IN_PROGRESS`) hoặc xác nhận bài đã đăng thành công (`SUCCESS`).

---

### 2. Tiền kiểm định Xuất bản (Publishing Preflight Engine)
- **Triển khai Mẫu Thiết kế Adapter Đa Nền tảng:**
  - Hoàn thiện các adapter cụ thể kế thừa `PlatformPublishingAdapter`:
    - `FacebookPublishingAdapter`: Thẩm định Facebook Feed, Story, Video, Group. Yêu cầu bắt buộc media đối với Story.
    - `ThreadsPublishingAdapter`: Giới hạn nghiêm ngặt 500 ký tự chuẩn Threads, thẩm định độ dài và media.
    - `TikTokPublishingAdapter`: Bắt buộc định dạng video (.mp4/.mov), giới hạn tiêu đề 2200 ký tự.
  - Tích hợp Dependency Injection vào `PublishingPreflightService`.
- **Tích hợp Điểm chặn Đầu vào (API Gate):**
  - Tích hợp kiểm định trực tiếp vào `PostQueueController.addFromUrls`. Chặn các bài viết rỗng hoặc nick hết hạn trước khi lưu vào DB.
  - Cung cấp API `POST /api/publishing-control-center/preflight-check/{postId}` cho phép kiểm tra sức khỏe bài viết trước khi xuất bản.

---

### 3. Cụm 3 Worker & Điều phối Dự phòng (Worker Cluster & Failover)
- **Nâng cấp Truy vấn Đối soát Đa Worker:**
  - Cải tiến `CampaignScheduler.askWorkerPostResult`: Thay vì chỉ hỏi Worker :3001, hệ thống quét tuần tự toàn bộ các worker trong danh sách `workerRouterService.getAllWorkerUrls()` (:3001, :3002, :3003).
- **Phân định Định tuyến Nhất quán (Consistent Account Affinity):**
  - Đảm bảo tài khoản Facebook cố định luôn được gán cho 1 Worker duy nhất để bảo toàn cookie và fingerprint trình duyệt.
  - Tự động chuyển vùng thông minh (Failover) sang worker khác khi worker ưu tiên gặp sự cố.

---

### 4. Giao diện Trung tâm Điều hành (Publishing Control Center UI)
- **Hiển thị Trạng thái Khóa (Lease Tag Badge):**
  - Bổ sung huy hiệu `🔒 {record.lockedBy}` kèm Tooltip hiển thị thời gian hết hạn của Lease khi bài ở trạng thái `PROCESSING`.
- **Nút Nhật ký Kiểm toán (Audit Trail Modal):**
  - Bổ sung nút biểu tượng `<HistoryOutlined />` trong cột Thao tác của Hàng đợi.
  - Mở Modal xem dòng thời gian (Timeline) chi tiết từng Attempt Token, Node thực thi, mã lỗi và Proof URL.
- **Cải thiện Xử lý Ngoại lệ:**
  - `PublishingControlCenterController` bắt các ngoại lệ `IllegalStateException` và `IllegalArgumentException`, trả lời HTTP 400 với thông điệp rõ ràng thay vì lỗi 500 mơ hồ.

---

### 5. Kết quả Kiểm thử & Chất lượng Mã nguồn
- **100% Backend Tests Pass (51/51 tests):**
  - Đã bổ sung bộ kiểm thử `AntiDuplicateLeasingTest`, `WorkerClusterReliabilityTest`, `PreflightValidationSuiteTest`.
- **100% Worker Tests Pass (4/4 tests).**
- **100% Frontend Build Clean:** Hoàn thành trong 857 ms trên Vite `v8.1.3`.
- **Live Deployment:** Backend và 3 Worker đang vận hành thực tế trên port 8081, 3001, 3002, 3003.

