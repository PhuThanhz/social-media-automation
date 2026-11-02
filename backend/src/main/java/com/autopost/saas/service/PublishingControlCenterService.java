package com.autopost.saas.service;

import com.autopost.saas.dto.PostQueueDto;
import com.autopost.saas.entity.Campaign;
import com.autopost.saas.entity.PostQueue;
import com.autopost.saas.entity.SocialAccount;
import com.autopost.saas.repository.CampaignRepository;
import com.autopost.saas.repository.PostQueueRepository;
import com.autopost.saas.repository.SocialAccountRepository;
import com.autopost.saas.util.PooledRestTemplateFactory;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.RestTemplate;

import java.time.LocalDateTime;
import java.util.*;

/**
 * Trung tâm điều hành xuất bản (Publishing Control Center Service) — TOOLZUTTER 3.2.
 * Cung cấp khả năng giám sát tổng quan, quản lý hàng ngàn bài đăng, chẩn đoán cụm worker và đối soát trạng thái bài viết.
 */
@Service
@Slf4j
public class PublishingControlCenterService {

    private final PostQueueRepository postQueueRepository;
    private final SocialAccountRepository socialAccountRepository;
    private final CampaignRepository campaignRepository;
    private final WorkerRouterService workerRouterService;
    private final com.autopost.saas.repository.PostExecutionAttemptRepository postExecutionAttemptRepository;
    private final com.autopost.saas.scheduler.CampaignScheduler campaignScheduler;
    private final RestTemplate shortTimeoutClient = PooledRestTemplateFactory.create(1500, 2500);

    @Autowired
    public PublishingControlCenterService(
            PostQueueRepository postQueueRepository,
            SocialAccountRepository socialAccountRepository,
            CampaignRepository campaignRepository,
            WorkerRouterService workerRouterService,
            com.autopost.saas.repository.PostExecutionAttemptRepository postExecutionAttemptRepository,
            com.autopost.saas.scheduler.CampaignScheduler campaignScheduler
    ) {
        this.postQueueRepository = postQueueRepository;
        this.socialAccountRepository = socialAccountRepository;
        this.campaignRepository = campaignRepository;
        this.workerRouterService = workerRouterService;
        this.postExecutionAttemptRepository = postExecutionAttemptRepository;
        this.campaignScheduler = campaignScheduler;
    }

    // Constructor phụ hỗ trợ unit test
    public PublishingControlCenterService(
            PostQueueRepository postQueueRepository,
            SocialAccountRepository socialAccountRepository,
            CampaignRepository campaignRepository,
            WorkerRouterService workerRouterService
    ) {
        this(postQueueRepository, socialAccountRepository, campaignRepository, workerRouterService, null, null);
    }

    /**
     * Lấy dữ liệu tổng quan cho Dashboard Publishing Control Center:
     * - Số lượng bài đăng theo từng trạng thái chuẩn hóa.
     * - Trạng thái sức khỏe, số luồng active, RAM của cụm 3 Worker.
     * - Danh sách tài khoản VIA / Fanpage bị mất kết nối (EXPIRED/Checkpoint).
     * - Danh sách các bài cần xác minh (NEEDS_REVIEW) để tránh đăng trùng.
     * - Các chiến dịch bị trễ lịch.
     */
    @Transactional(readOnly = true)
    public Map<String, Object> getControlCenterOverview(Long userId) {
        Map<String, Object> overview = new LinkedHashMap<>();

        // 1. Thống kê bài viết theo trạng thái
        List<Object[]> statusCounts = postQueueRepository.countByStatusForUser(userId);
        Map<String, Long> counts = new HashMap<>();
        long totalInQueue = 0;
        long totalHistorical = 0;

        for (Object[] row : statusCounts) {
            String st = row[0] != null ? row[0].toString().toUpperCase() : "UNKNOWN";
            long cnt = ((Number) row[1]).longValue();
            counts.put(st, cnt);
            totalHistorical += cnt;
            if ("PENDING".equals(st) || "SCHEDULED".equals(st) || "QUEUED".equals(st)
                    || "PROCESSING".equals(st) || "PUBLISHING".equals(st) || "NEEDS_REVIEW".equals(st)) {
                totalInQueue += cnt;
            }
        }

        Map<String, Object> queueStats = new LinkedHashMap<>();
        queueStats.put("totalActiveInQueue", totalInQueue);
        queueStats.put("totalHistorical", totalHistorical);
        queueStats.put("pending", counts.getOrDefault("PENDING", 0L));
        queueStats.put("scheduled", counts.getOrDefault("SCHEDULED", 0L));
        queueStats.put("queued", counts.getOrDefault("QUEUED", 0L));
        queueStats.put("processing", counts.getOrDefault("PROCESSING", 0L));
        queueStats.put("publishing", counts.getOrDefault("PUBLISHING", 0L));
        queueStats.put("published", counts.getOrDefault("PUBLISHED", 0L));
        queueStats.put("partial", counts.getOrDefault("PARTIAL", 0L));
        queueStats.put("failed", counts.getOrDefault("FAILED", 0L));
        queueStats.put("needsReview", counts.getOrDefault("NEEDS_REVIEW", 0L));
        queueStats.put("cancelled", counts.getOrDefault("CANCELLED", 0L));
        overview.put("queueStats", queueStats);

        // 2. Kiểm tra trực tiếp cụm 3 Worker Nodes
        List<Map<String, Object>> workerNodes = new ArrayList<>();
        List<String> workerUrls = workerRouterService.getAllWorkerUrls();

        for (String url : workerUrls) {
            Map<String, Object> node = new LinkedHashMap<>();
            node.put("url", url);
            long start = System.currentTimeMillis();
            try {
                @SuppressWarnings("unchecked")
                Map<String, Object> health = shortTimeoutClient.getForObject(url + "/api/health", Map.class);
                long latency = System.currentTimeMillis() - start;
                node.put("status", "ONLINE");
                node.put("latencyMs", latency);
                node.put("port", health != null ? health.get("port") : null);

                // Thử lấy thêm thông số RAM/Pool từ /api/pool-stats
                try {
                    @SuppressWarnings("unchecked")
                    Map<String, Object> poolStats = shortTimeoutClient.getForObject(url + "/api/pool-stats", Map.class);
                    if (poolStats != null) {
                        node.put("activeContexts", poolStats.get("activeContexts"));
                        node.put("totalContextsServed", poolStats.get("totalContextsServed"));
                        node.put("freeMemMb", poolStats.get("freeMemMb"));
                        node.put("heapUsedMb", poolStats.get("heapUsedMb"));
                        node.put("rssMb", poolStats.get("rssMb"));
                    }
                } catch (Exception ignored) {}
            } catch (Exception e) {
                node.put("status", "OFFLINE");
                node.put("latencyMs", -1);
                node.put("error", e.getMessage());
            }
            workerNodes.add(node);
        }
        overview.put("workerNodes", workerNodes);

        // 3. Danh sách tài khoản bị mất kết nối / lỗi cookie
        List<SocialAccount> accounts = socialAccountRepository.findByUserId(userId);
        List<Map<String, Object>> disconnectedAccounts = new ArrayList<>();
        int healthyAccountsCount = 0;

        for (SocialAccount a : accounts) {
            boolean isExpired = "EXPIRED".equalsIgnoreCase(a.getTokenStatus());
            if (isExpired) {
                Map<String, Object> accMap = new LinkedHashMap<>();
                accMap.put("id", a.getId());
                accMap.put("pageName", a.getPageName());
                accMap.put("platform", a.getPlatform());
                accMap.put("accountType", a.getAccountType());
                accMap.put("platformAccountId", a.getPlatformAccountId());
                accMap.put("tokenStatus", a.getTokenStatus());
                accMap.put("tokenCheckedAt", a.getTokenCheckedAt());
                disconnectedAccounts.add(accMap);
            } else {
                healthyAccountsCount++;
            }
        }
        overview.put("disconnectedAccounts", disconnectedAccounts);
        overview.put("totalAccountsCount", accounts.size());
        overview.put("healthyAccountsCount", healthyAccountsCount);

        // 4. Các bài đăng cần xác minh (NEEDS_REVIEW) gần nhất
        Page<PostQueue> needsReviewPage = postQueueRepository.findQueuePaginatedForUser(
                userId, "NEEDS_REVIEW", null, PageRequest.of(0, 10));
        overview.put("needsReviewList", needsReviewPage.getContent().stream().map(this::toDto).toList());

        // 5. Các bài đăng thất bại gần nhất
        Page<PostQueue> failedPage = postQueueRepository.findQueuePaginatedForUser(
                userId, "FAILED", null, PageRequest.of(0, 10));
        overview.put("recentFailures", failedPage.getContent().stream().map(this::toDto).toList());

        // 6. Phát hiện chiến dịch bị chậm (Lagging: có bài PENDING với scheduledAt quá 15 phút so với hiện tại)
        LocalDateTime threshold = LocalDateTime.now().minusMinutes(15);
        List<PostQueue> overduePending = postQueueRepository.findByStatusAndScheduledAtBeforeOrderByScheduledAtAscIdAsc("PENDING", threshold);
        Set<Long> laggingCampaignIds = new HashSet<>();
        for (PostQueue p : overduePending) {
            if (p.getCampaign() != null && p.getCampaign().getUser() != null && userId.equals(p.getCampaign().getUser().getId())) {
                laggingCampaignIds.add(p.getCampaign().getId());
            }
        }

        List<Map<String, Object>> laggingCampaigns = new ArrayList<>();
        for (Long cId : laggingCampaignIds) {
            campaignRepository.findById(cId).ifPresent(c -> {
                Map<String, Object> cmap = new LinkedHashMap<>();
                cmap.put("id", c.getId());
                cmap.put("name", c.getName());
                cmap.put("status", c.getStatus());
                laggingCampaigns.add(cmap);
            });
        }
        overview.put("laggingCampaigns", laggingCampaigns);

        return overview;
    }

    /**
     * Lấy danh sách hàng đợi phân trang cực nhanh, hỗ trợ tìm kiếm và lọc trạng thái.
     * Đáp ứng khả năng quản lý 1,000+ bài mà không làm nghẽn UI hay Backend.
     */
    @Transactional(readOnly = true)
    public Page<PostQueueDto> getPaginatedQueue(Long userId, String status, String search, int page, int size) {
        int boundedPage = Math.max(0, page);
        int boundedSize = Math.max(5, Math.min(100, size)); // Bounded size: tối đa 100/trang
        Pageable pageable = PageRequest.of(boundedPage, boundedSize);

        String stFilter = (status != null && !status.isBlank() && !"ALL".equalsIgnoreCase(status))
                ? status.trim().toUpperCase() : null;
        String searchFilter = (search != null && !search.isBlank()) ? search.trim() : null;

        Page<PostQueue> entities = postQueueRepository.findQueuePaginatedForUser(userId, stFilter, searchFilter, pageable);
        return entities.map(this::toDto);
    }

    /**
     * Xác minh hoặc xử lý bài đăng thuộc diện NEEDS_REVIEW / FAILED.
     */
    @Transactional
    public boolean verifyPost(Long postId, Long userId, String action, String notes) {
        Optional<PostQueue> opt = postQueueRepository.findById(postId);
        if (opt.isEmpty()) return false;

        PostQueue post = opt.get();
        if (post.getCampaign() == null || post.getCampaign().getUser() == null || !userId.equals(post.getCampaign().getUser().getId())) {
            throw new SecurityException("Không có quyền chỉnh sửa bài viết này.");
        }

        if ("CONFIRM_PUBLISHED".equalsIgnoreCase(action)) {
            post.setStatus("PUBLISHED");
            if (post.getPublishedAt() == null) {
                post.setPublishedAt(LocalDateTime.now());
            }
            post.setLockedBy(null);
            post.setLockToken(null);
            post.setLeaseExpiresAt(null);
            post.setErrorMessage((notes != null && !notes.isBlank()) ? "[Xác minh người dùng] " + notes : "[Xác minh người dùng] Đã kiểm tra bài viết hiển thị hợp lệ trên nền tảng.");
            postQueueRepository.save(post);
            if (postExecutionAttemptRepository != null) {
                try {
                    postExecutionAttemptRepository.save(com.autopost.saas.entity.PostExecutionAttempt.builder()
                            .postQueueId(postId)
                            .attemptToken(UUID.randomUUID().toString())
                            .workerInstance("ControlCenter:User#" + userId)
                            .startedAt(LocalDateTime.now())
                            .finishedAt(LocalDateTime.now())
                            .status("CONFIRM_PUBLISHED")
                            .errorMessage(notes != null ? notes : "Xác minh thủ công từ Control Center")
                            .proofUrl(post.getPublishedPostUrl())
                            .build());
                } catch (Exception ignored) {}
            }
            log.info("✅ [ControlCenter] Người dùng #{} đã xác minh bài Post #{} thành PUBLISHED.", userId, postId);
            return true;
        } else if ("RESET_PENDING".equalsIgnoreCase(action)) {
            // Kiểm tra an toàn chống đăng trùng (TOOLZUTTER 3.3):
            // 1. Kiểm tra xem có worker nào trong cụm đang xử lý bài này dở dang không
            if (campaignScheduler != null) {
                String workerVerdict = campaignScheduler.askWorkerPostResult(post);
                if ("IN_PROGRESS".equals(workerVerdict)) {
                    throw new IllegalStateException("Không thể reset: Một Worker trong cụm đang tích cực xử lý bài viết này. Vui lòng chờ worker hoàn tất.");
                }
                if ("SUCCESS".equals(workerVerdict)) {
                    throw new IllegalStateException("Worker trong cụm xác nhận bài này ĐÃ ĐĂNG THÀNH CÔNG (Proof URL: " + post.getPublishedPostUrl() + "). Vui lòng chọn 'Xác nhận đã đăng' thay vì đăng lại!");
                }
            }

            post.setStatus("PENDING");
            post.setScheduledAt(LocalDateTime.now().plusMinutes(2)); // Hẹn giờ đăng sau 2 phút
            post.setLockedBy(null);
            post.setLockToken(null);
            post.setLeaseExpiresAt(null);
            post.setErrorMessage((notes != null && !notes.isBlank()) ? "[Đăng lại có đối soát] " + notes : "Đặt lại hàng đợi sau khi đối soát.");
            post.setRetryCount(0);
            postQueueRepository.save(post);

            if (postExecutionAttemptRepository != null) {
                try {
                    postExecutionAttemptRepository.save(com.autopost.saas.entity.PostExecutionAttempt.builder()
                            .postQueueId(postId)
                            .attemptToken(UUID.randomUUID().toString())
                            .workerInstance("ControlCenter:User#" + userId)
                            .startedAt(LocalDateTime.now())
                            .finishedAt(LocalDateTime.now())
                            .status("RESET_PENDING")
                            .errorMessage(notes != null ? notes : "Người dùng đặt lại sau khi đối soát")
                            .build());
                } catch (Exception ignored) {}
            }

            log.info("🔁 [ControlCenter] Người dùng #{} đã đưa bài Post #{} về PENDING để thử lại.", userId, postId);
            return true;
        } else if ("CANCEL".equalsIgnoreCase(action)) {
            post.setStatus("CANCELLED");
            post.setLockedBy(null);
            post.setLockToken(null);
            post.setLeaseExpiresAt(null);
            post.setErrorMessage(notes != null ? notes : "Đã hủy bởi người dùng trong Control Center.");
            postQueueRepository.save(post);
            if (postExecutionAttemptRepository != null) {
                try {
                    postExecutionAttemptRepository.save(com.autopost.saas.entity.PostExecutionAttempt.builder()
                            .postQueueId(postId)
                            .attemptToken(UUID.randomUUID().toString())
                            .workerInstance("ControlCenter:User#" + userId)
                            .startedAt(LocalDateTime.now())
                            .finishedAt(LocalDateTime.now())
                            .status("CANCELLED")
                            .errorMessage(notes != null ? notes : "Hủy từ Control Center")
                            .build());
                } catch (Exception ignored) {}
            }
            return true;
        }

        return false;
    }

    /**
     * Lấy lịch sử các lần thực thi đăng bài (Audit trail attempts) — TOOLZUTTER 3.3.
     */
    @Transactional(readOnly = true)
    public List<com.autopost.saas.entity.PostExecutionAttempt> getExecutionAttempts(Long userId, Long postId) {
        Optional<PostQueue> opt = postQueueRepository.findById(postId);
        if (opt.isEmpty()) {
            throw new NoSuchElementException("Không tìm thấy bài viết #" + postId);
        }
        PostQueue post = opt.get();
        if (post.getCampaign() != null && post.getCampaign().getUser() != null) {
            if (!userId.equals(post.getCampaign().getUser().getId())) {
                throw new SecurityException("Không có quyền xem nhật ký bài viết này.");
            }
        }
        if (postExecutionAttemptRepository == null) return Collections.emptyList();
        return postExecutionAttemptRepository.findByPostQueueIdOrderByStartedAtDesc(postId);
    }

    @Transactional(readOnly = true)
    public List<com.autopost.saas.entity.PostExecutionAttempt> getExecutionAttempts(Long postId) {
        if (postExecutionAttemptRepository == null) return Collections.emptyList();
        return postExecutionAttemptRepository.findByPostQueueIdOrderByStartedAtDesc(postId);
    }

    @Transactional(readOnly = true)
    public com.autopost.saas.publishing.model.PreflightResult preflightCheckPost(
            Long userId, Long postId, com.autopost.saas.publishing.service.PublishingPreflightService preflightService) {
        Optional<PostQueue> opt = postQueueRepository.findById(postId);
        if (opt.isEmpty()) {
            throw new NoSuchElementException("Không tìm thấy bài viết #" + postId);
        }
        PostQueue post = opt.get();
        if (post.getCampaign() != null && post.getCampaign().getUser() != null) {
            if (!userId.equals(post.getCampaign().getUser().getId())) {
                throw new SecurityException("Không có quyền kiểm tra bài viết này.");
            }
        }
        SocialAccount account = null;
        if (post.getTargetFanpageId() != null && !post.getTargetFanpageId().isBlank()) {
            account = socialAccountRepository.findByPlatformAccountId(post.getTargetFanpageId()).orElse(null);
        }
        return preflightService.validatePost(account, post);
    }

    /**
     * Hủy hàng loạt bài đăng an toàn.
     */
    @Transactional
    public int bulkCancelPosts(Long userId, List<Long> postIds) {
        if (postIds == null || postIds.isEmpty()) return 0;
        int count = 0;
        for (Long id : postIds) {
            Optional<PostQueue> opt = postQueueRepository.findById(id);
            if (opt.isPresent()) {
                PostQueue p = opt.get();
                if (p.getCampaign() != null && p.getCampaign().getUser() != null && userId.equals(p.getCampaign().getUser().getId())) {
                    if (!"PUBLISHED".equalsIgnoreCase(p.getStatus())) {
                        p.setStatus("CANCELLED");
                        p.setErrorMessage("Hủy hàng loạt qua Publishing Control Center lúc " + LocalDateTime.now());
                        postQueueRepository.save(p);
                        count++;
                    }
                }
            }
        }
        return count;
    }

    /**
     * Dời lịch hàng loạt bài đăng an toàn.
     */
    @Transactional
    public int bulkReschedulePosts(Long userId, List<Long> postIds, LocalDateTime startAt, int gapMinutes) {
        if (postIds == null || postIds.isEmpty() || startAt == null) return 0;
        int gap = Math.max(1, gapMinutes);
        int count = 0;
        LocalDateTime current = startAt;

        for (Long id : postIds) {
            Optional<PostQueue> opt = postQueueRepository.findById(id);
            if (opt.isPresent()) {
                PostQueue p = opt.get();
                if (p.getCampaign() != null && p.getCampaign().getUser() != null && userId.equals(p.getCampaign().getUser().getId())) {
                    if (!"PUBLISHED".equalsIgnoreCase(p.getStatus())) {
                        p.setScheduledAt(current);
                        p.setStatus("PENDING");
                        postQueueRepository.save(p);
                        current = current.plusMinutes(gap);
                        count++;
                    }
                }
            }
        }
        return count;
    }

    private PostQueueDto toDto(PostQueue p) {
        return PostQueueDto.builder()
                .id(p.getId())
                .campaignId(p.getCampaign() != null ? p.getCampaign().getId() : null)
                .campaignName(p.getCampaign() != null ? p.getCampaign().getName() : "")
                .title(p.getTitle())
                .content(p.getContent())
                .mediaUrls(p.getMediaUrls())
                .originalUrl(p.getOriginalUrl())
                .status(p.getStatus())
                .targetFanpageId(p.getTargetFanpageId())
                .postType(p.getPostType())
                .targetGroupNames(p.getTargetGroupNames())
                .publishedPostUrl(p.getPublishedPostUrl())
                .errorMessage(p.getErrorMessage())
                .scheduledAt(p.getScheduledAt())
                .publishedAt(p.getPublishedAt())
                .executionDurationSeconds(p.getExecutionDurationSeconds())
                .retryCount(p.getRetryCount())
                .lockedBy(p.getLockedBy())
                .lockToken(p.getLockToken())
                .leaseExpiresAt(p.getLeaseExpiresAt())
                .attemptCount(p.getAttemptCount())
                .createdAt(p.getCreatedAt())
                .updatedAt(p.getUpdatedAt())
                .build();
    }
}

