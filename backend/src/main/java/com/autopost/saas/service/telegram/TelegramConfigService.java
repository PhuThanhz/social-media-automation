package com.autopost.saas.service.telegram;

import com.autopost.saas.entity.AppSetting;
import com.autopost.saas.repository.AppSettingRepository;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Cấu hình bot Telegram lưu trong app_settings (khoá "tgbot.*").
 * SettingController chặn đọc/ghi các khoá này qua /api/settings để token không bị lộ.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class TelegramConfigService {

    /** "tgbot." chứ không phải "telegram.": app_settings đã có sẵn khoá telegram.* cũ (27/10, nguồn khác ghi) — không dùng chung. */
    public static final String PREFIX = "tgbot.";
    /** Cấu hình Telegram cũ có sẵn trong app_settings — chỉ đọc để gợi ý "dùng lại bot này". */
    static final String LEGACY_TOKEN = "telegram.bot_token";
    static final String KEY_ENABLED = PREFIX + "enabled";
    static final String KEY_TOKEN = PREFIX + "bot_token";
    static final String KEY_USERNAME = PREFIX + "bot_username";
    static final String KEY_CHATS = PREFIX + "allowed_chats";
    static final String KEY_PAIR_CODE = PREFIX + "pair_code";
    static final String KEY_PAIR_EXPIRES = PREFIX + "pair_expires_at";
    static final String KEY_LAST_UPDATE = PREFIX + "last_update_id";
    static final String KEY_DEFAULT_TARGET = PREFIX + "default_target";
    static final String KEY_WATCH = PREFIX + "watched_posts";
    static final String KEY_DEFAULT_PAGES = PREFIX + "default_pages";

    private static final SecureRandom RANDOM = new SecureRandom();
    private static final ObjectMapper JSON = new ObjectMapper();

    private final AppSettingRepository repository;

    public record ChatEntry(long id, String name) {
    }

    /** Bài tạo từ bot: báo lại vào chatId khi bài PUBLISHED/FAILED. */
    public record WatchEntry(long chatId, long createdAtMs) {
    }

    // ---- primitive ----
    String read(String key) {
        return repository.findById(key).map(AppSetting::getValue).filter(v -> !v.isBlank()).orElse(null);
    }

    void write(String key, String value) {
        if (value == null) {
            repository.deleteById(key);
            return;
        }
        repository.save(new AppSetting(key, value));
    }

    // ---- token / enabled ----
    public boolean isEnabled() {
        return "true".equalsIgnoreCase(read(KEY_ENABLED));
    }

    public void setEnabled(boolean enabled) {
        write(KEY_ENABLED, String.valueOf(enabled));
    }

    public String token() {
        return read(KEY_TOKEN);
    }

    /** Đổi token: xoá mốc update cũ (thuộc bot khác) để không nhảy cóc / xử lý lại tin. */
    public void setToken(String token, String username) {
        write(KEY_TOKEN, token);
        write(KEY_USERNAME, username);
        write(KEY_LAST_UPDATE, null);
    }

    /** Token bot cũ (khoá telegram.bot_token) nếu có — để UI đề nghị dùng lại. */
    public String legacyToken() {
        return read(LEGACY_TOKEN);
    }

    public String botUsername() {
        return read(KEY_USERNAME);
    }

    public static String maskToken(String token) {
        if (token == null || token.isBlank()) return "";
        int colon = token.indexOf(':');
        String head = colon > 0 ? token.substring(0, colon) : token.substring(0, Math.min(4, token.length()));
        return head + ":***";
    }

    // ---- update offset ----
    public Long lastUpdateId() {
        String v = read(KEY_LAST_UPDATE);
        try {
            return v == null ? null : Long.valueOf(v);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    public void setLastUpdateId(long id) {
        write(KEY_LAST_UPDATE, String.valueOf(id));
    }

    // ---- allowed chats ----
    public synchronized List<ChatEntry> chats() {
        String v = read(KEY_CHATS);
        if (v == null) return new ArrayList<>();
        try {
            return JSON.readValue(v, new TypeReference<List<ChatEntry>>() {
            });
        } catch (Exception e) {
            log.warn("[Telegram] allowed_chats hỏng, bỏ qua: {}", e.getMessage());
            return new ArrayList<>();
        }
    }

    public boolean isAllowed(long chatId) {
        return chats().stream().anyMatch(c -> c.id() == chatId);
    }

    public synchronized void addChat(long chatId, String name) {
        List<ChatEntry> list = chats();
        list.removeIf(c -> c.id() == chatId);
        list.add(new ChatEntry(chatId, name));
        writeJson(KEY_CHATS, list);
    }

    public synchronized boolean removeChat(long chatId) {
        List<ChatEntry> list = chats();
        boolean removed = list.removeIf(c -> c.id() == chatId);
        writeJson(KEY_CHATS, list);
        return removed;
    }

    // ---- pairing ----
    public synchronized String newPairCode() {
        String code = String.format("%06d", RANDOM.nextInt(1_000_000));
        write(KEY_PAIR_CODE, code);
        write(KEY_PAIR_EXPIRES, LocalDateTime.now().plusMinutes(10).toString());
        return code;
    }

    public String pairCode() {
        LocalDateTime exp = pairExpiresAt();
        if (exp == null || exp.isBefore(LocalDateTime.now())) return null;
        return read(KEY_PAIR_CODE);
    }

    public LocalDateTime pairExpiresAt() {
        String v = read(KEY_PAIR_EXPIRES);
        try {
            return v == null ? null : LocalDateTime.parse(v);
        } catch (Exception e) {
            return null;
        }
    }

    /** Dùng 1 lần: đúng mã còn hạn → xoá mã và trả true. */
    public synchronized boolean consumePairCode(String code) {
        String current = pairCode();
        if (current == null || code == null || !java.security.MessageDigest.isEqual(
                current.getBytes(java.nio.charset.StandardCharsets.UTF_8),
                code.trim().getBytes(java.nio.charset.StandardCharsets.UTF_8))) {
            return false;
        }
        write(KEY_PAIR_CODE, null);
        write(KEY_PAIR_EXPIRES, null);
        return true;
    }

    public synchronized void clearPairCode() {
        write(KEY_PAIR_CODE, null);
        write(KEY_PAIR_EXPIRES, null);
    }

    // ---- default target ----
    public String defaultTarget() {
        return read(KEY_DEFAULT_TARGET);
    }

    public void setDefaultTarget(String target) {
        write(KEY_DEFAULT_TARGET, target);
    }

    /** Các Trang chọn lần trước (id kết nối) — bài nháp mới chọn sẵn. */
    public List<Long> defaultPages() {
        String v = read(KEY_DEFAULT_PAGES);
        List<Long> out = new ArrayList<>();
        if (v == null) return out;
        for (String s : v.split(",")) {
            try {
                out.add(Long.valueOf(s.trim()));
            } catch (NumberFormatException ignored) {
                // bỏ giá trị hỏng
            }
        }
        return out;
    }

    public void setDefaultPages(List<Long> ids) {
        write(KEY_DEFAULT_PAGES, ids == null || ids.isEmpty() ? null
                : ids.stream().map(String::valueOf).reduce((a, b) -> a + "," + b).orElse(null));
    }

    // ---- watched posts ----
    public synchronized Map<Long, WatchEntry> watched() {
        String v = read(KEY_WATCH);
        if (v == null) return new LinkedHashMap<>();
        try {
            return JSON.readValue(v, new TypeReference<LinkedHashMap<Long, WatchEntry>>() {
            });
        } catch (Exception e) {
            return new LinkedHashMap<>();
        }
    }

    public synchronized void watch(List<Long> postIds, long chatId) {
        if (postIds == null || postIds.isEmpty()) return;
        Map<Long, WatchEntry> map = watched();
        long now = System.currentTimeMillis();
        postIds.forEach(id -> map.put(id, new WatchEntry(chatId, now)));
        writeJson(KEY_WATCH, map);
    }

    public synchronized void unwatch(List<Long> postIds) {
        if (postIds == null || postIds.isEmpty()) return;
        Map<Long, WatchEntry> map = watched();
        postIds.forEach(map::remove);
        writeJson(KEY_WATCH, map);
    }

    private void writeJson(String key, Object value) {
        try {
            write(key, JSON.writeValueAsString(value));
        } catch (Exception e) {
            throw new IllegalStateException("Không ghi được " + key, e);
        }
    }
}
