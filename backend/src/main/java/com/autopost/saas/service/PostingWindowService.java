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

    private final AppSettingRepository repository;
    private volatile PostingWindow cached;

    public PostingWindow get() {
        PostingWindow w = cached;
        if (w != null) return w;
        try {
            boolean enabled = "true".equalsIgnoreCase(read(KEY_ENABLED, "false"));
            LocalTime start = LocalTime.parse(read(KEY_START, "09:00"));
            LocalTime end = LocalTime.parse(read(KEY_END, "23:00"));
            long minGap = Long.parseLong(read(KEY_MIN_GAP, "120"));
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

    private String read(String key, String fallback) {
        return repository.findById(key).map(AppSetting::getValue).filter(v -> !v.isBlank()).orElse(fallback);
    }

    private void write(String key, String value) {
        repository.save(new AppSetting(key, value));
    }
}
