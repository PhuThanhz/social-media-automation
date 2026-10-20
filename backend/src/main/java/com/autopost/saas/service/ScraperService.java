package com.autopost.saas.service;

import com.autopost.saas.entity.Campaign;
import com.autopost.saas.entity.PostQueue;
import com.autopost.saas.entity.SocialAccount;
import com.autopost.saas.repository.PostQueueRepository;
import com.autopost.saas.repository.SocialAccountRepository;
import com.autopost.saas.util.PooledRestTemplateFactory;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDateTime;
import java.util.*;

@Service
@RequiredArgsConstructor
@Slf4j
public class ScraperService {

    private final PostQueueRepository postQueueRepository;
    private final SocialAccountRepository socialAccountRepository;
    private final WorkerRouterService workerRouterService;

    private RestTemplate buildRestTemplate(int connectMs, int readMs) {
        return PooledRestTemplateFactory.create(connectMs, readMs);
    }

    /** Kiểm tra Worker Node.js có đang chạy không */
    public boolean isWorkerAlive() {
        return workerRouterService.isAnyWorkerAlive();
    }

    public List<PostQueue> scrapeAndQueueForCampaign(Campaign campaign) {
        return scrapeAndQueueForCampaign(campaign, null, null);
    }

    public List<PostQueue> scrapeAndQueueForCampaign(Campaign campaign, LocalDateTime explicitScheduledAt, String explicitTargetFanpageId) {
        return scrapeAndQueueForCampaign(campaign, explicitScheduledAt, explicitTargetFanpageId, 0);
    }

    /**
     * @param explicitScheduledAt nếu khác null, dùng giờ này cho bài cào được (trường hợp người dùng
     *                             tự chọn ngày giờ khi dán 1 link) thay vì tự tính theo postingIntervalMinutes.
     * @param explicitTargetFanpageId nếu khác null, ghi đè targetFanpageId của campaign cho bài cào được.
     * @param affiliateLinkOffset vị trí bắt đầu xoay vòng link affiliate — dùng khi hàm này được gọi
     *                            NHIỀU LẦN liên tiếp cho 1 batch (VD: đăng hàng loạt 50 link, mỗi link
     *                            gọi hàm này riêng 1 lần) để việc xoay vòng link tính đúng xuyên suốt cả
     *                            batch thay vì bị reset về link đầu tiên ở mỗi lần gọi.
     */
    /**
     * Gọi Worker để cào nội dung thuần túy từ 1 URL nguồn, KHÔNG cần Campaign và KHÔNG lưu vào
     * post_queue — dùng cho các luồng đăng bài không qua hàng đợi (VD: đăng thẳng vào Group).
     */
    public List<Map<String, Object>> fetchScrapedItems(String sourceUrl, String sourceType, int limit, Boolean includeCredit, String cookieString) {
        Map<String, Object> response = fetchScrapedResponse(sourceUrl, sourceType, limit, includeCredit, true, cookieString);
        if (response != null && Boolean.TRUE.equals(response.get("success")) && response.get("items") != null) {
            return (List<Map<String, Object>>) response.get("items");
        }
        return Collections.emptyList();
    }

    public List<Map<String, Object>> fetchScrapedItems(String sourceUrl, String sourceType, int limit, Boolean includeCredit) {
        return fetchScrapedItems(sourceUrl, sourceType, limit, includeCredit, null);
    }

    public List<Map<String, Object>> fetchScrapedItems(String sourceUrl, String sourceType, int limit) {
        return fetchScrapedItems(sourceUrl, sourceType, limit, false, null);
    }

    /**
     * Gọi Worker và trả về nguyên response (bao gồm cờ "cached") thay vì chỉ mỗi "items" — dùng cho
     * Quick Post để FE biết hiển thị badge "đã cào trước đó" và cho phép bỏ qua cache khi cần cào lại.
     */
    public Map<String, Object> fetchScrapedResponse(String sourceUrl, String sourceType, int limit, Boolean includeCredit, boolean forceRefresh) {
        return fetchScrapedResponse(sourceUrl, sourceType, limit, includeCredit, forceRefresh, null);
    }

    public Map<String, Object> fetchScrapedResponse(String sourceUrl, String sourceType, int limit, Boolean includeCredit, boolean forceRefresh, String cookieString) {
        if ((cookieString == null || cookieString.isBlank()) && sourceUrl != null
                && (sourceUrl.contains("facebook.com") || sourceUrl.contains("fb.watch"))) {
            cookieString = socialAccountRepository.findByAccountType("PERSONAL_COOKIE").stream()
                    .filter(a -> !"EXPIRED".equalsIgnoreCase(a.getTokenStatus()))
                    .filter(a -> a.getAccessToken() != null && !a.getAccessToken().isBlank())
                    .sorted((a, b) -> {
                        LocalDateTime tA = a.getUpdatedAt() != null ? a.getUpdatedAt() : LocalDateTime.MIN;
                        LocalDateTime tB = b.getUpdatedAt() != null ? b.getUpdatedAt() : LocalDateTime.MIN;
                        return tB.compareTo(tA);
                    })
                    .map(SocialAccount::getAccessToken)
                    .findFirst()
                    .orElse(null);
        }

        // 5s connect, 180s read — live test xác nhận cào 1 bài (ảnh/video) qua Playwright có thể mất
        // 60-80s tuỳ độ phức tạp, timeout 60s cũ hay bị vượt đúng lúc worker sắp trả kết quả thành công,
        // gây lỗi "Unexpected end of file from server" dù bản thân việc cào không hề lỗi.
        RestTemplate rt = buildRestTemplate(5000, 180000);
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);

        Map<String, String> requestBody = new HashMap<>();
        requestBody.put("sourceUrl", sourceUrl);
        requestBody.put("sourceType", sourceType != null ? sourceType : "WEBSITE_CRAWLER");
        requestBody.put("limit", String.valueOf(limit));
        requestBody.put("includeCredit", includeCredit != null ? includeCredit.toString() : "false");
        requestBody.put("forceRefresh", String.valueOf(forceRefresh));
        if (cookieString != null && !cookieString.isBlank()) {
            requestBody.put("cookieString", cookieString);
        }

        HttpEntity<Map<String, String>> request = new HttpEntity<>(requestBody, headers);
        // Cào bài là thao tác đọc (không có rủi ro đăng trùng), nên an toàn để thử lại nhiều lần khi
        // worker chưa kết nối được (VD vừa restart/respawn) — tăng từ 1 lên 3 lần retry, backoff tăng dần.
        int[] retryDelaysMs = { 3000, 5000, 8000 };
        for (int attempt = 0; ; attempt++) {
            try {
                String scrapeUrl = workerRouterService.getScrapingWorkerUrl("/api/scrape-content");
                return rt.postForObject(scrapeUrl, request, Map.class);
            } catch (Exception ex) {
                if (attempt >= retryDelaysMs.length) {
                    throw ex;
                }
                int delayMs = retryDelaysMs[attempt];
                log.warn("⚠️ Gọi Worker cào bài lần {} thất bại ({}), tự động thử lại sau {}ms...",
                        attempt + 1, ex.getMessage(), delayMs);
                try {
                    Thread.sleep(delayMs);
                } catch (InterruptedException ignored) {
                    Thread.currentThread().interrupt();
                }
            }
        }
    }

    @SuppressWarnings("unchecked")
    public List<PostQueue> scrapeAndQueueForCampaign(Campaign campaign, LocalDateTime explicitScheduledAt, String explicitTargetFanpageId, int affiliateLinkOffset) {
        if (campaign.getSourceUrl() == null || campaign.getSourceUrl().trim().isEmpty()) {
            log.warn("Campaign {} không có sourceUrl!", campaign.getName());
            return Collections.emptyList();
        }

        log.info("Thực hiện cào nội dung cho Campaign: {} | SourceType: {} | URL: {} | IncludeCredit: {}",
                campaign.getName(), campaign.getSourceType(), campaign.getSourceUrl(), campaign.getIncludeCredit());
        try {
            int targetCount = resolveLimit(campaign);
            int limitToFetch = "DIRECT_LINK".equals(campaign.getSourceType()) ? 1 : Math.max(targetCount * 3, 30);
            List<Map<String, Object>> items = fetchScrapedItems(
                    campaign.getSourceUrl(),
                    campaign.getSourceType(),
                    limitToFetch,
                    campaign.getIncludeCredit()
            );
            return queueScrapedItems(campaign, items, explicitScheduledAt, explicitTargetFanpageId, affiliateLinkOffset, targetCount);
        } catch (Exception e) {
            log.error("❌ Lỗi khi cào dữ liệu từ Worker cho Campaign {}: {}", campaign.getName(), e.getMessage());
            throw new RuntimeException("Không thể cào dữ liệu: " + e.getMessage(), e);
        }
    }

    /** Kết quả cào kèm cờ "cached" — dùng cho Quick Post để FE biết hiển thị badge/nút cào lại. */
    public static class ScrapeResult {
        public final List<PostQueue> posts;
        public final boolean cached;
        public ScrapeResult(List<PostQueue> posts, boolean cached) {
            this.posts = posts;
            this.cached = cached;
        }
    }

    @SuppressWarnings("unchecked")
    public ScrapeResult scrapeAndQueueQuickPostWithCacheInfo(Campaign campaign, LocalDateTime explicitScheduledAt, String explicitTargetFanpageId, boolean forceRefresh) {
        if (campaign.getSourceUrl() == null || campaign.getSourceUrl().trim().isEmpty()) {
            log.warn("Campaign {} không có sourceUrl!", campaign.getName());
            return new ScrapeResult(Collections.emptyList(), false);
        }
        try {
            int targetCount = resolveLimit(campaign);
            int limitToFetch = "DIRECT_LINK".equals(campaign.getSourceType()) ? 1 : Math.max(targetCount * 3, 30);
            Map<String, Object> response = fetchScrapedResponse(
                    campaign.getSourceUrl(), campaign.getSourceType(), limitToFetch, campaign.getIncludeCredit(), forceRefresh);
            boolean cached = response != null && Boolean.TRUE.equals(response.get("cached"));
            List<Map<String, Object>> items = (response != null && Boolean.TRUE.equals(response.get("success")) && response.get("items") != null)
                    ? (List<Map<String, Object>>) response.get("items")
                    : Collections.emptyList();
            List<PostQueue> posts = queueScrapedItems(campaign, items, explicitScheduledAt, explicitTargetFanpageId, 0, targetCount);
            return new ScrapeResult(posts, cached);
        } catch (Exception e) {
            log.error("❌ Lỗi khi cào dữ liệu từ Worker cho Campaign {}: {}", campaign.getName(), e.getMessage());
            throw new RuntimeException("Không thể cào dữ liệu: " + e.getMessage(), e);
        }
    }

    /**
     * Lưu ngay 1 (hoặc nhiều, nếu có nhiều Fanpage đích phân cách bởi dấu phẩy) PostQueue ở trạng
     * thái PENDING cho 1 URL vừa dán/gửi từ Extension — để người dùng thấy bài vào hàng đợi tức thì
     * thay vì phải chờ cào xong nội dung thật (có thể mất 20-80s qua Playwright). Nội dung thật sẽ
     * được điền vào đúng (các) bản ghi này sau bởi scrapeAndFillPlaceholdersAsync().
     */
    public List<PostQueue> createPendingPlaceholders(Campaign quickPostCampaign, String sourceUrl, LocalDateTime scheduledAt, String explicitTargetFanpageId) {
        String targetFanpageIdsRaw = explicitTargetFanpageId != null && !explicitTargetFanpageId.isBlank()
                ? explicitTargetFanpageId
                : quickPostCampaign.getTargetFanpageIds();
        List<String> targetFanpageIds = splitTargetFanpageIds(targetFanpageIdsRaw);

        List<PostQueue> placeholders = new ArrayList<>();
        for (String targetFanpageId : targetFanpageIds) {
            PostQueue postQueue = PostQueue.builder()
                    .campaign(quickPostCampaign)
                    .originalUrl(sourceUrl)
                    .title("Đang tải nội dung...")
                    .content("")
                    .mediaUrls("")
                    .status("PENDING")
                    .targetFanpageId(targetFanpageId)
                    .scheduledAt(scheduledAt)
                    .build();
            postQueueRepository.save(postQueue);
            placeholders.add(postQueue);
        }
        return placeholders;
    }

    /**
     * Cào nội dung thật ở nền (thread pool riêng "quickPostScrapeExecutor", không chặn request HTTP
     * gốc) cho các placeholder vừa tạo ở createPendingPlaceholders(), rồi UPDATE lại đúng các bản ghi
     * đó (không tạo row mới). Đánh dấu FAILED nếu cào lỗi hoặc không tìm thấy media.
     */
    @Async("quickPostScrapeExecutor")
    @SuppressWarnings("unchecked")
    public void scrapeAndFillPlaceholdersAsync(List<Long> postQueueIds, String sourceUrl, String sourceType, Boolean includeCredit, boolean forceRefresh) {
        if (postQueueIds == null || postQueueIds.isEmpty()) return;
        try {
            Map<String, Object> response = fetchScrapedResponse(sourceUrl, sourceType, 1, includeCredit, forceRefresh);
            List<Map<String, Object>> items = (response != null && Boolean.TRUE.equals(response.get("success")) && response.get("items") != null)
                    ? (List<Map<String, Object>>) response.get("items")
                    : Collections.emptyList();
            Map<String, Object> item = items.isEmpty() ? null : items.get(0);

            String title = item != null ? (String) item.get("title") : null;
            String rawContent = item != null ? (String) item.get("content") : null;
            List<String> mediaList = item != null ? (List<String>) item.get("mediaUrls") : null;
            String mediaUrls = mediaList != null && !mediaList.isEmpty()
                    ? mediaList.stream().filter(Objects::nonNull).map(String::trim).filter(s -> !s.isEmpty()).distinct().collect(java.util.stream.Collectors.joining(","))
                    : "";
            String content = (rawContent == null || rawContent.trim().isEmpty()) ? (title != null ? title : "") : rawContent;
            boolean hasMedia = !mediaUrls.isEmpty();

            for (Long id : postQueueIds) {
                postQueueRepository.findById(id).ifPresent(pq -> {
                    if (!hasMedia && (pq.getMediaUrls() == null || pq.getMediaUrls().trim().isEmpty())) {
                        pq.setStatus("FAILED");
                        pq.setErrorMessage("Không tìm thấy media (ảnh/video) trong bài viết.");
                    } else {
                        if (pq.getContent() == null || pq.getContent().trim().isEmpty()) {
                            pq.setTitle(title);
                            pq.setContent(content);
                        }
                        if (pq.getMediaUrls() == null || pq.getMediaUrls().trim().isEmpty()) {
                            pq.setMediaUrls(mediaUrls);
                        }
                    }
                    postQueueRepository.save(pq);
                });
            }
        } catch (Exception e) {
            log.error("❌ Lỗi cào nền (async) cho placeholder {}: {}", postQueueIds, e.getMessage());
            for (Long id : postQueueIds) {
                postQueueRepository.findById(id).ifPresent(pq -> {
                    pq.setStatus("FAILED");
                    pq.setErrorMessage("Cào bài thất bại: " + e.getMessage());
                    postQueueRepository.save(pq);
                });
            }
        }
    }

    private int resolveLimit(Campaign campaign) {
        return "DIRECT_LINK".equals(campaign.getSourceType()) ? 1 : (campaign.getMaxItemsPerScrape() != null ? campaign.getMaxItemsPerScrape() : 10);
    }

    @SuppressWarnings("unchecked")
    private List<PostQueue> queueScrapedItems(Campaign campaign, List<Map<String, Object>> items, LocalDateTime explicitScheduledAt, String explicitTargetFanpageId, int affiliateLinkOffset, int targetCount) {
        if ("DIRECT_LINK".equals(campaign.getSourceType()) && items.size() > 1) {
            items = items.subList(0, 1);
        }
        log.info("Cào được {} bài viết từ nguồn (mục tiêu thu thập {} bài mới).", items.size(), targetCount);
        List<PostQueue> newPosts = new ArrayList<>();

        // Bài cào tự động hàng loạt (không phải Quick Post dán tay 1 link) cần được duyệt thủ công
        // trước khi lên lịch đăng thật, tránh đăng nhầm nội dung không mong muốn lên Fanpage.
        boolean isBulkAutoScrape = !"DIRECT_LINK".equals(campaign.getSourceType());
        String initialStatus = isBulkAutoScrape ? "PENDING_APPROVAL" : "PENDING";

        int intervalMinutes = campaign.getPostingIntervalMinutes() != null ? campaign.getPostingIntervalMinutes() : 60;
        LocalDateTime baseScheduleTime = LocalDateTime.now().plusMinutes(5); // Bài đầu tiên hẹn sau 5 phút

        // Danh sách link affiliate (mỗi dòng 1 link) để xoay vòng (round-robin) cho từng bài.
        // Đăng 50 bài mà điền 3 link affiliate -> bài 1,4,7... dùng link 1, bài 2,5,8... dùng link 2, v.v.
        List<String> affiliateLinks = campaign.getAffiliateLink() != null
                ? java.util.Arrays.stream(campaign.getAffiliateLink().split("\\r?\\n"))
                        .map(String::trim)
                        .filter(s -> !s.isEmpty())
                        .toList()
                : List.of();

        Long userId = campaign.getUser() != null ? campaign.getUser().getId() : null;
        int count = 0;
        for (Map<String, Object> item : items) {
            String originalUrl = (String) item.get("originalUrl");
            String title = (String) item.get("title");
            String content = (String) item.get("content");
            List<String> mediaList = (List<String>) item.get("mediaUrls");
            String mediaUrls = mediaList != null && !mediaList.isEmpty()
                    ? mediaList.stream().filter(Objects::nonNull).map(String::trim).filter(s -> !s.isEmpty()).distinct().collect(java.util.stream.Collectors.joining(","))
                    : "";

            if (content == null || content.trim().isEmpty()) {
                content = title != null ? title : "";
            }

            // Bắt buộc phải có clip/ảnh mới được đăng — không fallback đăng chay chỉ có caption.
            if (mediaUrls.isEmpty()) {
                log.warn("⚠️  Bỏ qua item vì không tìm thấy media (clip/ảnh): {}", originalUrl);
                continue;
            }

            // Tránh cào trùng bài viết đã có trong DB (không áp dụng cho DIRECT_LINK khi dán tay).
            // Dedup theo content-hash thay vì original_url: khi Playwright không tìm thấy permalink
            // riêng của 1 bài (/posts/, /permalink/, /share/p/), worker fallback originalUrl về
            // chính URL của Group/Page nguồn — nếu dedup theo original_url thì mọi bài "không có
            // permalink" sau bài đầu tiên sẽ bị coi là trùng dù nội dung khác hẳn, bị bỏ sót vĩnh
            // viễn. Kiểm tra trên TOÀN BỘ campaign của user (không chỉ campaign hiện tại) — 1 bài
            // có thể được cào lại từ nhiều nguồn khác nhau.
            String contentHash = computeContentHash(content);
            if (isBulkAutoScrape) {
                boolean alreadyQueued = userId != null
                        ? postQueueRepository.existsByContentHashAndCampaign_User_Id(contentHash, userId)
                        : postQueueRepository.existsByContentHashAndCampaignId(contentHash, campaign.getId());
                if (alreadyQueued) {
                    log.info("Bài viết đã tồn tại trong Queue (trùng nội dung), bỏ qua: {}", originalUrl);
                    continue;
                }
            } else if (userId != null) {
                boolean recentDuplicate = postQueueRepository.existsRecentByContentHashAndUserId(contentHash, userId, LocalDateTime.now().minusMinutes(5));
                if (recentDuplicate) {
                    log.info("Bài viết vừa được tạo trong 5 phút gần đây (chống double-click/đăng trùng), bỏ qua: {}", originalUrl);
                    continue;
                }
            }

            LocalDateTime scheduledTime = explicitScheduledAt != null
                    ? explicitScheduledAt
                    : baseScheduleTime.plusMinutes((long) count * intervalMinutes);
            String targetFanpageIdsRaw = explicitTargetFanpageId != null
                    ? explicitTargetFanpageId
                    : campaign.getTargetFanpageIds();
            // Campaign có thể chọn NHIỀU Fanpage đích (targetFanpageIds phân cách bởi dấu phẩy) — mỗi
            // target phải có 1 PostQueue riêng để publishPostNow() resolve đúng connectionId của từng
            // target, tránh gộp chung nhiều connectionId vào 1 chuỗi mà publish không parse được.
            List<String> targetFanpageIds = splitTargetFanpageIds(targetFanpageIdsRaw);

            String resolvedAffiliateLink;
            if ("DIRECT_LINK".equals(campaign.getSourceType())) {
                resolvedAffiliateLink = campaign.getAffiliateLink() != null && !campaign.getAffiliateLink().trim().isEmpty()
                        ? campaign.getAffiliateLink().trim()
                        : null;
            } else {
                resolvedAffiliateLink = !affiliateLinks.isEmpty()
                        ? affiliateLinks.get((affiliateLinkOffset + count) % affiliateLinks.size())
                        : null;
            }

            for (String targetFanpageId : targetFanpageIds) {
                PostQueue postQueue = PostQueue.builder()
                        .campaign(campaign)
                        .originalUrl(originalUrl)
                        .contentHash(contentHash)
                        .title(title)
                        .content(content)
                        .mediaUrls(mediaUrls)
                        .status(initialStatus)
                        .targetFanpageId(targetFanpageId)
                        .scheduledAt(scheduledTime)
                        .affiliateLink(resolvedAffiliateLink)
                        .enableGroupComment(Boolean.TRUE.equals(campaign.getEnableGroupComment()))
                        .build();

                postQueueRepository.save(postQueue);
                newPosts.add(postQueue);
            }
            count++;
            if (newPosts.size() >= targetCount) {
                log.info("🎯 Đã thu thập đủ {} bài viết mới không trùng lặp, dừng thêm vào Hàng đợi.", targetCount);
                break;
            }
        }
        return newPosts;
    }

    /** SHA-256 hex của nội dung bài viết đã chuẩn hoá (trim, gộp khoảng trắng, lowercase) — dùng để dedup bài cào trùng nội dung. */
    private String computeContentHash(String content) {
        String normalized = (content == null ? "" : content).trim().replaceAll("\\s+", " ").toLowerCase();
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(normalized.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(hash.length * 2);
            for (byte b : hash) {
                hex.append(String.format("%02x", b));
            }
            return hex.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 not available", e);
        }
    }

    /** Tách chuỗi targetFanpageIds (comma-separated) thành danh sách từng target riêng lẻ. */
    private List<String> splitTargetFanpageIds(String raw) {
        if (raw == null || raw.trim().isEmpty()) {
            return Collections.singletonList(raw);
        }
        List<String> parts = java.util.Arrays.stream(raw.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .distinct()
                .toList();
        return parts.isEmpty() ? Collections.singletonList(raw) : parts;
    }

}
