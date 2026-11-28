package com.autopost.saas.controller;

import com.autopost.saas.service.telegram.TelegramApi;
import com.autopost.saas.service.telegram.TelegramBotService;
import com.autopost.saas.service.telegram.TelegramConfigService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Map;

/** Cấu hình bot Telegram cho card "Telegram bot" ở trang Kết nối. Token không bao giờ trả nguyên về client. */
@RestController
@RequestMapping("/api/telegram")
@RequiredArgsConstructor
@CrossOrigin(originPatterns = "*")
public class TelegramController {

    private final TelegramConfigService config;
    private final TelegramApi api;
    private final TelegramBotService bot;

    @GetMapping("/config")
    public ResponseEntity<Map<String, Object>> getConfig() {
        return ResponseEntity.ok(view());
    }

    /** Body: {botToken?: string, enabled?: boolean}. Token mới được kiểm tra bằng getMe trước khi lưu. */
    @PutMapping("/config")
    public ResponseEntity<Map<String, Object>> saveConfig(@RequestBody Map<String, Object> body) {
        Object rawToken = body.get("botToken");
        if (rawToken instanceof String t && !t.isBlank()) {
            String token = t.trim();
            if (!token.matches("\\d{5,}:[A-Za-z0-9_-]{30,}")) {
                return ResponseEntity.badRequest().body(Map.of("success", false, "message", "Token không đúng dạng 123456789:ABC... (lấy từ @BotFather)"));
            }
            try {
                Map<String, Object> me = api.getMe(token);
                config.setToken(token, me.get("username") != null ? String.valueOf(me.get("username")) : null);
                if (body.get("enabled") == null) config.setEnabled(true);
            } catch (TelegramApi.TelegramException e) {
                return ResponseEntity.badRequest().body(Map.of("success", false, "message", "Telegram không nhận token này: " + e.getMessage()));
            }
        }
        if (body.get("enabled") != null) {
            boolean enabled = Boolean.TRUE.equals(body.get("enabled")) || "true".equalsIgnoreCase(String.valueOf(body.get("enabled")));
            if (enabled && config.token() == null) {
                return ResponseEntity.badRequest().body(Map.of("success", false, "message", "Nhập bot token trước khi bật"));
            }
            config.setEnabled(enabled);
        }
        Map<String, Object> res = view();
        res.put("success", true);
        return ResponseEntity.ok(res);
    }

    /** Dùng lại bot đã cấu hình trước đây (khoá telegram.bot_token cũ) — kiểm tra bằng getMe rồi lưu như token mới. */
    @PostMapping("/config/use-legacy")
    public ResponseEntity<Map<String, Object>> useLegacy() {
        String legacy = config.legacyToken();
        if (legacy == null) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", "Không có bot cũ"));
        }
        return saveConfig(Map.of("botToken", legacy));
    }

    /** Xoá token + tắt bot (giữ danh sách chat để lần sau ghép lại khỏi phải làm lại). */
    @DeleteMapping("/config/token")
    public ResponseEntity<Map<String, Object>> clearToken() {
        config.setEnabled(false);
        config.setToken(null, null);
        Map<String, Object> res = view();
        res.put("success", true);
        return ResponseEntity.ok(res);
    }

    @PostMapping("/pair-code")
    public ResponseEntity<Map<String, Object>> newPairCode() {
        if (config.token() == null) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", "Nhập bot token trước"));
        }
        config.newPairCode();
        Map<String, Object> res = view();
        res.put("success", true);
        return ResponseEntity.ok(res);
    }

    @PostMapping("/test")
    public ResponseEntity<Map<String, Object>> test() {
        if (config.token() == null || config.chats().isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", "Cần token và ít nhất 1 chat đã ghép nối"));
        }
        int sent = bot.sendTest();
        return ResponseEntity.ok(Map.of("success", sent > 0, "sent", sent,
                "message", sent > 0 ? "Đã gửi tin thử tới " + sent + " chat" : "Không gửi được — xem lỗi trong log backend"));
    }

    @DeleteMapping("/chats/{chatId}")
    public ResponseEntity<Map<String, Object>> removeChat(@PathVariable long chatId) {
        config.removeChat(chatId);
        Map<String, Object> res = view();
        res.put("success", true);
        return ResponseEntity.ok(res);
    }

    private volatile String legacyUsernameCache;
    private volatile String legacyUsernameFor;

    /** Tên @bot của token cũ (gọi getMe 1 lần rồi nhớ); lỗi thì trả "" để UI vẫn hiện nút. */
    private String legacyUsername() {
        String legacy = config.legacyToken();
        if (legacy == null) return null;
        if (legacy.equals(legacyUsernameFor)) return legacyUsernameCache;
        String name;
        try {
            Object u = api.getMe(legacy).get("username");
            name = u != null ? String.valueOf(u) : "";
        } catch (TelegramApi.TelegramException e) {
            name = "";
        }
        legacyUsernameFor = legacy;
        legacyUsernameCache = name;
        return name;
    }

    private Map<String, Object> view() {
        Map<String, Object> m = new LinkedHashMap<>();
        String token = config.token();
        m.put("enabled", config.isEnabled());
        m.put("hasToken", token != null);
        m.put("tokenMasked", TelegramConfigService.maskToken(token));
        m.put("botUsername", config.botUsername());
        String legacy = token == null ? config.legacyToken() : null;
        m.put("legacyBotUsername", legacy != null ? legacyUsername() : null);
        m.put("chats", config.chats());
        String code = config.pairCode();
        LocalDateTime exp = config.pairExpiresAt();
        m.put("pairCode", code);
        m.put("pairExpiresAt", code != null && exp != null ? exp.toString() : null);
        m.putAll(bot.status());
        return m;
    }
}
