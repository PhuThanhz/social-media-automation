# 🧠 BÁO CÁO HỆ THỐNG AI THÔNG MINH (AI ENGINE REPORT)

**Nền tảng:** Google Gemini 3.5 Flash / Flash Lite & Gemini Speech  
**Dịch vụ lõi:** `GeminiService.java` (Spring Boot 3.4)

---

## 1. MÔ HÌNH VẬN HÀNH & KIẾN TRÚC BẢO VỆ

Hệ thống tích hợp Google Gemini với kiến trúc **Fault-Tolerant High-Availability**:

```mermaid
flowchart TD
    REQ[Client Request: Soạn bài / Giật tít / Xào caption] --> CACHE{Kiểm tra Caffeine Cache\nTTL 30 phút / Key: SHA-256}
    CACHE -->|Hit| RESP_FAST[⚡ Trả về kết quả tức thì (0ms, 0 Token)]
    CACHE -->|Miss| KEY_POOL[Xoay vòng Key Pool\n(x-goog-api-key)]
    KEY_POOL --> MODEL_ACTIVE[Gọi Model chính: gemini-3.5-flash]
    MODEL_ACTIVE -->|Thành công| SAVE_CACHE[Lưu vào Cache & Trả về Client]
    MODEL_ACTIVE -->|Lỗi 429 Quota / 503 Quá tải| FALLBACK[Tự động kích hoạt Fallback List:\n3.5-flash-lite ➔ 3.1-flash-lite ➔ 2.5-flash]
    FALLBACK --> SAVE_CACHE
```

---

## 2. CÁC NÂNG CẤP VƯỢT TRỘI ĐÃ THIẾT LẬP

### 2.1. In-Memory Response Caching (Caffeine)
- **Cơ chế**: Băm SHA-256 nội dung prompt + tham số đầu vào làm cache key.
- **Dung lượng**: 500 bản ghi, tự động giải phóng sau 30 phút không hoạt động.
- **Hiệu quả**: Loại bỏ 100% tình trạng người dùng click nhiều lần gây tốn token trùng lặp.

### 2.2. Xử lý Định dạng Ngôn ngữ & Bộ lọc Facebook Anti-Spam
- **Khử hoàn toàn dấu hoa thị Markdown (`*`, `**`)**: Facebook không hỗ trợ cú pháp markdown. Hàm `stripMarkdownAsterisks()` tự động chuyển đổi thành chữ IN HOA hoặc văn bản chuẩn, đảm bảo thẩm mỹ bài đăng.
- **Bọc từ khóa nổi bật trong `[[...]]`**: Tự động nhận diện 2-4 cụm từ khóa đắt giá nhất (con số, sự kiện, nhân vật) để News Card Studio và Video Studio tự động tô màu đỏ/vàng trên ảnh thẻ tin.
- **Né kiểm duyệt từ nhạy cảm tự động**: Các từ vựng nhạy cảm dễ bị thuật toán Meta bóp tương tác (bia, rượu, chết, súng...) tự động được viết né chuẩn báo chí (B.I.A, R.Ư.Ợ.U, C.H.Ế.T).

### 2.3. Quản lý Quota & Giám sát API Key
- Hàm `getKeyUsageToday(key)` ghi nhận số lượt gọi API trong ngày của từng key, tự động reset vào 00:00 ngày mới.
- Cơ chế Cooldown Model: Khi một model báo lỗi 429 hoặc 503, model đó được đưa vào danh sách nghỉ 10 phút (`MODEL_COOLDOWN_MS`), ưu tiên các model còn sống để không làm nghẽn luồng xử lý của người dùng.

