package com.autopost.saas.controller;

import com.autopost.saas.entity.Campaign;
import com.autopost.saas.entity.User;
import com.autopost.saas.repository.UserRepository;
import com.autopost.saas.service.CampaignService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * Chỉ đọc: các trang (Đăng tự động, Bài đăng, Dashboard, Job Kinh Tế) dùng danh sách Campaign nội bộ
 * (VD: "Quick Posts") để gom bài trong hàng đợi. Trang quản lý Chiến dịch đã bỏ nên không còn tạo/sửa/xóa.
 */
@RestController
@RequestMapping("/api/campaigns")
@RequiredArgsConstructor
@CrossOrigin(originPatterns = "*")
public class CampaignController {

    private final CampaignService campaignService;
    private final UserRepository userRepository;

    private User resolveUser(Authentication authentication) {
        if (authentication != null && authentication.getName() != null) {
            return userRepository.findByEmail(authentication.getName())
                    .orElseGet(() -> userRepository.findFirstByOrderByIdAsc().orElseThrow());
        }
        return userRepository.findByEmail("admin@gmail.com")
                .orElseGet(() -> userRepository.findFirstByOrderByIdAsc().orElseThrow());
    }

    @GetMapping
    public ResponseEntity<List<Campaign>> getCampaigns(Authentication authentication) {
        User user = resolveUser(authentication);
        return ResponseEntity.ok(campaignService.getCampaignsByUserId(user.getId()));
    }
}
