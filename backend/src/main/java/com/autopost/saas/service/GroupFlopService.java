package com.autopost.saas.service;

import com.autopost.saas.entity.GroupFlopConfig;
import com.autopost.saas.entity.GroupFlopLog;
import com.autopost.saas.entity.PostQueue;
import com.autopost.saas.entity.SocialAccount;
import com.autopost.saas.entity.User;
import com.autopost.saas.repository.GroupFlopConfigRepository;
import com.autopost.saas.repository.GroupFlopLogRepository;
import com.autopost.saas.repository.PostQueueRepository;
import com.autopost.saas.repository.SocialAccountRepository;
import com.autopost.saas.util.PooledRestTemplateFactory;
import com.autopost.saas.util.WorkerRetryHelper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.RestTemplate;

import java.time.LocalDateTime;
import java.util.*;

@Service
@RequiredArgsConstructor
@Slf4j
public class GroupFlopService {

    private final GroupFlopConfigRepository configRepository;
    private final GroupFlopLogRepository logRepository;
    private final PostQueueRepository postQueueRepository;
    private final SocialAccountRepository socialAccountRepository;

    private final RestTemplate restTemplate = PooledRestTemplateFactory.create(10_000, 600_000);

    @Value("${worker.base-url:http://localhost:3001}")
    private String workerBaseUrl;

    // 2026-09-19: đã fix xong lỗi bấm nút xác nhận Xoá (worker/server.js verifyAndSendComment-style
    // poll loop cho bước xoá bài flop) — bật lại cơ chế auto-xoá bài flop.
    private static final boolean FLOP_CHECK_ENABLED = false;

    public List<GroupFlopConfig> getConfigs(Long userId) {
        return configRepository.findByUserIdOrderByCreatedAtDesc(userId);
    }

    @Transactional
    public GroupFlopConfig saveConfig(User user, GroupFlopConfig dto) {
        Optional<GroupFlopConfig> existing = configRepository.findByUserIdAndGroupName(user.getId(),
                dto.getGroupName().trim());
        GroupFlopConfig config;
        if (existing.isPresent()) {
            config = existing.get();
        } else {
            config = new GroupFlopConfig();
            config.setUser(user);
            config.setGroupName(dto.getGroupName().trim());
        }
        config.setGroupUrl(dto.getGroupUrl() != null ? dto.getGroupUrl().trim() : null);
        config.setSocialAccountId(dto.getSocialAccountId());
        config.setSocialAccountName(dto.getSocialAccountName());
        int mins = 120;
        if (dto.getCheckAfterMinutes() != null && dto.getCheckAfterMinutes() > 0) {
            mins = dto.getCheckAfterMinutes();
        } else if (dto.getCheckAfterHours() != null && dto.getCheckAfterHours() > 0) {
            mins = dto.getCheckAfterHours() * 60;
        }
        config.setCheckAfterMinutes(mins);
        config.setCheckAfterHours(Math.max(1, mins / 60));
        config.setMinLikesThreshold(
                dto.getMinLikesThreshold() != null && dto.getMinLikesThreshold() >= 0 ? dto.getMinLikesThreshold()
                        : 10);
        config.setMinCommentsThreshold(dto.getMinCommentsThreshold() != null && dto.getMinCommentsThreshold() >= 0
                ? dto.getMinCommentsThreshold()
                : 0);
        config.setEnabled(dto.getEnabled() != null ? dto.getEnabled() : true);

        return configRepository.save(config);
    }

    @Transactional
    public void deleteConfig(Long userId, Long configId) {
        configRepository.findById(configId).ifPresent(cfg -> {
            if (cfg.getUser().getId().equals(userId)) {
                configRepository.delete(cfg);
            }
        });
    }

    @Transactional
    public GroupFlopConfig toggleConfig(Long userId, Long configId, boolean enabled) {
        GroupFlopConfig cfg = configRepository.findById(configId)
                .orElseThrow(() -> new IllegalArgumentException("Không tìm thấy cấu hình"));
        if (!cfg.getUser().getId().equals(userId)) {
            throw new IllegalArgumentException("Không có quyền chỉnh sửa");
        }
        cfg.setEnabled(enabled);
        return configRepository.save(cfg);
    }

    public List<GroupFlopLog> getLogs(Long userId) {
        return logRepository.findByUserIdOrderByCreatedAtDesc(userId);
    }

    /**
     * Tự động quét định kỳ các bài flop — ĐÃ TẮT HOÀN TOÀN THEO YÊU CẦU NGƯỜI DÙNG
     */
    public void autoCheckFlopPostsCron() {
        // Đã tắt hoàn toàn tính năng FlopCheck
    }

    @Transactional
    public Map<String, Object> triggerManualCheck(User user) {
        if (!FLOP_CHECK_ENABLED) {
            Map<String, Object> disabledResp = new HashMap<>();
            disabledResp.put("success", false);
            disabledResp.put("totalChecked", 0);
            disabledResp.put("totalDeleted", 0);
            disabledResp.put("message", "Cơ chế tự động xoá bài flop đang tạm tắt (đang chờ fix bước bấm xác nhận Xoá).");
            return disabledResp;
        }
        log.info("[GroupFlopService] User {} kích hoạt kiểm tra bài flop thủ công", user.getId());
        List<GroupFlopConfig> configs = configRepository.findByUserIdAndEnabledTrue(user.getId());
        int totalChecked = 0;
        int totalDeleted = 0;

        for (GroupFlopConfig config : configs) {
            int[] result = processFlopCheckForConfig(config);
            totalChecked += result[0];
            totalDeleted += result[1];
        }

        Map<String, Object> resp = new HashMap<>();
        resp.put("success", true);
        resp.put("totalChecked", totalChecked);
        resp.put("totalDeleted", totalDeleted);
        resp.put("message",
                String.format("Đã kiểm tra %d bài viết, tự động xoá %d bài bị flop.", totalChecked, totalDeleted));
        return resp;
    }

    @Transactional
    @SuppressWarnings("unchecked")
    public int[] processFlopCheckForConfig(GroupFlopConfig config) {
        int checked = 0;
        int deleted = 0;

        try {
            Long userId = config.getUser().getId();
            String groupName = config.getGroupName();
            String groupIdFromUrl = extractGroupIdFromUrl(config.getGroupUrl());
            int checkAfterMinutes = config.getCheckAfterMinutes() != null && config.getCheckAfterMinutes() > 0
                    ? config.getCheckAfterMinutes()
                    : config.getCheckAfterHours() * 60;
            int minLikes = config.getMinLikesThreshold();
            int minComments = config.getMinCommentsThreshold();

            // Tìm Cookie Facebook của người dùng từ SocialAccount
            List<SocialAccount> accounts = socialAccountRepository.findByUserId(userId);
            String cookieString = null;
            for (SocialAccount acc : accounts) {
                if (acc.getAccessToken() != null && acc.getAccessToken().contains("c_user=")) {
                    cookieString = acc.getAccessToken();
                    break;
                }
            }

            if (cookieString == null || cookieString.isBlank()) {
                log.warn("[GroupFlopService] Không tìm thấy Cookie hợp lệ của User {} để kiểm tra bài trong Group {}",
                        userId, groupName);
                return new int[] { 0, 0 };
            }

            // Tìm các bài mới nhất trong PostQueue đã đăng ở Group này
            List<PostQueue> publishedPosts = postQueueRepository.findTop50PublishedWithCampaignAndUser().stream()
                    .filter(p -> {
                        try {
                            if (p.getCampaign() != null && p.getCampaign().getUser() != null) {
                                return p.getCampaign().getUser().getId().equals(userId);
                            }
                        } catch (Exception ignored) {}
                        return true; // Bài đăng nhanh không gán campaign
                    })
                    .filter(p -> "PUBLISHED".equalsIgnoreCase(p.getStatus()))
                    .filter(p -> {
                        LocalDateTime t = p.getCreatedAt() != null ? p.getCreatedAt() : p.getPublishedAt();
                        if (p.getPublishedAt() != null && p.getPublishedAt().isBefore(t)) {
                            t = p.getPublishedAt();
                        }
                        return t != null && t.plusMinutes(checkAfterMinutes).isBefore(LocalDateTime.now());
                    })
                    .filter(p -> {
                        String targetGroups = p.getTargetGroupNames();
                        if (targetGroups == null)
                            return false;
                        String lowerTarget = targetGroups.toLowerCase();
                        if (lowerTarget.contains(groupName.toLowerCase()))
                            return true;
                        if (groupIdFromUrl != null && lowerTarget.contains(groupIdFromUrl))
                            return true;
                        return false;
                    })
                    .filter(p -> {
                        if (config.getSocialAccountId() == null || config.getSocialAccountId() == 0L) {
                            return true; // Áp dụng cho tất cả tài khoản
                        }
                        if (p.getTargetFanpageId() != null
                                && p.getTargetFanpageId().contains(String.valueOf(config.getSocialAccountId()))) {
                            return true;
                        }
                        if (config.getSocialAccountName() != null && p.getTargetFanpageId() != null
                                && p.getTargetFanpageId().toLowerCase()
                                        .contains(config.getSocialAccountName().toLowerCase())) {
                            return true;
                        }
                        return false;
                    })
                    .toList();

            for (PostQueue post : publishedPosts) {
                List<String> urlsToProcess = new ArrayList<>();
                if (post.getPublishedGroupPostUrls() != null && !post.getPublishedGroupPostUrls().isBlank()) {
                    for (String u : post.getPublishedGroupPostUrls().split(",")) {
                        if (!u.trim().isEmpty())
                            urlsToProcess.add(u.trim());
                    }
                }
                if (urlsToProcess.isEmpty() && post.getPublishedPostUrl() != null
                        && !post.getPublishedPostUrl().isBlank()) {
                    urlsToProcess.add(post.getPublishedPostUrl().trim());
                }
                if (urlsToProcess.isEmpty() && config.getGroupUrl() != null && !config.getGroupUrl().isBlank()) {
                    urlsToProcess.add(config.getGroupUrl().trim());
                }

                for (String postUrl : urlsToProcess) {
                    postUrl = postUrl.trim();
                    if (postUrl.isBlank())
                        continue;

                    // Kiểm tra nếu bài này đã xoá rồi
                    if (logRepository.existsByPostQueueIdAndPostUrl(post.getId(), postUrl)) {
                        continue;
                    }

                    checked++;
                    log.info(
                            "[GroupFlopService] Kiểm tra bài flop ID #{}: URL {} (Sau {}m, tiêu chí: >= {} likes, >= {} comments)",
                            post.getId(), postUrl, checkAfterMinutes, minLikes, minComments);

                    Map<String, Object> reqBody = new HashMap<>();
                    reqBody.put("cookieString", cookieString);
                    reqBody.put("postUrl", postUrl);
                    reqBody.put("postContent", post.getContent() != null ? post.getContent() : post.getTitle());
                    reqBody.put("minLikesThreshold", minLikes);
                    reqBody.put("minCommentsThreshold", minComments);

                    HttpHeaders headers = new HttpHeaders();
                    headers.setContentType(MediaType.APPLICATION_JSON);

                    try {
                        Map<String, Object> workerResp = WorkerRetryHelper.postWithConnectionRetry(
                                restTemplate,
                                workerBaseUrl + "/api/check-and-delete-flop-post",
                                new HttpEntity<>(reqBody, headers),
                                Map.class);

                        if (workerResp != null && Boolean.TRUE.equals(workerResp.get("success"))) {
                            boolean isDeleted = Boolean.TRUE.equals(workerResp.get("deleted"));
                            int likes = workerResp.get("likesCount") != null
                                    ? ((Number) workerResp.get("likesCount")).intValue()
                                    : 0;
                            int comments = workerResp.get("commentsCount") != null
                                    ? ((Number) workerResp.get("commentsCount")).intValue()
                                    : 0;
                            String reason = (String) workerResp.get("reason");

                            if (isDeleted) {
                                deleted++;
                                GroupFlopLog flopLog = GroupFlopLog.builder()
                                        .user(config.getUser())
                                        .postQueueId(post.getId())
                                        .groupName(groupName)
                                        .postUrl(postUrl)
                                        .likesCount(likes)
                                        .commentsCount(comments)
                                        .status("DELETED_SUCCESS")
                                        .reason(reason != null ? reason
                                                : String.format("Bài flop sau %d phút: %d likes < %d likes",
                                                        checkAfterMinutes, likes, minLikes))
                                        .deletedAt(LocalDateTime.now())
                                        .build();
                                logRepository.save(flopLog);
                            }
                        }
                    } catch (Exception ex) {
                        log.error("[GroupFlopService] Lỗi khi gọi Worker kiểm tra xoá bài flop URL {}: {}", postUrl,
                                ex.getMessage());
                    }
                }
            }
        } catch (Exception e) {
            log.error("[GroupFlopService] Lỗi khi xử lý cấu hình flop cho Group {}: {}", config.getGroupName(),
                    e.getMessage(), e);
        }

        return new int[] { checked, deleted };
    }

    private String extractGroupIdFromUrl(String url) {
        if (url == null)
            return null;
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("groups/(\\d+)").matcher(url);
        if (m.find())
            return m.group(1);
        return null;
    }
}
