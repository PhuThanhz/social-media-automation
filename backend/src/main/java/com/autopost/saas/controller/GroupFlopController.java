package com.autopost.saas.controller;

import com.autopost.saas.entity.GroupFlopConfig;
import com.autopost.saas.entity.GroupFlopLog;
import com.autopost.saas.entity.User;
import com.autopost.saas.repository.UserRepository;
import com.autopost.saas.service.GroupFlopService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/group-flop")
@RequiredArgsConstructor
@CrossOrigin(originPatterns = "*")
public class GroupFlopController {

    private final GroupFlopService groupFlopService;
    private final UserRepository userRepository;

    private User resolveUser(Authentication authentication) {
        if (authentication != null && authentication.getName() != null) {
            return userRepository.findByEmail(authentication.getName())
                    .orElseGet(() -> userRepository.findFirstByOrderByIdAsc().orElseThrow());
        }
        return userRepository.findByEmail("admin@gmail.com")
                .orElseGet(() -> userRepository.findFirstByOrderByIdAsc().orElseThrow());
    }

    @GetMapping("/configs")
    public ResponseEntity<List<GroupFlopConfig>> getConfigs(Authentication authentication) {
        User user = resolveUser(authentication);
        return ResponseEntity.ok(groupFlopService.getConfigs(user.getId()));
    }

    @PostMapping("/configs")
    public ResponseEntity<GroupFlopConfig> saveConfig(
            @RequestBody GroupFlopConfig configDto,
            Authentication authentication
    ) {
        User user = resolveUser(authentication);
        return ResponseEntity.ok(groupFlopService.saveConfig(user, configDto));
    }

    @DeleteMapping("/configs/{id}")
    public ResponseEntity<Map<String, Object>> deleteConfig(
            @PathVariable Long id,
            Authentication authentication
    ) {
        User user = resolveUser(authentication);
        groupFlopService.deleteConfig(user.getId(), id);
        return ResponseEntity.ok(Map.of("success", true, "message", "Đã xoá cấu hình thành công"));
    }

    @PatchMapping("/configs/{id}/toggle")
    public ResponseEntity<GroupFlopConfig> toggleConfig(
            @PathVariable Long id,
            @RequestBody Map<String, Boolean> body,
            Authentication authentication
    ) {
        User user = resolveUser(authentication);
        boolean enabled = Boolean.TRUE.equals(body.get("enabled"));
        return ResponseEntity.ok(groupFlopService.toggleConfig(user.getId(), id, enabled));
    }

    @GetMapping("/logs")
    public ResponseEntity<List<GroupFlopLog>> getLogs(Authentication authentication) {
        User user = resolveUser(authentication);
        return ResponseEntity.ok(groupFlopService.getLogs(user.getId()));
    }

    @PostMapping("/check-now")
    public ResponseEntity<Map<String, Object>> checkNow(Authentication authentication) {
        User user = resolveUser(authentication);
        return ResponseEntity.ok(groupFlopService.triggerManualCheck(user));
    }
}
