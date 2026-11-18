package com.autopost.saas.controller;

import com.autopost.saas.util.LocalServices;
import com.autopost.saas.entity.Campaign;
import com.autopost.saas.entity.PostQueue;
import com.autopost.saas.entity.SocialAccount;
import com.autopost.saas.entity.User;
import com.autopost.saas.repository.CampaignRepository;
import com.autopost.saas.repository.PostQueueRepository;
import com.autopost.saas.repository.SocialAccountRepository;
import com.autopost.saas.repository.UserRepository;
import com.autopost.saas.service.FacebookGraphApiService;
import com.autopost.saas.service.PostQueueService;
import com.autopost.saas.service.RedditService;
import com.autopost.saas.service.ScraperService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.support.ServletUriComponentsBuilder;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/queue")
@RequiredArgsConstructor
@Slf4j
@CrossOrigin(originPatterns = "*")
public class PostQueueController {

    private static final String QUICK_POST_CAMPAIGN_NAME = "Quick Posts";

    private final PostQueueService postQueueService;
    private final com.autopost.saas.scheduler.CampaignScheduler campaignScheduler;
    private final ScraperService scraperService;
    private final RedditService redditService;
    private final CampaignRepository campaignRepository;
    private final UserRepository userRepository;
    private final SocialAccountRepository socialAccountRepository;
    private final PostQueueRepository postQueueRepository;
    private final FacebookGraphApiService facebookGraphApiService;
    private final com.autopost.saas.service.PostingWindowService postingWindowService;
    private final com.autopost.saas.publishing.service.PublishingPreflightService publishingPreflightService;
    // Có timeout + kèm session token của worker (new RestTemplate() trước đây có thể treo vô hạn).
    private final org.springframework.web.client.RestTemplate extractVideoClient =
            com.autopost.saas.util.PooledRestTemplateFactory.create(10000, 180000);

    private User resolveUser(Authentication authentication) {
        if (authentication != null && authentication.getName() != null) {
            return userRepository.findByEmail(authentication.getName())
                    .orElseGet(() -> userRepository.findFirstByOrderByIdAsc().orElseThrow());
        }
        return userRepository.findByEmail("admin@gmail.com")
                .orElseGet(() -> userRepository.findFirstByOrderByIdAsc().orElseThrow());
    }

    private Campaign resolveQuickPostCampaign(User user) {
        return campaignRepository.findByUserIdAndName(user.getId(), QUICK_POST_CAMPAIGN_NAME)
                .orElseGet(() -> {
                    Campaign c = Campaign.builder()
                            .user(user)
                            .name(QUICK_POST_CAMPAIGN_NAME)
                            .sourceType("DIRECT_LINK")
                            .sourceUrl("")
                            .aiRewriteEnabled(false)
                            .postingIntervalMinutes(60)
                            .cronExpression("MANUAL")
                            .status("ACTIVE")
                            .build();
                    return campaignRepository.save(c);
                });
    }

    /**
     * Tìm đúng SocialAccount loại PERSONAL_COOKIE để đăng vào Group.
     * Ưu tiên:
     * 1. Khớp chính xác theo connectionId nếu targetFanpageId có dạng "platformAccountId:accountType:connectionId"
     * 2. Nếu không có connectionId: CHỈ tự chọn khi kết quả khớp là DUY NHẤT — không đoán theo updatedAt
     *    (updatedAt bị đụng bởi health-check/cookie-refresh chạy nền, y hệt bug "đăng nhầm account" đã
     *    fix ở PostQueueService.publishPostNow — xem comment ở đó). Nếu nhiều account khớp, trả về null
     *    để caller báo lỗi rõ ràng thay vì đăng nhầm người/Fanpage.
     */
    private SocialAccount resolvePersonalCookieAccount(User user, String targetFanpageId, String pageId) {
        List<SocialAccount> accounts = socialAccountRepository.findByUserId(user.getId());
        if (accounts.isEmpty()) {
            return null;
        }

        String rawTarget = targetFanpageId != null && !targetFanpageId.trim().isEmpty()
                ? targetFanpageId.trim()
                : (pageId != null ? pageId.trim() : "");
        String[] parts = rawTarget.split(":", -1);
        String realPlatformId = parts[0].trim();
        String requestedAccountType = parts.length >= 2 ? parts[1].trim() : null;

        // 1. Khớp chính xác connectionId nếu có (VD: PERSONAL_PROFILE:PERSONAL_PROFILE_COOKIE:35)
        if (parts.length >= 3 && !parts[2].trim().isEmpty()) {
            try {
                Long requestedConnectionId = Long.valueOf(parts[2].trim());
                SocialAccount matched = accounts.stream()
                        .filter(a -> requestedConnectionId.equals(a.getId()))
                        .filter(a -> !"EXPIRED".equalsIgnoreCase(a.getTokenStatus()))
                        .findFirst()
                        .orElse(null);
                if (matched != null) return matched;
            } catch (NumberFormatException ignored) {
            }
        }

        if (rawTarget.isEmpty() || rawTarget.contains("PERSONAL_PROFILE") || rawTarget.startsWith("PERSONAL_")) {
            List<SocialAccount> personalMatches = accounts.stream()
                    .filter(a -> a.getAccessToken() != null && a.getAccessToken().contains("c_user="))
                    .filter(a -> !"EXPIRED".equalsIgnoreCase(a.getTokenStatus()))
                    .toList();
            // Ưu tiên tài khoản cá nhân thật (FACEBOOK_PROFILE / PERSONAL_PROFILE_COOKIE)
            SocialAccount realProfile = personalMatches.stream()
                    .filter(a -> "FACEBOOK_PROFILE".equalsIgnoreCase(a.getPlatform()) || "PERSONAL_PROFILE_COOKIE".equalsIgnoreCase(a.getAccountType()))
                    .findFirst()
                    .orElse(null);
            if (realProfile != null) return realProfile;
            return personalMatches.size() == 1 ? personalMatches.get(0) : (!personalMatches.isEmpty() ? personalMatches.get(0) : null);
        }

        // 2. Không có connectionId tường minh — tìm theo platformAccountId, chỉ tự chọn khi DUY NHẤT.
        List<SocialAccount> matchingAccounts = accounts.stream()
                .filter(a -> realPlatformId.equals(a.getPlatformAccountId()))
                .filter(a -> requestedAccountType == null || requestedAccountType.isEmpty()
                        || requestedAccountType.equalsIgnoreCase(a.getAccountType()))
                .filter(a -> !"EXPIRED".equalsIgnoreCase(a.getTokenStatus()))
                .toList();

        List<SocialAccount> cookieMatches = matchingAccounts.stream()
                .filter(a -> "PERSONAL_COOKIE".equals(a.getAccountType()))
                .toList();

        if (matchingAccounts.size() == 1) return matchingAccounts.get(0);
        if (cookieMatches.size() == 1) return cookieMatches.get(0);
        return null;
    }

    /**
     * true khi targetFanpageId/pageId đã chỉ đích danh 1 connectionId cụ thể (dạng 3 phần
     * "platformAccountId:accountType:connectionId") — nghĩa là người dùng đã CHỌN RÕ 1 via, không
     * nên tự ý xoay vòng sang via khác dù đang có nhiều via cá nhân khả dụng.
     */
    private boolean hasExplicitConnectionId(String targetFanpageId, String pageId) {
        String rawTarget = targetFanpageId != null && !targetFanpageId.trim().isEmpty()
                ? targetFanpageId.trim()
                : (pageId != null ? pageId.trim() : "");
        String[] parts = rawTarget.split(":", -1);
        return parts.length >= 3 && !parts[2].trim().isEmpty();
    }

    /**
     * Danh sách TẤT CẢ via cá nhân (PERSONAL_PROFILE_COOKIE/FACEBOOK_PROFILE) còn hạn của user, theo
     * thứ tự ID tăng dần (ổn định giữa các lần gọi) — dùng để xoay vòng (round-robin) khi đăng ẩn
     * danh hàng loạt mà người dùng không chỉ định rõ 1 via cụ thể, tránh dồn hết bài vào 1 via khiến
     * tài khoản đó dễ bị Facebook đánh dấu đăng dồn dập/đá phiên đăng nhập.
     */
    private List<SocialAccount> resolveAllPersonalProfileAccounts(User user) {
        return socialAccountRepository.findByUserId(user.getId()).stream()
                .filter(a -> a.getAccessToken() != null && a.getAccessToken().contains("c_user="))
                .filter(a -> !"EXPIRED".equalsIgnoreCase(a.getTokenStatus()))
                .filter(a -> "FACEBOOK_PROFILE".equalsIgnoreCase(a.getPlatform()) || "PERSONAL_PROFILE_COOKIE".equalsIgnoreCase(a.getAccountType()))
                .sorted(java.util.Comparator.comparing(SocialAccount::getId))
                .toList();
    }

    @GetMapping("/counts")
    public ResponseEntity<Map<String, Object>> getQueueCounts(Authentication authentication) {
        User user = resolveUser(authentication);
        return ResponseEntity.ok(postQueueService.getQueueCountsForUser(user.getId()));
    }

    /** Hàng đợi active + bài đã đăng trong `days` ngày của mọi campaign của user (thay cho 1 + N request /campaign/{id}). */
    @GetMapping("/recent")
    public ResponseEntity<List<PostQueue>> getRecentQueue(
            Authentication authentication,
            @RequestParam(required = false, defaultValue = "2") int days,
            @RequestParam(required = false) String excludeType) {
        User user = resolveUser(authentication);
        return ResponseEntity.ok(postQueueService.getRecentQueueForUser(user.getId(), days, excludeType));
    }

    @GetMapping("/campaign/{campaignId}")
    public ResponseEntity<List<PostQueue>> getQueueByCampaign(
            @PathVariable Long campaignId,
            @RequestParam(required = false, defaultValue = "false") boolean all,
            @RequestParam(required = false, defaultValue = "7") int days) {
        if (all) {
            return ResponseEntity.ok(postQueueService.getQueueByCampaign(campaignId));
        }
        return ResponseEntity.ok(postQueueService.getRecentQueueByCampaign(campaignId, days));
    }

    /** Danh sách bài trong khoảng [from, to) để vẽ Lịch đăng bài (ISO LocalDateTime, VD: 2026-08-20T00:00:00). */
    @GetMapping("/calendar")
    public ResponseEntity<Map<String, Object>> getQueueForCalendar(
            @RequestParam String from,
            @RequestParam String to) {
        try {
            LocalDateTime fromDate = LocalDateTime.parse(from);
            LocalDateTime toDate = LocalDateTime.parse(to);
            return ResponseEntity.ok(Map.of("success", true, "items", postQueueService.getQueueByScheduleRange(fromDate, toDate)));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", "from/to không đúng định dạng"));
        }
    }

    /**
     * Cào thử 1 URL để xem trước caption + ảnh/video TRƯỚC khi lên lịch đăng thật — không tạo PostQueue,
     * không đăng gì cả. Dùng cho nút "Xem trước" ở Quick Post để người dùng kiểm tra media trước khi bấm đăng.
     */
    @PostMapping("/preview-url")
    public ResponseEntity<Map<String, Object>> previewUrl(@RequestBody Map<String, String> requestBody, Authentication authentication) {
        String url = requestBody.get("url");
        if (url == null || url.trim().isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", "URL không hợp lệ"));
        }
        User user = null;
        try {
            user = resolveUser(authentication);
        } catch (Exception ignored) {}

        String cookieString = (url.contains("facebook.com") || url.contains("fb.watch") || url.contains("fb.me"))
                ? scraperService.resolveBestFacebookCookie(user != null ? user.getId() : null)
                : null;

        String sourceType = url.contains("facebook.com") || url.contains("fb.watch")
                ? "FB_PAGE"
                : (url.contains("tiktok.com") || url.contains("douyin.com") ? "TIKTOK" : "WEBSITE_CRAWLER");
        try {
            List<Map<String, Object>> items = scraperService.fetchScrapedItems(url, sourceType, 1, false, cookieString);
            if (items.isEmpty()) {
                return ResponseEntity.ok(Map.of("success", false, "message", "Không cào được nội dung từ link này"));
            }
            return ResponseEntity.ok(Map.of("success", true, "item", items.get(0)));
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of("success", false, "message", "Cào bài thất bại: " + e.getMessage()));
        }
    }

    @PostMapping("/add-from-url")
    public ResponseEntity<Map<String, Object>> addFromUrl(@RequestBody Map<String, String> requestBody, Authentication authentication) {
        String url = requestBody.get("url");
        if (url == null || url.trim().isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", "URL không hợp lệ"));
        }

        boolean publishNow = "true".equalsIgnoreCase(requestBody.get("publishNow"));

        String scheduledAtRaw = requestBody.get("scheduledAt");
        LocalDateTime scheduledAt = null;
        if (publishNow) {
            scheduledAt = LocalDateTime.now();
        } else if (scheduledAtRaw != null && !scheduledAtRaw.trim().isEmpty()) {
            try {
                scheduledAt = LocalDateTime.parse(scheduledAtRaw);
            } catch (Exception e) {
                return ResponseEntity.badRequest().body(Map.of("success", false, "message", "scheduledAt không đúng định dạng"));
            }
        } else {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", "Vui lòng chọn ngày giờ đăng hoặc bật Đăng ngay"));
        }
        String targetFanpageId = requestBody.get("targetFanpageId");
        String affiliateLinkRaw = requestBody.get("affiliateLink");
        String affiliateLink = affiliateLinkRaw != null && !affiliateLinkRaw.trim().isEmpty()
                ? affiliateLinkRaw.trim()
                : null;
        Object rawEnableGroup = requestBody.get("enableGroupComment");
        boolean enableGroupComment = rawEnableGroup != null
                ? (Boolean.TRUE.equals(rawEnableGroup) || "true".equalsIgnoreCase(rawEnableGroup.toString()) || "1".equals(rawEnableGroup.toString()))
                : (affiliateLink != null && !affiliateLink.trim().isEmpty());

        User user = resolveUser(authentication);
        Campaign quickPostCampaign = resolveQuickPostCampaign(user);

        Campaign tempCampaign = new Campaign();
        tempCampaign.setId(quickPostCampaign.getId());
        tempCampaign.setUser(user);
        tempCampaign.setName(quickPostCampaign.getName());
        tempCampaign.setSourceUrl(url);
        tempCampaign.setSourceType("DIRECT_LINK");
        tempCampaign.setEnableGroupComment(enableGroupComment);
        // Không gửi targetFanpageId (VD: đẩy qua Extension — chưa có UI chọn Fanpage) -> dùng Fanpage
        // mặc định đã lưu sẵn trên Campaign "Quick Posts" thay vì để trống, để publishPostNow() không
        // phải tự đoán account nào (nguồn gốc bug "đăng nhầm account" trước đây).
        tempCampaign.setTargetFanpageIds(
                targetFanpageId != null && !targetFanpageId.isBlank() ? targetFanpageId : quickPostCampaign.getTargetFanpageIds());
        tempCampaign.setAiRewriteEnabled(false);
        tempCampaign.setPostingIntervalMinutes(quickPostCampaign.getPostingIntervalMinutes());
        tempCampaign.setAffiliateLink(affiliateLink);

        boolean forceRefresh = "true".equalsIgnoreCase(requestBody.get("forceRefresh"));
        ScraperService.ScrapeResult result;
        try {
            result = scraperService.scrapeAndQueueQuickPostWithCacheInfo(tempCampaign, scheduledAt, targetFanpageId, forceRefresh);
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of("success", false, "message", "Cào bài thất bại: " + e.getMessage()));
        }
        List<PostQueue> scraped = result.posts;

        if (publishNow) {
            for (PostQueue post : scraped) {
                postQueueService.publishPostNow(post.getId());
            }
        }

        return ResponseEntity.ok(Map.of("success", true, "count", scraped.size(), "items", scraped, "cached", result.cached));
    }

    @PostMapping("/add-from-urls")
    public ResponseEntity<Map<String, Object>> addFromUrls(@RequestBody Map<String, Object> requestBody, Authentication authentication) {
        Object rawUrls = requestBody.get("urls");
        if (!(rawUrls instanceof List<?> urlList) || urlList.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", "Vui lòng nhập ít nhất 1 bài viết hoặc URL"));
        }
        List<String> urls = new ArrayList<>();
        for (int i = 0; i < urlList.size(); i++) {
            String u = urlList.get(i) != null ? urlList.get(i).toString().trim() : "";
            if (u.isEmpty()) {
                u = "manual://post_" + System.currentTimeMillis() + "_" + i;
            }
            urls.add(u);
        }
        if (urls.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", "Vui lòng nhập ít nhất 1 bài viết hoặc URL hợp lệ"));
        }

        List<String> scheduledTimes = null;
        Object rawScheduledTimes = requestBody.get("scheduledTimes");
        if (rawScheduledTimes instanceof List<?> stList) {
            scheduledTimes = stList.stream().map(Object::toString).toList();
        }

        // 3 cách chọn giờ duy nhất: NOW (đăng ngay) / QUEUE (xếp vào lịch theo cài đặt chung) / AT (hẹn giờ cụ thể)
        String scheduleMode = resolveScheduleMode(requestBody);
        boolean publishNow = "NOW".equals(scheduleMode);
        String targetFanpageId = (String) requestBody.get("targetFanpageId");
        if (targetFanpageId == null || targetFanpageId.trim().isEmpty() || "null".equalsIgnoreCase(targetFanpageId.trim())) {
            User currentUser = resolveUser(authentication);
            SocialAccount defaultAcc = resolvePersonalCookieAccount(currentUser, null, null);
            if (defaultAcc != null) {
                targetFanpageId = defaultAcc.getPlatformAccountId() + ":" + defaultAcc.getAccountType() + ":" + defaultAcc.getId();
            }
        }
        Object affiliateLinkRaw = requestBody.get("affiliateLink");
        String affiliateLink = affiliateLinkRaw != null && !affiliateLinkRaw.toString().trim().isEmpty()
                ? affiliateLinkRaw.toString().trim()
                : null;

        Object rawGroupNames = requestBody.get("groupNames");
        String targetGroupNames = null;
        if (rawGroupNames instanceof List<?> groupNameList && !groupNameList.isEmpty()) {
            List<String> cleanedGroupNames = groupNameList.stream()
                            .map(Object::toString)
                    .map(String::trim)
                    .filter(s -> !s.isEmpty())
                    .toList();
            if (!cleanedGroupNames.isEmpty()) {
                targetGroupNames = String.join(",", cleanedGroupNames);
            }
        }

        @SuppressWarnings("unchecked")
        List<String> affiliateLinks = (List<String>) requestBody.get("affiliateLinks");

        // Cho phép gửi caption tùy chỉnh riêng cho từng bài (nếu người dùng đã sửa caption trước khi đăng)
        List<?> rawCustomCaptions = requestBody.get("customCaptions") instanceof List<?> cc ? cc : null;

        // Cho phép bật/tắt tự động ghi "Cre: @tác giả" riêng cho từng bài trong danh sách (mặc định
        // BẬT nếu không gửi lên, khớp với Campaign.includeCredit = true theo mặc định hiện có).
        List<?> rawIncludeCredits = requestBody.get("includeCredits") instanceof List<?> l ? l : null;

        // Cho phép tắt HẲN bình luận tự động (kể cả cmt mặc định) riêng cho từng bài — khác với việc
        // chỉ để trống ô cmt riêng, vốn vẫn rơi về dùng cmt mặc định chung như trước giờ.
        List<?> rawCommentDisabled = requestBody.get("commentDisabled") instanceof List<?> cd ? cd : null;

        // Bình luận link Affiliate vào bài đăng trong NHÓM là opt-in riêng, mặc định TẮT nếu không
        // gửi lên — khác với bài đăng lên Fanpage vốn tự bình luận mặc định hễ có điền affiliateLink.
        List<?> rawGroupCommentEnabled = requestBody.get("groupCommentEnabled") instanceof List<?> gce ? gce : null;

        // Cho phép gửi danh sách mediaUrls tùy chỉnh riêng (đã đổi thứ tự hoặc xóa bớt ảnh/video)
        List<?> rawCustomMediaUrls = requestBody.get("customMediaUrls") instanceof List<?> cmu ? cmu : null;

        // Cho phép đăng bài phông nền màu đỏ (Facebook Color Background)
        List<?> rawColorBackgrounds = requestBody.get("colorBackgrounds") instanceof List<?> cbList ? cbList : null;

        User user = resolveUser(authentication);
        Campaign quickPostCampaign = resolveQuickPostCampaign(user);

        int intervalMinutes = requestBody.get("intervalMinutes") != null
                ? Integer.parseInt(requestBody.get("intervalMinutes").toString())
                : (quickPostCampaign.getPostingIntervalMinutes() != null ? quickPostCampaign.getPostingIntervalMinutes() : 60);

        LocalDateTime baseScheduledAt;
        if (publishNow) {
            baseScheduledAt = LocalDateTime.now();
        } else if ("QUEUE".equals(scheduleMode)) {
            // Giờ tạm (đủ xa để scheduler không chộp bài trong lúc còn đang cào các link khác);
            // packContinuous ở cuối request sẽ xếp lại đúng giờ theo lịch đăng chung.
            baseScheduledAt = LocalDateTime.now().plusHours(1);
        } else {
            String scheduledAtRaw = (String) requestBody.get("scheduledAt");
            if (scheduledAtRaw != null && !scheduledAtRaw.trim().isEmpty()) {
                try {
                    baseScheduledAt = LocalDateTime.parse(scheduledAtRaw);
                } catch (Exception e) {
                    baseScheduledAt = LocalDateTime.now();
                }
            } else if (scheduledTimes != null && !scheduledTimes.isEmpty() && scheduledTimes.get(0) != null) {
                try {
                    baseScheduledAt = LocalDateTime.parse(scheduledTimes.get(0));
                } catch (Exception e) {
                    baseScheduledAt = LocalDateTime.now();
                }
            } else {
                baseScheduledAt = LocalDateTime.now();
            }
        }

        // Hỗ trợ phân phối đa kênh: cho phép gửi danh sách targetFanpageIds và targetGroupNamesList riêng cho từng bài
        List<?> rawTargetFanpageIds = requestBody.get("targetFanpageIds") instanceof List<?> tfList ? tfList : null;
        List<?> rawTargetGroupNamesList = requestBody.get("targetGroupNamesList") instanceof List<?> tgnList ? tgnList : null;

        List<PostQueue> allCreated = new ArrayList<>();
        List<PostQueue> manualPostsToSave = new ArrayList<>();
        List<String> allCachedUrls = new ArrayList<>();
        Map<String, String> cachedGroupDisplayNames = null;
        // Chặn trùng: cùng 1 bài gốc (so theo ID bài) đã có trong Lịch đăng cho cùng nhóm đích thì bỏ qua.
        // Gửi allowDuplicates=true để cố ý đăng lại.
        boolean allowDuplicates = Boolean.TRUE.equals(requestBody.get("allowDuplicates")) || "true".equals(String.valueOf(requestBody.get("allowDuplicates")));
        List<Map<String, Object>> skippedDuplicates = new ArrayList<>();
        Map<String, java.util.Set<String>> queuedInThisRequest = new java.util.HashMap<>();
        for (int i = 0; i < urls.size(); i++) {
            boolean itemCommentDisabled = rawCommentDisabled != null && rawCommentDisabled.size() > i
                    && Boolean.TRUE.equals(rawCommentDisabled.get(i));
            String itemAffiliateLink = itemCommentDisabled ? null : (
                    (affiliateLinks != null && affiliateLinks.size() > i && affiliateLinks.get(i) != null && !affiliateLinks.get(i).trim().isEmpty())
                            ? affiliateLinks.get(i).trim()
                            : (affiliateLink != null && !affiliateLink.trim().isEmpty() ? affiliateLink.trim() : null)
            );
            boolean itemGroupCommentEnabled;
            if (rawGroupCommentEnabled != null && rawGroupCommentEnabled.size() > i && rawGroupCommentEnabled.get(i) != null) {
                Object val = rawGroupCommentEnabled.get(i);
                itemGroupCommentEnabled = Boolean.TRUE.equals(val) || "true".equalsIgnoreCase(val.toString()) || "1".equals(val.toString());
            } else if (requestBody.get("enableGroupComment") != null) {
                Object val = requestBody.get("enableGroupComment");
                itemGroupCommentEnabled = Boolean.TRUE.equals(val) || "true".equalsIgnoreCase(val.toString()) || "1".equals(val.toString());
            } else {
                itemGroupCommentEnabled = itemAffiliateLink != null && !itemAffiliateLink.trim().isEmpty();
            }
            String itemCustomCaption = (rawCustomCaptions != null && rawCustomCaptions.size() > i && rawCustomCaptions.get(i) != null)
                    ? rawCustomCaptions.get(i).toString().trim()
                    : null;
            String itemCustomMedia = (rawCustomMediaUrls != null && rawCustomMediaUrls.size() > i && rawCustomMediaUrls.get(i) != null)
                    ? rawCustomMediaUrls.get(i).toString().trim()
                    : null;

            String itemTargetGroupNames = (rawTargetGroupNamesList != null && rawTargetGroupNamesList.size() > i && rawTargetGroupNamesList.get(i) != null)
                    ? rawTargetGroupNamesList.get(i).toString().trim()
                    : targetGroupNames;

            if (!allowDuplicates) {
                List<String> duplicateGroups = findDuplicateGroupTargets(user.getId(), urls.get(i), itemTargetGroupNames, queuedInThisRequest);
                if (!duplicateGroups.isEmpty()) {
                    if (cachedGroupDisplayNames == null) {
                        cachedGroupDisplayNames = loadGroupDisplayNamesMap();
                    }
                    log.info("⏭️ Bỏ qua bài trùng {} → nhóm {}", urls.get(i), duplicateGroups);
                    skippedDuplicates.add(Map.of(
                            "index", i,
                            "url", urls.get(i),
                            "groups", resolveGroupDisplayNames(duplicateGroups, cachedGroupDisplayNames)));
                    continue;
                }
                String postId = com.autopost.saas.util.FacebookPostIds.extractPostId(urls.get(i));
                if (postId != null) {
                    queuedInThisRequest.computeIfAbsent(postId, k -> new java.util.HashSet<>())
                            .addAll(com.autopost.saas.util.FacebookPostIds.targetGroupKeys(itemTargetGroupNames));
                }
            }

            String chosenTargetId = ((rawTargetFanpageIds != null && rawTargetFanpageIds.size() > i && rawTargetFanpageIds.get(i) != null && !rawTargetFanpageIds.get(i).toString().trim().isEmpty())
                    ? rawTargetFanpageIds.get(i).toString().trim()
                    : targetFanpageId);
            String itemTargetFanpageId = (chosenTargetId != null && !chosenTargetId.isBlank())
                    ? chosenTargetId
                    : ((itemTargetGroupNames != null && itemTargetGroupNames.startsWith("GROUP_ONLY_ANON:")) ? "PERSONAL_PROFILE" : null);

            // QUY TẮC BẢO VỆ UY TÍN: Fanpage Vietnam Real Estate (100053405437835) tuyệt đối không gắn link Shopee/Affiliate/bán hàng!
            boolean isRealEstateTarget = itemTargetFanpageId != null && (
                    itemTargetFanpageId.contains("100053405437835") ||
                    itemTargetFanpageId.toLowerCase().contains("real_estate") ||
                    itemTargetFanpageId.toLowerCase().contains("realestate")
            );
            if (isRealEstateTarget && itemAffiliateLink != null && (itemAffiliateLink.toLowerCase().contains("shopee") || itemAffiliateLink.toLowerCase().contains("shp.ee") || itemAffiliateLink.toLowerCase().contains("affiliate"))) {
                itemAffiliateLink = null;
            }

            Campaign tempCampaign = new Campaign();
            tempCampaign.setId(quickPostCampaign.getId());
            tempCampaign.setUser(user);
            tempCampaign.setName(quickPostCampaign.getName());
            tempCampaign.setSourceUrl(urls.get(i));
            tempCampaign.setSourceType("DIRECT_LINK");
            // Không gửi targetFanpageId (VD: đẩy qua Extension) -> dùng Fanpage mặc định đã lưu sẵn
            // trên Campaign "Quick Posts" thay vì để trống (xem comment tương tự ở addFromUrl()).
            tempCampaign.setTargetFanpageIds(
                    itemTargetFanpageId != null && !itemTargetFanpageId.isBlank() ? itemTargetFanpageId : quickPostCampaign.getTargetFanpageIds());
            tempCampaign.setAiRewriteEnabled(false);
            tempCampaign.setPostingIntervalMinutes(intervalMinutes);
            tempCampaign.setAffiliateLink(itemAffiliateLink);
            tempCampaign.setEnableGroupComment(itemGroupCommentEnabled);
            boolean itemIncludeCredit = rawIncludeCredits == null || rawIncludeCredits.size() <= i
                    || !Boolean.FALSE.equals(rawIncludeCredits.get(i));
            tempCampaign.setIncludeCredit(itemIncludeCredit);

            LocalDateTime scheduledAtForItem;
            if (scheduledTimes != null && scheduledTimes.size() > i && scheduledTimes.get(i) != null && !scheduledTimes.get(i).trim().isEmpty()) {
                try {
                    scheduledAtForItem = LocalDateTime.parse(scheduledTimes.get(i));
                } catch (Exception ex) {
                    scheduledAtForItem = baseScheduledAt.plusMinutes((long) i * intervalMinutes);
                }
            } else if (!"AT".equals(scheduleMode)) {
                // Đăng ngay / Xếp vào lịch: giờ do server quyết (QUEUE được xếp lại bằng packContinuous ở cuối)
                scheduledAtForItem = baseScheduledAt;
            } else {
                scheduledAtForItem = baseScheduledAt.plusMinutes((long) i * intervalMinutes);
            }

            Object rawCb = rawColorBackgrounds != null && rawColorBackgrounds.size() > i ? rawColorBackgrounds.get(i) : null;
            boolean isRedPhotoTrick = "RED_PHOTO_TRICK".equalsIgnoreCase(String.valueOf(rawCb)) || "COLOR_PHOTO_TRICK".equalsIgnoreCase(String.valueOf(rawCb));
            boolean itemColorBackground = isRedPhotoTrick || (rawCb != null && (Boolean.TRUE.equals(rawCb) || "true".equalsIgnoreCase(String.valueOf(rawCb)) || "COLOR_BACKGROUND".equalsIgnoreCase(String.valueOf(rawCb))));

            boolean forceRefresh = "true".equalsIgnoreCase(String.valueOf(requestBody.get("forceRefresh")));
            String currentUrl = urls.get(i);
            // Bài Reddit (hộp duyệt Kho Nguồn) đã có sẵn caption + ảnh: không cào lại link (reddit.com bị chặn
            // DNS ở mạng này và cũng bắt đăng nhập) mà lưu thẳng như bài tự soạn, giữ link gốc để ghi nguồn.
            boolean isRedditPost = RedditService.isRedditPostUrl(currentUrl)
                    && itemCustomCaption != null && !itemCustomCaption.trim().isEmpty();
            boolean isManualPost = currentUrl.startsWith("manual://") || isRedditPost
                    || (itemCustomCaption != null && !itemCustomCaption.trim().isEmpty() && (!currentUrl.startsWith("http://") && !currentUrl.startsWith("https://")));

            if (isRedditPost && itemCustomMedia != null && itemCustomMedia.contains("https://v.redd.it/")) {
                // Video Reddit: hình và tiếng là 2 file riêng → tải về, ghép bằng ffmpeg rồi đăng file đã ghép
                List<String> merged = new ArrayList<>();
                for (String m : itemCustomMedia.split(",")) {
                    String u = m.trim();
                    if (u.startsWith("https://v.redd.it/")) {
                        try {
                            u = ServletUriComponentsBuilder.fromCurrentContextPath().path(redditService.downloadVideoWithAudio(u)).toUriString();
                        } catch (Exception e) {
                            return ResponseEntity.internalServerError().body(Map.of("success", false, "message", "Không tải được video Reddit: " + e.getMessage()));
                        }
                    }
                    if (!u.isEmpty()) merged.add(u);
                }
                itemCustomMedia = String.join(",", merged);
            }

            if (isManualPost) {
                String postType = isRedPhotoTrick ? "RED_PHOTO_TRICK" : (itemColorBackground ? "COLOR_BACKGROUND" : "TEXT");
                if (!itemColorBackground && itemCustomMedia != null && !itemCustomMedia.isBlank()) {
                    boolean hasVideo = itemCustomMedia.matches("(?i).*\\.(mp4|mov|webm|mkv|avi).*") || itemCustomMedia.contains("video");
                    postType = hasVideo ? "VIDEO" : (itemCustomMedia.contains(",") ? "ALBUM" : "IMAGE");
                }
                PostQueue manualPost = PostQueue.builder()
                        .campaign(quickPostCampaign)
                        .title(itemCustomCaption != null && itemCustomCaption.length() > 80 ? itemCustomCaption.substring(0, 80) : "Bài viết tự soạn")
                        .content(itemCustomCaption != null ? itemCustomCaption : "")
                        .mediaUrls(itemColorBackground && !isRedPhotoTrick ? "" : (itemCustomMedia != null ? itemCustomMedia : ""))
                        .originalUrl(currentUrl.startsWith("manual://") || isRedditPost ? currentUrl : "manual://" + System.currentTimeMillis() + "_" + i)
                        .postType(postType)
                        .targetFanpageId(itemTargetFanpageId)
                        .targetGroupNames(itemTargetGroupNames)
                        .affiliateLink(itemAffiliateLink)
                        .enableGroupComment(itemGroupCommentEnabled)
                        .scheduledAt(scheduledAtForItem)
                        .status("PENDING")
                        .retryCount(0)
                        .build();

                if (publishingPreflightService != null && itemTargetFanpageId != null) {
                    SocialAccount targetAcc = resolvePersonalCookieAccount(user, itemTargetFanpageId, null);
                    com.autopost.saas.publishing.model.PreflightResult preflight = publishingPreflightService.validatePost(targetAcc, manualPost);
                    if (!preflight.isValid()) {
                        manualPost.setStatus("FAILED");
                        manualPost.setErrorMessage("Preflight chặn xuất bản: " + String.join(" | ", preflight.getErrors()));
                        log.warn("🛑 [addFromUrls] Bài viết #{} không đạt tiêu chuẩn Preflight: {}", i, manualPost.getErrorMessage());
                    }
                }

                manualPostsToSave.add(manualPost);
                continue;
            }

            if (publishNow) {
                // Đăng ngay bắt buộc phải có nội dung cào xong trước -> giữ nguyên luồng đồng bộ cũ.
                try {
                    ScraperService.ScrapeResult result = scraperService.scrapeAndQueueQuickPostWithCacheInfo(tempCampaign, scheduledAtForItem, itemTargetFanpageId, forceRefresh);
                    List<PostQueue> scraped = result.posts;
                    if (result.cached) {
                        allCachedUrls.add(urls.get(i));
                    }
                    for (PostQueue p : scraped) {
                        if (itemTargetGroupNames != null) {
                            p.setTargetGroupNames(itemTargetGroupNames);
                        }
                        if (itemAffiliateLink != null && !itemAffiliateLink.isEmpty()) {
                            p.setAffiliateLink(itemAffiliateLink);
                        }
                        p.setEnableGroupComment(itemGroupCommentEnabled);
                        if (itemCustomCaption != null && !itemCustomCaption.isEmpty()) {
                            p.setContent(itemCustomCaption);
                            p.setTitle(itemCustomCaption.length() > 100 ? itemCustomCaption.substring(0, 100) : itemCustomCaption);
                        }
                        if (itemCustomMedia != null && !itemCustomMedia.isEmpty()) {
                            p.setMediaUrls(itemCustomMedia);
                        }
                        if (isRedPhotoTrick) {
                            p.setPostType("RED_PHOTO_TRICK");
                            if (itemCustomMedia != null && !itemCustomMedia.isEmpty()) {
                                p.setMediaUrls(itemCustomMedia);
                            } else if (p.getMediaUrls() != null && p.getMediaUrls().contains(",")) {
                                p.setMediaUrls(p.getMediaUrls().split(",")[0].trim());
                            }
                        } else if (itemColorBackground) {
                            p.setPostType("COLOR_BACKGROUND");
                            p.setMediaUrls("");
                        }
                    }
                    if (!scraped.isEmpty()) {
                        postQueueRepository.saveAll(scraped);
                    }
                    allCreated.addAll(scraped);
                } catch (Exception e) {
                    return ResponseEntity.internalServerError().body(Map.of("success", false, "message", "Cào bài thất bại cho URL '" + urls.get(i) + "': " + e.getMessage()));
                }
            } else {
                // Lưu ngay bản ghi PENDING (đặt chỗ) để người dùng thấy bài vào hàng đợi tức thì, rồi
                // cào nội dung thật ở nền và cập nhật lại đúng bản ghi này sau (không chặn request).
                List<PostQueue> placeholders = scraperService.createPendingPlaceholders(quickPostCampaign, urls.get(i), scheduledAtForItem, itemTargetFanpageId);
                for (PostQueue p : placeholders) {
                    if (itemTargetGroupNames != null) {
                        p.setTargetGroupNames(itemTargetGroupNames);
                    }
                    if (itemAffiliateLink != null && !itemAffiliateLink.isEmpty()) {
                        p.setAffiliateLink(itemAffiliateLink);
                    }
                    p.setEnableGroupComment(itemGroupCommentEnabled);
                    if (itemCustomCaption != null && !itemCustomCaption.isEmpty()) {
                        p.setContent(itemCustomCaption);
                        p.setTitle(itemCustomCaption.length() > 100 ? itemCustomCaption.substring(0, 100) : itemCustomCaption);
                    }
                    if (itemCustomMedia != null && !itemCustomMedia.isEmpty()) {
                        p.setMediaUrls(itemCustomMedia);
                    }
                    if (isRedPhotoTrick) {
                        p.setPostType("RED_PHOTO_TRICK");
                        if (itemCustomMedia != null && !itemCustomMedia.isEmpty()) {
                            p.setMediaUrls(itemCustomMedia);
                        } else if (p.getMediaUrls() != null && p.getMediaUrls().contains(",")) {
                            p.setMediaUrls(p.getMediaUrls().split(",")[0].trim());
                        }
                    } else if (itemColorBackground) {
                        p.setPostType("COLOR_BACKGROUND");
                        p.setMediaUrls("");
                    }
                }
                if (!placeholders.isEmpty()) {
                    postQueueRepository.saveAll(placeholders);
                }
                allCreated.addAll(placeholders);

                List<Long> placeholderIds = placeholders.stream().map(PostQueue::getId).toList();
                scraperService.scrapeAndFillPlaceholdersAsync(placeholderIds, urls.get(i), tempCampaign.getSourceType(), tempCampaign.getIncludeCredit(), forceRefresh);
            }
        }

        if (!manualPostsToSave.isEmpty()) {
            List<PostQueue> saved = postQueueRepository.saveAll(manualPostsToSave);
            allCreated.addAll(saved);
        }

        if (publishNow && !allCreated.isEmpty()) {
            boolean anyFailed = false;
            String firstErrorMessage = null;
            for (PostQueue createdPost : allCreated) {
                PostQueue freshPost = postQueueRepository.findById(createdPost.getId()).orElse(createdPost);
                if ("PENDING".equals(freshPost.getStatus())) {
                    boolean published = postQueueService.publishPostNow(freshPost.getId());
                    if (!published) {
                        PostQueue updatedPost = postQueueRepository.findById(freshPost.getId()).orElse(freshPost);
                        if ("FAILED".equals(updatedPost.getStatus())) {
                            anyFailed = true;
                            if (firstErrorMessage == null) {
                                firstErrorMessage = updatedPost.getErrorMessage();
                            }
                        }
                    }
                }
            }
            if (anyFailed && firstErrorMessage != null) {
                return ResponseEntity.internalServerError().body(Map.of("success", false, "message", firstErrorMessage));
            }
        }

        // Chế độ "Nối đuôi liên tục" hoặc "Rải đều theo nhóm":
        boolean isSpreadGroups = "SPREAD_DAY".equalsIgnoreCase(String.valueOf(requestBody.get("groupTimingMode")));
        boolean appendToQueue = "QUEUE".equals(scheduleMode) && !isSpreadGroups;

        String skippedNote = skippedDuplicates.isEmpty() ? ""
                : " Bỏ qua " + skippedDuplicates.size() + " bài trùng đã có trong Lịch đăng cho cùng nhóm.";

        // Nếu người dùng chọn rải đều các nhóm
        if (!publishNow && !allCreated.isEmpty() && isSpreadGroups) {
            LocalDateTime spreadStart = null;
            LocalDateTime spreadEnd = null;
            if (requestBody.get("groupSpreadStart") != null && !requestBody.get("groupSpreadStart").toString().isBlank()) {
                try { spreadStart = LocalDateTime.parse(requestBody.get("groupSpreadStart").toString()); } catch (Exception ignored) {}
            }
            if (requestBody.get("groupSpreadEnd") != null && !requestBody.get("groupSpreadEnd").toString().isBlank()) {
                try { spreadEnd = LocalDateTime.parse(requestBody.get("groupSpreadEnd").toString()); } catch (Exception ignored) {}
            }
            Map<String, Object> spreadResult = campaignScheduler.spreadEvenlyByGroups(
                    allCreated.stream().map(PostQueue::getId).toList(), spreadStart, spreadEnd, null);

            String finishFormatted = spreadResult.get("estimatedFinishAt") != null
                    ? LocalDateTime.parse(spreadResult.get("estimatedFinishAt").toString()).format(java.time.format.DateTimeFormatter.ofPattern("HH:mm dd/MM"))
                    : "";
            return ResponseEntity.ok(Map.of(
                    "success", true,
                    "message", "🎯 Đã thêm " + allCreated.size() + " bài và rải đều lịch cho " + spreadResult.getOrDefault("groupCount", 0) + " nhóm"
                            + (!finishFormatted.isEmpty() ? ", dự kiến hoàn tất lúc " + finishFormatted : "") + "." + skippedNote,
                    "count", allCreated.size(),
                    "cachedUrls", allCachedUrls,
                    "skippedDuplicates", skippedDuplicates,
                    "estimatedFinishAt", spreadResult.getOrDefault("estimatedFinishAt", ""),
                    "items", allCreated.stream()
                            .map(p -> Map.of(
                                    "id", p.getId(),
                                    "originalUrl", p.getOriginalUrl() != null ? p.getOriginalUrl() : "",
                                    "status", p.getStatus() != null ? p.getStatus() : ""))
                            .toList()
            ));
        }
        // Bài hẹn giờ (không phải "Đăng ngay") rơi ngoài khung giờ đăng chung → đưa vào trong khung
        int windowDeferred = 0;
        int windowMoved = 0;
        if (!publishNow && !allCreated.isEmpty() && !appendToQueue && !isSpreadGroups && postingWindowService.get().enabled()) {
            Map<String, Object> fitted = campaignScheduler.fitIntoWindow(allCreated.stream().map(PostQueue::getId).toList());
            windowMoved = ((Number) fitted.getOrDefault("updated", 0)).intValue();
            windowDeferred = ((Number) fitted.getOrDefault("deferredCount", 0)).intValue();
        }
        // "Hẹn giờ" nhiều bài chỉ với 1 mốc (không gửi giờ riêng từng bài): bắt đầu từ mốc đó, mỗi nick nối đuôi
        if ("AT".equals(scheduleMode) && scheduledTimes == null && !allCreated.isEmpty()
                && requestBody.get("scheduleMode") != null) {
            int gapSeconds = parseGapSeconds(requestBody.get("gapSeconds"));
            if (gapSeconds <= 0 && requestBody.get("intervalMinutes") instanceof Number n) {
                gapSeconds = n.intValue() * 60;
            }
            if (gapSeconds <= 0) gapSeconds = postingWindowService.defaultGapSeconds();
            campaignScheduler.packContinuousFrom(allCreated.stream().map(PostQueue::getId).toList(),
                    gapSeconds, baseScheduledAt);
        }
        String windowNote = windowMoved == 0 ? ""
                : " " + windowMoved + " bài hẹn ngoài khung giờ đăng đã được dời vào khung"
                        + (windowDeferred > 0 ? " (" + windowDeferred + " bài không kịp hôm nay, xem đề xuất ở mục Khung giờ đăng)." : ".");

        if (appendToQueue && !publishNow && !allCreated.isEmpty()) {
            int gapSeconds = parseGapSeconds(requestBody.get("gapSeconds"));
            if (gapSeconds <= 0 && requestBody.get("intervalMinutes") instanceof Number n) {
                gapSeconds = n.intValue() * 60;
            }
            if (gapSeconds <= 0) gapSeconds = postingWindowService.defaultGapSeconds();
            // Chỉ xếp nối đuôi cho các bài MỚI tạo (allCreated), giữ nguyên giờ các bài cũ đang chờ
            Map<String, Object> packed = campaignScheduler.packContinuous(
                    allCreated.stream().map(PostQueue::getId).toList(), gapSeconds);
            return ResponseEntity.ok(Map.of(
                    "success", true,
                    "message", "Đã thêm " + allCreated.size() + " bài và rải đều lịch đăng trong ngày, dự kiến xong lúc "
                            + LocalDateTime.parse(packed.get("estimatedFinishAt").toString())
                                    .format(java.time.format.DateTimeFormatter.ofPattern("HH:mm dd/MM")) + "." + skippedNote
                            + (((Number) packed.getOrDefault("deferredCount", 0)).intValue() > 0
                                    ? " " + packed.get("deferredCount") + " bài không kịp trong khung giờ hôm nay, đã tạm dời sang hôm sau — xem đề xuất ở mục Khung giờ đăng."
                                    : ""),
                    "count", allCreated.size(),
                    "cachedUrls", allCachedUrls,
                    "skippedDuplicates", skippedDuplicates,
                    "estimatedFinishAt", packed.get("estimatedFinishAt"),
                    "items", allCreated.stream()
                            .map(p -> Map.of(
                                    "id", p.getId(),
                                    "originalUrl", p.getOriginalUrl() != null ? p.getOriginalUrl() : "",
                                    "status", p.getStatus() != null ? p.getStatus() : ""))
                            .toList()
            ));
        }
        return ResponseEntity.ok(Map.of(
                "success", true,
                "message", allCreated.isEmpty() && !skippedDuplicates.isEmpty()
                        ? "Không thêm bài nào: tất cả " + skippedDuplicates.size() + " bài đều đã có trong Lịch đăng cho cùng nhóm."
                        : "Đã xử lý " + allCreated.size() + " bài viết thành công!" + skippedNote + windowNote,
                "count", allCreated.size(),
                "cachedUrls", allCachedUrls,
                "skippedDuplicates", skippedDuplicates,
                "items", allCreated.stream()
                        .map(p -> Map.of(
                                "id", p.getId(),
                                "originalUrl", p.getOriginalUrl() != null ? p.getOriginalUrl() : "",
                                "status", p.getStatus() != null ? p.getStatus() : ""))
                        .toList()
        ));
    }

    /**
     * Các nhóm đích của bài này đã có cùng bài gốc (cùng ID bài) trong Lịch đăng — kể cả bài vừa thêm
     * ở chính request này. Rỗng nếu không trùng, không nhận ra ID bài, hoặc bài không đăng vào nhóm.
     */
    private List<String> findDuplicateGroupTargets(Long userId, String url, String targetGroupNames,
                                                   Map<String, java.util.Set<String>> queuedInThisRequest) {
        if (com.autopost.saas.util.FacebookPostIds.isDuplicateExemptGroup(targetGroupNames)) {
            return List.of(); // Nhóm Đảo & Tinder Pet: cho phép đăng lại thoải mái
        }
        java.util.Set<String> targetGroups = com.autopost.saas.util.FacebookPostIds.targetGroupKeys(targetGroupNames);
        if (targetGroups.isEmpty() || url == null || url.startsWith("manual://")) return List.of();
        String postId = com.autopost.saas.util.FacebookPostIds.extractPostId(url);
        if (postId == null) return List.of();

        java.util.Set<String> duplicates = new java.util.LinkedHashSet<>();
        java.util.Set<String> sameRequest = queuedInThisRequest.get(postId);
        if (sameRequest != null) {
            for (String g : targetGroups) {
                if (sameRequest.contains(g)) duplicates.add(g);
            }
        }
        for (PostQueue existing : postQueueRepository.findActiveByUserIdAndOriginalUrlContaining(userId, postId)) {
            if (!postId.equalsIgnoreCase(com.autopost.saas.util.FacebookPostIds.extractPostId(existing.getOriginalUrl()))) continue;
            java.util.Set<String> existingGroups = com.autopost.saas.util.FacebookPostIds.targetGroupKeys(existing.getTargetGroupNames());
            for (String g : targetGroups) {
                if (existingGroups.contains(g)) duplicates.add(g);
            }
        }
        return new ArrayList<>(duplicates);
    }

    /** Đổi ID nhóm sang tên nhóm đã khai báo (nếu có) để thông báo dễ đọc. */
    private List<String> resolveGroupDisplayNames(List<String> groupKeys) {
        return resolveGroupDisplayNames(groupKeys, loadGroupDisplayNamesMap());
    }

    private List<String> resolveGroupDisplayNames(List<String> groupKeys, Map<String, String> names) {
        if (names == null || names.isEmpty()) return groupKeys;
        return groupKeys.stream().map(k -> names.getOrDefault(k.trim().toLowerCase(), k)).toList();
    }

    private Map<String, String> loadGroupDisplayNamesMap() {
        Map<String, String> names = new java.util.HashMap<>();
        for (SocialAccount a : socialAccountRepository.findAll()) {
            if ("FACEBOOK_GROUP".equals(a.getPlatform()) && a.getPlatformAccountId() != null && a.getPageName() != null) {
                names.put(a.getPlatformAccountId().trim().toLowerCase(), a.getPageName());
            }
        }
        return names;
    }

    private static boolean appendToQueueRequested(Map<String, Object> requestBody) {
        return Boolean.TRUE.equals(requestBody.get("appendToQueue")) || "true".equals(String.valueOf(requestBody.get("appendToQueue")));
    }

    /**
     * Chế độ chọn giờ: "scheduleMode" = NOW | QUEUE | AT. Request cũ (publishNow / appendToQueue) vẫn được hiểu
     * để không gãy các client chưa cập nhật.
     */
    static String resolveScheduleMode(Map<String, Object> body) {
        Object raw = body.get("scheduleMode");
        if (raw != null) {
            String v = raw.toString().trim().toUpperCase();
            if (v.equals("NOW") || v.equals("QUEUE") || v.equals("AT")) return v;
        }
        Object pn = body.get("publishNow");
        if (Boolean.TRUE.equals(pn) || "true".equalsIgnoreCase(String.valueOf(pn))) return "NOW";
        if (appendToQueueRequested(body)) return "QUEUE";
        return "AT";
    }

    /** Khung giờ đăng chung (VD 09:00–23:00) — ngoài khung scheduler không tự đăng bài theo lịch. */
    @GetMapping("/posting-window")
    public ResponseEntity<Map<String, Object>> getPostingWindow() {
        com.autopost.saas.scheduler.PostingWindow w = postingWindowService.get();
        return ResponseEntity.ok(Map.of(
                "enabled", w.enabled(),
                "start", w.start().toString(),
                "end", w.end().toString(),
                "minGapSeconds", w.minGapSeconds(),
                "maxPostsPerHourPerNick", postingWindowService.maxPostsPerHourPerNick()));
    }

    /** Lưu khung giờ; khi bật thì đưa ngay các bài đang hẹn ngoài khung vào trong khung. */
    @PutMapping("/posting-window")
    public ResponseEntity<Map<String, Object>> savePostingWindow(@RequestBody Map<String, Object> body) {
        try {
            com.autopost.saas.scheduler.PostingWindow current = postingWindowService.get();
            boolean enabled = body.get("enabled") != null ? Boolean.parseBoolean(body.get("enabled").toString()) : current.enabled();
            java.time.LocalTime start = body.get("start") != null ? java.time.LocalTime.parse(body.get("start").toString()) : current.start();
            java.time.LocalTime end = body.get("end") != null ? java.time.LocalTime.parse(body.get("end").toString()) : current.end();
            long minGap = body.get("minGapSeconds") != null ? Long.parseLong(body.get("minGapSeconds").toString()) : current.minGapSeconds();
            com.autopost.saas.scheduler.PostingWindow saved = postingWindowService.save(
                    new com.autopost.saas.scheduler.PostingWindow(enabled, start, end, Math.max(0, minGap)));
            Map<String, Object> result = new java.util.LinkedHashMap<>();
            result.put("success", true);
            result.put("enabled", saved.enabled());
            result.put("start", saved.start().toString());
            result.put("end", saved.end().toString());
            result.put("minGapSeconds", saved.minGapSeconds());
            if (body.get("maxPostsPerHourPerNick") != null) {
                postingWindowService.saveMaxPostsPerHourPerNick(Integer.parseInt(body.get("maxPostsPerHourPerNick").toString()));
            }
            result.put("maxPostsPerHourPerNick", postingWindowService.maxPostsPerHourPerNick());
            boolean rescheduleExisting = Boolean.parseBoolean(String.valueOf(body.get("rescheduleExisting")));
            if (saved.enabled() && rescheduleExisting) {
                Map<String, Object> fitted = campaignScheduler.spreadEvenly((int) saved.minGapSeconds());
                result.put("movedIntoWindow", fitted.get("updated"));
                result.put("deferredCount", fitted.get("deferredCount"));
            }
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", "Khung giờ không hợp lệ: " + e.getMessage()));
        }
    }

    /** Bài dư (không kịp trong khung giờ) theo từng nick + đề xuất chuyển sang nick khác. */
    @GetMapping("/window-plan")
    public ResponseEntity<Map<String, Object>> getWindowPlan() {
        return ResponseEntity.ok(campaignScheduler.windowPlanReport());
    }

    /** Duyệt 1 đề xuất: chuyển các bài dư sang nick đích rồi xếp lại vào khung giờ. Body: {postIds, toTargetFanpageId}. */
    @PostMapping("/window-plan/apply")
    public ResponseEntity<Map<String, Object>> applyWindowPlan(@RequestBody Map<String, Object> body) {
        try {
            List<Long> ids = body.get("postIds") instanceof List<?> l
                    ? l.stream().map(o -> Long.valueOf(o.toString())).toList()
                    : List.of();
            if (ids.isEmpty()) {
                return ResponseEntity.badRequest().body(Map.of("success", false, "message", "Chưa chọn bài nào"));
            }
            Map<String, Object> result = new java.util.LinkedHashMap<>(campaignScheduler.applyWindowSuggestion(ids, (String) body.get("toTargetFanpageId")));
            result.put("success", true);
            return ResponseEntity.ok(result);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", e.getMessage()));
        }
    }

    /**
     * Chuyển nick / chia đều sang nhiều Nick (Cân bằng tải) cho danh sách bài được chọn.
     * Body: { postIds: [...], targetFanpageIds: [...], rescheduleToday: true }
     */
    @PostMapping("/reassign-nicks")
    public ResponseEntity<Map<String, Object>> reassignNicks(@RequestBody Map<String, Object> body) {
        try {
            List<Long> postIds = body.get("postIds") instanceof List<?> l
                    ? l.stream().map(o -> Long.valueOf(o.toString())).toList()
                    : List.of();
            List<String> targetFanpageIds = body.get("targetFanpageIds") instanceof List<?> l
                    ? l.stream().map(Object::toString).filter(s -> !s.isBlank()).toList()
                    : List.of();
            if (postIds.isEmpty()) {
                return ResponseEntity.badRequest().body(Map.of("success", false, "message", "Vui lòng chọn ít nhất 1 bài viết để chuyển"));
            }
            if (targetFanpageIds.isEmpty()) {
                return ResponseEntity.badRequest().body(Map.of("success", false, "message", "Vui lòng chọn ít nhất 1 Nick / Via đích"));
            }
            boolean rescheduleToday = body.get("rescheduleToday") == null
                    || Boolean.parseBoolean(body.get("rescheduleToday").toString());

            List<PostQueue> posts = postQueueRepository.findAllById(postIds);
            List<PostQueue> updated = new ArrayList<>();
            for (int i = 0; i < posts.size(); i++) {
                PostQueue p = posts.get(i);
                if (!"PENDING".equals(p.getStatus())) continue;
                String assignedTarget = targetFanpageIds.get(i % targetFanpageIds.size());
                p.setTargetFanpageId(assignedTarget);
                p.setWindowDeferred(null); // Gỡ cờ bị hoãn sang ngày mai
                updated.add(p);
            }
            postQueueRepository.saveAll(updated);

            Map<String, Object> result = new java.util.LinkedHashMap<>();
            result.put("success", true);
            result.put("updatedCount", updated.size());
            result.put("targetCount", targetFanpageIds.size());

            if (rescheduleToday && !updated.isEmpty()) {
                int gapSeconds = postingWindowService.defaultGapSeconds();
                // Chỉ dồn lịch cho các bài vừa chuyển nick vào làn mới, không xáo trộn toàn bộ hàng đợi
                Map<String, Object> packed = campaignScheduler.packContinuous(
                        updated.stream().map(PostQueue::getId).toList(), gapSeconds);
                result.putAll(packed);
            }
            log.info("🔀 [Cân bằng tải] Đã chuyển {} bài sang {} Nick (rescheduleToday={})",
                    updated.size(), targetFanpageIds.size(), rescheduleToday);
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            log.error("❌ Lỗi reassign-nicks: {}", e.getMessage(), e);
            return ResponseEntity.internalServerError().body(Map.of("success", false, "message", e.getMessage()));
        }
    }

    /** Giãn cách: mặc định lấy từ cài đặt lịch đăng chung, chỉ ghi đè khi request gửi rõ gapSeconds. */
    private int parseGapSeconds(Object raw) {
        int fallback = postingWindowService.defaultGapSeconds();
        try {
            int value = raw == null ? fallback : Integer.parseInt(raw.toString());
            return Math.max(0, Math.min(value, 3600));
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    /**
     * Dồn hàng đợi chạy liên tục: xếp lại giờ các bài PENDING để mỗi nick đăng nối tiếp nhau từ bây giờ
     * (nghỉ gapSeconds giữa 2 bài), các nick khác nhau chạy song song. Body: {gapSeconds?, ids?}.
     */
    @PostMapping("/pack-continuous")
    public ResponseEntity<Map<String, Object>> packContinuous(@RequestBody(required = false) Map<String, Object> body) {
        int gapSeconds = parseGapSeconds(body != null ? body.get("gapSeconds") : null);
        List<Long> ids = null;
        if (body != null && body.get("ids") instanceof List<?> rawIds && !rawIds.isEmpty()) {
            ids = rawIds.stream().map(v -> Long.parseLong(v.toString())).toList();
        }
        Map<String, Object> result = new java.util.LinkedHashMap<>(campaignScheduler.packContinuous(ids, gapSeconds));
        result.put("success", true);
        return ResponseEntity.ok(result);
    }

    /**
     * Phân bổ đều toàn bộ các nhóm (Group-Interleaved Day Distribution):
     * Xếp lại giờ các bài PENDING của từng nhóm xen kẽ nhau, rải đều suốt ngày/khung thời gian.
     * Body: { ids?: Long[], startTime?: string, endTime?: string, minGroupGapMinutes?: number }
     */
    @PostMapping("/spread-groups")
    public ResponseEntity<Map<String, Object>> spreadGroups(@RequestBody(required = false) Map<String, Object> body) {
        List<Long> ids = null;
        if (body != null && body.get("ids") instanceof List<?> rawIds && !rawIds.isEmpty()) {
            ids = rawIds.stream().map(v -> Long.parseLong(v.toString())).toList();
        }
        LocalDateTime start = null;
        LocalDateTime end = null;
        Integer minGapMinutes = null;
        if (body != null) {
            if (body.get("startTime") != null && !body.get("startTime").toString().isBlank()) {
                try {
                    start = LocalDateTime.parse(body.get("startTime").toString());
                } catch (Exception ignored) {}
            }
            if (body.get("endTime") != null && !body.get("endTime").toString().isBlank()) {
                try {
                    end = LocalDateTime.parse(body.get("endTime").toString());
                } catch (Exception ignored) {}
            }
            if (body.get("minGroupGapMinutes") != null) {
                try {
                    minGapMinutes = Integer.parseInt(body.get("minGroupGapMinutes").toString());
                } catch (Exception ignored) {}
            }
        }
        Map<String, Object> result = campaignScheduler.spreadEvenlyByGroups(ids, start, end, minGapMinutes);
        return ResponseEntity.ok(result);
    }

    @PostMapping("/{id}/publish")
    public ResponseEntity<Map<String, Object>> publishPostNow(@PathVariable Long id) {
        boolean success = postQueueService.publishPostNow(id);
        return ResponseEntity.ok(Map.of("success", success));
    }

    /**
     * Bài đã lên Page nhưng lỗi một phần Group: chỉ thử lại các Group có
     * kết quả gần nhất là FAILED. Không đăng lại Page/Group đã thành công.
     */
    @PostMapping("/{id}/retry-failed-groups")
    public ResponseEntity<?> retryFailedGroups(@PathVariable Long id) {
        try {
            return ResponseEntity.ok(postQueueService.retryFailedGroups(id));
        } catch (IllegalArgumentException | IllegalStateException e) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", e.getMessage()));
        } catch (Exception e) {
            log.error("❌ Thử lại Group lỗi cho Post ID {} thất bại: {}", id, e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of(
                    "success", false,
                    "message", "Thử lại Group lỗi thất bại: " + e.getMessage()));
        }
    }

    /** UI poll endpoint này trong lúc request retry Group đang chạy. */
    @GetMapping("/{id}/retry-failed-groups/progress")
    public ResponseEntity<PostQueueService.GroupRetryProgress> getRetryFailedGroupsProgress(@PathVariable Long id) {
        return ResponseEntity.ok(postQueueService.getFailedGroupRetryProgress(id));
    }

    /**
     * Thống kê hiệu suất (reach, tương tác, like/comment/share) của 1 bài đã đăng — chỉ hoạt động với
     * bài đăng qua Graph API (account PAGE_TOKEN) vì cần fbPostId thật; bài đăng qua Playwright cookie
     * không tra được insights do không đi qua Graph API khi đăng.
     */
    @GetMapping("/{id}/insights")
    public ResponseEntity<Map<String, Object>> getPostInsights(@PathVariable Long id) {
        PostQueue post = postQueueRepository.findByIdWithCampaignAndUser(id).orElse(null);
        if (post == null) {
            return ResponseEntity.notFound().build();
        }
        if (post.getFbPostId() == null || post.getFbPostId().trim().isEmpty()) {
            return ResponseEntity.ok(Map.of("success", false, "message", "Bài này không có insights (chỉ hỗ trợ bài đăng qua Graph API/PAGE_TOKEN)"));
        }
        String targetId = post.getTargetFanpageId();
        String realPlatformId = targetId != null ? targetId.split(":", -1)[0].trim() : null;
        List<SocialAccount> candidateAccounts = realPlatformId == null
                ? socialAccountRepository.findByAccountType("PAGE_TOKEN")
                : socialAccountRepository.findByAccountTypeAndPlatformAccountId("PAGE_TOKEN", realPlatformId);
        SocialAccount account = candidateAccounts.stream().findFirst().orElse(null);
        if (account == null) {
            return ResponseEntity.ok(Map.of("success", false, "message", "Không tìm thấy Fanpage PAGE_TOKEN tương ứng để tra insights"));
        }
        Map<String, Object> insights = facebookGraphApiService.getPostInsights(post.getFbPostId(), account.getAccessToken());
        return ResponseEntity.ok(Map.of("success", true, "insights", insights));
    }

    /** Danh sách bài cào tự động hàng loạt (không phải Quick Post) đang chờ duyệt trước khi lên lịch đăng thật. */
    @GetMapping("/pending-approval")
    public ResponseEntity<List<PostQueue>> getPendingApproval(Authentication authentication) {
        User user = resolveUser(authentication);
        return ResponseEntity.ok(postQueueRepository.findPendingApprovalByUserId(user.getId()));
    }

    /** Duyệt 1 bài đang chờ duyệt — chuyển về PENDING để scheduler đăng theo giờ đã định. */
    @PostMapping("/{id}/approve")
    public ResponseEntity<Map<String, Object>> approvePost(@PathVariable Long id) {
        PostQueue post = postQueueRepository.findById(id).orElse(null);
        if (post == null) {
            return ResponseEntity.notFound().build();
        }
        if (!"PENDING_APPROVAL".equals(post.getStatus())) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", "Bài này không ở trạng thái chờ duyệt"));
        }
        // Giờ hẹn đăng được tính lúc cào (dựa trên thời điểm cào), nếu người duyệt xử lý muộn thì giờ
        // đó có thể đã qua — dời lên 1 phút tới thay vì để bài kẹt mãi vì scheduler chỉ xét tương lai.
        if (post.getScheduledAt() == null || post.getScheduledAt().isBefore(LocalDateTime.now())) {
            post.setScheduledAt(LocalDateTime.now().plusMinutes(1));
        }
        post.setStatus("PENDING");
        postQueueRepository.save(post);
        return ResponseEntity.ok(Map.of("success", true, "item", post));
    }

    /** Từ chối 1 bài đang chờ duyệt — chuyển sang CANCELLED, không đăng. */
    @PostMapping("/{id}/reject")
    public ResponseEntity<Map<String, Object>> rejectPost(@PathVariable Long id) {
        PostQueue post = postQueueRepository.findById(id).orElse(null);
        if (post == null) {
            return ResponseEntity.notFound().build();
        }
        if (!"PENDING_APPROVAL".equals(post.getStatus())) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", "Bài này không ở trạng thái chờ duyệt"));
        }
        post.setStatus("CANCELLED");
        postQueueRepository.save(post);
        return ResponseEntity.ok(Map.of("success", true));
    }

    /** Đổi giờ đăng của 1 bài (kéo-thả trên Lịch đăng bài) — chỉ cho phép khi bài còn PENDING. */
    @PatchMapping("/{id}/schedule")
    public ResponseEntity<Map<String, Object>> reschedule(@PathVariable Long id, @RequestBody Map<String, String> requestBody) {
        String scheduledAtRaw = requestBody.get("scheduledAt");
        if (scheduledAtRaw == null || scheduledAtRaw.trim().isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", "Thiếu scheduledAt"));
        }
        try {
            LocalDateTime newScheduledAt = LocalDateTime.parse(scheduledAtRaw);
            PostQueue updated = postQueueService.reschedulePost(id, newScheduledAt);
            return ResponseEntity.ok(Map.of("success", true, "item", updated));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", e.getMessage()));
        } catch (IllegalStateException e) {
            return ResponseEntity.status(409).body(Map.of("success", false, "message", e.getMessage()));
        } catch (java.time.format.DateTimeParseException e) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", "scheduledAt không đúng định dạng"));
        }
    }

    /** Sửa tay caption của 1 bài trong hàng đợi trước khi đăng. */
    @PutMapping("/{id}/content")
    public ResponseEntity<Map<String, Object>> updateContent(@PathVariable Long id, @RequestBody Map<String, String> requestBody) {
        String content = requestBody.get("content");
        if (content == null) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", "Thiếu content"));
        }
        try {
            PostQueue updated = postQueueService.updateContent(id, content);
            return ResponseEntity.ok(Map.of("success", true, "item", updated));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", e.getMessage()));
        }
    }



    @PostMapping("/post-to-group")
    public ResponseEntity<Map<String, Object>> postToGroup(
            @RequestBody Map<String, Object> requestBody,
            Authentication authentication
    ) {
        String url = (String) requestBody.get("url");
        String targetGroupId = (String) requestBody.get("targetGroupId");
        String pageId = (String) requestBody.get("pageId");
        String targetFanpageId = (String) requestBody.get("targetFanpageId");

        if (url == null || url.trim().isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", "Thiếu url"));
        }
        if (targetGroupId == null || targetGroupId.trim().isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", "Thiếu targetGroupId"));
        }
        if ((pageId == null || pageId.trim().isEmpty()) && (targetFanpageId == null || targetFanpageId.trim().isEmpty())) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", "Thiếu pageId (Fanpage muốn đăng dưới danh nghĩa)"));
        }

        User user = resolveUser(authentication);
        SocialAccount account = resolvePersonalCookieAccount(user, targetFanpageId, pageId);
        if (account == null) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", "Không tìm thấy Fanpage đã kết nối với ID: " + (pageId != null ? pageId : targetFanpageId)));
        }

        try {
            List<Map<String, Object>> items = scraperService.fetchScrapedItems(url, "DIRECT_LINK", 1, false, account.getAccessToken());
            if (items.isEmpty()) {
                return ResponseEntity.badRequest().body(Map.of("success", false, "message", "Không cào được nội dung từ link này"));
            }
            Map<String, Object> item = items.get(0);
            String content = (String) item.get("content");
            List<String> mediaList = (List<String>) item.get("mediaUrls");
            String mediaUrls = mediaList != null && !mediaList.isEmpty() ? String.join(",", mediaList) : "";
            String originalUrl = (String) item.get("originalUrl");

            postQueueService.publishToFacebookGroup(account, content, mediaUrls, originalUrl != null ? originalUrl : url, targetGroupId);
            return ResponseEntity.ok(Map.of("success", true, "message", "Đã đăng bài vào Group thành công"));
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of("success", false, "message", "Lỗi: " + e.getMessage()));
        }
    }

    @PostMapping("/post-urls-to-group")
    public ResponseEntity<Map<String, Object>> postUrlsToGroup(
            @RequestBody Map<String, Object> requestBody,
            Authentication authentication
    ) {
        @SuppressWarnings("unchecked")
        List<String> urls = (List<String>) requestBody.get("urls");
        if (urls == null || urls.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", "Thiếu danh sách urls"));
        }
        String targetGroupId = (String) requestBody.get("targetGroupId");
        String pageId = (String) requestBody.get("pageId");
        String targetFanpageId = (String) requestBody.get("targetFanpageId");
        if (targetGroupId == null || targetGroupId.trim().isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", "Thiếu targetGroupId"));
        }
        if ((pageId == null || pageId.trim().isEmpty()) && (targetFanpageId == null || targetFanpageId.trim().isEmpty())) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", "Thiếu pageId (Fanpage muốn đăng dưới danh nghĩa)"));
        }

        List<String> scheduledTimes = null;
        Object rawScheduledTimes = requestBody.get("scheduledTimes");
        if (rawScheduledTimes instanceof List<?> stList) {
            scheduledTimes = stList.stream().map(Object::toString).toList();
        }

        // Mặc định cũ của endpoint này là đăng ngay khi không gửi gì
        String groupScheduleMode = (requestBody.get("scheduleMode") == null && requestBody.get("publishNow") == null)
                ? "NOW" : resolveScheduleMode(requestBody);
        Boolean publishNow = "NOW".equals(groupScheduleMode);
        Integer intervalMinutes = requestBody.get("intervalMinutes") instanceof Number ? ((Number) requestBody.get("intervalMinutes")).intValue() : 20;
        List<Long> queuedGroupPostIds = new ArrayList<>();
        LocalDateTime baseScheduledAt = LocalDateTime.now();
        if (!publishNow) {
            String scheduledAtRaw = (String) requestBody.get("scheduledAt");
            if (scheduledAtRaw != null && !scheduledAtRaw.trim().isEmpty()) {
                try {
                    baseScheduledAt = LocalDateTime.parse(scheduledAtRaw);
                } catch (Exception e) {
                    baseScheduledAt = LocalDateTime.now();
                }
            } else if (scheduledTimes != null && !scheduledTimes.isEmpty() && scheduledTimes.get(0) != null) {
                try {
                    baseScheduledAt = LocalDateTime.parse(scheduledTimes.get(0));
                } catch (Exception e) {
                    baseScheduledAt = LocalDateTime.now();
                }
            }
        }

        String affiliateLink = (String) requestBody.get("affiliateLink");
        @SuppressWarnings("unchecked")
        List<String> affiliateLinks = (List<String>) requestBody.get("affiliateLinks");
        Object rawEnableGroup = requestBody.get("enableGroupComment");
        boolean groupCommentEnabled = rawEnableGroup != null
                ? (Boolean.TRUE.equals(rawEnableGroup) || "true".equalsIgnoreCase(rawEnableGroup.toString()) || "1".equals(rawEnableGroup.toString()))
                : ((affiliateLink != null && !affiliateLink.trim().isEmpty()) || (affiliateLinks != null && !affiliateLinks.isEmpty()));
        List<?> rawCustomCaptions = requestBody.get("customCaptions") instanceof List<?> cc ? cc : null;
        List<?> rawCustomMediaUrls = requestBody.get("customMediaUrls") instanceof List<?> cmu ? cmu : null;
        Boolean isAnonymous = requestBody.get("isAnonymous") instanceof Boolean b ? b : (requestBody.get("postAnonymous") instanceof Boolean b2 ? b2 : false);
        String groupPrefix = Boolean.TRUE.equals(isAnonymous) ? "GROUP_ONLY_ANON:" : "GROUP_ONLY:";

        User user = resolveUser(authentication);
        SocialAccount account = resolvePersonalCookieAccount(user, targetFanpageId, pageId);
        if (account == null) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", "Không tìm thấy Fanpage đã kết nối với ID: " + (pageId != null ? pageId : targetFanpageId)));
        }

        // Xoay vòng (round-robin) giữa TẤT CẢ via cá nhân còn hạn khi đăng ẩn danh HÀNG LOẠT mà người
        // dùng KHÔNG chỉ định rõ 1 via cụ thể — tránh dồn hết cả loạt bài vào đúng 1 via (dễ bị
        // Facebook đánh dấu đăng dồn dập/đá phiên đăng nhập). Nếu người dùng đã chọn rõ 1 via
        // (connectionId tường minh) thì tôn trọng lựa chọn đó cho toàn bộ batch, không tự ý xoay.
        boolean shouldRoundRobinVia = Boolean.TRUE.equals(isAnonymous) && !hasExplicitConnectionId(targetFanpageId, pageId);
        List<SocialAccount> roundRobinAccounts = shouldRoundRobinVia ? resolveAllPersonalProfileAccounts(user) : List.of();
        if (shouldRoundRobinVia && roundRobinAccounts.size() > 1) {
            log.info("🔀 Xoay vòng {} bài đăng ẩn danh giữa {} via cá nhân: {}", urls.size(), roundRobinAccounts.size(),
                    roundRobinAccounts.stream().map(SocialAccount::getPageName).toList());
        }

        Campaign quickPostCampaign = resolveQuickPostCampaign(user);
        List<Map<String, Object>> results = new ArrayList<>();
        int successCount = 0;
        for (int i = 0; i < urls.size(); i++) {
            String url = urls.get(i);
            String itemAffiliateLink = (affiliateLinks != null && affiliateLinks.size() > i && affiliateLinks.get(i) != null && !affiliateLinks.get(i).trim().isEmpty())
                    ? affiliateLinks.get(i).trim()
                    : (affiliateLink != null && !affiliateLink.trim().isEmpty() ? affiliateLink.trim() : null);
            String itemCustomCaption = (rawCustomCaptions != null && rawCustomCaptions.size() > i && rawCustomCaptions.get(i) != null)
                    ? rawCustomCaptions.get(i).toString().trim()
                    : null;
            String itemCustomMedia = (rawCustomMediaUrls != null && rawCustomMediaUrls.size() > i && rawCustomMediaUrls.get(i) != null)
                    ? rawCustomMediaUrls.get(i).toString().trim()
                    : null;

            LocalDateTime scheduledAtForItem;
            if (scheduledTimes != null && scheduledTimes.size() > i && scheduledTimes.get(i) != null && !scheduledTimes.get(i).trim().isEmpty()) {
                try {
                    scheduledAtForItem = LocalDateTime.parse(scheduledTimes.get(i));
                } catch (Exception ex) {
                    scheduledAtForItem = baseScheduledAt.plusMinutes((long) i * intervalMinutes);
                }
            } else {
                scheduledAtForItem = baseScheduledAt.plusMinutes((long) i * intervalMinutes);
            }

            // Via dùng cho ĐÚNG item này — xoay vòng qua roundRobinAccounts nếu đang bật, còn không thì
            // luôn dùng account đã resolve 1 lần ở trên (giữ nguyên hành vi cũ khi có via cụ thể).
            SocialAccount itemAccount = (shouldRoundRobinVia && !roundRobinAccounts.isEmpty())
                    ? roundRobinAccounts.get(i % roundRobinAccounts.size())
                    : account;

            PostQueue queueItem = null;
            try {
                String content = (itemCustomCaption != null && !itemCustomCaption.isEmpty()) ? itemCustomCaption : null;
                String mediaUrls = (itemCustomMedia != null && !itemCustomMedia.isEmpty()) ? itemCustomMedia : "";
                String originalUrl = url;
                String title = (content != null && !content.isEmpty())
                        ? (content.length() > 100 ? content.substring(0, 100) : content)
                        : "Bài đăng nhóm";

                if (content == null || content.trim().isEmpty() || mediaUrls.isEmpty()) {
                    @SuppressWarnings("unchecked")
                    List<Map<String, Object>> items = scraperService.fetchScrapedItems(url, "DIRECT_LINK", 1, false, itemAccount.getAccessToken());
                    if (!items.isEmpty()) {
                        Map<String, Object> item = items.get(0);
                        if (content == null || content.trim().isEmpty()) {
                            content = (String) item.get("content");
                        }
                        @SuppressWarnings("unchecked")
                        List<String> mediaList = (List<String>) item.get("mediaUrls");
                        if (mediaUrls.isEmpty() && mediaList != null && !mediaList.isEmpty()) {
                            mediaUrls = String.join(",", mediaList);
                        }
                        if (item.get("originalUrl") != null) originalUrl = (String) item.get("originalUrl");
                        if (item.get("title") != null && (title == null || title.equals("Bài đăng nhóm"))) {
                            title = (String) item.get("title");
                        }
                    } else if (content == null && mediaUrls.isEmpty()) {
                        results.add(Map.of("url", url, "success", false, "message", "Không cào được nội dung từ link này"));
                        continue;
                    }
                }

                // Giữ nguyên connectionId (itemAccount.getId()) ngay cả khi đăng ẩn danh — chuỗi
                // "PERSONAL_PROFILE" bare (không connectionId) khiến PostQueueService phải đoán
                // ngẫu nhiên (findFirst()) giữa nhiều via cá nhân (VD Thạnh Phú/Thanh An) thay vì
                // dùng đúng via đã chọn cho item này (có thể đến từ xoay vòng roundRobinAccounts ở
                // trên). Vẫn giữ tiền tố "PERSONAL_PROFILE" để các chỗ check isExplicitPersonal (dựa
                // trên .contains("PERSONAL_PROFILE")) hoạt động đúng.
                String effectiveFanpageTarget = Boolean.TRUE.equals(isAnonymous)
                        ? ("PERSONAL_PROFILE:" + (itemAccount.getAccountType() != null ? itemAccount.getAccountType() : "PERSONAL_PROFILE_COOKIE") + ":" + itemAccount.getId())
                        : (targetFanpageId != null && !targetFanpageId.trim().isEmpty()
                                ? targetFanpageId
                                : (itemAccount.getPlatformAccountId() + ":" + (itemAccount.getAccountType() != null ? itemAccount.getAccountType() : "PERSONAL_COOKIE") + ":" + itemAccount.getId()));

                boolean shouldPostImmediately = publishNow && i == 0;

                queueItem = PostQueue.builder()
                        .campaign(quickPostCampaign)
                        .originalUrl(originalUrl != null ? originalUrl : url)
                        .title(title != null && !title.isBlank() ? title : (content != null ? content.substring(0, Math.min(content.length(), 200)) : "Bài đăng nhóm"))
                        .content(content)
                        .mediaUrls(mediaUrls)
                        .targetFanpageId(effectiveFanpageTarget)
                        .targetGroupNames(groupPrefix + targetGroupId)
                        .affiliateLink(itemAffiliateLink)
                        .enableGroupComment(groupCommentEnabled)
                        .status(shouldPostImmediately ? "PROCESSING" : "PENDING")
                        .scheduledAt(scheduledAtForItem)
                        .build();
                queueItem = postQueueRepository.save(queueItem);

                if (shouldPostImmediately) {
                    postQueueService.publishToFacebookGroup(itemAccount, content, mediaUrls, originalUrl != null ? originalUrl : url, targetGroupId, itemAffiliateLink, queueItem, Boolean.TRUE.equals(isAnonymous));
                    queueItem.setStatus("PUBLISHED");
                    queueItem.setPublishedAt(LocalDateTime.now());
                    queueItem.setErrorMessage(null);
                    postQueueRepository.save(queueItem);
                    results.add(Map.of("url", url, "success", true, "message", "Đã đăng thành công"));
                    successCount++;
                } else {
                    queuedGroupPostIds.add(queueItem.getId());
                    results.add(Map.of("url", url, "success", true, "message", "Đã lên lịch đăng lúc " + scheduledAtForItem));
                    successCount++;
                }
            } catch (Exception e) {
                if (queueItem != null) {
                    queueItem.setStatus("FAILED");
                    queueItem.setErrorMessage(e.getMessage());
                    postQueueRepository.save(queueItem);
                }
                results.add(Map.of("url", url, "success", false, "message", e.getMessage() != null ? e.getMessage() : "Lỗi không xác định"));
            }
        }

        if ("QUEUE".equals(groupScheduleMode) && !queuedGroupPostIds.isEmpty()) {
            int gapSeconds = parseGapSeconds(requestBody.get("gapSeconds"));
            if (gapSeconds <= 0 && requestBody.get("intervalMinutes") instanceof Number n) {
                gapSeconds = n.intValue() * 60;
            }
            if (gapSeconds <= 0) gapSeconds = postingWindowService.defaultGapSeconds();
            campaignScheduler.packContinuous(queuedGroupPostIds, gapSeconds);
        }

        return ResponseEntity.ok(Map.of(
                "success", successCount > 0,
                "total", urls.size(),
                "posted", successCount,
                "results", results
        ));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deletePost(@PathVariable Long id) {
        postQueueService.deletePost(id);
        return ResponseEntity.ok().build();
    }

    @PostMapping("/batch-delete")
    public ResponseEntity<Map<String, Object>> deletePostsBatch(@RequestBody Map<String, Object> body) {
        Object rawIds = body.get("ids");
        int count = 0;
        if (rawIds instanceof List<?> list) {
            for (Object item : list) {
                try {
                    Long id = Long.parseLong(item.toString());
                    postQueueService.deletePost(id);
                    count++;
                } catch (Exception e) {
                    // Ignore single delete failures
                }
            }
        }
        return ResponseEntity.ok(Map.of("success", true, "count", count));
    }

    /**
     * Đăng Story trực tiếp lên Fanpage.
     * Hỗ trợ 2 loại URL:
     *   1. Link trực tiếp .mp4 / ảnh → đăng ngay
     *   2. Link bài đăng (Threads, TikTok, Instagram, Facebook) → Worker tự giải mã ra .mp4 → rồi đăng Story
     * Body: { connectionId, mediaUrl, mediaType? }
     */
    @PostMapping("/post-story")
    public ResponseEntity<Map<String, Object>> postStory(
            @RequestBody Map<String, Object> body,
            Authentication auth) {
        try {
            Long connectionId = body.get("connectionId") != null && !body.get("connectionId").toString().isEmpty()
                    ? Long.parseLong(body.get("connectionId").toString())
                    : null;
            String directPageId = body.get("pageId") != null ? body.get("pageId").toString().trim() : null;
            String directAccessToken = body.get("accessToken") != null ? body.get("accessToken").toString().trim() : null;
            String inputUrl = ((String) body.get("mediaUrl")).trim();
            String mediaType = body.getOrDefault("mediaType", "video").toString();

            SocialAccount account = null;
            if (connectionId != null) {
                account = socialAccountRepository.findById(connectionId).orElse(null);
            }
            if (account == null && directPageId != null && !directPageId.isEmpty() && directAccessToken != null && !directAccessToken.isEmpty()) {
                account = SocialAccount.builder()
                        .platform("FACEBOOK")
                        .platformAccountId(directPageId)
                        .pageName("Fanpage (" + directPageId + ")")
                        .accessToken(directAccessToken)
                        .accountType("PAGE_TOKEN")
                        .build();
            }
            if (account == null) {
                return ResponseEntity.badRequest().body(Map.of("success", false, "error", "Vui lòng chọn Fanpage hoặc nhập Page ID & Page Access Token!"));
            }

            // === Tự động giải mã link bài (Threads/TikTok/Instagram) thành .mp4 ===
            String resolvedMediaUrl = inputUrl;
            boolean isDirectMedia = inputUrl.contains(".mp4") || inputUrl.contains(".jpg")
                    || inputUrl.contains(".jpeg") || inputUrl.contains(".png")
                    || inputUrl.contains(".webp");

            if (!isDirectMedia) {
                log.info("🔍 Link Story không phải media trực tiếp, gọi Worker extract-video từ: {}", inputUrl);
                try {
                    org.springframework.web.client.RestTemplate rt = extractVideoClient;
                    org.springframework.http.HttpHeaders headers = new org.springframework.http.HttpHeaders();
                    headers.setContentType(org.springframework.http.MediaType.APPLICATION_JSON);
                    org.springframework.http.HttpEntity<Map<String, String>> req = new org.springframework.http.HttpEntity<>(Map.of("url", inputUrl), headers);
                    @SuppressWarnings("unchecked")
                    Map<String, Object> extractResp = rt.postForObject(LocalServices.WORKER_BASE + "/api/extract-video", req, Map.class);
                    if (extractResp != null && Boolean.TRUE.equals(extractResp.get("success")) && extractResp.get("videoUrl") != null) {
                        resolvedMediaUrl = extractResp.get("videoUrl").toString();
                        mediaType = "video"; // Link bài thì luôn là video
                        log.info("🎬 Đã giải mã ra MP4: {}", resolvedMediaUrl.substring(0, Math.min(80, resolvedMediaUrl.length())));
                    } else {
                        log.warn("⚠️ Không tìm thấy video trong link: {}", inputUrl);
                        return ResponseEntity.badRequest().body(Map.of(
                            "success", false,
                            "error", "Không tìm thấy video trong link này. Hãy thử dán link trực tiếp .mp4 hoặc dùng tính năng 'Tải Video Media' để lấy link .mp4 trước."
                        ));
                    }
                } catch (Exception extractEx) {
                    log.error("❌ Lỗi khi giải mã link video: {}", extractEx.getMessage());
                    return ResponseEntity.badRequest().body(Map.of(
                        "success", false,
                        "error", "Worker giải mã video lỗi: " + extractEx.getMessage() + ". Đảm bảo Worker đang chạy trên cổng 3001."
                    ));
                }
            }

            String affiliateLink = body.get("affiliateLink") != null ? body.get("affiliateLink").toString().trim() : null;

            // === Lưu bản ghi vào PostQueue để lưu vết lịch sử Story ===
            User user = resolveUser(auth);
            Campaign quickPostCampaign = resolveQuickPostCampaign(user);
            String targetFanpageStr = account.getPlatformAccountId() + ":" + account.getAccountType() + ":" + account.getId();

            // === Nếu tài khoản là PERSONAL_COOKIE -> Đăng Story trực tiếp qua Playwright Browser Worker ===
            if ("PERSONAL_COOKIE".equals(account.getAccountType())) {
                log.info("📖 Đăng Story cho Fanpage {} via Playwright Worker (PERSONAL_COOKIE)...", account.getPageName());
                try {
                    postQueueService.publishStoryViaWorker(account, resolvedMediaUrl, inputUrl, affiliateLink);
                    
                    // Lưu lịch sử thành công
                    PostQueue storyQueue = PostQueue.builder()
                            .campaign(quickPostCampaign)
                            .title("Story: " + (account.getPageName() != null ? account.getPageName() : account.getPlatformAccountId()))
                            .content(inputUrl)
                            .originalUrl(inputUrl)
                            .mediaUrls(resolvedMediaUrl)
                            .affiliateLink(affiliateLink)
                            .status("PUBLISHED")
                            .postType("STORY")
                            .targetFanpageId(targetFanpageStr)
                            .scheduledAt(LocalDateTime.now())
                            .publishedAt(LocalDateTime.now())
                            .build();
                    postQueueRepository.save(storyQueue);

                    return ResponseEntity.ok(Map.of(
                        "success", true,
                        "message", "Đã khởi chạy Playwright Browser tự động đăng Story lên Fanpage!",
                        "resolvedUrl", resolvedMediaUrl.substring(0, Math.min(100, resolvedMediaUrl.length())),
                        "item", storyQueue
                    ));
                } catch (Exception workerEx) {
                    log.error("❌ Đăng Story via Playwright Worker thất bại: {}", workerEx.getMessage());
                    
                    // Lưu lịch sử thất bại
                    PostQueue failedQueue = PostQueue.builder()
                            .campaign(quickPostCampaign)
                            .title("Story: " + (account.getPageName() != null ? account.getPageName() : account.getPlatformAccountId()))
                            .content(inputUrl)
                            .originalUrl(inputUrl)
                            .mediaUrls(resolvedMediaUrl)
                            .affiliateLink(affiliateLink)
                            .status("FAILED")
                            .errorMessage(workerEx.getMessage())
                            .postType("STORY")
                            .targetFanpageId(targetFanpageStr)
                            .scheduledAt(LocalDateTime.now())
                            .build();
                    postQueueRepository.save(failedQueue);

                    return ResponseEntity.internalServerError().body(Map.of(
                        "success", false,
                        "error", "Playwright Worker lỗi: " + workerEx.getMessage()
                    ));
                }
            }

            // === Đăng Story ===
            Map<String, Object> result;
            if ("photo".equalsIgnoreCase(mediaType)) {
                log.info("📸 Đăng Photo Story cho Fanpage {} ({})", account.getPageName(), account.getPlatformAccountId());
                result = postQueueService.getFacebookGraphApiService()
                        .publishPhotoStory(account.getPlatformAccountId(), account.getAccessToken(), resolvedMediaUrl);
            } else {
                log.info("🎬 Đăng Video Story cho Fanpage {} ({}) | URL: {}...", account.getPageName(), account.getPlatformAccountId(), resolvedMediaUrl.substring(0, Math.min(60, resolvedMediaUrl.length())));
                result = postQueueService.getFacebookGraphApiService()
                        .publishVideoStory(account.getPlatformAccountId(), account.getAccessToken(), resolvedMediaUrl);
            }

            boolean success = result != null && (
                result.containsKey("post_id") ||
                result.containsKey("id") ||
                result.containsKey("photo_id") ||
                result.containsKey("video_id") ||
                Boolean.TRUE.equals(result.get("success"))
            );

            if (success) {
                String storyId = String.valueOf(result.getOrDefault("post_id", result.getOrDefault("id", result.getOrDefault("photo_id", ""))));
                log.info("✅ Story đã đăng thành công lên Fanpage {} | ID={}", account.getPageName(), storyId);
                
                PostQueue storyQueue = PostQueue.builder()
                        .campaign(quickPostCampaign)
                        .title("Story: " + (account.getPageName() != null ? account.getPageName() : account.getPlatformAccountId()))
                        .content(inputUrl)
                        .originalUrl(inputUrl)
                        .mediaUrls(resolvedMediaUrl)
                        .status("PUBLISHED")
                        .postType("STORY")
                        .targetFanpageId(targetFanpageStr)
                        .scheduledAt(LocalDateTime.now())
                        .publishedAt(LocalDateTime.now())
                        .build();
                postQueueRepository.save(storyQueue);

                return ResponseEntity.ok(Map.of(
                    "success", true,
                    "postId", storyId,
                    "message", "Story đã được đăng thành công lên Fanpage!",
                    "resolvedUrl", resolvedMediaUrl.substring(0, Math.min(100, resolvedMediaUrl.length())),
                    "item", storyQueue
                ));
            } else {
                String errorMsg = result != null && result.containsKey("error") && result.get("error") != null
                        ? String.valueOf(result.get("error"))
                        : (result != null ? "Meta Graph API trả về: " + result : "Không nhận được phản hồi từ Graph API");

                if (result != null && Boolean.TRUE.equals(result.get("pending"))) {
                    log.warn("⏳ Story chưa xác nhận hoàn tất: {}", errorMsg);
                    return ResponseEntity.ok(Map.of(
                        "success", false,
                        "pending", true,
                        "error", errorMsg
                    ));
                }

                log.warn("⚠️ Đẩy Story qua Meta Graph API không thành công: {}. Đang thử chuyển sang Playwright Worker...", errorMsg);

                // Fallback: Thử đẩy qua Playwright Worker
                try {
                    postQueueService.publishStoryViaWorker(account, resolvedMediaUrl, inputUrl);
                    
                    PostQueue storyQueue = PostQueue.builder()
                            .campaign(quickPostCampaign)
                            .title("Story: " + (account.getPageName() != null ? account.getPageName() : account.getPlatformAccountId()))
                            .content(inputUrl)
                            .originalUrl(inputUrl)
                            .mediaUrls(resolvedMediaUrl)
                            .status("PUBLISHED")
                            .postType("STORY")
                            .targetFanpageId(targetFanpageStr)
                            .scheduledAt(LocalDateTime.now())
                            .publishedAt(LocalDateTime.now())
                            .build();
                    postQueueRepository.save(storyQueue);

                    return ResponseEntity.ok(Map.of(
                        "success", true,
                        "message", "Đã gửi yêu cầu đăng Story sang Playwright Worker tự động!",
                        "resolvedUrl", resolvedMediaUrl.substring(0, Math.min(100, resolvedMediaUrl.length())),
                        "item", storyQueue
                    ));
                } catch (Exception workerEx) {
                    log.error("❌ Thử Playwright Worker cũng thất bại: {}", workerEx.getMessage());
                }

                PostQueue failedQueue = PostQueue.builder()
                        .campaign(quickPostCampaign)
                        .title("Story: " + (account.getPageName() != null ? account.getPageName() : account.getPlatformAccountId()))
                        .content(inputUrl)
                        .originalUrl(inputUrl)
                        .mediaUrls(resolvedMediaUrl)
                        .status("FAILED")
                        .errorMessage(errorMsg)
                        .postType("STORY")
                        .targetFanpageId(targetFanpageStr)
                        .scheduledAt(LocalDateTime.now())
                        .build();
                postQueueRepository.save(failedQueue);

                return ResponseEntity.internalServerError().body(Map.of(
                    "success", false,
                    "error", errorMsg
                ));
            }
        } catch (Exception e) {
            log.error("❌ Lỗi khi đăng Story: {}", e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("success", false, "error", e.getMessage()));
        }
    }

    /**
     * Lấy danh sách toàn bộ Story đã đăng và hàng đợi Story của người dùng
     */
    @GetMapping("/stories")
    public ResponseEntity<List<PostQueue>> getStoryHistory(Authentication auth) {
        User user = resolveUser(auth);
        List<PostQueue> stories = postQueueRepository.findStoriesByUserId(user.getId());
        return ResponseEntity.ok(stories);
    }

    /**
     * Tạo 1 bài Story trong hàng đợi (postType=STORY) — khác với /post-story ở chỗ bài được lưu vào
     * PostQueue nên có lịch sử/trạng thái và có thể lên lịch giờ đăng (kéo-thả trên Lịch đăng bài).
     * Không sửa/xoá /post-story để giữ nguyên luồng "đăng ngay" đang hoạt động.
     * Body: { connectionId, mediaUrl, scheduledAt? } (thiếu scheduledAt = đăng ngay lập tức).
     */
    @PostMapping("/schedule-story")
    public ResponseEntity<Map<String, Object>> scheduleStory(@RequestBody Map<String, Object> body, Authentication auth) {
        try {
            Long connectionId = body.get("connectionId") != null && !body.get("connectionId").toString().isEmpty()
                    ? Long.parseLong(body.get("connectionId").toString())
                    : null;
            String directPageId = body.get("pageId") != null ? body.get("pageId").toString().trim() : null;
            String directAccessToken = body.get("accessToken") != null ? body.get("accessToken").toString().trim() : null;

            SocialAccount account = null;
            if (connectionId != null) {
                account = socialAccountRepository.findById(connectionId).orElse(null);
            }
            if (account == null && directPageId != null && !directPageId.isEmpty() && directAccessToken != null && !directAccessToken.isEmpty()) {
                account = socialAccountRepository.findByPlatformAccountId(directPageId).orElse(null);
                if (account == null) {
                    account = SocialAccount.builder()
                            .platform("FACEBOOK")
                            .platformAccountId(directPageId)
                            .pageName("Fanpage (" + directPageId + ")")
                            .accessToken(directAccessToken)
                            .accountType("PAGE_TOKEN")
                            .build();
                    account = socialAccountRepository.save(account);
                }
            }
            if (account == null) {
                return ResponseEntity.badRequest().body(Map.of("success", false, "message", "Vui lòng chọn Fanpage hoặc nhập Page ID & Page Access Token!"));
            }
            Object mediaUrlRaw = body.get("mediaUrl");
            if (mediaUrlRaw == null || mediaUrlRaw.toString().trim().isEmpty()) {
                return ResponseEntity.badRequest().body(Map.of("success", false, "message", "Vui lòng nhập link media!"));
            }
            String inputUrl = mediaUrlRaw.toString().trim();

            // === Tự động giải mã link bài (Threads/TikTok/Instagram) thành .mp4 — y hệt logic /post-story ===
            String resolvedMediaUrl = inputUrl;
            boolean isDirectMedia = inputUrl.contains(".mp4") || inputUrl.contains(".jpg")
                    || inputUrl.contains(".jpeg") || inputUrl.contains(".png")
                    || inputUrl.contains(".webp");
            if (!isDirectMedia) {
                log.info("🔍 [schedule-story] Link không phải media trực tiếp, gọi Worker extract-video từ: {}", inputUrl);
                try {
                    org.springframework.web.client.RestTemplate rt = extractVideoClient;
                    org.springframework.http.HttpHeaders headers = new org.springframework.http.HttpHeaders();
                    headers.setContentType(org.springframework.http.MediaType.APPLICATION_JSON);
                    org.springframework.http.HttpEntity<Map<String, String>> req = new org.springframework.http.HttpEntity<>(Map.of("url", inputUrl), headers);
                    @SuppressWarnings("unchecked")
                    Map<String, Object> extractResp = rt.postForObject(LocalServices.WORKER_BASE + "/api/extract-video", req, Map.class);
                    if (extractResp != null && Boolean.TRUE.equals(extractResp.get("success")) && extractResp.get("videoUrl") != null) {
                        resolvedMediaUrl = extractResp.get("videoUrl").toString();
                        log.info("🎬 [schedule-story] Đã giải mã ra MP4: {}", resolvedMediaUrl.substring(0, Math.min(80, resolvedMediaUrl.length())));
                    } else {
                        return ResponseEntity.badRequest().body(Map.of(
                            "success", false,
                            "message", "Không tìm thấy video trong link này. Hãy thử dán link trực tiếp .mp4 hoặc dùng tính năng 'Tải Video Media' để lấy link .mp4 trước."
                        ));
                    }
                } catch (Exception extractEx) {
                    log.error("❌ [schedule-story] Lỗi khi giải mã link video: {}", extractEx.getMessage());
                    return ResponseEntity.badRequest().body(Map.of(
                        "success", false,
                        "message", "Worker giải mã video lỗi: " + extractEx.getMessage() + ". Đảm bảo Worker đang chạy trên cổng 3001."
                    ));
                }
            }

            Object scheduledAtRaw = body.get("scheduledAt");
            boolean hasAt = scheduledAtRaw != null && !scheduledAtRaw.toString().trim().isEmpty();
            String storyMode = body.get("scheduleMode") != null ? resolveScheduleMode(body) : (hasAt ? "AT" : "NOW");
            if ("AT".equals(storyMode) && !hasAt) storyMode = "NOW";
            boolean publishNow = "NOW".equals(storyMode);
            boolean queueStory = "QUEUE".equals(storyMode);
            LocalDateTime scheduledAt;
            if (publishNow || queueStory) {
                scheduledAt = LocalDateTime.now();
            } else {
                try {
                    scheduledAt = LocalDateTime.parse(scheduledAtRaw.toString());
                } catch (Exception e) {
                    return ResponseEntity.badRequest().body(Map.of("success", false, "message", "scheduledAt không đúng định dạng"));
                }
            }
            String affiliateLink = body.get("affiliateLink") != null ? body.get("affiliateLink").toString().trim() : null;

            User user = resolveUser(auth);
            Campaign quickPostCampaign = resolveQuickPostCampaign(user);
            PostQueue post = PostQueue.builder()
                    .campaign(quickPostCampaign)
                    .title("Story: " + (account.getPageName() != null ? account.getPageName() : account.getPlatformAccountId()))
                    .content(inputUrl)
                    .originalUrl(inputUrl)
                    .mediaUrls(resolvedMediaUrl)
                    .affiliateLink(affiliateLink)
                    .status("PENDING")
                    .postType("STORY")
                    .targetFanpageId(account.getPlatformAccountId() + ":" + account.getAccountType() + ":" + account.getId())
                    .scheduledAt(scheduledAt)
                    .build();
            post = postQueueRepository.save(post);
            if (queueStory || (!publishNow && body.get("scheduleMode") != null)) {
                // Xếp vào lịch (từ bây giờ) / Hẹn giờ (từ mốc đã chọn): nối đuôi các bài đang chờ của cùng nick
                campaignScheduler.packContinuousFrom(List.of(post.getId()), postingWindowService.defaultGapSeconds(),
                        queueStory ? null : scheduledAt);
            }

            if (publishNow) {
                boolean published = postQueueService.publishPostNow(post.getId());
                if (!published) {
                    PostQueue failedPost = postQueueRepository.findById(post.getId()).orElse(post);
                    if ("FAILED".equals(failedPost.getStatus())) {
                        return ResponseEntity.internalServerError().body(Map.of(
                                "success", false,
                                "message", failedPost.getErrorMessage() != null ? failedPost.getErrorMessage() : "Đăng Story thất bại!"));
                    }
                }
            }

            return ResponseEntity.ok(Map.of("success", true, "item", postQueueRepository.findById(post.getId()).orElse(post)));
        } catch (Exception e) {
            log.error("❌ Lỗi khi lên lịch Story: {}", e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("success", false, "message", e.getMessage()));
        }
    }

    /**
     * Cập nhật hàng loạt thời gian đăng (scheduledAt) cho danh sách bài viết PENDING theo khung giờ.
     */
    @PostMapping("/reschedule-batch")
    public ResponseEntity<Map<String, Object>> rescheduleBatch(@RequestBody Map<String, Object> body, Authentication authentication) {
        try {
            User user = resolveUser(authentication);
            Object updatesObj = body.get("updates");
            if (updatesObj instanceof List<?> updatesList) {
                int count = 0;
                for (Object itemObj : updatesList) {
                    if (itemObj instanceof Map<?, ?> item) {
                        Object idObj = item.get("id");
                        Object timeObj = item.get("scheduledAt");
                        Object targetFanpageIdObj = item.get("targetFanpageId");
                        if (idObj != null) {
                            Long postId = Long.valueOf(idObj.toString());
                            PostQueue post = postQueueRepository.findById(postId).orElse(null);
                            if (post != null && "PENDING".equals(post.getStatus())) {
                                if (timeObj != null) {
                                    String timeStr = timeObj.toString().trim().replace("Z", "");
                                    LocalDateTime newTime;
                                    try {
                                        newTime = LocalDateTime.parse(timeStr);
                                    } catch (Exception ex) {
                                        // Thử parse dạng "YYYY-MM-DD HH:mm:ss"
                                        newTime = LocalDateTime.parse(timeStr.replace(" ", "T"));
                                    }
                                    post.setScheduledAt(newTime);
                                    post.setWindowDeferred(null);
                                }
                                if (targetFanpageIdObj != null && !targetFanpageIdObj.toString().trim().isEmpty()) {
                                    post.setTargetFanpageId(targetFanpageIdObj.toString().trim());
                                }
                                post.setWindowDeferred(null);
                                postQueueRepository.save(post);
                                count++;
                            }
                        }
                    }
                }
                log.info("🕒 [Reschedule Batch] Đã cập nhật lại giờ đăng cho {} bài viết PENDING thành công.", count);
                return ResponseEntity.ok(Map.of("success", true, "updatedCount", count));
            }
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", "Dữ liệu updates không hợp lệ"));
        } catch (Exception e) {
            log.error("❌ Lỗi khi reschedule-batch: {}", e.getMessage(), e);
            return ResponseEntity.internalServerError().body(Map.of("success", false, "message", e.getMessage()));
        }
    }

    /**
     * Chuyển 1 bài đăng ở trạng thái FAILED sang PENDING để đăng lại.
     */
    @PostMapping("/{id}/reset-failed")
    public ResponseEntity<Map<String, Object>> resetFailedPost(@PathVariable Long id) {
        try {
            PostQueue updated = postQueueService.resetFailedPost(id);
            return ResponseEntity.ok(Map.of("success", true, "item", updated));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", e.getMessage()));
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of("success", false, "message", e.getMessage()));
        }
    }

    /**
     * Chuyển danh sách bài FAILED sang PENDING (chờ đăng lại).
     */
    @PostMapping("/reset-failed-batch")
    public ResponseEntity<Map<String, Object>> resetFailedBatch(@RequestBody(required = false) Map<String, Object> body) {
        try {
            List<Long> ids = new ArrayList<>();
            if (body != null && body.get("ids") instanceof List<?> list) {
                for (Object item : list) {
                    try {
                        ids.add(Long.parseLong(item.toString()));
                    } catch (Exception ignored) {}
                }
            }
            Integer spacingSeconds = null;
            if (body != null && body.get("spacingSeconds") != null) {
                try {
                    spacingSeconds = Integer.parseInt(body.get("spacingSeconds").toString());
                } catch (Exception ignored) {}
            }
            String targetDeadline = body != null && body.get("targetDeadline") != null ? body.get("targetDeadline").toString() : null;
            int updatedCount = postQueueService.resetFailedPostsBatch(ids, spacingSeconds, targetDeadline);
            return ResponseEntity.ok(Map.of("success", true, "count", updatedCount));
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of("success", false, "message", e.getMessage()));
        }
    }
}
