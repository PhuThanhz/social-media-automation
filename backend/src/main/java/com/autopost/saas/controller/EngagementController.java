package com.autopost.saas.controller;

import com.autopost.saas.entity.User;
import com.autopost.saas.repository.UserRepository;
import com.autopost.saas.service.EngagementService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/engagement")
@RequiredArgsConstructor
@CrossOrigin(originPatterns = "*")
public class EngagementController {

    private final EngagementService engagementService;
    private final UserRepository userRepository;

    private User resolveUser(Authentication authentication) {
        if (authentication != null && authentication.getName() != null) {
            return userRepository.findByEmail(authentication.getName())
                    .orElseGet(() -> userRepository.findFirstByOrderByIdAsc().orElseThrow());
        }
        return userRepository.findByEmail("admin@gmail.com")
                .orElseGet(() -> userRepository.findFirstByOrderByIdAsc().orElseThrow());
    }

    @PostMapping("/buff-like")
    public ResponseEntity<Map<String, Object>> buffLike(
            @RequestBody EngagementService.BuffLikeRequestDto request,
            Authentication authentication
    ) {
        User user = resolveUser(authentication);
        return ResponseEntity.ok(engagementService.buffLike(user.getId(), request));
    }

    @PostMapping("/buff-view")
    public ResponseEntity<Map<String, Object>> buffView(
            @RequestBody EngagementService.BuffViewRequestDto request,
            Authentication authentication
    ) {
        User user = resolveUser(authentication);
        return ResponseEntity.ok(engagementService.buffView(user.getId(), request));
    }

    @PostMapping("/scan-pages")
    public ResponseEntity<Map<String, Object>> scanPages(
            @RequestBody Map<String, String> body
    ) {
        String cookieString = body.get("cookieString");
        return ResponseEntity.ok(engagementService.scanPages(cookieString));
    }
}
