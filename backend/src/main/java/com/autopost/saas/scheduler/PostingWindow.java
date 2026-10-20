package com.autopost.saas.scheduler;

import java.time.LocalDateTime;
import java.time.LocalTime;

/**
 * Khung giờ đăng chung cho toàn bộ hàng đợi (VD 09:00–23:00): ngoài khung scheduler không tự đăng,
 * lịch nối đuôi chỉ xếp bài vào trong khung. minGapSeconds là giãn cách tối thiểu giữa 2 bài cùng nick
 * khi phải ép lịch cho kịp đăng hết trước giờ đóng khung.
 */
public record PostingWindow(boolean enabled, LocalTime start, LocalTime end, long minGapSeconds) {

    public static final PostingWindow DISABLED = new PostingWindow(false, LocalTime.of(9, 0), LocalTime.of(23, 0), 120);

    public PostingWindow {
        if (start == null) start = LocalTime.of(9, 0);
        if (end == null) end = LocalTime.of(23, 0);
        if (!end.isAfter(start)) {
            throw new IllegalArgumentException("Giờ kết thúc phải sau giờ bắt đầu (trong cùng 1 ngày)");
        }
        minGapSeconds = Math.max(0, minGapSeconds);
    }

    public boolean contains(LocalDateTime t) {
        if (!enabled) return true;
        LocalTime time = t.toLocalTime();
        return !time.isBefore(start) && time.isBefore(end);
    }

    /** Thời điểm sớm nhất được đăng tính từ t: chính t nếu đang trong khung, nếu không là giờ mở khung kế tiếp. */
    public LocalDateTime openAtOrAfter(LocalDateTime t) {
        if (!enabled) return t;
        LocalTime time = t.toLocalTime();
        if (time.isBefore(start)) return t.toLocalDate().atTime(start);
        if (time.isBefore(end)) return t;
        return t.toLocalDate().plusDays(1).atTime(start);
    }

    /** Giờ đóng khung của ngày chứa t. */
    public LocalDateTime closeOf(LocalDateTime t) {
        return t.toLocalDate().atTime(end);
    }

    public long lengthSeconds() {
        return java.time.Duration.between(start, end).getSeconds();
    }
}
