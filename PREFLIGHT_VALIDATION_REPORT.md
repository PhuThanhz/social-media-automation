# TOOLZUTTER 3.3 — BÁO CÁO TIỀN KIỂM ĐỊNH XUẤT BẢN (PREFLIGHT VALIDATION)
## (PREFLIGHT VALIDATION SUITE REPORT)

**Thời điểm kiểm tra:** 2026-11-02  
**Phiên bản:** TOOLZUTTER v3.3  
**Bộ kiểm thử:** `PreflightValidationSuiteTest.java` (7/7 tests Passed)

---

## 1. MỤC ĐÍCH & Ý NGHĨA

Trong các hệ thống tự động hóa mạng xã hội, 70% các lỗi đăng bài xuất phát từ dữ liệu đầu vào không hợp lệ (nội dung rỗng, thiếu media đối với Story/TikTok, cookie tài khoản hết hạn, hoặc bài viết vượt quá ký tự quy định). 

Nếu đẩy các bài lỗi này vào hàng đợi:
- Worker Playwright phải mất công mở trình duyệt (tốn 100-300MB RAM).
- Trình duyệt thao tác đến bước cuối cùng mới bị nền tảng từ chối.
- Gây lãng phí tài nguyên và làm nghẽn các bài hợp lệ khác đang xếp hàng.

**Tiền kiểm định (Preflight Validation)** trong TOOLZUTTER 3.3 giải quyết triệt để vấn đề này bằng cách thẩm định tính hợp lệ ngay tại cổng nạp (API Gate) trước khi lưu vào MySQL.

---

## 2. MA TRẬN LUẬT KIỂM ĐỊNH ĐA NỀN TẢNG (PLATFORM VALIDATION MATRIX)

Hệ thống sử dụng mẫu thiết kế Strategy kết hợp `PlatformPublishingAdapter`:

```
                    [PublishingPreflightService]
                                 │
     ┌───────────────────────────┼───────────────────────────┐
     ▼                           ▼                           ▼
[FacebookAdapter]        [ThreadsAdapter]             [TikTokAdapter]
  - Text or Media          - Max 500 chars              - Video ONLY (.mp4/.mov)
  - Story: Media req       - Link check                 - Title max 2200 chars
  - Account Active         - Text or Media              - Video URL reachable
```

| Nền tảng / Định dạng | Điều kiện Nội dung chữ | Điều kiện Media đính kèm | Kiểm tra Tài khoản | Kết quả kiểm thử |
| :--- | :--- | :--- | :--- | :--- |
| **Facebook Feed** | Cho phép chữ không cần media | Cho phép ảnh/video không cần chữ | Phải có cookie/token hợp lệ | ✅ PASSED |
| **Facebook Story** | Tùy chọn (Title) | **Bắt buộc** phải có Media URL (Ảnh/Video) | Tài khoản phải ở trạng thái ACTIVE | ✅ PASSED |
| **Threads Feed** | Tối đa **500 ký tự** (giới hạn cứng của Threads) | Hỗ trợ ảnh/video | Tài khoản kết nối Threads phải sẵn sàng | ✅ PASSED |
| **TikTok Video** | Tối đa 2200 ký tự | **Bắt buộc** phải có Video (.mp4 / .mov / webm) | Tài khoản TikTok phải ACTIVE | ✅ PASSED |
| **Bài trống hoàn toàn** | Rỗng | Rỗng | Mọi tài khoản | ❌ BỊ CHẶN NGAY LẬP TỨC |
| **Tài khoản Checkpoint** | Mọi nội dung | Mọi media | Bị đánh dấu `EXPIRED` hoặc `CHECKPOINT` | ❌ BỊ CHẶN NGAY LẬP TỨC |

---

## 3. ĐIỂM TÍCH HỢP TRONG TOÀN BỘ HỆ THỐNG

1. **API Thêm bài từ URLs (`PostQueueController.addFromUrls`):**
   - Trước khi lưu batch hàng chục bài viết vào cơ sở dữ liệu, hàm gọi `publishingPreflightService.validatePost(account, post)`.
   - Nếu có lỗi chặn nghiêm trọng, bài viết bị loại khỏi hàng đợi và trả về thông báo lỗi trực tiếp cho người dùng.

2. **API Tiền kiểm tra theo yêu cầu (`POST /api/publishing-control-center/preflight-check/{postId}`):**
   - Cho phép người dùng kiểm tra trạng thái sức khỏe của bất kỳ bài viết nào đang nằm trong Queue hoặc trước khi bấm "Đăng ngay".
   - Phản hồi định dạng chuẩn:
     ```json
     {
       "valid": true,
       "errors": [],
       "warnings": []
     }
     ```

3. **Giao diện người dùng (Publishing Control Center UI):**
   - Tích hợp nút **"Preflight Check"** trực tiếp trên từng dòng của bảng danh sách hàng đợi (Queue Table).
   - Hiển thị thông báo Modal Modal/Popconfirm chi tiết các điều kiện không thỏa mãn giúp người dùng sửa bài ngay tại chỗ mà không cần mò log.

