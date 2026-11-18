package com.autopost.saas.service;

import com.autopost.saas.entity.AppSetting;
import com.autopost.saas.repository.AppSettingRepository;
import com.autopost.saas.scheduler.PostingWindow;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.LocalTime;

/** Đọc/lưu khung giờ đăng chung (bảng app_settings). Giữ bản cache vì scheduler đọc mỗi 10 giây. */
@Service
@RequiredArgsConstructor
@Slf4j
public class PostingWindowService {

    private static final String KEY_ENABLED = "posting_window.enabled";
    private static final String KEY_START = "posting_window.start";
    private static final String KEY_END = "posting_window.end";
    private static final String KEY_MIN_GAP = "posting_window.min_gap_seconds";
    private static final String KEY_MAX_PER_HOUR = "posting_window.max_posts_per_hour_per_nick";
    public static final int DEFAULT_MAX_POSTS_PER_HOUR_PER_NICK = 35;
    public static final long DEFAULT_GAP_SECONDS = 1200; // Mặc định 20 phút (1200s) cho mỗi bài để chống spam và an toàn cho group

    private final AppSettingRepository repository;
    private volatile PostingWindow cached;
    private volatile Integer cachedMaxPerHour;

    public PostingWindow get() {
        PostingWindow w = cached;
        if (w != null) return w;
        try {
            boolean enabled = "true".equalsIgnoreCase(read(KEY_ENABLED, "false"));
            LocalTime start = LocalTime.parse(read(KEY_START, "09:00"));
            LocalTime end = LocalTime.parse(read(KEY_END, "23:00"));
            long minGap = Long.parseLong(read(KEY_MIN_GAP, String.valueOf(DEFAULT_GAP_SECONDS)));
            w = new PostingWindow(enabled, start, end, minGap);
        } catch (Exception e) {
            log.warn("Cài đặt khung giờ đăng không hợp lệ, tạm tắt khung giờ: {}", e.getMessage());
            w = PostingWindow.DISABLED;
        }
        cached = w;
        return w;
    }

    public PostingWindow save(PostingWindow window) {
        write(KEY_ENABLED, String.valueOf(window.enabled()));
        write(KEY_START, window.start().toString());
        write(KEY_END, window.end().toString());
        write(KEY_MIN_GAP, String.valueOf(window.minGapSeconds()));
        cached = window;
        log.info("🕘 Đã lưu khung giờ đăng: {} {}–{} (giãn tối thiểu {}s)",
                window.enabled() ? "BẬT" : "TẮT", window.start(), window.end(), window.minGapSeconds());
        return window;
    }

    /** Giãn cách mặc định giữa 2 bài cùng nick khi "Xếp vào lịch" — một giá trị dùng chung cho mọi nơi. */
    public int defaultGapSeconds() {
        long gap = get().minGapSeconds();
        return (int) Math.min(3600, gap > 0 ? gap : DEFAULT_GAP_SECONDS);
    }

    /** Giới hạn số bài/giờ cho mỗi nick Facebook (c_user), dùng bởi NickThrottleService. */
    public int maxPostsPerHourPerNick() {
        Integer v = cachedMaxPerHour;
        if (v != null) return v;
        try {
            v = Integer.parseInt(read(KEY_MAX_PER_HOUR, String.valueOf(DEFAULT_MAX_POSTS_PER_HOUR_PER_NICK)));
        } catch (Exception e) {
            v = DEFAULT_MAX_POSTS_PER_HOUR_PER_NICK;
        }
        v = Math.max(1, Math.min(v, 200));
        cachedMaxPerHour = v;
        return v;
    }

    public int saveMaxPostsPerHourPerNick(int value) {
        int v = Math.max(1, Math.min(value, 200));
        write(KEY_MAX_PER_HOUR, String.valueOf(v));
        cachedMaxPerHour = v;
        log.info("🕘 Đã lưu giới hạn {} bài/giờ/nick", v);
        return v;
    }

    private String read(String key, String fallback) {
        return repository.findById(key).map(AppSetting::getValue).filter(v -> !v.isBlank()).orElse(fallback);
    }

    private void write(String key, String value) {
        repository.save(new AppSetting(key, value));
    }
}
