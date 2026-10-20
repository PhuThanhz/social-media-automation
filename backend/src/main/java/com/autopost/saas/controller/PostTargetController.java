package com.autopost.saas.controller;

import com.autopost.saas.entity.PostTarget;
import com.autopost.saas.entity.User;
import com.autopost.saas.repository.UserRepository;
import com.autopost.saas.service.PostTargetService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.Map;

/** KPI đăng bài theo ngày cho từng Fanpage/Group riêng biệt — đặt mục tiêu trước + theo dõi tiến độ thực tế. */
@RestController
@RequestMapping("/api/post-targets")
@RequiredArgsConstructor
@CrossOrigin(originPatterns = "*")
public class PostTargetController {

    private final PostTargetService postTargetService;
    private final UserRepository userRepository;

    private User resolveUser(Authentication authentication) {
        if (authentication != null && authentication.getName() != null) {
            return userRepository.findByEmail(authentication.getName())
                    .orElseGet(() -> userRepository.findFirstByOrderByIdAsc().orElseThrow());
        }
        return userRepository.findByEmail("admin@gmail.com")
                .orElseGet(() -> userRepository.findFirstByOrderByIdAsc().orElseThrow());
    }

    /** Lấy danh sách KPI + tiến độ thực tế trong khoảng ngày (YYYY-MM-DD) để vẽ trên Lịch đăng bài. */
    @GetMapping
    public ResponseEntity<Map<String, Object>> getSummary(
            @RequestParam String from, @RequestParam String to, Authentication authentication) {
        try {
            User user = resolveUser(authentication);
            LocalDate fromDate = LocalDate.parse(from);
            LocalDate toDate = LocalDate.parse(to);
            return ResponseEntity.ok(Map.of("success", true, "items", postTargetService.getSummary(user.getId(), fromDate, toDate)));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", "from/to không đúng định dạng (YYYY-MM-DD)"));
        }
    }

    /** Đặt/sửa KPI cho 1 Fanpage/Group vào 1 ngày cụ thể — gửi targetCount=0 hoặc null để bỏ mục tiêu. */
    @PutMapping
    public ResponseEntity<Map<String, Object>> upsertTarget(@RequestBody Map<String, Object> body, Authentication authentication) {
        User user = resolveUser(authentication);
        try {
            Long socialAccountId = Long.valueOf(body.get("socialAccountId").toString());
            LocalDate date = LocalDate.parse(body.get("date").toString());
            Object rawTarget = body.get("targetCount");
            Integer targetCount = rawTarget != null ? Integer.parseInt(rawTarget.toString()) : null;
            PostTarget saved = postTargetService.upsertTarget(user.getId(), socialAccountId, date, targetCount);
            return ResponseEntity.ok(Map.of("success", true, "item", saved != null ? Map.of(
                    "targetId", saved.getId(),
                    "socialAccountId", saved.getSocialAccount().getId(),
                    "date", saved.getTargetDate().toString(),
                    "targetCount", saved.getTargetCount()
            ) : Map.of()));
        } catch (SecurityException se) {
            return ResponseEntity.status(403).body(Map.of("success", false, "message", se.getMessage()));
        } catch (IllegalArgumentException ie) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", ie.getMessage()));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", "Dữ liệu không hợp lệ: " + e.getMessage()));
        }
    }

    /** Xoá KPI của 1 ngày (theo id bản ghi PostTarget trả về từ GET). */
    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String, Object>> deleteTarget(@PathVariable Long id, Authentication authentication) {
        User user = resolveUser(authentication);
        try {
            postTargetService.deleteTarget(user.getId(), id);
            return ResponseEntity.ok(Map.of("success", true));
        } catch (SecurityException se) {
            return ResponseEntity.status(403).body(Map.of("success", false, "message", se.getMessage()));
        } catch (IllegalArgumentException ie) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", ie.getMessage()));
        }
    }
}

