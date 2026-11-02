# BÁO CÁO ĐỘ TIN CẬY HÀNG ĐỢI (QUEUE RELIABILITY & FAULT TOLERANCE)
**Dự án:** TOOLZUTTER 3.2  
**Chuyên đề:** Tính bất biến, khả năng phục hồi sau sự cố, chống đăng trùng lặp và bảo vệ nick VIA.

---

## 1. NGUYÊN TẮC THIẾT KẾ ĐỘ TIN CẬY
Hệ thống xuất bản tự động trên mạng xã hội đòi hỏi độ chính xác tuyệt đối:
- **Nguyên tắc "Đăng 1 lần duy nhất" (At-most-once posting guarantee):** Thà hoãn lại để người dùng xem xét, còn hơn tự ý đăng lại và gây trùng bài hoặc bị Facebook tính là spam hành vi.
- **Bảo vệ tài khoản VIA (Rate Limiting & Cooldown Protection):** Giới hạn tối đa 35 bài / 60 phút trên cùng 1 nick VIA cá nhân. Khi phát hiện cảnh báo giới hạn tần suất từ Facebook, hệ thống tự động cho nick nghỉ 6 tiếng và dời các bài tiếp theo một cách an toàn.

---

## 2. CHU KỲ TRẠNG THÁI BÀI ĐĂNG (POST STATUS LIFECYCLE)

```text
[PENDING]  ──────── (Đến giờ hẹn & Kiểm tra Preflight PASS) ───────►  [QUEUED]
                                                                         │
                                                                         ▼
                                                                   [PROCESSING]
                                                                         │
                                                                         ▼
                                                                   [PUBLISHING]
                                                                  ╱            ╲
                                  (Thành công + có URL proof)    ╱              ╲  (Lỗi xác thực / Cookie chết)
                                                                ▼                ▼
                                                          [PUBLISHED]         [FAILED]
                                                                ▲
                                                                │ (Xác nhận thủ công)
                                                                │
                                                         [NEEDS_REVIEW]
                                                       (Mất kết nối / Timeout)
                                                                │
                                                                │ (Đăng lại)
                                                                ▼
                                                            [PENDING]
```

---

## 3. CƠ CHẾ PHỤC HỒI KHI BACKEND HOẶC WORKER RESTART
1. **Trường hợp Backend đột ngột tắt/khởi động lại:**
   - Các bài đang ở trạng thái `PROCESSING` hoặc `PUBLISHING` quá 5 phút mà không có cập nhật được `CampaignScheduler` rà soát trong chu kỳ quét mỗi phút.
   - Các bài này tự động chuyển thành `NEEDS_REVIEW` thay vì `FAILED`.
   - Bảng điều khiển `PublishingControlCenter` lập tức nổi huy hiệu cảnh báo vàng và hiển thị danh sách bài cần đối soát.
2. **Trường hợp Worker Node bị crash (Chromium Out of Memory):**
   - Pool giám sát tiến trình con; nếu worker không phản hồi HTTP trong 30 giây, `WorkerRouterService` ghi nhận trạng thái OFFLINE trên cụm điều khiển và tự động chuyển hướng các tác vụ mới sang 2 worker còn lại.
3. **Cơ chế Dời lịch an toàn (Bulk Reschedule with Safe Jitter):**
   - Cung cấp tính năng dời lịch hàng loạt bài viết với khoảng cách thời gian tuỳ chọn (khuyến nghị 15 phút giữa các bài).
   - Ngăn chặn triệt để tình huống hàng chục bài đăng dồn cục vào cùng 1 phút làm nghẽn worker và trigger thuật toán chống bot của Facebook.

