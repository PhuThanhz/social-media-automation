package com.autopost.saas.controller;

import com.autopost.saas.entity.AppSetting;
import com.autopost.saas.repository.AppSettingRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * Lưu trữ và đồng bộ vĩnh viễn các cài đặt cá nhân, Preset Combo cấu hình vào Database (PostgreSQL / SQLite).
 * Giúp người dùng không bao giờ bị mất cấu hình khi xoá cache trình duyệt hoặc đổi thiết bị.
 */
@RestController
@RequestMapping("/api/settings")
@RequiredArgsConstructor
@CrossOrigin(originPatterns = "*")
public class SettingController {

    private final AppSettingRepository appSettingRepository;

    /** Khoá bí mật của bot Telegram (tgbot.*) chỉ đọc/ghi qua TelegramController, không qua endpoint chung này. */
    static boolean isProtected(String key) {
        return key != null && key.toLowerCase().startsWith(com.autopost.saas.service.telegram.TelegramConfigService.PREFIX);
    }

    @GetMapping("/{key}")
    public ResponseEntity<Map<String, Object>> getSetting(@PathVariable String key) {
        if (isProtected(key)) {
            return ResponseEntity.status(403).body(Map.of("success", false, "message", "Khoá này không đọc được qua /api/settings"));
        }
        String val = appSettingRepository.findById(key).map(AppSetting::getValue).orElse(null);
        return ResponseEntity.ok(Map.of("success", true, "value", val != null ? val : ""));
    }

    @PostMapping("/{key}")
    public ResponseEntity<Map<String, Object>> saveSetting(@PathVariable String key, @RequestBody Map<String, Object> body) {
        if (isProtected(key)) {
            return ResponseEntity.status(403).body(Map.of("success", false, "message", "Khoá này không ghi được qua /api/settings"));
        }
        Object val = body.get("value");
        String strVal = val instanceof String ? (String) val : (val != null ? val.toString() : "");
        appSettingRepository.save(new AppSetting(key, strVal));
        return ResponseEntity.ok(Map.of("success", true));
    }
}
