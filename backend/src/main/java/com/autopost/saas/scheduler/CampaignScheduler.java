package com.autopost.saas.scheduler;

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
    // Mỗi nick (c_user) đăng TUẦN TỰ; các nick KHÁC nhau được đăng song song, tối đa 4 nick cùng lúc
    // được chia đều qua 2 Playwright Worker (Port 3001 và Port 3002).
    private static final int MAX_PARALLEL_ACCOUNTS = 4;
    // Giãn cách tối thiểu giữa 2 lần đăng liên tiếp trên CÙNG 1 account (nghỉ nhẹ giải phóng Chromium)
    private static final long MIN_MS_BETWEEN_POSTS_SAME_ACCOUNT = 15_000;
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
        return socialAccountRepository.findAll().stream()
                .filter(account -> platformId.equals(account.getPlatformAccountId()))
                .filter(account -> accountType.isBlank() || accountType.equalsIgnoreCase(account.getAccountType()))
                .findFirst();
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

    // 2. Tiến trình tự động đăng bài theo lịch đặt trước mỗi 10 giây (siêu nhạy, đúng giờ là chạy ngay).
    @Scheduled(fixedRate = 10000)
    @Transactional(readOnly = true)
    public void executePublishing() {
        LocalDateTime now = LocalDateTime.now();
        // Ngoài khung giờ đăng chung: không tự đăng bài theo lịch (bấm "Đăng ngay" vẫn đăng qua publishPostNow)
        if (!postingWindowService.get().contains(now)) {
            return;
        }

        // Tự động dọn dẹp khóa nếu bị kẹt quá 5 phút
        long nowMs = System.currentTimeMillis();
        accountsCurrentlyPublishing.entrySet().removeIf(entry -> {
            boolean stale = (nowMs - entry.getValue() > 300_000);
            if (stale) {
                log.warn("⚠️ Khóa đăng của account '{}' bị kẹt quá 5 phút — tự động giải phóng để thông hàng đợi.", entry.getKey());
            }
            return stale;
        });
        targetsCurrentlyPublishing.entrySet().removeIf(entry -> {
            boolean stale = (nowMs - entry.getValue() > 300_000);
            if (stale) {
                log.warn("⚠️ Khóa đăng của target '{}' bị kẹt quá 5 phút — tự động giải phóng để thông hàng đợi.", entry.getKey());
            }
            return stale;
        });

        List<PostQueue> pendingPosts = postQueueRepository
                .findByStatusAndScheduledAtBeforeOrderByScheduledAtAscIdAsc("PENDING", now);

        if (pendingPosts.isEmpty()) {
            return;
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
            // 1. Nếu là CÙNG 1 Target (Fanpage/Group) thì giãn cách 20 giây để trang nghỉ nhẹ.
            // 2. Nếu là Target KHÁC NHAU (Group khác / Page khác) của cùng via: chỉ cần 5 giây sau khi bài trước đóng trình duyệt.
            // 3. Nếu bài đã trễ hạn quá 1 phút: ưu tiên đăng bù ngay lập tức, không chờ giãn cách.
            boolean isOverdue = firstPost.getScheduledAt() != null && firstPost.getScheduledAt().isBefore(now.minusMinutes(1));
            Long lastTargetFinished = lastPublishFinishedAtByTarget.get(targetId);
            Long lastAccountFinished = lastPublishFinishedAt.get(accountKey);

            if (!isOverdue) {
                if (lastTargetFinished != null && (nowMs - lastTargetFinished < 20_000)) {
                    // Cùng Group/Fanpage vừa đăng xong — nghỉ nhẹ 20s
                    continue;
                }
                if (lastAccountFinished != null && (nowMs - lastAccountFinished < 5_000)) {
                    // Trình duyệt vừa đóng — nghỉ 5s để giải phóng tài nguyên
                    continue;
                }
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

            log.info("🚀 [Scheduler] Đang tự động xử lý Post ID {} (Tên: '{}') cho account '{}' vào target '{}'...",
                    firstPost.getId(), firstPost.getTitle(), accountKey, targetId);

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
                        accountsCurrentlyPublishing.remove(accountKey);
                        targetsCurrentlyPublishing.remove(targetId);
                    }
                });
            } catch (Exception submitErr) {
                log.error("Không thể submit tác vụ đăng Post ID {}: {}", firstPost.getId(), submitErr.getMessage());
                accountsCurrentlyPublishing.remove(accountKey);
                targetsCurrentlyPublishing.remove(targetId);
            }
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

            List<SocialAccount> candidates = postQueueService.findCandidatePostingAccountsForPage(userId, pagePlatformId, connId);
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
            // c) Đã qua thời gian nghỉ giãn cách 2 phút
            SocialAccount bestVia = null;
            for (SocialAccount candidate : candidates) {
                String key = publishingIdentityKey(candidate);
                boolean isPublishing = accountsCurrentlyPublishing.containsKey(key);
                Long lastFinished = lastPublishFinishedAt.get(key);
                boolean inCooldown = (lastFinished != null && (System.currentTimeMillis() - lastFinished < MIN_MS_BETWEEN_POSTS_SAME_ACCOUNT));
                boolean alreadyAssigned = assignedKeysInThisTick.contains(key);

                if (!isPublishing && !inCooldown && !alreadyAssigned) {
                    bestVia = candidate;
                    break;
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
                        postQueueRepository.save(post);
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
        // auto-retry luôn an toàn (không rủi ro đăng trùng) — retry các lỗi này BẤT KỂ cờ
        // autoRetryFailedPosts, vì cờ đó chỉ nhằm chặn retry cho lỗi mơ hồ (có thể đã bấm Đăng rồi
        // mất phản hồi), không áp dụng cho 2 lỗi dưới đây.
        List<PostQueue> safeToRetryPosts = postQueueRepository.findByStatusAndUpdatedAtBefore("FAILED", LocalDateTime.now().minusMinutes(10))
                .stream()
                .filter(p -> isSafePreSubmitFailure(p.getErrorMessage()))
                .toList();
        for (PostQueue post : safeToRetryPosts) {
            try {
                if (postQueueRepository.markRetryIfEligible(post.getId(), MAX_RETRY) == 1) {
                    log.info("🔁 Tự động thử lại Post ID: {} (lỗi trước-khi-bấm-Đăng, an toàn để retry)", post.getId());
                    postQueueService.publishPostNow(post.getId());
                }
            } catch (Exception e) {
                log.error("Lỗi khi tự động thử lại Post ID {}: {}", post.getId(), e.getMessage());
            }
        }

        if (!autoRetryFailedPosts) {
            return;
        }
        List<PostQueue> failedPosts = postQueueRepository.findByStatusAndUpdatedAtBefore("FAILED", LocalDateTime.now().minusMinutes(10));
        if (failedPosts.isEmpty()) {
            return;
        }
        log.info("🔁 [Scheduler] Phát hiện {} bài lỗi, kiểm tra để tự động thử lại (tối đa {} lần)...", failedPosts.size(), MAX_RETRY);
        for (PostQueue post : failedPosts) {
            // Lỗi vĩnh viễn (token/cookie hết hạn, thiếu quyền...) sẽ không tự khỏi chỉ vì đợi 10 phút
            // rồi thử lại — retry chỉ tổ tốn thêm 1 lượt (giới hạn MAX_RETRY) và có nguy cơ đăng trùng
            // nếu lần trước Playwright đã bấm Đăng nhưng mất phản hồi. Chỉ retry lỗi có tính tạm thời.
            if (isPermanentFailure(post.getErrorMessage())) {
                log.info("⏭️ Post ID {} lỗi vĩnh viễn ({}), bỏ qua auto-retry — cần người dùng xử lý thủ công.", post.getId(), post.getErrorMessage());
                continue;
            }
            try {
                if (postQueueRepository.markRetryIfEligible(post.getId(), MAX_RETRY) == 1) {
                    log.info("🔁 Tự động thử lại Post ID: {} (lần thử tiếp theo)", post.getId());
                    postQueueService.publishPostNow(post.getId());
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
                post.setStatus("FAILED");
                post.setErrorMessage(appendRecoveryWarning(post.getErrorMessage(),
                        "Tiến trình đăng mất phản hồi quá " + PROCESSING_STALE_AFTER_MINUTES + " phút và chưa tìm thấy ID/link xác nhận. Hãy kiểm tra Facebook trước khi bấm Đăng lại để tránh đăng trùng. [NO_AUTO_RETRY]"));
                postQueueRepository.save(post);
                log.warn("⚠️ [Recovery] Post ID {} bị kẹt PROCESSING và chưa có bằng chứng — chuyển FAILED, không tự retry.", post.getId());
            }
        }
    }

    /**
     * Hỏi worker kết quả các lượt đăng của bài (worker ghi theo header X-Post-Queue-Id).
     * Trả về IN_PROGRESS (worker còn đang đăng/xếp hàng), SUCCESS (mọi lượt đã xong và có lượt thành công, không lượt
     * nào lỗi), hoặc null (không biết — giữ cách xử lý cũ). Lấy link bài nếu worker có.
     */
    private String askWorkerPostResult(PostQueue post) {
        try {
            Map<?, ?> resp = workerStatusClient.getForObject("http://localhost:3001/api/post-results/" + post.getId(), Map.class);
            if (resp == null || !(resp.get("legs") instanceof List<?> legs) || legs.isEmpty()) return null;
            boolean anySuccess = false;
            for (Object o : legs) {
                if (!(o instanceof Map<?, ?> leg)) continue;
                String status = String.valueOf(leg.get("status"));
                if ("IN_PROGRESS".equals(status)) return "IN_PROGRESS";
                if (!"SUCCESS".equals(status)) return null;
                anySuccess = true;
                if (leg.get("postUrl") instanceof String url && !url.isBlank() && (post.getPublishedPostUrl() == null || post.getPublishedPostUrl().isBlank())) {
                    post.setPublishedPostUrl(url);
                }
            }
            return anySuccess ? "SUCCESS" : null;
        } catch (Exception e) {
            return null;
        }
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
        List<PostQueue> pending = postQueueRepository.findByStatusOrderByIdAsc("PENDING");
        List<PostQueue> processing = postQueueRepository.findByStatusOrderByIdAsc("PROCESSING");
        List<PostQueue> updated = new ArrayList<>();
        Map<String, List<PostQueue>> deferred = new LinkedHashMap<>();
        Set<Long> movingIds = postIds == null ? null : new HashSet<>(postIds);
        PostingWindow window = postingWindowService.get();
        LocalDateTime lastFinish = planContinuousLanes(pending, processing, movingIds, this::accountGroupKey,
                LocalDateTime.now(), Math.max(0, gapSeconds), window, false, updated, deferred);

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

    // Mỗi 5 phút: bài bị hẹn/sửa giờ ra ngoài khung giờ đăng (VD sửa tay giờ, dữ liệu cũ) được đưa lại vào
    // trong khung — tránh dồn cục cả loạt bài trễ hạn đăng liền một lúc khi khung giờ vừa mở.
    @Scheduled(fixedRate = 300000, initialDelay = 60000)
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

        long gapSeconds = window.minGapSeconds() > 0 ? window.minGapSeconds() : 120;

        if (scope == null) {
            // Khi cấu hình lại khung giờ hoặc gọi quét tổng: đưa toàn bộ bài PENDING vào để xếp lại chuẩn theo khung giờ & giãn cách
            for (PostQueue p : pending) {
                movingIds.add(p.getId());
            }
        } else {
            for (PostQueue p : pending) {
                if (!scope.contains(p.getId())) continue;
                LocalDateTime at = p.getScheduledAt();
                boolean outside = at == null || !window.contains(at)
                        || at.plusSeconds(estimatePublishSeconds(p)).isAfter(window.closeOf(at))
                        || Boolean.TRUE.equals(p.getWindowDeferred());
                if (outside) movingIds.add(p.getId());
            }
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
            Map<String, Object> packed = packContinuous(moved.stream().map(PostQueue::getId).toList(),
                    (int) Math.max(postingWindowService.get().minGapSeconds(), 120));
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

            LocalDateTime laneStart = window.openAtOrAfter(laneBusyUntil.getOrDefault(entry.getKey(), now.plusSeconds(20)));

            long chosenGap = gap;
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
