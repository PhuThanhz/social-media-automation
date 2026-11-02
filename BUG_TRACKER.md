# 🐛 BẢNG THEO DÕI VẤN ĐỀ VÀ LỖI (BUG TRACKER)

| Mã lỗi | Phân hệ | Mô tả chi tiết | Mức độ | Trạng thái | Giải pháp xử lý |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **BUG-01** | Frontend | TS2339 trong `QuickUpdateCookieModal.tsx`: missing `fullCookie` trong object trả về khi phân tích thủ công cookie | **CRITICAL** | **ĐÃ GIẢI QUYẾT** | Bổ sung `fullCookie: pair` vào object trả về của `parsedData` useMemo. |
| **BUG-02** | Frontend | `vendor-antd` chunk phình to 1.32MB do gộp cả icon và components | **HIGH** | **ĐÃ GIẢI QUYẾT** | Tách riêng `@ant-design/icons` (163KB) và `@rc-component` (462KB), đưa `vendor-antd` xuống 696KB. |
| **BUG-03** | Backend | `findByStatusAndScheduledAtBeforeOrderByScheduledAtAscIdAsc` không có limit, fetch toàn bộ hàng đợi | **HIGH** | **ĐÃ GIẢI QUYẾT** | Bổ sung Pageable giới hạn an toàn Top 100 vào repository query. |
| **BUG-04** | Worker | Thiếu thư mục `test/` dẫn đến `npm test` bị exit code 1 | **MEDIUM** | **ĐÃ GIẢI QUYẾT** | Thiết lập bộ test Node.js native test runner cho browserPool & device-fingerprints (4/4 PASS). |
| **BUG-05** | Media Engine | FFmpeg render đơn luồng và thiếu dọn dẹp debug output trong worker | **HIGH** | **ĐÃ GIẢI QUYẾT** | Kích hoạt `-threads 0` đa luồng CPU và tích hợp cron dọn `worker/debug_output` vào StorageCleanupService. |
