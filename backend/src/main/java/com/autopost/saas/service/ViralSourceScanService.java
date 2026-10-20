package com.autopost.saas.service;

import com.autopost.saas.controller.VideoToolController;
import com.autopost.saas.entity.AppSetting;
import com.autopost.saas.entity.ViralInboxItem;
import com.autopost.saas.entity.ViralSource;
import com.autopost.saas.repository.AppSettingRepository;
import com.autopost.saas.repository.ViralInboxItemRepository;
import com.autopost.saas.repository.ViralSourceRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Quét tự động toàn bộ Kho Nguồn của trang Săn bài Viral: lần lượt cào từng Fanpage/Group (dùng lại
 * endpoint hunt-facebook-group để có sẵn chọn cookie + lọc bài đã đăng), bài mới chưa đăng và chưa có
 * trong hộp thì lưu vào viral_inbox_items (trạng thái NEW) chờ người dùng duyệt — KHÔNG tự đưa vào Hàng đợi.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ViralSourceScanService {

    public static final String KEY_ENABLED = "viral_auto_scan_enabled";
    public static final String KEY_INTERVAL_HOURS = "viral_auto_scan_interval_hours";
    public static final String KEY_LAST_RUN = "viral_auto_scan_last_run";
    private static final int DEFAULT_INTERVAL_HOURS = 3;
    private static final int SCAN_LIMIT_PER_SOURCE = 20;
    // Nghỉ giữa 2 nguồn để không mở trình duyệt liên tục vào Facebook
    private static final long PAUSE_BETWEEN_SOURCES_MS = 20_000;

    private final ViralSourceRepository sourceRepository;
    private final ViralInboxItemRepository inboxRepository;
    private final AppSettingRepository appSettingRepository;
    private final VideoToolController videoToolController;
    private final RedditService redditService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    private final ExecutorService scanExecutor = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "viral-source-scan");
        t.setDaemon(true);
        return t;
    });
    private final AtomicBoolean running = new AtomicBoolean(false);
    private volatile String currentSourceName;

    // ── Cài đặt ──
    public boolean isEnabled() {
        return "true".equals(getSetting(KEY_ENABLED, "false"));
    }

    public int getIntervalHours() {
        try {
            return Math.max(1, Integer.parseInt(getSetting(KEY_INTERVAL_HOURS, String.valueOf(DEFAULT_INTERVAL_HOURS))));
        } catch (NumberFormatException e) {
            return DEFAULT_INTERVAL_HOURS;
        }
    }

    public LocalDateTime getLastRunAt() {
        String v = getSetting(KEY_LAST_RUN, null);
        try {
            return v == null ? null : LocalDateTime.parse(v);
        } catch (Exception e) {
            return null;
        }
    }

    public LocalDateTime getNextRunAt() {
        if (!isEnabled()) return null;
        LocalDateTime last = getLastRunAt();
        return last == null ? LocalDateTime.now() : last.plusHours(getIntervalHours());
    }

    public void updateSettings(Boolean enabled, Integer intervalHours) {
        if (enabled != null) {
            boolean wasEnabled = isEnabled();
            saveSetting(KEY_ENABLED, String.valueOf(enabled));
            // Vừa bật: đếm lại từ bây giờ, lần quét đầu sau đúng 1 chu kỳ (muốn quét liền thì bấm "Quét tất cả ngay")
            if (enabled && !wasEnabled) saveSetting(KEY_LAST_RUN, LocalDateTime.now().toString());
        }
        if (intervalHours != null && intervalHours >= 1) saveSetting(KEY_INTERVAL_HOURS, String.valueOf(intervalHours));
    }

    public Map<String, Object> getStatus() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("enabled", isEnabled());
        m.put("intervalHours", getIntervalHours());
        m.put("lastRunAt", fmt(getLastRunAt()));
        m.put("nextRunAt", fmt(getNextRunAt()));
        m.put("running", running.get());
        m.put("currentSource", running.get() ? currentSourceName : null);
        m.put("newCount", inboxRepository.countByStatus("NEW"));
        return m;
    }

    /** Gọi từ scheduler: tới hẹn thì quét. */
    public void runIfDue() {
        if (!isEnabled() || running.get()) return;
        LocalDateTime next = getNextRunAt();
        if (next != null && !LocalDateTime.now().isBefore(next)) {
            startScanAll("định kỳ");
        }
    }

    /** Chạy quét toàn bộ nguồn bật autoScan ở luồng riêng. Trả false nếu đang có lượt quét khác chạy. */
    public boolean startScanAll(String reason) {
        if (!running.compareAndSet(false, true)) return false;
        saveSetting(KEY_LAST_RUN, LocalDateTime.now().toString());
        scanExecutor.submit(() -> {
            try {
                List<ViralSource> sources = sourceRepository.findByAutoScanTrue();
                log.info("[ViralScan] Bắt đầu quét {} nguồn ({})", sources.size(), reason);
                int totalNew = 0;
                for (int i = 0; i < sources.size(); i++) {
                    totalNew += scanOne(sources.get(i));
                    if (i < sources.size() - 1) Thread.sleep(PAUSE_BETWEEN_SOURCES_MS);
                }
                int pruned = inboxRepository.deleteOlderThan(LocalDateTime.now().minusDays(14));
                log.info("[ViralScan] Xong: {} bài mới vào hộp duyệt{}", totalNew, pruned > 0 ? ", dọn " + pruned + " bài cũ >14 ngày" : "");
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
            } catch (Exception e) {
                log.error("[ViralScan] Lỗi lượt quét: {}", e.getMessage(), e);
            } finally {
                currentSourceName = null;
                running.set(false);
            }
        });
        return true;
    }

    @SuppressWarnings("unchecked")
    /** Quét ngay 1 nguồn (nút "Cào ngay" của nguồn Reddit); trả số bài mới, -1 nếu đang có lượt quét khác. */
    public int scanSourceNow(ViralSource source) {
        if (!running.compareAndSet(false, true)) return -1;
        try {
            return scanOne(source);
        } finally {
            running.set(false);
            currentSourceName = null;
        }
    }

    private int scanOne(ViralSource source) {
        currentSourceName = source.getName();
        int added = 0;
        try {
            List<Map<String, Object>> items;
            if ("REDDIT".equals(source.getType())) {
                items = redditService.fetchPosts(source.getUrl(), SCAN_LIMIT_PER_SOURCE);
            } else {
                Map<String, Object> req = new HashMap<>();
                req.put("groupUrl", source.getUrl());
                req.put("limit", SCAN_LIMIT_PER_SOURCE);
                req.put("sortViral", true);
                req.put("minReactions", 0);
                ResponseEntity<Map<String, Object>> resp = videoToolController.huntFacebookGroup(req);
                Map<String, Object> body = resp.getBody();
                if (body == null || !Boolean.TRUE.equals(body.get("success"))) {
                    String err = body != null && body.get("error") != null ? body.get("error").toString() : "Worker không phản hồi";
                    markSource(source, "ERROR", err, 0);
                    log.warn("[ViralScan] {} lỗi: {}", source.getName(), err);
                    return 0;
                }
                items = body.get("items") instanceof List<?> l ? (List<Map<String, Object>>) l : List.of();
            }
            List<Map<String, Object>> fresh = new ArrayList<>();
            for (Map<String, Object> it : items) {
                Object url = it.get("url");
                if (url == null || url.toString().isBlank() || Boolean.TRUE.equals(it.get("isAlreadyImported"))) continue;
                fresh.add(it);
            }
            Set<String> urls = new HashSet<>();
            fresh.forEach(it -> urls.add(it.get("url").toString()));
            Set<String> existing = urls.isEmpty() ? Set.of() : inboxRepository.findExistingUrls(urls);
            for (Map<String, Object> it : fresh) {
                String url = it.get("url").toString();
                if (existing.contains(url) || url.length() > 700) continue;
                Map<String, Object> payload = new HashMap<>(it);
                payload.put("sourceGroup", source.getName());
                inboxRepository.save(ViralInboxItem.builder()
                        .sourceId(source.getId())
                        .sourceName(source.getName())
                        .postUrl(url)
                        .payload(objectMapper.writeValueAsString(payload))
                        .viralScore(it.get("viralScore") instanceof Number n ? n.intValue() : 0)
                        .status("NEW")
                        .build());
                existing = new HashSet<>(existing);
                existing.add(url);
                added++;
            }
            markSource(source, "OK", null, added);
            log.info("[ViralScan] {}: quét {} bài, {} bài mới", source.getName(), items.size(), added);
        } catch (Exception e) {
            markSource(source, "ERROR", e.getMessage(), added);
            log.warn("[ViralScan] {} lỗi: {}", source.getName(), e.getMessage());
        }
        return added;
    }

    private void markSource(ViralSource source, String status, String error, int newCount) {
        sourceRepository.findById(source.getId()).ifPresent(s -> {
            s.setLastScannedAt(LocalDateTime.now());
            s.setLastScanStatus(status);
            s.setLastScanError(error != null && error.length() > 1000 ? error.substring(0, 1000) : error);
            s.setLastNewCount(newCount);
            sourceRepository.save(s);
        });
    }

    private String getSetting(String key, String def) {
        return appSettingRepository.findById(key).map(AppSetting::getValue).orElse(def);
    }

    private void saveSetting(String key, String value) {
        appSettingRepository.save(new AppSetting(key, value));
    }

    private static String fmt(LocalDateTime t) {
        return t == null ? null : t.format(DateTimeFormatter.ISO_LOCAL_DATE_TIME);
    }
}
