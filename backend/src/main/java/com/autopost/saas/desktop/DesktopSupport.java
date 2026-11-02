package com.autopost.saas.desktop;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Chỉ bật ở bản Desktop (desktop.mode=true).
 * - Worker trước đây đọc thẳng MySQL; bản Desktop dùng H2 trong backend nên Worker gọi endpoint này thay thế.
 * - Tự thoát khi app Tauri cha đã tắt (kể cả bị force quit) để không giữ cổng và chạy ngầm.
 */
@RestController
@RequestMapping("/api/internal")
@ConditionalOnProperty(name = "desktop.mode", havingValue = "true")
@RequiredArgsConstructor
@Slf4j
public class DesktopSupport {

    // Worker chỉ cần đọc/cập nhật trạng thái tài khoản; không cho phép câu lệnh khác
    private static final Pattern ALLOWED_SQL = Pattern.compile(
            "^\\s*(SELECT\\s[^;]*\\sFROM\\s+social_accounts\\b[^;]*|UPDATE\\s+social_accounts\\s+SET\\s[^;]*)$",
            Pattern.CASE_INSENSITIVE | Pattern.DOTALL);

    private final JdbcTemplate jdbcTemplate;

    @PostMapping("/worker-sql")
    public ResponseEntity<?> workerSql(@RequestBody Map<String, Object> body) {
        String sql = String.valueOf(body.getOrDefault("sql", ""));
        Object rawParams = body.get("params");
        Object[] params = rawParams instanceof List<?> list ? list.toArray() : new Object[0];
        if (!ALLOWED_SQL.matcher(sql).matches()) {
            return ResponseEntity.badRequest().body(Map.of("error", "SQL_NOT_ALLOWED"));
        }
        if (sql.trim().regionMatches(true, 0, "SELECT", 0, 6)) {
            return ResponseEntity.ok(Map.of("rows", jdbcTemplate.queryForList(sql, params)));
        }
        return ResponseEntity.ok(Map.of("affectedRows", jdbcTemplate.update(sql, params)));
    }

    @Scheduled(fixedDelay = 5000, initialDelay = 5000)
    public void exitWhenParentGone() {
        String parent = System.getenv("PARENT_PID");
        if (parent == null || parent.isBlank()) return;
        boolean alive = ProcessHandle.of(Long.parseLong(parent.trim())).map(ProcessHandle::isAlive).orElse(false);
        if (!alive) {
            log.warn("App Desktop đã tắt (PARENT_PID={}), backend tự thoát", parent);
            // Không gọi System.exit trong chính luồng @Scheduled: Spring tắt sẽ chờ task này xong → treo.
            // Thoát ở luồng riêng, quá 15s vẫn chưa xong thì halt hẳn.
            Thread exit = new Thread(() -> System.exit(0), "desktop-exit");
            exit.setDaemon(false);
            exit.start();
            Thread halt = new Thread(() -> {
                try { Thread.sleep(15_000); } catch (InterruptedException ignored) { }
                Runtime.getRuntime().halt(0);
            }, "desktop-exit-halt");
            halt.setDaemon(true);
            halt.start();
        }
    }
}
