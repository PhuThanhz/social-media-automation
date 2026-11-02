# BÁO CÁO TƯƠNG THÍCH ĐA NỀN TẢNG (PLATFORM ADAPTER REPORT)
**Dự án:** TOOLZUTTER 3.2 — Publishing Engine  
**Các nền tảng hỗ trợ:** Facebook (Fanpage, Groups, Story, Reels), Threads, TikTok.

---

## 1. BẢNG QUY CHUẨN THẨM ĐỊNH TRƯỚC (PREFLIGHT RULES MATRIX)

| Nền tảng | Định dạng bài viết | Giới hạn ký tự | Yêu cầu Media | Ràng buộc đặc thù |
| :--- | :--- | :--- | :--- | :--- |
| **Facebook Fanpage** | Feed, Photo, Album | Tối đa 63,206 ký tự | Ảnh (.jpg, .png, .webp) hoặc Video (.mp4) | Hỗ trợ lập lịch natively hoặc Playwright automation |
| **Facebook Group** | Group Post | Tối đa 63,206 ký tự | Tùy chọn | Kiểm tra quyền thành viên và kiểm duyệt trước của Group |
| **Facebook Story** | Story (24h) | Ngắn / Caption ảnh | **Bắt buộc có ảnh hoặc video** | Tỉ lệ khuyến nghị 9:16 |
| **Threads (Meta)** | Threads Status | **Tối đa 500 ký tự** | Tùy chọn (Ảnh/Video) | Cắt tỉa văn bản nếu vượt quá 500 ký tự; cảnh báo đỏ trong Preflight |
| **TikTok** | Video Feed | Tối đa 2,200 ký tự | **Bắt buộc có Video (.mp4, .mov, .webm)** | Chặn ngay nếu chỉ có ảnh tĩnh hoặc link rỗng |

---

## 2. KIẾN TRÚC ADAPTER TRONG SOURCE CODE
- **Giao diện Interface:** `PlatformPublishingAdapter.java` định nghĩa các phương thức:
  - `PreflightResult validate(PostQueue post, SocialAccount account)`
  - `PublishResult publish(PostQueue post, SocialAccount account)`
  - `boolean supports(String platform, String postType)`
- **Dịch vụ thẩm định:** `PublishingPreflightService.java` tích hợp tập luật thẩm định không đồng bộ, cung cấp phản hồi trong **dưới 1ms**.
- **Cơ chế Cookie Refresh:** Tự động bắt cặp cookie mới (`c_user`, `xs`, `fr`) khi đăng qua Playwright và cập nhật ngược lại cơ sở dữ liệu `SocialAccount` để duy trì phiên đăng nhập liên tục mà không bắt người dùng nhập lại thủ công.

