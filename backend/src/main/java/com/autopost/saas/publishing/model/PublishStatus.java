package com.autopost.saas.publishing.model;

/**
 * Trạng thái vòng đời chuẩn hóa của một bài đăng trong TOOLZUTTER Publishing Engine 3.2.
 */
public enum PublishStatus {
    /** Bài mới tạo, đang chờ kích hoạt hoặc chưa đến giờ đăng */
    PENDING,

    /** Đã lên lịch hẹn giờ cụ thể trong tương lai */
    SCHEDULED,

    /** Đã được scheduler tiếp nhận và đưa vào hàng đợi cấp phát Worker */
    QUEUED,

    /** Đang trong tiến trình chuẩn bị dữ liệu, tải media và kiểm tra Preflight */
    PROCESSING,

    /** Worker / Browser đang trực tiếp mở phiên và xuất bản lên nền tảng */
    PUBLISHING,

    /** Đã xuất bản thành công 100% kèm bằng chứng link / post ID từ nền tảng */
    PUBLISHED,

    /** Thành công một phần (VD: đăng Fanpage thành công nhưng 1 số Group vệ tinh bị từ chối) */
    PARTIAL,

    /** Thất bại hoàn toàn với nguyên nhân và mã lỗi xác thực */
    FAILED,

    /** Người dùng hoặc hệ thống chủ động hủy bỏ bài đăng */
    CANCELLED,

    /** Cần quản trị viên kiểm tra lại (mất phản hồi giữa chừng, nghi ngờ checkpoint, hoặc group chờ duyệt) */
    NEEDS_REVIEW
}

