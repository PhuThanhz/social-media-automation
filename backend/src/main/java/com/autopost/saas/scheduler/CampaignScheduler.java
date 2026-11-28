package com.autopost.saas.scheduler;

import com.autopost.saas.util.LocalServices;
import com.autopost.saas.entity.Campaign;
import com.autopost.saas.entity.PostQueue;
import com.autopost.saas.entity.SocialAccount;
import com.autopost.saas.repository.CampaignRepository;
import com.autopost.saas.repository.PostQueueGroupResultRepository;
import com.autopost.saas.repository.PostQueueRepository;
import com.autopost.saas.repository.SocialAccountRepository;
import com.autopost.saas.service.FacebookGraphApiService;
import com.autopost.saas.service.PlaywrightHealthCheckService;
import com.autopost.saas.service.PostQueueService;
import com.autopost.saas.service.ScraperService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.scheduling.support.CronExpression;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Function;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

@Component
@RequiredArgsConstructor
@Slf4j
public class CampaignScheduler {

    private static final int MAX_RETRY = 3;
    private static final int TOKEN_EXPIRING_SOON_DAYS = 3;
    // Mỗi nick (c_user) đăng TUẦN TỰ; các nick KHÁC nhau được đăng song song, tối đa 6 nick cùng lúc
    // được chia đều qua các Playwright Worker (Port 3001, 3002 và 3003).
    private static final int MAX_PARALLEL_ACCOUNTS = 6;
    // Giãn cách tối thiểu giữa 2 lần đăng liên tiếp trên CÙNG 1 account (nghỉ nhẹ giải phóng Chromium)
    private static final long MIN_MS_BETWEEN_POSTS_SAME_ACCOUNT = 8_000;
    // Bài cùng nick bị hẹn trùng giờ: dời từng bài ra sau đúng chừng này phút (giữ sát lịch gốc thay vì đẩy xa).
    private static final int STAGGER_GAP_MINUTES = 3;
    // Quá 3 phút không có heartbeat mới xem là tiến trình đã chết/mất phản hồi thật sự.
    private static final int PROCESSING_STALE_AFTER_MINUTES = 3;
    private static final Pattern C_USER_COOKIE_PATTERN = Pattern.compile("(?:^|;\\s*)c_user=([^;]+)", Pattern.CASE_INSENSITIVE);

    // Mặc định tắt: với Playwright, worker có thể đã bấm Đăng nhưng mất phản hồi ở bước sau đó.
    // Tự retry ngầm khi ấy vừa có nguy cơ đăng trùng, vừa khiến một bài lỗi cũ bất ngờ xuất hiện
    // trong lúc người dùng đang thử một link mới. Chỉ bật khi vận hành chủ động chấp nhận rủi ro.
    @Value("${app.auto-retry-failed-posts:false}")
    private boolean autoRetryFailedPosts;

    private final CampaignRepository campaignRepository;
    private final PostQueueRepository postQueueRepository;
    private final PostQueueGroupResultRepository postQueueGroupResultRepository;
    private final SocialAccountRepository socialAccountRepository;
    private final ScraperService scraperService;
    private final PostQueueService postQueueService;
    private final FacebookGraphApiService facebookGraphApiService;
    private final PlaywrightHealthCheckService playwrightHealthCheckService;
    private final com.autopost.saas.service.ViaCookieFollowService viaCookieFollowService;
    private final com.autopost.saas.service.PostingWindowService postingWindowService;
    private final com.autopost.saas.service.NickThrottleService nickThrottleService;
    private final com.autopost.saas.service.WorkerRouterService workerRouterService;

    // 1. TẮT HOÀN TOÀN CÀO TỰ ĐỘNG CHẠY NGẦM: Chỉ cào bài khi người dùng trực tiếp yêu cầu hoặc dán link
    // @Scheduled(fixedRate = 300000)
    public void executeScraping() {
        // Tắt cào ngầm theo yêu cầu để tránh tự ý sinh bài vào hàng đợi
        return;
    }

    private boolean isDueForScraping(Campaign campaign) {
        String cron = campaign.getCronExpression();
        if (cron == null || cron.trim().isEmpty()) {
            return true; // Không đặt cron -> giữ hành vi mặc định, cào mỗi lần scheduler chạy (5 phút)
        }
        LocalDateTime lastRun = campaign.getLastScrapedAt() != null ? campaign.getLastScrapedAt() : campaign.getCreatedAt();
        try {
            LocalDateTime nextRun = CronExpression.parse(cron).next(lastRun);
            return nextRun != null && !nextRun.isAfter(LocalDateTime.now());
        } catch (IllegalArgumentException e) {
            log.warn("Cron expression không hợp lệ cho campaign {}: '{}' — bỏ qua lịch, dùng mặc định mỗi 5 phút", campaign.getName(), cron);
            return true;
        }
    }

    // Executor RIÊNG cho việc đăng bài (tách khỏi thread pool của @Scheduled ở SchedulingConfig) — mỗi
    // tick executePublishing() chỉ submit việc rồi trả về ngay, không chặn thread scheduler dù bài có
    // phải giãn cách MIN_MS_BETWEEN_POSTS_SAME_ACCOUNT hàng chục giây/nhiều bài liên tiếp.
    private final ExecutorService publishExecutor = Executors.newFixedThreadPool(MAX_PARALLEL_ACCOUNTS);
    // Thời điểm mỗi nick đăng xong bài gần nhất — dùng để giữ khoảng nghỉ tối thiểu giữa 2 bài cùng nick.
    private final Map<String, Long> lastPublishFinishedAt = new ConcurrentHashMap<>();
    private final org.springframework.web.client.RestTemplate workerStatusClient =
            com.autopost.saas.util.PooledRestTemplateFactory.create(3000, 5000);

    /**
     * Khoá hàng đợi theo danh tính đăng thật thay vì connectionId.
     *
     * Một cookie Facebook có thể được lưu thành nhiều connection khác nhau hoặc được cập nhật lại giá
     * trị xs. Nếu khoá theo connectionId, scheduler sẽ mở nhiều browser song song cho cùng c_user và
     * các phiên có thể tranh nhau danh tính Page. Với PERSONAL_COOKIE, c_user là danh tính ổn định nhất;
     * chỉ lưu SHA-256 của nó trong key/log để không làm lộ Facebook user id. Nếu cookie cũ không có
     * c_user thì dùng toàn bộ cookie đã chuẩn hoá (bỏ i_user vì i_user chỉ là Page đang chuyển sang).
     * PAGE_TOKEN được tuần tự theo Page ID để không dồn nhiều bài lên cùng Page.
     */
    String accountGroupKey(PostQueue post) {
        String target = post.getTargetFanpageId();
        if (target == null || target.isBlank()) {
            return "unresolved:__no_target__";
        }

        SocialAccount account = resolveTargetAccount(target).orElse(null);
        if (account == null) {
            return "unresolved:" + target;
        }

        return publishingIdentityKey(account);
    }

    static String publishingIdentityKey(SocialAccount account) {
        // Mọi connection mang cookie có c_user (PERSONAL_COOKIE, PERSONAL_PROFILE_COOKIE, kết nối đăng nhóm
        // ẩn danh…) đều là CÙNG 1 nick → chung 1 làn. Trước đây chỉ PERSONAL_COOKIE mới khoá theo c_user,
        // nên conn 35 "Thành An" (đăng nhóm) chạy song song với các Page của chính nick đó.
        String cUserIdentity = extractCookieValue(account.getAccessToken(), "c_user");
        if (cUserIdentity != null && !cUserIdentity.isBlank()) {
            return "facebook-cookie:" + sha256(cUserIdentity);
        }
        if ("PERSONAL_COOKIE".equalsIgnoreCase(account.getAccountType())) {
            String cookieIdentity = extractCookieValue(account.getAccessToken(), "c_user");
            if (cookieIdentity == null || cookieIdentity.isBlank()) {
                cookieIdentity = canonicalCookie(account.getAccessToken());
            }
            if (cookieIdentity != null && !cookieIdentity.isBlank()) {
                return "facebook-cookie:" + sha256(cookieIdentity);
            }
        }

        String platformId = account.getPlatformAccountId();
        if (platformId != null && !platformId.isBlank()) {
            return "platform-account:" + account.getAccountType() + ":" + platformId.trim();
        }
        return "connection:" + account.getId();
    }

    private Optional<SocialAccount> resolveTargetAccount(String target) {
        String[] parts = target.split(":", -1);
        if (parts.length >= 3 && !parts[2].isBlank()) {
            try {
                Optional<SocialAccount> byConnectionId = socialAccountRepository.findById(Long.valueOf(parts[2].trim()));
                if (byConnectionId.isPresent()) {
                    return byConnectionId;
                }
            } catch (NumberFormatException ignored) {
                // Dữ liệu cũ có thể không chứa connectionId hợp lệ; rơi xuống cách tìm tương thích.
            }
        }

        String platformId = parts[0].trim();
        String accountType = parts.length >= 2 ? parts[1].trim() : "";
        return accountType.isBlank()
                ? socialAccountRepository.findFirstByPlatformAccountIdOrderByIdAsc(platformId)
                : socialAccountRepository.findFirstByPlatformAccountIdAndAccountTypeIgnoreCaseOrderByIdAsc(platformId, accountType);
    }

    private static String extractCookieValue(String cookieString, String cookieName) {
        if (cookieString == null || cookieString.isBlank()) return null;
        return Arrays.stream(cookieString.split(";"))
                .map(String::trim)
                .filter(part -> part.regionMatches(true, 0, cookieName + "=", 0, cookieName.length() + 1))
                .map(part -> part.substring(part.indexOf('=') + 1).trim())
                .filter(value -> !value.isBlank())
                .findFirst()
                .orElse(null);
    }

    private static String canonicalCookie(String cookieString) {
        if (cookieString == null || cookieString.isBlank()) return null;
        return Arrays.stream(cookieString.split(";"))
                .map(String::trim)
                .filter(part -> !part.isBlank())
                .filter(part -> !part.regionMatches(true, 0, "i_user=", 0, "i_user=".length()))
                .sorted()
                .collect(Collectors.joining(";"));
    }

    private static String sha256(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("JVM không hỗ trợ SHA-256", e);
        }
    }

    /** Gom và sắp hàng đợi theo giờ hẹn trước, sau đó theo ID để 5 bài cùng giờ luôn có thứ tự ổn định. */
    Map<String, List<PostQueue>> groupPendingPosts(List<PostQueue> pendingPosts) {
        return groupPendingPosts(pendingPosts, this::accountGroupKey);
    }

    static Map<String, List<PostQueue>> groupPendingPosts(
            List<PostQueue> pendingPosts,
            Function<PostQueue, String> keyResolver) {
        Map<String, String> resolvedKeyByTarget = new ConcurrentHashMap<>();
        Comparator<PostQueue> publishOrder = Comparator
                .comparing(PostQueue::getScheduledAt, Comparator.nullsLast(Comparator.naturalOrder()))
                .thenComparing(PostQueue::getId, Comparator.nullsLast(Comparator.naturalOrder()));

        return pendingPosts.stream()
                .sorted(publishOrder)
                .collect(Collectors.groupingBy(
                        post -> resolvedKeyByTarget.computeIfAbsent(
                                post.getTargetFanpageId() != null ? post.getTargetFanpageId() : "__no_target__",
                                ignored -> keyResolver.apply(post)),
                        LinkedHashMap::new,
                        Collectors.toList()));
    }

    // 2. Tiến trình tự động đăng bài theo lịch đặt trước mỗi 10 giây (siêu nhạy, đúng giờ là chạy ngay).
    //    Đăng song song tối đa MAX_PARALLEL_ACCOUNTS account khác nhau để rút ngắn thời gian xử lý khi
    //    hàng đợi lớn, nhưng bài cùng 1 account luôn xử lý TUẦN TỰ + giãn cách tối thiểu giữa các lần
    //    đăng (tránh 2 Playwright session tranh cookie + tránh spam pattern dễ bị Facebook hạn chế).
    // Quản lý nick đang đăng kèm thời điểm bắt đầu — nếu quá 5 phút chưa xong (VD: tiến trình treo/chết ngầm)
    // thì tự động giải phóng khóa để không làm kẹt hàng đợi vĩnh viễn.
    private final Map<String, Long> accountsCurrentlyPublishing = new ConcurrentHashMap<>();
    // Quản lý nhóm/target đang được đăng — đảm bảo các worker chia ra đăng ở các nhóm KHÁC NHAU,
    // tuyệt đối không có 2 worker/2 nick xông vào đăng song song vào cùng 1 nhóm.
    private final Map<String, Long> targetsCurrentlyPublishing = new ConcurrentHashMap<>();
    // Thời điểm mỗi target (Fanpage/Group) đăng xong bài gần nhất
    private final Map<String, Long> lastPublishFinishedAtByTarget = new ConcurrentHashMap<>();
    // Post ID đang giữ khoá của từng làn/target — để bộ dọn khoá kẹt KHÔNG nhả khoá khi bài vẫn đang
    // thật sự chạy (PostQueueService.isInFlight). 1 bài Page + nhiều nhóm có thể chạy > 5 phút.
    private final Map<String, Long> postIdHoldingAccountLock = new ConcurrentHashMap<>();
    private final Map<String, Long> postIdHoldingTargetLock = new ConcurrentHashMap<>();
    /** Khoá đã giữ quá mốc này mà bài KHÔNG còn in-flight → coi là kẹt (worker read timeout là 600s). */
    static final long LANE_LOCK_STALE_MS = 660_000;
    /** Mốc tuyệt đối: dù còn in-flight, quá 45 phút vẫn nhả để không treo làn vĩnh viễn. */
    static final long LANE_LOCK_HARD_LIMIT_MS = 45 * 60_000;

    // 2. Tiến trình tự động đăng bài theo lịch đặt trước mỗi 5 giây (siêu nhạy, đúng giờ là chạy ngay).
    @Scheduled(fixedRate = 5000)
    @Transactional(readOnly = true)
    public void executePublishing() {
        LocalDateTime now = LocalDateTime.now();
        // Ngoài khung giờ đăng chung: không tự đăng bài theo lịch (bấm "Đăng ngay" vẫn đăng qua publishPostNow)
        if (!postingWindowService.get().contains(now)) {
            return;
        }

        // Tự động dọn dẹp khóa kẹt — nhưng KHÔNG nhả khi bài giữ khoá vẫn đang chạy thật (in-flight).
        long nowMs = System.currentTimeMillis();
        accountsCurrentlyPublishing.entrySet().removeIf(entry ->
                releaseIfStale("account", entry.getKey(), entry.getValue(), postIdHoldingAccountLock, nowMs));
        targetsCurrentlyPublishing.entrySet().removeIf(entry ->
                releaseIfStale("target", entry.getKey(), entry.getValue(), postIdHoldingTargetLock, nowMs));

        List<PostQueue> pendingPosts = postQueueRepository
                .findByStatusAndScheduledAtBeforeOrderByScheduledAtAscIdAsc("PENDING", now);

        if (pendingPosts.isEmpty()) {
            return;
        }
        if (pendingPosts.size() >= PENDING_PAGE_SIZE) {
            // Trang 100 bài cũ nhất đã đầy: có thể 1 nick đang nghỉ (throttle) chiếm hết, làm các nick khác
            // "vô hình". Bổ sung bài sớm nhất của TỪNG target để làn nào cũng được xét trong tick này.
            pendingPosts = mergeLaneHeads(pendingPosts,
                    postQueueRepository.findOverduePendingHeadPerTarget(now));
        }

        if (accountsCurrentlyPublishing.size() >= MAX_PARALLEL_ACCOUNTS) {
            // Đã đủ số nick đăng song song — chờ 1 nick xong mới nhận thêm.
            return;
        }

        // Tự động cân bằng tải và điều phối đa Via cho các Fanpage có từ 2 Via cùng quản trị
        balanceCoAdminPendingPosts(pendingPosts, now);

        Map<String, List<PostQueue>> byAccount = groupPendingPosts(pendingPosts);

        for (Map.Entry<String, List<PostQueue>> entry : byAccount.entrySet()) {
            String accountKey = entry.getKey();
            List<PostQueue> accountPosts = entry.getValue();
            if (accountPosts.isEmpty()) {
                continue;
            }

            if (accountsCurrentlyPublishing.size() >= MAX_PARALLEL_ACCOUNTS) {
                break;
            }

            PostQueue firstPost = accountPosts.get(0);
            String targetGroup = firstPost.getTargetGroupNames();
            String targetId = (targetGroup != null && !targetGroup.isBlank())
                    ? "group:" + targetGroup.trim()
                    : (firstPost.getTargetFanpageId() != null ? firstPost.getTargetFanpageId() : "__no_target__");

            // Giãn cách an toàn:
            // 1. Nếu là CÙNG 1 Target (Fanpage/Group) thì giãn cách 10 giây để trang nghỉ nhẹ.
            // 2. Nếu là Target KHÁC NHAU (Group khác / Page khác) của cùng via: chỉ cần 3 giây sau khi bài trước đóng trình duyệt.
            // 3. Nếu bài đã trễ hạn quá 1 phút: ưu tiên đăng bù ngay lập tức, không chờ giãn cách.
            // 3. Bài trễ hạn KHÔNG còn được bỏ qua giãn cách: trước đây làn bị trễ sẽ đăng dồn liên tiếp
            //    (không nghỉ) tới khi chạm trần bài/giờ — đúng kiểu nhịp làm Facebook giới hạn tần suất.
            //    Giờ mọi bài cùng nick đều phải cách bài trước ≥ minGapSeconds (Cài đặt lịch), tối thiểu 3s.
            Long lastTargetFinished = lastPublishFinishedAtByTarget.get(targetId);
            Long lastAccountFinished = lastPublishFinishedAt.get(accountKey);

            if (lastTargetFinished != null && (nowMs - lastTargetFinished < 10_000)) {
                // Cùng Group/Fanpage vừa đăng xong — nghỉ nhẹ 10s
                continue;
            }
            if (lastAccountFinished != null && (nowMs - lastAccountFinished < sameNickGapMs())) {
                continue;
            }

            // Nick đang bị Facebook giới hạn tần suất hoặc đã chạm trần bài/giờ → để bài chờ tick sau (không đổi lịch).
            SocialAccount laneAccount = firstPost.getTargetFanpageId() != null
                    ? resolveTargetAccount(firstPost.getTargetFanpageId()).orElse(null) : null;
            String nickKey = laneAccount != null ? com.autopost.saas.service.NickThrottleService.nickKey(laneAccount) : accountKey;
            if (nickThrottleService.blockReason(nickKey, laneAccount != null ? laneAccount.getPageName() : accountKey, now, nowMs) != null) {
                continue;
            }
            // Người dùng tạm dừng nick (Kết nối / bot Telegram) → giữ bài PENDING, không đổi giờ.
            if (laneAccount != null && Boolean.TRUE.equals(laneAccount.getPaused())) {
                continue;
            }

            if (targetsCurrentlyPublishing.putIfAbsent(targetId, nowMs) != null) {
                // Nhóm/Target này đang có 1 luồng/worker khác xử lý — bỏ qua để chia worker sang các nhóm khác nhau!
                continue;
            }

            if (accountsCurrentlyPublishing.putIfAbsent(accountKey, nowMs) != null) {
                // Account này đang có 1 luồng khác xử lý dở — bỏ qua tick này.
                targetsCurrentlyPublishing.remove(targetId);
                continue;
            }
            postIdHoldingAccountLock.put(accountKey, firstPost.getId());
            postIdHoldingTargetLock.put(targetId, firstPost.getId());
            nickThrottleService.recordStart(nickKey, nowMs);

            log.info("🚀 [Scheduler] Đang tự động xử lý Post ID {} (Tên: '{}') cho account '{}' vào target '{}' (nick đã đăng {}/{} bài trong 60 phút)...",
                    firstPost.getId(), firstPost.getTitle(), accountKey, targetId,
                    nickThrottleService.startsInLastHour(nickKey, nowMs), com.autopost.saas.service.NickThrottleService.MAX_POSTS_PER_HOUR_PER_NICK);

            try {
                publishExecutor.submit(() -> {
                    try {
                        log.info("Đang tự động đăng Post ID: {} (Tên: {})", firstPost.getId(), firstPost.getTitle());
                        postQueueService.publishPostNow(firstPost.getId());
                    } catch (Exception e) {
                        log.error("Lỗi khi tự động đăng Post ID {}: {}", firstPost.getId(), e.getMessage());
                    } finally {
                        long doneTime = System.currentTimeMillis();
                        lastPublishFinishedAt.put(accountKey, doneTime);
                        lastPublishFinishedAtByTarget.put(targetId, doneTime);
                        releaseLaneLocks(accountKey, targetId, firstPost.getId());
                    }
                });
            } catch (Exception submitErr) {
                log.error("Không thể submit tác vụ đăng Post ID {}: {}", firstPost.getId(), submitErr.getMessage());
                releaseLaneLocks(accountKey, targetId, firstPost.getId());
            }
        }
    }

    static final int PENDING_PAGE_SIZE = 100;

    /** Giãn cách tối thiểu giữa 2 bài cùng nick: minGapSeconds trong Cài đặt lịch, không dưới 3s. */
    long sameNickGapMs() {
        long gapSeconds = 0;
        try {
            gapSeconds = postingWindowService.get().minGapSeconds();
        } catch (Exception ignored) {
            // Lỗi đọc cấu hình → dùng mức tối thiểu
        }
        return Math.max(3_000L, gapSeconds * 1000L);
    }

    /**
     * Gộp danh sách bài đầu làn vào trang 100 bài cũ nhất (bỏ trùng theo ID), giữ thứ tự giờ hẹn rồi ID.
     */
    static List<PostQueue> mergeLaneHeads(List<PostQueue> oldestPage, List<PostQueue> laneHeads) {
        if (laneHeads == null || laneHeads.isEmpty()) return oldestPage;
        Map<Long, PostQueue> byId = new LinkedHashMap<>();
        for (PostQueue p : oldestPage) byId.put(p.getId(), p);
        for (PostQueue p : laneHeads) byId.putIfAbsent(p.getId(), p);
        List<PostQueue> merged = new ArrayList<>(byId.values());
        merged.sort(Comparator
                .comparing(PostQueue::getScheduledAt, Comparator.nullsLast(Comparator.naturalOrder()))
                .thenComparing(PostQueue::getId, Comparator.nullsLast(Comparator.naturalOrder())));
        return merged;
    }

    /** Trả true (→ xoá khoá) nếu khoá đã kẹt: quá LANE_LOCK_STALE_MS mà bài không còn in-flight, hoặc quá mốc tuyệt đối. */
    boolean releaseIfStale(String kind, String key, Long lockedAtMs, Map<String, Long> holderMap, long nowMs) {
        long heldMs = nowMs - (lockedAtMs != null ? lockedAtMs : nowMs);
        if (heldMs <= LANE_LOCK_STALE_MS) return false;
        Long holderPostId = holderMap.get(key);
        boolean stillRunning = holderPostId != null && postQueueService.isInFlight(holderPostId);
        if (stillRunning && heldMs <= LANE_LOCK_HARD_LIMIT_MS) {
            return false;
        }
        log.warn("⚠️ Khóa đăng {} '{}' (Post ID {}) giữ {} phút{} — tự động giải phóng để thông hàng đợi.",
                kind, key, holderPostId, heldMs / 60_000, stillRunning ? " (vẫn in-flight, vượt mốc tuyệt đối)" : "");
        holderMap.remove(key, holderPostId);
        return true;
    }

    private void releaseLaneLocks(String accountKey, String targetId, Long postId) {
        // Chỉ gỡ khoá nếu chính bài này đang giữ (tránh gỡ nhầm khoá của bài khác sau khi bị dọn kẹt).
        if (postIdHoldingAccountLock.remove(accountKey, postId) || !postIdHoldingAccountLock.containsKey(accountKey)) {
            accountsCurrentlyPublishing.remove(accountKey);
        }
        if (postIdHoldingTargetLock.remove(targetId, postId) || !postIdHoldingTargetLock.containsKey(targetId)) {
            targetsCurrentlyPublishing.remove(targetId);
        }
    }

    /**
     * CÂN BẰNG TẢI ĐA VIA (SMART CO-ADMIN LOAD BALANCING):
     * Nếu bài viết thuộc Fanpage có từ 2 Via cùng quản trị, hệ thống sẽ:
     * 1. Kiểm tra Via được gắn mặc định có đang bận (đang có luồng đăng hoặc đang trong thời gian giãn cách 2 phút) không.
     * 2. Nếu Via hiện tại đang bận hoặc đã có 1 bài khác được giao trong cùng tick này, tự động chuyển bài sang Via đồng
     *    quản trị còn lại đang rảnh rỗi (idle).
     * -> Kích hoạt đăng SONG SONG cả 2 Via trên Worker Playwright, vừa x2 tốc độ vừa tận dụng triệt để tài nguyên!
     */
    private void balanceCoAdminPendingPosts(List<PostQueue> pendingPosts, LocalDateTime now) {
        if (pendingPosts.isEmpty()) return;

        Set<String> assignedKeysInThisTick = new HashSet<>();
        // Nhiều bài cùng Page trong 1 tick → chỉ tra DB 1 lần cho mỗi (user, page, connection).
        Map<String, List<SocialAccount>> candidatesCache = new java.util.HashMap<>();

        for (PostQueue post : pendingPosts) {
            String target = post.getTargetFanpageId();
            if (target == null || target.isBlank()) continue;
            if (post.getTargetGroupNames() != null && post.getTargetGroupNames().startsWith("GROUP_ONLY_ANON")) continue;

            String[] parts = target.split(":", -1);
            String pagePlatformId = parts[0].trim();
            Long connId = null;
            if (parts.length >= 3 && !parts[2].isBlank()) {
                try {
                    connId = Long.valueOf(parts[2].trim());
                } catch (NumberFormatException ignored) {}
            }

            Long userId = post.getCampaign() != null && post.getCampaign().getUser() != null
                    ? post.getCampaign().getUser().getId() : null;

            final Long candUserId = userId;
            final Long candConnId = connId;
            List<SocialAccount> candidates = candidatesCache.computeIfAbsent(
                    userId + "|" + pagePlatformId + "|" + connId,
                    k -> postQueueService.findCandidatePostingAccountsForPage(candUserId, pagePlatformId, candConnId));
            if (candidates.size() <= 1) {
                // Chỉ có 1 Via quản trị -> giữ nguyên và ghi nhận key
                if (!candidates.isEmpty()) {
                    assignedKeysInThisTick.add(publishingIdentityKey(candidates.get(0)));
                }
                continue;
            }

            // Có từ 2 Via trở lên cùng quản trị Page này!
            // Tìm Via tối ưu nhất trong tick này:
            // Tiêu chí:
            // a) Chưa được giao bài nào trong tick này (!assignedKeysInThisTick)
            // b) Không đang bận xử lý bài dở (!accountsCurrentlyPublishing)
            // c) Đã qua thời gian nghỉ giãn cách giữa các bài cùng nick
            // d) Ưu tiên Via đăng ÍT BÀI HƠN trong 60 phút qua để tự động chia đều tải giữa 2 Via
            SocialAccount bestVia = null;
            int minStarts = Integer.MAX_VALUE;
            long oldestFinished = Long.MAX_VALUE;
            long nowMsVal = System.currentTimeMillis();

            for (SocialAccount candidate : candidates) {
                String key = publishingIdentityKey(candidate);
                boolean isPublishing = accountsCurrentlyPublishing.containsKey(key);
                Long lastFinished = lastPublishFinishedAt.get(key);
                boolean inCooldown = (lastFinished != null && (nowMsVal - lastFinished < sameNickGapMs()));
                boolean alreadyAssigned = assignedKeysInThisTick.contains(key);
                String candidateNick = com.autopost.saas.service.NickThrottleService.nickKey(candidate);
                boolean throttled = nickThrottleService.rateLimitedUntil(candidateNick, now) != null
                        || nickThrottleService.isOverHourlyCap(candidateNick, nowMsVal)
                        || Boolean.TRUE.equals(candidate.getPaused());

                if (!isPublishing && !inCooldown && !alreadyAssigned && !throttled) {
                    int starts = nickThrottleService.startsInLastHour(candidateNick, nowMsVal);
                    long finishTime = lastFinished != null ? lastFinished : 0L;
                    if (starts < minStarts || (starts == minStarts && finishTime < oldestFinished)) {
                        minStarts = starts;
                        oldestFinished = finishTime;
                        bestVia = candidate;
                    }
                }
            }

            if (bestVia != null) {
                String bestKey = publishingIdentityKey(bestVia);
                assignedKeysInThisTick.add(bestKey);

                String newTarget = pagePlatformId + ":PERSONAL_COOKIE:" + bestVia.getId();
                if (!newTarget.equalsIgnoreCase(post.getTargetFanpageId())) {
                    log.info("🔀 [Multi-Via Balancing] Điều phối Post ID {} ({}) sang Via rảnh '{}' (UID: {}) để kích hoạt đăng song song!",
                            post.getId(), post.getTitle(), bestVia.getPageName(), bestVia.getPlatformAccountId());
                    post.setTargetFanpageId(newTarget);
                    try {
                        // UPDATE riêng (REQUIRES_NEW): save() trong transaction readOnly sẽ không được flush.
                        postQueueRepository.reassignPendingTarget(post.getId(), newTarget);
                    } catch (Exception e) {
                        log.warn("Không thể lưu điều phối Post ID {}: {}", post.getId(), e.getMessage());
                    }
                }
            }
        }
    }

    // 3. Tự động thử lại các bài bị lỗi (tối đa MAX_RETRY lần), chờ ít nhất 10 phút giữa các lần thử
    //    để tránh spam retry liên tục khi lỗi có tính hệ thống (VD: token hết hạn, worker sập).
    @Scheduled(fixedRate = 600000)
    public void retryFailedPosts() {
        if (!autoRetryFailedPosts) {
            return;
        }
        if (!postingWindowService.get().contains(LocalDateTime.now())) {
            return;
        }
        // Allowlist hẹp: lỗi CHẮC CHẮN xảy ra trước khi Playwright kịp mở trình duyệt/bấm Đăng, nên
        // auto-retry luôn an toàn (không rủi ro đăng trùng).
        List<PostQueue> failedPosts = postQueueRepository.findByStatusAndUpdatedAtBefore("FAILED", LocalDateTime.now().minusMinutes(10));
        if (failedPosts.isEmpty()) {
            return;
        }
        log.info("🔁 [Scheduler] Phát hiện {} bài lỗi, kiểm tra để tự động thử lại (tối đa {} lần)...", failedPosts.size(), MAX_RETRY);
        for (PostQueue post : failedPosts) {
            boolean safePreSubmit = isSafePreSubmitFailure(post.getErrorMessage());
            // Lỗi vĩnh viễn (token/cookie hết hạn, thiếu quyền...) sẽ không tự khỏi chỉ vì đợi 10 phút
            // rồi thử lại — retry chỉ tổ tốn thêm 1 lượt (giới hạn MAX_RETRY) và có nguy cơ đăng trùng
            // nếu lần trước Playwright đã bấm Đăng nhưng mất phản hồi. Chỉ retry lỗi có tính tạm thời.
            if (!safePreSubmit && isPermanentFailure(post.getErrorMessage())) {
                log.info("⏭️ Post ID {} lỗi vĩnh viễn ({}), bỏ qua auto-retry — cần người dùng xử lý thủ công.", post.getId(), post.getErrorMessage());
                continue;
            }
            try {
                if (postQueueRepository.markRetryIfEligible(post.getId(), MAX_RETRY) == 1) {
                    log.info("🔁 Tự động thử lại Post ID: {}{}", post.getId(),
                            safePreSubmit ? " (lỗi trước-khi-bấm-Đăng, an toàn để retry)" : " (lần thử tiếp theo)");
                    // Đăng trên publishExecutor để không chiếm thread @Scheduled (pool nhỏ) suốt thời gian worker xử lý.
                    publishExecutor.submit(() -> {
                        try {
                            postQueueService.publishPostNow(post.getId());
                        } catch (Exception e) {
                            log.error("Lỗi khi tự động thử lại Post ID {}: {}", post.getId(), e.getMessage());
                        }
                    });
                }
            } catch (Exception e) {
                log.error("Lỗi khi tự động thử lại Post ID {}: {}", post.getId(), e.getMessage());
            }
        }
    }

    /**
     * Thu hồi bài PROCESSING bị treo. Nếu đã có ID/link bài hoặc một GroupResult=PUBLISHED thì có bằng
     * chứng bài thực sự đã lên Facebook và có thể chốt PUBLISHED an toàn. Nếu không có bằng chứng,
     * chuyển FAILED để dừng spinner nhưng KHÔNG tự retry — người dùng phải kiểm tra Facebook trước,
     * tránh trường hợp worker đã bấm Đăng xong rồi mất phản hồi dẫn đến đăng trùng.
     */
    private boolean isNickResting(PostQueue post) {
        if (post.getTargetFanpageId() == null) return false;
        SocialAccount account = resolveTargetAccount(post.getTargetFanpageId()).orElse(null);
        return account != null && nickThrottleService.rateLimitedUntil(
                com.autopost.saas.service.NickThrottleService.nickKey(account), LocalDateTime.now()) != null;
    }

    /**
     * NickThrottleService chỉ giữ trong RAM — sau restart nạp lại số bài đã đăng trong 60 phút qua theo nick
     * (để trần bài/giờ không bị reset) và mốc nghỉ của các nick đang bị Facebook giới hạn tần suất.
     */
    @org.springframework.context.event.EventListener(org.springframework.boot.context.event.ApplicationReadyEvent.class)
    @Transactional(readOnly = true)
    public void restoreNickThrottleState() {
        LocalDateTime now = LocalDateTime.now();
        int restored = 0;
        for (PostQueue post : postQueueRepository.findByPublishedAtAfter(now.minusHours(1))) {
            if (post.getTargetFanpageId() == null || post.getPublishedAt() == null) continue;
            SocialAccount account = resolveTargetAccount(post.getTargetFanpageId()).orElse(null);
            if (account == null) continue;
            long startedMs = post.getPublishedAt().atZone(java.time.ZoneId.systemDefault()).toInstant().toEpochMilli();
            nickThrottleService.recordStart(com.autopost.saas.service.NickThrottleService.nickKey(account), startedMs);
            restored++;
        }
        // Bài bị dời do cooldown giữ đúng giờ hết nghỉ; lấy mốc SỚM NHẤT của mỗi nick (các bài khác bị đẩy xa hơn).
        Map<String, LocalDateTime> resumeByNick = new java.util.HashMap<>();
        for (PostQueue post : postQueueRepository.findByStatusAndErrorMessageStartingWithAndScheduledAtAfter(
                "PENDING", PostQueueService.RATE_LIMIT_MESSAGE_PREFIX, now)) {
            SocialAccount account = post.getTargetFanpageId() != null ? resolveTargetAccount(post.getTargetFanpageId()).orElse(null) : null;
            if (account == null) continue;
            resumeByNick.merge(com.autopost.saas.service.NickThrottleService.nickKey(account), post.getScheduledAt(),
                    (a, b) -> a.isBefore(b) ? a : b);
        }
        resumeByNick.forEach(nickThrottleService::markRateLimited);
        log.info("🔁 [NickThrottle] Đã nạp lại {} bài đăng trong 60 phút qua và {} nick đang nghỉ do Facebook giới hạn tần suất.",
                restored, resumeByNick.size());
    }

    @Scheduled(fixedRate = 30000, initialDelay = 5000)
    @org.springframework.context.event.EventListener(org.springframework.boot.context.event.ApplicationReadyEvent.class)
    public void recoverStaleProcessingPosts() {
        LocalDateTime staleBefore = LocalDateTime.now().minusMinutes(PROCESSING_STALE_AFTER_MINUTES);
        List<PostQueue> stalePosts = postQueueRepository.findByStatusAndUpdatedAtBefore("PROCESSING", staleBefore);
        for (PostQueue post : stalePosts) {
            // Luồng backend vẫn đang chờ worker (bài chỉ đang xếp hàng vì worker đăng tuần tự) → chưa phải treo,
            // luồng đó sẽ tự chốt kết quả khi worker trả lời.
            if (postQueueService.isInFlight(post.getId())) {
                continue;
            }
            // Không còn luồng nào chờ (VD: backend vừa restart) → hỏi worker xem bài này đã đăng xong chưa.
            String workerVerdict = askWorkerPostResult(post);
            if ("IN_PROGRESS".equals(workerVerdict)) {
                continue;
            }
            if ("SUCCESS".equals(workerVerdict)) {
                post.setStatus("PUBLISHED");
                if (post.getPublishedAt() == null) {
                    post.setPublishedAt(LocalDateTime.now());
                }
                post.setErrorMessage(appendRecoveryWarning(post.getErrorMessage(),
                        "Hệ thống tự khôi phục: worker xác nhận bài đã đăng thành công dù backend mất phản hồi giữa chừng."));
                postQueueRepository.save(post);
                log.warn("✅ [Recovery] Post ID {} bị kẹt PROCESSING — worker xác nhận đã đăng, chốt PUBLISHED.", post.getId());
                continue;
            }
            Optional<com.autopost.saas.entity.PostQueueGroupResult> groupProof =
                    postQueueGroupResultRepository.findFirstByPostQueue_IdAndStatusOrderByAttemptedAtDesc(
                            post.getId(), "PUBLISHED");

            if (hasDirectPublishedEvidence(post) || groupProof.isPresent()) {
                LocalDateTime recoveredPublishedAt = groupProof
                        .map(com.autopost.saas.entity.PostQueueGroupResult::getAttemptedAt)
                        .orElseGet(() -> post.getUpdatedAt() != null ? post.getUpdatedAt()
                                : (post.getScheduledAt() != null ? post.getScheduledAt() : LocalDateTime.now()));
                post.setStatus("PUBLISHED");
                if (post.getPublishedAt() == null) {
                    post.setPublishedAt(recoveredPublishedAt);
                }
                post.setErrorMessage(appendRecoveryWarning(post.getErrorMessage(),
                        "Hệ thống tự khôi phục trạng thái sau khi tiến trình mất phản hồi; đã tìm thấy bằng chứng bài được đăng thành công."));
                postQueueRepository.save(post);
                log.warn("✅ [Recovery] Post ID {} bị kẹt PROCESSING nhưng có bằng chứng đã đăng — đã chốt PUBLISHED.", post.getId());
            } else {
                post.setStatus("NEEDS_REVIEW");
                post.setErrorMessage(appendRecoveryWarning(post.getErrorMessage(),
                        "Tiến trình đăng mất phản hồi quá " + PROCESSING_STALE_AFTER_MINUTES + " phút và chưa tìm thấy ID/link xác nhận. Đã chuyển sang trạng thái CẦN XÁC MINH (NEEDS_REVIEW) để tránh đăng trùng."));
                postQueueRepository.save(post);
                log.warn("⚠️ [Recovery] Post ID {} bị kẹt PROCESSING và chưa có bằng chứng — chuyển NEEDS_REVIEW để đối soát an toàn.", post.getId());
            }
        }
    }

    /**
     * Hỏi worker kết quả các lượt đăng của bài (worker ghi theo header X-Post-Queue-Id).
     * Trả về IN_PROGRESS (worker còn đang đăng/xếp hàng), SUCCESS (mọi lượt đã xong và có lượt thành công, không lượt
     * nào lỗi), hoặc null (không biết — giữ cách xử lý cũ). Lấy link bài nếu worker có.
     */
    /**
     * Hỏi toàn bộ cụm worker (3001, 3002, 3003) kết quả các lượt đăng của bài (worker ghi theo header X-Post-Queue-Id).
     * Trả về IN_PROGRESS (có worker đang xử lý), SUCCESS (có worker báo đã đăng thành công), hoặc null.
     */
    public String askWorkerPostResult(PostQueue post) {
        if (post == null || post.getId() == null) return null;
        List<String> workerUrls = workerRouterService != null ? workerRouterService.getAllWorkerUrls() : List.of(LocalServices.WORKER_BASE);
        boolean anySuccess = false;

        for (String baseUrl : workerUrls) {
            try {
                Map<?, ?> resp = workerStatusClient.getForObject(baseUrl + "/api/post-results/" + post.getId(), Map.class);
                if (resp == null || !(resp.get("legs") instanceof List<?> legs) || legs.isEmpty()) continue;
                for (Object o : legs) {
                    if (!(o instanceof Map<?, ?> leg)) continue;
                    String status = String.valueOf(leg.get("status"));
                    if ("IN_PROGRESS".equals(status)) {
                        return "IN_PROGRESS"; // Có worker đang xử lý, tuyệt đối không can thiệp!
                    }
                    if ("SUCCESS".equals(status)) {
                        anySuccess = true;
                        if (leg.get("postUrl") instanceof String url && !url.isBlank() && (post.getPublishedPostUrl() == null || post.getPublishedPostUrl().isBlank())) {
                            post.setPublishedPostUrl(url);
                        }
                    }
                }
            } catch (Exception ignored) {
                // Tiếp tục hỏi worker khác trong cụm
            }
        }
        return anySuccess ? "SUCCESS" : null;
    }

    static boolean hasDirectPublishedEvidence(PostQueue post) {
        return hasText(post.getFbPostId()) || hasText(post.getPublishedPostUrl())
                || hasText(post.getPublishedGroupPostUrls());
    }

    private static boolean hasText(String value) {
        return value != null && !value.isBlank();
    }

    private String appendRecoveryWarning(String existing, String recoveryMessage) {
        return existing == null || existing.isBlank() ? recoveryMessage : existing + " | " + recoveryMessage;
    }

    /** Nhận diện lỗi vĩnh viễn (cần người dùng can thiệp) — không có ý nghĩa để hệ thống tự retry. */
    private boolean isPermanentFailure(String errorMessage) {
        if (errorMessage == null) return false;
        String m = errorMessage.toLowerCase();
        return m.contains("hết hạn") || m.contains("đăng nhập lại") || m.contains("chưa bật quyền")
                || m.contains("permission") || m.contains("token") || m.contains("không hợp lệ")
                || m.contains("[no_auto_retry]") || m.contains("kiểm tra facebook trước");
    }

    // Allowlist hẹp cho retryFailedPosts(): các lỗi này CHẮC CHẮN xảy ra trước khi Playwright kịp mở
    // trình duyệt/bấm nút Đăng (connection refused = request chưa tới được worker; "không thể mở
    // modal" = chưa từng chạm tới bước nhập nội dung/submit), nên auto-retry an toàn tuyệt đối, không
    // có rủi ro đăng trùng — khác với các lỗi mơ hồ khác vẫn cần cờ autoRetryFailedPosts.
    private boolean isSafePreSubmitFailure(String errorMessage) {
        if (errorMessage == null) return false;
        String m = errorMessage.toLowerCase();
        // "không mở được modal đăng bài" = lỗi mở hộp đăng bài trong Group — cũng xảy ra TRƯỚC khi gõ/bấm Đăng.
        return m.contains("connection refused") || m.contains("i/o error")
                || m.contains("không thể mở modal tạo bài viết") || m.contains("không mở được modal đăng bài");
    }

    // 4. Kiểm tra tình trạng Page Access Token mỗi 6 giờ — cảnh báo sớm nếu sắp hết hạn/đã hết hạn,
    //    để tránh tình trạng đăng lỗi hàng loạt mà không rõ nguyên nhân.
    @Scheduled(fixedRate = 21600000, initialDelay = 30000)
    public void checkTokenHealth() {
        List<SocialAccount> pageTokenAccounts = socialAccountRepository.findByAccountType("PAGE_TOKEN");
        if (pageTokenAccounts.isEmpty()) {
            return;
        }
        log.info("🔑 [Scheduler] Kiểm tra tình trạng Page Access Token cho {} Fanpage...", pageTokenAccounts.size());
        for (SocialAccount account : pageTokenAccounts) {
            try {
                Map<String, Object> debug = facebookGraphApiService.debugToken(account.getAccessToken());
                String status;
                LocalDateTime expiresAt = null;

                if (debug.isEmpty()) {
                    status = "UNKNOWN";
                } else if (Boolean.FALSE.equals(debug.get("is_valid"))) {
                    status = "EXPIRED";
                } else {
                    Object expiresAtRaw = debug.get("expires_at");
                    long expiresAtEpoch = expiresAtRaw != null ? Long.parseLong(expiresAtRaw.toString()) : 0;
                    if (expiresAtEpoch == 0) {
                        status = "OK"; // 0 = token không có hạn (never expires)
                    } else {
                        expiresAt = LocalDateTime.ofEpochSecond(expiresAtEpoch, 0, java.time.ZoneOffset.UTC);
                        boolean expiringSoon = expiresAt.isBefore(LocalDateTime.now().plusDays(TOKEN_EXPIRING_SOON_DAYS));
                        status = expiresAt.isBefore(LocalDateTime.now()) ? "EXPIRED" : (expiringSoon ? "EXPIRING_SOON" : "OK");
                    }
                }

                if (!status.equals(account.getTokenStatus())) {
                    log.warn("🔑 Fanpage {} ({}): trạng thái token đổi thành {}", account.getPageName(), account.getPlatformAccountId(), status);
                }
                account.setTokenStatus(status);
                account.setTokenExpiresAt(expiresAt);
                account.setTokenCheckedAt(LocalDateTime.now());
                socialAccountRepository.save(account);
            } catch (Exception e) {
                log.warn("⚠️ Lỗi khi kiểm tra token Fanpage {}: {}", account.getPageName(), e.getMessage());
            }
        }
    }

    // 5. Kiểm tra chủ động cookie Facebook (PERSONAL_COOKIE) mỗi 6 giờ — phát hiện cookie hết hạn
    //    TRƯỚC khi một bài đăng thực tế thất bại, để cảnh báo sớm trên UI (chuông + banner Dashboard).
    //    Lệch initialDelay với checkTokenHealth() để không mở nhiều browser Playwright cùng lúc.
    @Scheduled(fixedRate = 21600000, initialDelay = 1800000)
    public void checkCookieHealth() {
        // Page có bản sao cookie hỏng (c_user lạ/EXPIRED) đi theo Via trước, để được kiểm tra chung
        // nhóm c_user với Via thay vì bị check riêng bằng cookie hỏng rồi báo hết hạn oan.
        viaCookieFollowService.repairPagesFollowingVias();
        List<SocialAccount> cookieAccounts = socialAccountRepository
                .findByAccountTypeIn(List.of("PERSONAL_COOKIE", "PERSONAL_PROFILE_COOKIE")).stream()
                .filter(a -> !"FACEBOOK_GROUP".equalsIgnoreCase(a.getPlatform()))
                .toList();
        if (cookieAccounts.isEmpty()) {
            return;
        }
        Map<String, List<SocialAccount>> accountsByVia = cookieAccounts.stream().collect(Collectors.groupingBy(
                this::cookieIdentityKey,
                LinkedHashMap::new,
                Collectors.toList()
        ));
        log.info("🍪 [Scheduler] Kiểm tra tình trạng Cookie cho {} via ({} kết nối)...", accountsByVia.size(), cookieAccounts.size());
        for (List<SocialAccount> sameViaAccounts : accountsByVia.values()) {
            SocialAccount account = sameViaAccounts.stream()
                    .filter(item -> "FACEBOOK_PROFILE".equals(item.getPlatform()))
                    .findFirst()
                    .orElse(sameViaAccounts.get(0));
            try {
                String status = playwrightHealthCheckService.checkCookieStatus(account.getAccessToken());
                if (!status.equals(account.getTokenStatus())) {
                    log.warn("🍪 Cookie {} ({}): trạng thái đổi thành {}", account.getPageName(), account.getPlatformAccountId(), status);
                }
                LocalDateTime checkedAt = LocalDateTime.now();
                for (SocialAccount sameViaAccount : sameViaAccounts) {
                    sameViaAccount.setTokenStatus(status);
                    sameViaAccount.setTokenCheckedAt(checkedAt);
                    socialAccountRepository.save(sameViaAccount);
                }
                Thread.sleep(2000); // Giãn cách giữa các lần mở browser thật, tránh dồn tải Worker
            } catch (Exception e) {
                log.warn("⚠️ Lỗi khi kiểm tra Cookie {}: {}", account.getPageName(), e.getMessage());
            }
        }
        viaCookieFollowService.repairPagesFollowingVias();
    }

    // 5b. Page cookie đi theo Via (chỉ đọc/ghi DB, không mở browser): Page nào có bản sao cookie hỏng
    //     mà Via quản trị còn sống thì chép cookie Via xuống — Via sống thì Page không bị báo hết hạn oan.
    @Scheduled(fixedRate = 600000, initialDelay = 60000)
    public void syncPagesWithVias() {
        try {
            int repaired = viaCookieFollowService.repairPagesFollowingVias();
            if (repaired > 0) {
                log.info("🔗 [Scheduler] Đã đồng bộ cookie Via xuống {} kết nối Page.", repaired);
            }
        } catch (Exception e) {
            log.warn("⚠️ Lỗi khi đồng bộ cookie Via xuống Page: {}", e.getMessage());
        }
    }

    private String cookieIdentityKey(SocialAccount account) {
        Matcher matcher = C_USER_COOKIE_PATTERN.matcher(account.getAccessToken() == null ? "" : account.getAccessToken());
        return matcher.find() ? "c_user:" + matcher.group(1).trim() : "account:" + account.getId();
    }

    /** Ước lượng thời gian đăng 1 bài (giây): ~60s cho Page + ~60s cho mỗi Nhóm đăng kèm. */
    private static long estimatePublishSeconds(PostQueue post) {
        String groups = post.getTargetGroupNames();
        if (groups == null || groups.isBlank()) {
            return 60;
        }
        boolean groupOnly = groups.startsWith("GROUP_ONLY:") || groups.startsWith("GROUP_ONLY_ANON:");
        long groupCount = Arrays.stream(groups.replaceFirst("^GROUP_ONLY_ANON:|^GROUP_ONLY:", "").split(","))
                .map(String::trim).filter(g -> !g.isEmpty()).count();
        return (groupOnly ? 0 : 60) + 60 * Math.max(1, groupCount);
    }

    /**
     * Chế độ "Nối đuôi liên tục": xếp giờ cho các bài PENDING theo từng nick (cùng khoá c_user mà
     * scheduler dùng để đăng tuần tự), mỗi bài nối ngay sau bài trước + thời gian nghỉ gapSeconds.
     * Các nick khác nhau chạy song song nên mỗi nick có "làn" riêng bắt đầu từ bây giờ.
     *
     * @param postIds null = dồn TOÀN BỘ hàng chờ chạy liên tục từ bây giờ; có danh sách = chỉ xếp các
     *                bài này, chèn vào khoảng trống sớm nhất của làn mà không đụng giờ các bài khác.
     * @return số bài được đổi giờ và giờ dự kiến bài cuối cùng chạy xong.
     */
    @Transactional
    public Map<String, Object> packContinuous(Collection<Long> postIds, int gapSeconds) {
        return packContinuousFrom(postIds, gapSeconds, null);
    }

    /**
     * Như packContinuous nhưng các làn bắt đầu từ mốc "from" (chế độ "Hẹn giờ" cho nhiều bài:
     * bắt đầu từ giờ đã chọn, các bài cùng nick nối đuôi sau đó). from null/quá khứ = từ bây giờ.
     */
    @Transactional
    public Map<String, Object> packContinuousFrom(Collection<Long> postIds, int gapSeconds, LocalDateTime from) {
        LocalDateTime start = (from != null && from.isAfter(LocalDateTime.now())) ? from : LocalDateTime.now();
        List<PostQueue> pending = postQueueRepository.findByStatusOrderByIdAsc("PENDING");
        List<PostQueue> processing = postQueueRepository.findByStatusOrderByIdAsc("PROCESSING");
        List<PostQueue> updated = new ArrayList<>();
        Map<String, List<PostQueue>> deferred = new LinkedHashMap<>();
        Set<Long> movingIds = postIds == null ? null : new HashSet<>(postIds);

        // Kiểm tra nếu các bài cần xếp lịch có chứa nhiều nhóm đích Facebook, tự động rải đều theo Nhóm
        List<PostQueue> targetList = pending.stream()
                .filter(p -> movingIds == null || movingIds.contains(p.getId()))
                .toList();
        long groupCount = targetList.stream()
                .map(p -> com.autopost.saas.util.FacebookPostIds.targetGroupKeys(p.getTargetGroupNames()))
                .filter(keys -> !keys.isEmpty())
                .distinct()
                .count();
        if (groupCount > 1) {
            log.info("🎯 [packContinuous] Phát hiện {} nhóm đích, tự động kích hoạt thuật toán rải đều theo Nhóm (gap: {}s)", groupCount, gapSeconds);
            Integer minGapMins = gapSeconds > 0 ? Math.max(1, gapSeconds / 60) : null;
            return spreadEvenlyByGroups(postIds, from, null, minGapMins);
        }

        PostingWindow window = postingWindowService.get();
        LocalDateTime lastFinish = planContinuousLanes(pending, processing, movingIds, this::accountGroupKey,
                start, Math.max(0, gapSeconds), window, false, updated, deferred);

        postQueueRepository.saveAll(updated);
        int deferredCount = deferred.values().stream().mapToInt(List::size).sum();
        log.info("🔗 [Nối đuôi liên tục] Đã xếp lại {} bài (nghỉ {}s/bài), dự kiến xong lúc {}{}",
                updated.size(), gapSeconds, lastFinish,
                deferredCount > 0 ? " — " + deferredCount + " bài không kịp trong khung giờ, dời sang hôm sau" : "");
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("updated", updated.size());
        result.put("estimatedFinishAt", lastFinish.toString());
        result.put("deferredCount", deferredCount);
        return result;
    }

    /**
     * Rải đều TOÀN BỘ bài PENDING của từng nick trong phần còn lại của khung giờ hôm nay (hoặc khung kế tiếp
     * nếu đang ngoài giờ): giãn cách = (thời gian khung còn lại − thời gian đăng) / số bài, không dưới minGapSeconds.
     * Không kịp hết trong ngày thì giãn cách rút về mức tối thiểu và phần dư dời sang hôm sau như packContinuous.
     */
    @Transactional
    public Map<String, Object> spreadEvenly(int minGapSeconds) {
        PostingWindow window = postingWindowService.get();
        if (!window.enabled()) {
            return packContinuous(null, minGapSeconds);
        }
        List<PostQueue> pending = postQueueRepository.findByStatusOrderByIdAsc("PENDING");
        List<PostQueue> processing = postQueueRepository.findByStatusOrderByIdAsc("PROCESSING");
        List<PostQueue> updated = new ArrayList<>();
        Map<String, List<PostQueue>> deferred = new LinkedHashMap<>();
        long gap = Math.max(Math.max(0, minGapSeconds), window.minGapSeconds());
        LocalDateTime lastFinish = planContinuousLanes(pending, processing, null, this::accountGroupKey,
                LocalDateTime.now(), gap, window, false, true, updated, deferred);
        postQueueRepository.saveAll(updated);
        int deferredCount = deferred.values().stream().mapToInt(List::size).sum();
        log.info("📅 [Rải đều] Đã xếp lại {} bài trong khung {}–{} (tối thiểu {}s/bài), dự kiến xong lúc {}{}",
                updated.size(), window.start(), window.end(), gap, lastFinish,
                deferredCount > 0 ? " — " + deferredCount + " bài không kịp, dời sang hôm sau" : "");
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("updated", updated.size());
        result.put("estimatedFinishAt", lastFinish.toString());
        result.put("deferredCount", deferredCount);
        return result;
    }

    /**
     * Rải đều TOÀN BỘ bài của TẤT CẢ CÁC NHÓM suốt cả ngày / khoảng thời gian mong muốn (Group-Interleaved Day Distribution):
     * - Gom bài theo Facebook Group đích.
     * - Giãn cách đều đặn các bài của cùng 1 nhóm (không bị dồn cục một buổi).
     * - Xếp xen kẽ (interleaved) giữa các nhóm: Vòng 1 xếp bài đầu tiên của tất cả các nhóm (cách nhau vài phút),
     *   sau đó mới đến vòng 2, vòng 3...
     * - Bảo vệ an toàn: 2 bài của cùng 1 Nick/Page không bao giờ bị xếp sát nhau hơn 2 phút.
     */
    @Transactional
    public Map<String, Object> spreadEvenlyByGroups(Collection<Long> postIds, LocalDateTime startRange, LocalDateTime endRange, Integer minGroupGapMinutes) {
        List<PostQueue> allPending = postQueueRepository.findByStatusOrderByIdAsc("PENDING");
        Set<Long> scope = (postIds != null && !postIds.isEmpty()) ? new HashSet<>(postIds) : null;
        List<PostQueue> targets = allPending.stream()
                .filter(p -> scope == null || scope.contains(p.getId()))
                .filter(p -> !isNickResting(p))
                .toList();

        Map<String, Object> result = new LinkedHashMap<>();
        if (targets.isEmpty()) {
            result.put("success", true);
            result.put("updated", 0);
            result.put("groupCount", 0);
            return result;
        }

        // 1. Phân nhóm bài theo Group đích (nếu không có group thì gom theo target_fanpage_id)
        Map<String, List<PostQueue>> byGroup = new LinkedHashMap<>();
        for (PostQueue p : targets) {
            Set<String> groupKeys = com.autopost.saas.util.FacebookPostIds.targetGroupKeys(p.getTargetGroupNames());
            String groupKey = groupKeys.isEmpty()
                    ? ("FANPAGE_" + (p.getTargetFanpageId() != null ? p.getTargetFanpageId() : "DEFAULT"))
                    : groupKeys.iterator().next();
            byGroup.computeIfAbsent(groupKey, k -> new ArrayList<>()).add(p);
        }

        // Sắp xếp các bài trong mỗi nhóm theo ID / giờ hiện tại
        LocalDateTime now = LocalDateTime.now();
        for (List<PostQueue> list : byGroup.values()) {
            list.sort(Comparator.comparing((PostQueue p) -> p.getScheduledAt() != null ? p.getScheduledAt() : now)
                    .thenComparing(PostQueue::getId));
        }

        // 2. Xác định mốc thời gian bắt đầu & kết thúc
        LocalDateTime start = (startRange != null && startRange.isAfter(now)) ? startRange : now.plusMinutes(2);
        PostingWindow window = postingWindowService.get();
        if (window.enabled()) {
            start = window.openAtOrAfter(start);
        }

        LocalDateTime end = endRange;
        if (end == null || !end.isAfter(start)) {
            if (window.enabled()) {
                end = window.closeOf(start);
                if (!end.isAfter(start)) {
                    start = window.openAtOrAfter(start);
                    end = window.closeOf(start);
                }
            } else {
                end = start.toLocalDate().atTime(22, 0);
                if (!end.isAfter(start)) {
                    end = start.plusHours(12);
                }
            }
        }

        long totalSeconds = java.time.Duration.between(start, end).getSeconds();
        if (totalSeconds < 600) totalSeconds = 3600;

        int groupCount = byGroup.size();

        // 3. Phân bổ đều theo tỷ lệ tiến độ (Fractional Distribution):
        // Mỗi bài của mỗi nhóm được phân đều từ start đến end, nhóm ít bài hay nhiều bài đều có bài rải suốt ngày
        record Candidate(PostQueue post, String groupKey, LocalDateTime desiredTime) {}
        List<Candidate> candidates = new ArrayList<>();
        int gIdx = 0;
        for (Map.Entry<String, List<PostQueue>> entry : byGroup.entrySet()) {
            String gKey = entry.getKey();
            List<PostQueue> gPosts = entry.getValue();
            int count = gPosts.size();
            for (int pIdx = 0; pIdx < count; pIdx++) {
                double frac;
                if (count <= 1) {
                    // Nếu nhóm chỉ có 1 bài: rải đều vị trí của nhóm này trong toàn bộ khung thời gian
                    frac = (groupCount <= 1) ? 0.0 : ((double) gIdx / Math.max(1, groupCount - 1));
                } else {
                    // Nếu nhóm có nhiều bài: rải đều các bài của nhóm đó dọc theo ngày, so le nhẹ giữa các nhóm
                    double groupOffset = (groupCount > 1) ? ((double) gIdx / groupCount) : 0.0;
                    double step = 1.0 / count;
                    frac = (pIdx * step) + (groupOffset * step * 0.7);
                }
                long offsetSec = (long) (Math.min(0.98, Math.max(0.0, frac)) * totalSeconds);
                LocalDateTime desired = start.plusSeconds(offsetSec);
                candidates.add(new Candidate(gPosts.get(pIdx), gKey, desired));
            }
            gIdx++;
        }

        candidates.sort(Comparator.comparing(Candidate::desiredTime).thenComparing(c -> c.post().getId()));

        // 4. Giải quyết xung đột (cùng Nick tối thiểu minNickGap, cùng Nhóm tối thiểu minGroupGap, và nhảy qua đêm theo PostingWindow)
        long minGroupGapSeconds = (minGroupGapMinutes != null && minGroupGapMinutes > 0)
                ? (minGroupGapMinutes * 60L)
                : 1200L; // Mặc định 20 phút (1200s) cho cùng 1 Group nếu không truyền
        // Giữa các nhóm khác nhau trên cùng 1 nick: tối thiểu 60s để Chromium đóng và nick nghỉ ngơi
        long minNickGapSeconds = Math.max(60L, Math.min(minGroupGapSeconds, 60L));

        Map<String, LocalDateTime> lastNickAssigned = new HashMap<>();
        Map<String, LocalDateTime> lastGroupAssigned = new HashMap<>();
        List<PostQueue> updated = new ArrayList<>();
        LocalDateTime maxScheduled = start;

        for (Candidate c : candidates) {
            PostQueue post = c.post();
            String nickKey = accountGroupKey(post);
            String gKey = c.groupKey();

            LocalDateTime slot = c.desiredTime();
            if (slot.isBefore(start)) slot = start;

            // Xung đột trên cùng 1 Nick
            LocalDateTime lastNick = lastNickAssigned.get(nickKey);
            if (lastNick != null && slot.isBefore(lastNick.plusSeconds(minNickGapSeconds))) {
                slot = lastNick.plusSeconds(minNickGapSeconds);
            }

            // Xung đột trên cùng 1 Nhóm
            LocalDateTime lastGroup = lastGroupAssigned.get(gKey);
            if (lastGroup != null && slot.isBefore(lastGroup.plusSeconds(minGroupGapSeconds))) {
                slot = lastGroup.plusSeconds(minGroupGapSeconds);
            }

            // Nhảy qua đêm nếu vượt quá giờ đóng khung
            if (window.enabled()) {
                LocalDateTime openSlot = window.openAtOrAfter(slot);
                if (!openSlot.equals(slot)) {
                    slot = openSlot;
                    // Sau khi nhảy sang sáng hôm sau, kiểm tra lại nick collision
                    lastNick = lastNickAssigned.get(nickKey);
                    if (lastNick != null && slot.isBefore(lastNick.plusSeconds(minNickGapSeconds))) {
                        slot = lastNick.plusSeconds(minNickGapSeconds);
                    }
                }
            }

            lastNickAssigned.put(nickKey, slot);
            lastGroupAssigned.put(gKey, slot);
            post.setScheduledAt(slot);
            post.setWindowDeferred(null);
            updated.add(post);

            if (slot.isAfter(maxScheduled)) {
                maxScheduled = slot;
            }
        }

        postQueueRepository.saveAll(updated);
        log.info("🎯 [Phân bổ đều các nhóm] Đã xếp lại {} bài cho {} nhóm từ {} đến {}, bài cuối dự kiến {}",
                updated.size(), groupCount, start, end, maxScheduled);

        result.put("success", true);
        result.put("updated", updated.size());
        result.put("groupCount", groupCount);
        result.put("estimatedFinishAt", maxScheduled.toString());
        return result;
    }

    // ĐÃ TẮT TỰ ĐỘNG CHẠY NGẦM MỖI 5 PHÚT: Tránh việc tự ý ghi đè/xáo trộn giờ đăng của người dùng sau lưng.
    // Việc chặn đăng ngoài khung giờ đã được đảm bảo an toàn tại thời điểm publish (executePublishing kiểm tra postingWindow).
    // @Scheduled(fixedRate = 300000, initialDelay = 60000)
    public void keepPendingInsidePostingWindow() {
        if (!postingWindowService.get().enabled()) return;
        try {
            fitIntoWindow(null);
        } catch (Exception e) {
            log.warn("Không thể xếp lại bài vào khung giờ đăng: {}", e.getMessage());
        }
    }

    /**
     * Đưa các bài PENDING đang hẹn giờ NGOÀI khung giờ đăng vào trong khung (giữ nguyên bài đã nằm trong
     * khung, không kéo bài sớm hơn giờ đã hẹn). postIds == null = xét toàn bộ hàng chờ.
     * @return số bài dời giờ và số bài không kịp trong ngày (bị dời sang hôm sau).
     */
    @Transactional
    public Map<String, Object> fitIntoWindow(Collection<Long> postIds) {
        PostingWindow window = postingWindowService.get();
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("updated", 0);
        result.put("deferredCount", 0);
        if (!window.enabled()) return result;

        List<PostQueue> pending = postQueueRepository.findByStatusOrderByIdAsc("PENDING");
        List<PostQueue> processing = postQueueRepository.findByStatusOrderByIdAsc("PROCESSING");
        Set<Long> scope = postIds == null ? null : new HashSet<>(postIds);
        Set<Long> movingIds = new HashSet<>();

        long gapSeconds = window.minGapSeconds() > 0 ? window.minGapSeconds() : postingWindowService.defaultGapSeconds();

        // Chỉ dời bài đang nằm NGOÀI khung giờ (hoặc bị đánh dấu dư). Trước đây scope == null xếp lại TOÀN BỘ
        // hàng chờ — job 5 phút gọi vậy nên giờ hẹn của mọi bài bị đổi liên tục. Muốn xếp lại cả ngày: spreadEvenly().
        for (PostQueue p : pending) {
            if (scope != null && !scope.contains(p.getId())) continue;
            LocalDateTime at = p.getScheduledAt();
            boolean outside = at == null || !window.contains(at)
                    || at.plusSeconds(estimatePublishSeconds(p)).isAfter(window.closeOf(at))
                    || Boolean.TRUE.equals(p.getWindowDeferred());
            // Nick đang nghỉ do Facebook giới hạn tần suất: giờ hết nghỉ có thể rơi ngoài khung (VD 23:00) — không được
            // kéo bài về "ngay bây giờ" (2026-10-27 đã kéo 32 bài Thành An về lại tối nay theo cách này).
            if (outside && isNickResting(p)) continue;
            if (outside) movingIds.add(p.getId());
        }
        if (movingIds.isEmpty()) return result;

        List<PostQueue> updated = new ArrayList<>();
        Map<String, List<PostQueue>> deferred = new LinkedHashMap<>();
        planContinuousLanes(pending, processing, movingIds, this::accountGroupKey, LocalDateTime.now(),
                gapSeconds, window, false, updated, deferred);
        postQueueRepository.saveAll(updated);
        int deferredCount = deferred.values().stream().mapToInt(List::size).sum();
        log.info("🕘 [Khung giờ đăng] Đưa {} bài vào khung {}–{} (nghỉ {}s/bài, {} bài dời sang hôm sau)",
                updated.size(), window.start(), window.end(), gapSeconds, deferredCount);
        result.put("updated", updated.size());
        result.put("deferredCount", deferredCount);
        return result;
    }

    /**
     * Báo cáo bài dư (không kịp đăng trong khung giờ, đã bị dời sang hôm sau) theo từng nick, kèm đề xuất
     * chuyển sang nick khác còn chỗ trống trong khung giờ hôm nay và có quyền đăng đúng chỗ đó:
     * - Bài Fanpage: Via đồng quản trị Page (cùng nguồn với cân bằng tải đa Via).
     * - Bài Nhóm: nick đã từng đăng thành công vào chính nhóm đó (chắc chắn đã là thành viên).
     * Không đổi gì trong DB — người dùng phải bấm duyệt (applyWindowSuggestion).
     */
    @Transactional(readOnly = true)
    public Map<String, Object> windowPlanReport() {
        PostingWindow window = postingWindowService.get();
        LocalDateTime now = LocalDateTime.now();
        Map<String, Object> report = new LinkedHashMap<>();
        report.put("enabled", window.enabled());
        report.put("start", window.start().toString());
        report.put("end", window.end().toString());
        report.put("minGapSeconds", window.minGapSeconds());
        List<Map<String, Object>> lanes = new ArrayList<>();
        report.put("lanes", lanes);

        List<PostQueue> pending = postQueueRepository.findByStatusOrderByIdAsc("PENDING");
        List<PostQueue> processing = postQueueRepository.findByStatusOrderByIdAsc("PROCESSING");
        Map<String, String> laneNames = new java.util.HashMap<>();
        for (PostQueue p : pending) {
            String tgt = p.getTargetFanpageId() != null && !p.getTargetFanpageId().isBlank() ? p.getTargetFanpageId() : "unresolved";
            laneNames.putIfAbsent(tgt, targetDisplayName(tgt));
        }
        report.put("queue", queueFinishSummary(pending, processing,
                p -> p.getTargetFanpageId() != null && !p.getTargetFanpageId().isBlank() ? p.getTargetFanpageId() : "unresolved",
                lane -> laneNames.getOrDefault(lane, "Không rõ nick"), now, window));

        if (!window.enabled()) {
            report.put("totalDeferred", 0);
            return report;
        }

        Map<String, String> laneOfPost = new java.util.HashMap<>();
        Map<String, List<PostQueue>> deferredByLane = new LinkedHashMap<>();
        // Tải hôm nay của từng nick (giây đã chiếm trong khung giờ còn lại hôm nay)
        LocalDateTime todayOpen = window.openAtOrAfter(now);
        LocalDateTime todayClose = window.closeOf(todayOpen);
        Map<String, Long> busySecondsToday = new java.util.HashMap<>();
        for (PostQueue p : pending) {
            String lane = accountGroupKey(p);
            laneOfPost.put(String.valueOf(p.getId()), lane);
            // Chỉ còn tính là "dư" khi bài vẫn đang nằm ở ngày sau (qua ngày thì bài dư hôm qua là lịch bình thường hôm nay)
            boolean stillDeferred = Boolean.TRUE.equals(p.getWindowDeferred()) && p.getScheduledAt() != null
                    && p.getScheduledAt().toLocalDate().isAfter(todayOpen.toLocalDate());
            if (stillDeferred) {
                deferredByLane.computeIfAbsent(lane, k -> new ArrayList<>()).add(p);
            } else if (p.getScheduledAt() != null && !p.getScheduledAt().isBefore(todayOpen) && p.getScheduledAt().isBefore(todayClose)) {
                busySecondsToday.merge(lane, estimatePublishSeconds(p) + window.minGapSeconds(), Long::sum);
            }
        }
        long freeWindowToday = Math.max(0, java.time.Duration.between(todayOpen, todayClose).getSeconds());

        // Nhóm → các danh tính đăng đã từng đăng thành công vào nhóm đó
        Map<String, Set<String>> groupPosters = new java.util.HashMap<>();
        boolean needGroupHistory = deferredByLane.values().stream().flatMap(List::stream)
                .anyMatch(p -> !com.autopost.saas.util.FacebookPostIds.targetGroupKeys(p.getTargetGroupNames()).isEmpty());
        if (needGroupHistory) {
            for (PostQueue done : postQueueRepository.findByStatusOrderByIdAsc("PUBLISHED")) {
                if (done.getTargetFanpageId() == null || done.getTargetGroupNames() == null) continue;
                if (done.getTargetGroupNames().startsWith("GROUP_ONLY_ANON:")) continue;
                for (String g : com.autopost.saas.util.FacebookPostIds.targetGroupKeys(done.getTargetGroupNames())) {
                    groupPosters.computeIfAbsent(g, k -> new java.util.LinkedHashSet<>()).add(done.getTargetFanpageId());
                }
            }
        }

        Map<String, Long> plannedExtra = new java.util.HashMap<>();
        int totalDeferred = 0;
        for (Map.Entry<String, List<PostQueue>> entry : deferredByLane.entrySet()) {
            String lane = entry.getKey();
            List<PostQueue> posts = entry.getValue();
            totalDeferred += posts.size();
            PostQueue first = posts.get(0);
            Map<String, Object> laneInfo = new LinkedHashMap<>();
            laneInfo.put("laneName", targetDisplayName(first.getTargetFanpageId()));
            laneInfo.put("deferredCount", posts.size());
            laneInfo.put("firstDeferredAt", first.getScheduledAt() != null ? first.getScheduledAt().toString() : null);

            Map<String, Map<String, Object>> suggestionsByTarget = new LinkedHashMap<>();
            long unassignedSeconds = 0;
            int unassigned = 0;
            for (PostQueue post : posts) {
                long need = estimatePublishSeconds(post) + window.minGapSeconds();
                String chosen = null;
                for (String candidate : candidateTargetsFor(post, groupPosters)) {
                    String candLane = laneOfTarget(candidate);
                    if (candLane == null || candLane.equals(lane)) continue;
                    long used = busySecondsToday.getOrDefault(candLane, 0L) + plannedExtra.getOrDefault(candLane, 0L);
                    if (used + need <= freeWindowToday) {
                        chosen = candidate;
                        plannedExtra.merge(candLane, need, Long::sum);
                        break;
                    }
                }
                if (chosen == null) {
                    unassigned++;
                    unassignedSeconds += need;
                    continue;
                }
                Map<String, Object> sug = suggestionsByTarget.computeIfAbsent(chosen, t -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("toTargetFanpageId", t);
                    m.put("toName", targetDisplayName(t));
                    m.put("postIds", new ArrayList<Long>());
                    return m;
                });
                @SuppressWarnings("unchecked")
                List<Long> ids = (List<Long>) sug.get("postIds");
                ids.add(post.getId());
            }
            laneInfo.put("suggestions", new ArrayList<>(suggestionsByTarget.values()));
            laneInfo.put("unassignedCount", unassigned);
            laneInfo.put("unassignedPostIds", posts.stream().map(PostQueue::getId)
                    .filter(id -> suggestionsByTarget.values().stream().noneMatch(sug -> ((List<?>) sug.get("postIds")).contains(id)))
                    .toList());
            // Số via cần thêm để đăng hết phần còn lại trong khung giờ hôm nay
            laneInfo.put("extraViasNeeded", unassigned == 0 || freeWindowToday == 0 ? (unassigned == 0 ? 0 : 1)
                    : (int) Math.ceil((double) unassignedSeconds / freeWindowToday));
            lanes.add(laneInfo);
        }
        report.put("totalDeferred", totalDeferred);
        return report;
    }

    /**
     * Người dùng duyệt đề xuất: chuyển các bài dư sang nick/danh tính đăng khác rồi xếp lại vào khung giờ
     * (nối đuôi làn của nick mới). Chỉ đụng bài còn PENDING và đang bị đánh dấu dư.
     */
    @Transactional
    public Map<String, Object> applyWindowSuggestion(Collection<Long> postIds, String toTargetFanpageId) {
        if (toTargetFanpageId == null || toTargetFanpageId.isBlank()) {
            throw new IllegalArgumentException("Thiếu nick đích");
        }
        if (resolveTargetAccount(toTargetFanpageId).isEmpty()) {
            throw new IllegalArgumentException("Không tìm thấy nick đích: " + toTargetFanpageId);
        }
        List<PostQueue> moved = new ArrayList<>();
        for (PostQueue p : postQueueRepository.findAllById(postIds)) {
            if (!"PENDING".equals(p.getStatus()) || !Boolean.TRUE.equals(p.getWindowDeferred())) continue;
            log.info("🔀 [Khung giờ đăng] Người dùng duyệt chuyển Post ID {} từ '{}' sang '{}'",
                    p.getId(), p.getTargetFanpageId(), toTargetFanpageId);
            p.setTargetFanpageId(toTargetFanpageId);
            p.setWindowDeferred(null);
            moved.add(p);
        }
        postQueueRepository.saveAll(moved);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("moved", moved.size());
        if (!moved.isEmpty()) {
            // Chỉ xếp lại đúng các bài vừa chuyển nick vào làn mới, không xáo trộn toàn bộ hàng đợi
            Map<String, Object> packed = packContinuous(moved.stream().map(PostQueue::getId).toList(),
                    (int) Math.max(postingWindowService.get().minGapSeconds(), postingWindowService.defaultGapSeconds()));
            result.putAll(packed);
        }
        return result;
    }

    /**
     * Ước tính giờ đăng xong toàn bộ hàng chờ, theo từng nick: mỗi nick đăng tuần tự theo giờ hẹn (bài
     * trễ hạn đăng nối nhau ngay), chỉ trong khung giờ đăng nếu đang bật. Không sửa bài.
     */
    static Map<String, Object> queueFinishSummary(List<PostQueue> pending, List<PostQueue> processing,
                                                  Function<PostQueue, String> laneKey, Function<String, String> laneName,
                                                  LocalDateTime now, PostingWindow window) {
        Map<String, List<PostQueue>> byLane = new LinkedHashMap<>();
        for (PostQueue p : pending) byLane.computeIfAbsent(laneKey.apply(p), k -> new ArrayList<>()).add(p);
        Map<String, LocalDateTime> busyUntil = new java.util.HashMap<>();
        for (PostQueue p : processing) {
            busyUntil.merge(laneKey.apply(p), now.plusSeconds(estimatePublishSeconds(p)), (a, b) -> a.isAfter(b) ? a : b);
        }

        List<Map<String, Object>> lanes = new ArrayList<>();
        LocalDateTime finishAll = null;
        int finishToday = 0;
        for (Map.Entry<String, List<PostQueue>> e : byLane.entrySet()) {
            List<PostQueue> posts = e.getValue();
            posts.sort(Comparator.comparing((PostQueue p) -> p.getScheduledAt() != null ? p.getScheduledAt() : now)
                    .thenComparing(PostQueue::getId));
            LocalDateTime cursor = busyUntil.getOrDefault(e.getKey(), now);
            LocalDateTime firstStart = null;
            int laneToday = 0;
            int deferred = 0;
            for (PostQueue p : posts) {
                LocalDateTime start = p.getScheduledAt() != null && p.getScheduledAt().isAfter(cursor) ? p.getScheduledAt() : cursor;
                start = window.openAtOrAfter(start);
                if (window.enabled() && start.plusSeconds(estimatePublishSeconds(p)).isAfter(window.closeOf(start))) {
                    start = window.openAtOrAfter(window.closeOf(start));
                }
                if (firstStart == null) firstStart = start;
                cursor = start.plusSeconds(estimatePublishSeconds(p));
                if (!cursor.toLocalDate().isAfter(now.toLocalDate())) laneToday++;
                if (Boolean.TRUE.equals(p.getWindowDeferred())) deferred++;
            }
            Map<String, Object> lane = new LinkedHashMap<>();
            lane.put("name", laneName.apply(e.getKey()));
            lane.put("pending", posts.size());
            lane.put("nextAt", firstStart != null ? firstStart.toString() : null);
            lane.put("finishAt", cursor.toString());
            lane.put("finishTodayCount", laneToday);
            lane.put("deferredCount", deferred);
            lanes.add(lane);
            finishToday += laneToday;
            if (finishAll == null || cursor.isAfter(finishAll)) finishAll = cursor;
        }
        lanes.sort((a, b) -> b.get("finishAt").toString().compareTo(a.get("finishAt").toString()));

        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("totalPending", pending.size());
        summary.put("processing", processing.size());
        summary.put("finishAllAt", finishAll != null ? finishAll.toString() : null);
        summary.put("finishTodayCount", finishToday);
        summary.put("laterCount", pending.size() - finishToday);
        summary.put("lanes", lanes);
        return summary;
    }

    /** Các danh tính đăng (dạng target_fanpage_id) có quyền đăng đúng chỗ của bài này. */
    private List<String> candidateTargetsFor(PostQueue post, Map<String, Set<String>> groupPosters) {
        List<String> out = new ArrayList<>();
        String groups = post.getTargetGroupNames();
        if (groups != null && groups.startsWith("GROUP_ONLY_ANON:")) return out; // bài ẩn danh gắn với nick gốc
        Set<String> groupKeys = com.autopost.saas.util.FacebookPostIds.targetGroupKeys(groups);
        if (!groupKeys.isEmpty()) {
            // Nick phải từng đăng được vào TẤT CẢ các nhóm của bài
            Set<String> common = null;
            for (String g : groupKeys) {
                Set<String> posters = groupPosters.getOrDefault(g, Set.of());
                if (common == null) common = new java.util.LinkedHashSet<>(posters);
                else common.retainAll(posters);
            }
            if (common != null) out.addAll(common);
            out.remove(post.getTargetFanpageId());
            return out;
        }
        String target = post.getTargetFanpageId();
        if (target == null || target.isBlank()) return out;
        String[] parts = target.split(":", -1);
        String pageId = parts[0].trim();
        Long userId = post.getCampaign() != null && post.getCampaign().getUser() != null ? post.getCampaign().getUser().getId() : null;
        for (SocialAccount acc : postQueueService.findCandidatePostingAccountsForPage(userId, pageId, null)) {
            if (!"PERSONAL_COOKIE".equalsIgnoreCase(acc.getAccountType())) continue;
            String t = pageId + ":PERSONAL_COOKIE:" + acc.getId();
            if (!t.equalsIgnoreCase(target)) out.add(t);
        }
        return out;
    }

    private String laneOfTarget(String target) {
        return resolveTargetAccount(target).map(CampaignScheduler::publishingIdentityKey).orElse(null);
    }

    private String targetDisplayName(String target) {
        if (target == null) return "Không rõ nick";
        return resolveTargetAccount(target).map(a -> a.getPageName() != null ? a.getPageName() : target).orElse(target);
    }

    /**
     * Phần tính giờ thuần (không đụng DB) của packContinuous: đặt scheduledAt cho các bài "moving" và
     * thêm chúng vào updatedOut. movingIds == null nghĩa là mọi bài pending đều được xếp lại.
     * @return giờ dự kiến bài cuối cùng chạy xong.
     */
    static LocalDateTime planContinuousLanes(List<PostQueue> pending, List<PostQueue> processing,
                                             Set<Long> movingIds, Function<PostQueue, String> laneKey,
                                             LocalDateTime now, long gap, List<PostQueue> updatedOut) {
        return planContinuousLanes(pending, processing, movingIds, laneKey, now, gap,
                PostingWindow.DISABLED, false, updatedOut, new LinkedHashMap<>());
    }

    /**
     * Bản có khung giờ đăng: bài chỉ được xếp trong [giờ mở, giờ đóng) và phải đăng xong trước giờ đóng.
     * Nick nào không kịp đăng hết trong ngày thì giãn cách được rút dần xuống window.minGapSeconds();
     * vẫn dư thì phần dư dời sang giờ mở khung hôm sau và được ghi vào deferredOut (theo làn) để đề xuất
     * chuyển sang nick khác.
     *
     * @param keepOriginalTime true = không xếp bài sớm hơn giờ người dùng đã hẹn (chỉ đẩy bài ngoài khung vào khung)
     */
    static LocalDateTime planContinuousLanes(List<PostQueue> pending, List<PostQueue> processing,
                                             Set<Long> movingIds, Function<PostQueue, String> laneKey,
                                             LocalDateTime now, long gap, PostingWindow window, boolean keepOriginalTime,
                                             List<PostQueue> updatedOut, Map<String, List<PostQueue>> deferredOut) {
        return planContinuousLanes(pending, processing, movingIds, laneKey, now, gap, window, keepOriginalTime,
                false, updatedOut, deferredOut);
    }

    /**
     * @param spreadEvenly true = giãn cách mỗi làn được nới ra để các bài trải đều tới giờ đóng khung của
     *                     ngày đầu tiên (chỉ áp dụng cho làn không có bài cố định), thay vì nối đuôi sát nhau.
     */
    static LocalDateTime planContinuousLanes(List<PostQueue> pending, List<PostQueue> processing,
                                             Set<Long> movingIds, Function<PostQueue, String> laneKey,
                                             LocalDateTime now, long gap, PostingWindow window, boolean keepOriginalTime,
                                             boolean spreadEvenly,
                                             List<PostQueue> updatedOut, Map<String, List<PostQueue>> deferredOut) {
        Map<String, List<PostQueue>> movingByLane = new LinkedHashMap<>();
        Map<String, List<PostQueue>> fixedByLane = new LinkedHashMap<>();
        for (PostQueue post : pending) {
            boolean moving = movingIds == null || movingIds.contains(post.getId());
            (moving ? movingByLane : fixedByLane).computeIfAbsent(laneKey.apply(post), k -> new ArrayList<>()).add(post);
        }

        // Nick đang đăng dở 1 bài thì làn của nó chỉ rảnh sau khi bài đó xong + nghỉ.
        Map<String, LocalDateTime> laneBusyUntil = new LinkedHashMap<>();
        for (PostQueue post : processing) {
            laneBusyUntil.merge(laneKey.apply(post), now.plusSeconds(estimatePublishSeconds(post) + gap),
                    (a, b) -> a.isAfter(b) ? a : b);
        }

        LocalDateTime lastFinish = now;
        int laneIndex = 0;
        for (Map.Entry<String, List<PostQueue>> entry : movingByLane.entrySet()) {
            List<PostQueue> moving = entry.getValue();
            moving.sort(Comparator.comparing((PostQueue p) -> p.getScheduledAt() != null ? p.getScheduledAt() : now)
                    .thenComparing(PostQueue::getId));

            // Các bài giữ nguyên giờ trong làn chiếm [bắt đầu, xong + nghỉ] — bài mới không được chen vào.
            List<LocalDateTime[]> busy = new ArrayList<>();
            for (PostQueue fixed : fixedByLane.getOrDefault(entry.getKey(), List.of())) {
                if (fixed.getScheduledAt() == null) continue;
                LocalDateTime start = fixed.getScheduledAt().isBefore(now) ? now : fixed.getScheduledAt();
                busy.add(new LocalDateTime[]{start, start.plusSeconds(estimatePublishSeconds(fixed) + gap)});
            }

            // Lệch nhẹ 30 giây giữa các làn/nick để các trình duyệt Chromium không khởi động cùng tích tắc
            long laneStaggerSeconds = (laneIndex++) * 30L;
            LocalDateTime defaultLaneStart = now.plusSeconds(20 + laneStaggerSeconds);
            LocalDateTime laneStart = window.openAtOrAfter(laneBusyUntil.getOrDefault(entry.getKey(), defaultLaneStart));

            long chosenGap = gap;
            if (spreadEvenly && window.enabled() && busy.isEmpty() && !moving.isEmpty()) {
                long available = java.time.Duration.between(laneStart, window.closeOf(laneStart)).getSeconds();
                long work = moving.stream().mapToLong(CampaignScheduler::estimatePublishSeconds).sum();
                long evenGap = (available - work) / moving.size();
                if (evenGap > chosenGap) chosenGap = evenGap;
            }
            List<LocalDateTime> slots = simulateLane(moving, busy, laneStart, chosenGap, window, keepOriginalTime);
            int spill = countSpilled(moving, slots, laneStart, keepOriginalTime, window);
            long minGap = Math.min(gap, window.minGapSeconds());
            if (window.enabled() && spill > 0 && minGap < gap) {
                // Rút giãn cách: tìm giãn cách LỚN NHẤT vẫn cho số bài dư ít nhất có thể (như khi dùng mức tối thiểu)
                int bestSpill = countSpilled(moving, simulateLane(moving, busy, laneStart, minGap, window, keepOriginalTime), laneStart, keepOriginalTime, window);
                long lo = minGap;
                long hi = gap;
                while (hi - lo > 5) {
                    long mid = (lo + hi) / 2;
                    int midSpill = countSpilled(moving, simulateLane(moving, busy, laneStart, mid, window, keepOriginalTime), laneStart, keepOriginalTime, window);
                    if (midSpill <= bestSpill) lo = mid; else hi = mid;
                }
                chosenGap = lo;
                slots = simulateLane(moving, busy, laneStart, chosenGap, window, keepOriginalTime);
            }

            LocalDateTime cursorEnd = laneStart;
            for (int i = 0; i < moving.size(); i++) {
                PostQueue post = moving.get(i);
                LocalDateTime slot = slots.get(i);
                boolean deferred = window.enabled() && isSpilled(post, slot, laneStart, keepOriginalTime, window);
                post.setScheduledAt(slot);
                post.setWindowDeferred(deferred ? Boolean.TRUE : null);
                updatedOut.add(post);
                if (deferred) deferredOut.computeIfAbsent(entry.getKey(), k -> new ArrayList<>()).add(post);
                LocalDateTime end = slot.plusSeconds(estimatePublishSeconds(post) + chosenGap);
                if (end.isAfter(cursorEnd)) cursorEnd = end;
            }
            if (cursorEnd.isAfter(lastFinish)) lastFinish = cursorEnd;
        }
        return lastFinish;
    }

    /** Tính giờ đăng cho các bài của 1 làn (không sửa bài): nối đuôi, né bài cố định, nằm gọn trong khung giờ. */
    private static List<LocalDateTime> simulateLane(List<PostQueue> moving, List<LocalDateTime[]> busy, LocalDateTime laneStart,
                                                    long gap, PostingWindow window, boolean keepOriginalTime) {
        List<LocalDateTime> slots = new ArrayList<>();
        LocalDateTime cursor = laneStart;
        for (PostQueue post : moving) {
            long duration = estimatePublishSeconds(post);
            long need = duration + gap;
            if (keepOriginalTime && post.getScheduledAt() != null && post.getScheduledAt().isAfter(cursor)) {
                cursor = post.getScheduledAt();
            }
            cursor = window.openAtOrAfter(cursor);
            boolean shifted = true;
            while (shifted) {
                shifted = false;
                for (LocalDateTime[] b : busy) {
                    if (cursor.isBefore(b[1]) && cursor.plusSeconds(need).isAfter(b[0])) {
                        cursor = window.openAtOrAfter(b[1]);
                        shifted = true;
                    }
                }
                // Phải đăng XONG trước giờ đóng khung, không thì sang giờ mở khung hôm sau
                if (window.enabled() && cursor.plusSeconds(duration).isAfter(window.closeOf(cursor))) {
                    cursor = window.openAtOrAfter(window.closeOf(cursor));
                    shifted = true;
                }
            }
            slots.add(cursor);
            cursor = cursor.plusSeconds(need);
        }
        return slots;
    }

    /** Bài bị dư = bị đẩy sang ngày sau ngày đầu tiên của làn (và sau ngày người dùng tự hẹn, nếu giữ giờ gốc). */
    private static boolean isSpilled(PostQueue post, LocalDateTime slot, LocalDateTime laneStart, boolean keepOriginalTime,
                                     PostingWindow window) {
        java.time.LocalDate firstDay = laneStart.toLocalDate();
        if (keepOriginalTime && post.getScheduledAt() != null) {
            // Ngày "đúng hẹn" của bài là ngày khung giờ mở gần nhất tính từ giờ đã hẹn (hẹn 23:30 → sáng hôm sau)
            java.time.LocalDate dueDay = window.openAtOrAfter(post.getScheduledAt()).toLocalDate();
            if (dueDay.isAfter(firstDay)) firstDay = dueDay;
        }
        return slot.toLocalDate().isAfter(firstDay);
    }

    private static int countSpilled(List<PostQueue> moving, List<LocalDateTime> slots, LocalDateTime laneStart, boolean keepOriginalTime,
                                    PostingWindow window) {
        int n = 0;
        for (int i = 0; i < moving.size(); i++) {
            if (isSpilled(moving.get(i), slots.get(i), laneStart, keepOriginalTime, window)) n++;
        }
        return n;
    }
}
