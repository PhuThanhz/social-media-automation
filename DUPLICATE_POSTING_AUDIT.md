# TOOLZUTTER 3.3 — BÁO CÁO KIỂM TOÁN CHỐNG ĐĂNG TRÙNG
## (DUPLICATE POSTING AUDIT & CONCURRENCY CONTROL)

**Thời điểm kiểm toán:** 2026-11-02  
**Phiên bản:** TOOLZUTTER v3.3  
**Trọng tâm:** Cơ chế Khóa Phân tán (Distributed Lease), Fencing Tokens, và Quy trình Đối soát trước khi Cho phép Đăng lại (Reconciliation-First Policy).

---

## 1. NGUY CƠ ĐĂNG TRÙNG VÀ CÁC ĐIỂM YẾU LỊCH SỬ

Trước phiên bản 3.3, hiện tượng đăng trùng trên các nền tảng mạng xã hội (Facebook, Threads, TikTok) có thể xảy ra trong các tình huống sau:

1. **Timeout không đồng nghĩa với Thất bại:**
   - Khi mạng lag hoặc Facebook render video lâu, yêu cầu HTTP từ Backend sang Worker bị timeout (Read Timeout 10 phút).
   - Nếu Backend vội vã đánh dấu `FAILED` và tự động retry (hoặc người dùng bấm Reset bài), Playwright ở Worker vẫn đang âm thầm hoàn tất thao tác đăng. Khi Worker đăng xong bài cũ, luồng retry mới lại đẩy tiếp bài thứ 2 lên cùng Fanpage/Group.
2. **Tranh chấp Worker (Race Condition):**
   - Nhiều luồng Backend hoặc Scheduler quét cùng một thời điểm có thể bốc cùng 1 job và gửi sang 2 worker khác nhau cùng lúc.
3. **Reset thủ công thiếu đối soát (`RESET_PENDING` mù quáng):**
   - Người dùng thấy bài ở trạng thái `NEEDS_REVIEW` hoặc `PROCESSING` quá lâu liền bấm nút Reset để chuyển về `PENDING`, trong khi bài thực tế đã được đăng lên mạng xã hội.

---

## 2. GIẢI PHÁP TRIỂN KHAI TRONG TOOLZUTTER 3.3

### A. Cơ chế Khóa Phân tán & Fencing Tokens (Distributed Lease & Fencing Tokens)
Thay vì cập nhật trạng thái đơn giản, hệ thống sử dụng câu lệnh UPDATE có điều kiện nguyên tử (Atomic Conditional Update) ở cấp cơ sở dữ liệu:

```sql
UPDATE post_queue 
SET locked_by = :workerId, 
    lock_token = :fencingToken, 
    locked_at = :now, 
    lease_expires_at = :leaseExpiresAt,
    attempt_count = COALESCE(attempt_count, 0) + 1,
    last_attempt_id = :attemptToken
WHERE id = :postId 
  AND (status IN ('PENDING', 'SCHEDULED', 'QUEUED') 
       OR (status = 'PROCESSING' AND lease_expires_at IS NOT NULL AND lease_expires_at < :now))
```

**Đặc điểm bảo vệ:**
- **Fencing Token (`UUID`):** Mỗi lần thử thực thi (Attempt) được cấp một mã token duy nhất. Chỉ tiến trình nắm giữ token hợp lệ mới có quyền ghi nhận kết quả cuối cùng.
- **Lease Expiration (`leaseExpiresAt`):** Khóa có thời hạn cụ thể (mặc định 12 phút). Nếu Worker chết đột ngột, khóa sẽ tự giải phóng sau khi hết hạn mà không gây deadlock.
- **Race Condition Immunity:** Nếu 2 Worker cùng cố gắng tranh chấp 1 job, chỉ có 1 câu lệnh UPDATE trả về `row_count = 1`, Worker còn lại nhận `row_count = 0` và phải nhường quyền ngay lập tức.

### B. Bảng Nhật ký Thực thi Bất biến (`post_execution_attempt`)
Mọi diễn biến trong vòng đời của một bài đăng đều được ghi lại trong bảng audit trail:
- `attempt_token`: Mã token định danh phiên làm việc.
- `worker_instance`: Node thực thi (ví dụ: `http://localhost:3002` hoặc `ControlCenter:User#1`).
- `started_at` & `finished_at`: Dấu vết thời gian chuẩn xác đến millisecond.
- `status`: `SUCCESS`, `FAILED`, `TIMEOUT`, `CONFIRM_PUBLISHED`, `RESET_PENDING`, `CANCELLED`.
- `proof_url`: Đường dẫn bài đăng thực tế được mạng xã hội trả về.
- `error_code` & `error_message`: Lý do thất bại (nếu có).

### C. Quy trình Đối soát Bắt buộc trước khi Reset (`Reconciliation-First Policy`)
TOOLZUTTER 3.3 bãi bỏ hoàn toàn giả định "chờ 2 phút là đủ an toàn". Khi có yêu cầu đưa bài về `PENDING`:
1. Backend bắt buộc gửi truy vấn đối soát sang **toàn bộ các Worker trong cụm** (`askWorkerPostResult`).
2. **Nếu Worker trả về `IN_PROGRESS`:** Backend từ chối ngay lập tức:  
   *`"Không thể reset: Một Worker trong cụm đang tích cực xử lý bài viết này. Vui lòng chờ worker hoàn tất."`*
3. **Nếu Worker trả về `SUCCESS` hoặc bài đã có Proof URL:** Backend chặn đứng thao tác:  
   *`"Worker trong cụm xác nhận bài này ĐÃ ĐĂNG THÀNH CÔNG (Proof URL: ...). Vui lòng chọn 'Xác nhận đã đăng' thay vì đăng lại!"`* (Trả về HTTP 400).
4. Chỉ khi **Worker xác nhận đã dừng hoặc không có bản ghi thực thi dở dang**, hệ thống mới cấp phép chuyển trạng thái và ghi nhận một bản ghi Audit Trail `RESET_PENDING`.

---

## 3. CAM KẾT MỨC ĐỘ BẢO ĐẢM (HONEST SLA)

> [!IMPORTANT]
> **Tuyên bố trung thực về mức độ bảo đảm:**  
> Do các nền tảng mạng xã hội bên thứ ba (đặc biệt là Facebook Web UI thông qua tự động hóa trình duyệt) **không hỗ trợ Idempotency Token gốc** như Stripe hay AWS, TOOLZUTTER **không tuyên bố bảo đảm Exactly-Once tuyệt đối**.  
>  
> Thay vào đó, TOOLZUTTER 3.3 cam kết chuẩn bảo đảm:  
> **"Reconciliation-First At-Most-Once Publishing" (Xuất bản Tối đa Một Lần với Đối soát Chặt chẽ)**:  
> - Bằng mọi giá ưu tiên an toàn, không bao giờ tự động đăng lại khi kết quả lần trước còn mơ hồ.  
> - Luôn đối soát vết lưu trữ cục bộ của cụm Worker trước bất kỳ thao tác tái lập lịch nào.

