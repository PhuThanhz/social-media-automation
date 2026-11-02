package com.autopost.saas.controller;

import com.autopost.saas.dto.PostQueueDto;
import com.autopost.saas.entity.PostQueue;
import com.autopost.saas.entity.SocialAccount;
import com.autopost.saas.entity.User;
import com.autopost.saas.publishing.model.PreflightResult;
import com.autopost.saas.publishing.service.PublishingPreflightService;
import com.autopost.saas.repository.PostQueueRepository;
import com.autopost.saas.repository.SocialAccountRepository;
import com.autopost.saas.repository.UserRepository;
import com.autopost.saas.service.PublishingControlCenterService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.*;

/**
 * REST Controller cho Publishing Control Center (Trung tâm điều hành xuất bản) — TOOLZUTTER 3.2.
 * Cung cấp API trực tiếp cho Cockpit Dashboard, kiểm soát hàng đợi 1,000+ bài, xử lý sự cố và Preflight Check.
 */
@RestController
@RequestMapping("/api/publishing-control-center")
@RequiredArgsConstructor
@Slf4j
@CrossOrigin(originPatterns = "*")
public class PublishingControlCenterController {

    private final PublishingControlCenterService controlCenterService;
    private final PublishingPreflightService preflightService;
    private final UserRepository userRepository;
    private final PostQueueRepository postQueueRepository;
    private final SocialAccountRepository socialAccountRepository;

    private User resolveUser(Authentication authentication) {
        if (authentication != null && authentication.getName() != null) {
            return userRepository.findByEmail(authentication.getName())
                    .orElseGet(() -> userRepository.findFirstByOrderByIdAsc().orElseThrow());
        }
        return userRepository.findByEmail("admin@gmail.com")
                .orElseGet(() -> userRepository.findFirstByOrderByIdAsc().orElseThrow());
    }

    /**
     * GET /api/publishing-control-center/overview
     * Trả về toàn bộ bức tranh điều hành: thống kê hàng đợi, sức khỏe 3 worker nodes,
     * các tài khoản mất kết nối, bài đăng cần xác minh (NEEDS_REVIEW) và chiến dịch chậm.
     */
    @GetMapping("/overview")
    public ResponseEntity<Map<String, Object>> getOverview(Authentication authentication) {
        User user = resolveUser(authentication);
        Map<String, Object> overview = controlCenterService.getControlCenterOverview(user.getId());
        return ResponseEntity.ok(overview);
    }

    /**
     * GET /api/publishing-control-center/queue
     * Phân trang hàng đợi đăng bài (hỗ trợ scale 1,000+ bài mà không giật lag).
     */
    @GetMapping("/queue")
    public ResponseEntity<Page<PostQueueDto>> getPaginatedQueue(
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String search,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            Authentication authentication) {
        User user = resolveUser(authentication);
        Page<PostQueueDto> result = controlCenterService.getPaginatedQueue(user.getId(), status, search, page, size);
        return ResponseEntity.ok(result);
    }

    /**
     * POST /api/publishing-control-center/verify/{postId}
     * Xác minh bài viết (CONFIRM_PUBLISHED, RESET_PENDING, CANCEL).
     */
    @PostMapping("/verify/{postId}")
    public ResponseEntity<Map<String, Object>> verifyPost(
            @PathVariable Long postId,
            @RequestBody Map<String, String> body,
            Authentication authentication) {
        User user = resolveUser(authentication);
        String action = body != null ? body.get("action") : null;
        String notes = body != null ? body.get("notes") : null;

        if (action == null || action.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "Thiếu tham số 'action' (CONFIRM_PUBLISHED | RESET_PENDING | CANCEL)"));
        }

        try {
            boolean success = controlCenterService.verifyPost(postId, user.getId(), action, notes);
            return ResponseEntity.ok(Map.of(
                    "success", success,
                    "postId", postId,
                    "action", action,
                    "message", success ? "Xử lý xác minh bài viết thành công" : "Bài viết không tìm thấy hoặc xử lý thất bại"
            ));
        } catch (SecurityException se) {
            return ResponseEntity.status(403).body(Map.of("error", se.getMessage()));
        } catch (IllegalStateException | IllegalArgumentException ie) {
            return ResponseEntity.badRequest().body(Map.of("error", ie.getMessage()));
        }
    }

    /**
     * POST /api/publishing-control-center/bulk-cancel
     * Hủy hàng loạt bài đăng đang chờ hoặc lỗi.
     */
    @PostMapping("/bulk-cancel")
    public ResponseEntity<Map<String, Object>> bulkCancel(
            @RequestBody Map<String, Object> body,
            Authentication authentication) {
        User user = resolveUser(authentication);
        @SuppressWarnings("unchecked")
        List<Object> rawIds = body != null && body.get("postIds") instanceof List ? (List<Object>) body.get("postIds") : Collections.emptyList();

        List<Long> postIds = new ArrayList<>();
        for (Object item : rawIds) {
            if (item instanceof Number) {
                postIds.add(((Number) item).longValue());
            } else if (item instanceof String) {
                try {
                    postIds.add(Long.parseLong((String) item));
                } catch (NumberFormatException ignored) {}
            }
        }

        int count = controlCenterService.bulkCancelPosts(user.getId(), postIds);
        return ResponseEntity.ok(Map.of(
                "success", true,
                "cancelledCount", count,
                "totalRequested", postIds.size()
        ));
    }

    /**
     * POST /api/publishing-control-center/bulk-reschedule
     * Dời lịch hàng loạt bài đăng với khoảng cách an toàn (gapMinutes).
     */
    @PostMapping("/bulk-reschedule")
    public ResponseEntity<Map<String, Object>> bulkReschedule(
            @RequestBody Map<String, Object> body,
            Authentication authentication) {
        User user = resolveUser(authentication);
        if (body == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "Payload rỗng"));
        }

        @SuppressWarnings("unchecked")
        List<Object> rawIds = body.get("postIds") instanceof List ? (List<Object>) body.get("postIds") : Collections.emptyList();
        List<Long> postIds = new ArrayList<>();
        for (Object item : rawIds) {
            if (item instanceof Number) {
                postIds.add(((Number) item).longValue());
            } else if (item instanceof String) {
                try {
                    postIds.add(Long.parseLong((String) item));
                } catch (NumberFormatException ignored) {}
            }
        }

        LocalDateTime startAt = LocalDateTime.now().plusMinutes(5);
        if (body.get("startAt") != null) {
            try {
                startAt = LocalDateTime.parse(body.get("startAt").toString());
            } catch (Exception e) {
                log.warn("Không thể parse startAt: {}, dùng mặc định sau 5 phút.", body.get("startAt"));
            }
        }

        int gapMinutes = 15;
        if (body.get("gapMinutes") instanceof Number) {
            gapMinutes = ((Number) body.get("gapMinutes")).intValue();
        }

        int count = controlCenterService.bulkReschedulePosts(user.getId(), postIds, startAt, gapMinutes);
        return ResponseEntity.ok(Map.of(
                "success", true,
                "rescheduledCount", count,
                "startAt", startAt.toString(),
                "gapMinutes", gapMinutes
        ));
    }

    /**
     * POST /api/publishing-control-center/preflight-check/{postId}
     * Kiểm tra tính hợp lệ bài viết trước khi đăng (Preflight check).
     */
    @PostMapping("/preflight-check/{postId}")
    public ResponseEntity<?> preflightCheckPost(
            @PathVariable Long postId,
            Authentication authentication) {
        User user = resolveUser(authentication);
        try {
            PreflightResult preflight = controlCenterService.preflightCheckPost(user.getId(), postId, preflightService);
            return ResponseEntity.ok(preflight);
        } catch (NoSuchElementException e) {
            return ResponseEntity.notFound().build();
        } catch (SecurityException e) {
            return ResponseEntity.status(403).body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * GET /api/publishing-control-center/attempts/{postId}
     * Lấy nhật ký toàn bộ các lần thực thi/đối soát của bài viết (Audit trail).
     */
    @GetMapping("/attempts/{postId}")
    public ResponseEntity<?> getPostAttempts(
            @PathVariable Long postId,
            Authentication authentication) {
        User user = resolveUser(authentication);
        try {
            List<com.autopost.saas.entity.PostExecutionAttempt> attempts = controlCenterService.getExecutionAttempts(user.getId(), postId);
            return ResponseEntity.ok(attempts);
        } catch (NoSuchElementException e) {
            return ResponseEntity.notFound().build();
        } catch (SecurityException e) {
            return ResponseEntity.status(403).body(Map.of("error", e.getMessage()));
        }
    }
}

