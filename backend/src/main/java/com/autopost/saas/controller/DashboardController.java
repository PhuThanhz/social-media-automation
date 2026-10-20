package com.autopost.saas.controller;

import com.autopost.saas.entity.User;
import com.autopost.saas.repository.PostQueueRepository;
import com.autopost.saas.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.Map;

@RestController
@RequestMapping("/api/dashboard")
@RequiredArgsConstructor
@CrossOrigin(originPatterns = "*")
public class DashboardController {

    private final UserRepository userRepository;
    private final PostQueueRepository postQueueRepository;

    private User resolveUser(Authentication authentication) {
        if (authentication != null && authentication.getName() != null) {
            return userRepository.findByEmail(authentication.getName())
                    .orElseGet(() -> userRepository.findFirstByOrderByIdAsc().orElseThrow());
        }
        return userRepository.findByEmail("admin@gmail.com")
                .orElseGet(() -> userRepository.findFirstByOrderByIdAsc().orElseThrow());
    }

    /** KPI số bài cần đăng trong ngày — mục tiêu người dùng tự đặt + số đã đăng thành công tính đến hiện tại. */
    @GetMapping("/daily-kpi")
    public ResponseEntity<Map<String, Object>> getDailyKpi(Authentication authentication) {
        User user = resolveUser(authentication);
        LocalDateTime startOfDay = LocalDateTime.now().toLocalDate().atStartOfDay();
        long publishedToday = postQueueRepository.countPublishedTodayByUserId(user.getId(), startOfDay);
        Integer target = user.getDailyPostTarget();
        return ResponseEntity.ok(Map.of(
                "target", target != null ? target : 0,
                "hasTarget", target != null,
                "publishedToday", publishedToday,
                "remaining", target != null ? Math.max(0, target - publishedToday) : 0,
                "achieved", target != null && publishedToday >= target
        ));
    }

    /** Đặt/sửa mục tiêu KPI số bài/ngày — gửi target=0 hoặc null để bỏ mục tiêu. */
    @PutMapping("/daily-kpi")
    public ResponseEntity<Map<String, Object>> updateDailyKpi(@RequestBody Map<String, Object> body, Authentication authentication) {
        User user = resolveUser(authentication);
        Object rawTarget = body.get("target");
        Integer target = null;
        if (rawTarget != null) {
            int parsed = Integer.parseInt(rawTarget.toString());
            target = parsed > 0 ? parsed : null;
        }
        user.setDailyPostTarget(target);
        userRepository.save(user);
        return ResponseEntity.ok(Map.of("success", true, "target", target != null ? target : 0));
    }
}
