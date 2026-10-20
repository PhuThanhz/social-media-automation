package com.autopost.saas.service;

import com.autopost.saas.entity.PostQueue;
import com.autopost.saas.entity.PostQueueGroupResult;
import com.autopost.saas.entity.SocialAccount;
import com.autopost.saas.exception.GraphApiException;
import com.autopost.saas.repository.PostQueueGroupResultRepository;
import com.autopost.saas.repository.PostQueueRepository;
import com.autopost.saas.repository.SocialAccountRepository;
import com.autopost.saas.entity.FacebookPageAccess;
import com.autopost.saas.repository.FacebookPageAccessRepository;
import com.autopost.saas.util.PooledRestTemplateFactory;
import com.autopost.saas.util.WorkerRetryHelper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestTemplate;

import java.net.SocketTimeoutException;
import java.time.LocalDateTime;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
@Slf4j
public class PostQueueService {

    // Fanpage mặc định khi bài không chỉ định rõ đích đăng (VD: đẩy qua Extension — chưa có UI chọn
    // Fanpage). Theo yêu cầu người dùng 2026-08-27: mặc định luôn dùng cookie "Làm Sen".
    private static final String DEFAULT_QUICK_POST_PLATFORM_ACCOUNT_ID = "61584834510803";
    private static final String DEFAULT_QUICK_POST_ACCOUNT_TYPE = "PERSONAL_COOKIE";

    private final PostQueueRepository postQueueRepository;
    private final SocialAccountRepository socialAccountRepository;
    private final PostQueueGroupResultRepository postQueueGroupResultRepository;
    private final FacebookGraphApiService facebookGraphApiService;
    private final GeminiService geminiService;
    private final FacebookPageAccessRepository facebookPageAccessRepository;
    private final WorkerRouterService workerRouterService;
    // 10s connect, 600s (10 phút) read — đăng bài thật qua Playwright (mở Modal tối đa 4 lần thử x tới
    // 45s/lần, rồi chờ xác nhận đã xuất bản tới 2 phút, có bài còn tự động comment link sau đó tới 2
    // phút nữa) cộng dồn dễ vượt quá các mốc ngắn hơn, gây lỗi "Read timed out" dù worker vẫn đang xử
    // lý bình thường. Nới thêm biên an toàn theo yêu cầu người dùng 2026-08-27.
    private final RestTemplate restTemplate = PooledRestTemplateFactory.create(10000, 600000);

    // Bài đang thật sự được 1 luồng backend xử lý (đang chờ worker trả lời). Bộ giám sát bài treo
    // (CampaignScheduler.recoverStaleProcessingPosts) bỏ qua các bài này — trước đây bài chỉ đang XẾP HÀNG
    // chờ worker rảnh (worker đăng tuần tự) cũng bị đánh "mất phản hồi" rồi FAILED dù sau đó vẫn đăng thành công.
    private final Map<Long, Integer> inFlightPosts = new ConcurrentHashMap<>();
    // Mã bài của luồng hiện tại — gắn vào header X-Post-Queue-Id khi gọi worker để worker ghi kết quả theo bài.
    private static final ThreadLocal<Long> CURRENT_POST_ID = new ThreadLocal<>();
    // Số giờ cho nick nghỉ khi Facebook báo "Rate limit exceeded".
    private static final int RATE_LIMIT_COOLDOWN_HOURS = 3;
    private final Set<Long> retryingFailedGroupPosts = ConcurrentHashMap.newKeySet();
    private final Map<Long, GroupRetryProgress> groupRetryProgress = new ConcurrentHashMap<>();

    public record GroupRetryProgress(
            int total,
            int completed,
            int succeeded,
            int failed,
            String currentGroupId,
            String currentGroupName,
            String status
    ) {}

    public record GroupRetrySummary(
            boolean success,
            int total,
            int succeeded,
            int failed,
            List<Map<String, Object>> groups
    ) {}

    public List<PostQueue> getQueueByCampaign(Long campaignId) {
        return postQueueRepository.findByCampaignId(campaignId);
    }

    public List<PostQueue> getRecentQueueByCampaign(Long campaignId, int days) {
        LocalDateTime since = LocalDateTime.now().minusDays(days).toLocalDate().atStartOfDay();
        return postQueueRepository.findActiveAndRecentByCampaignId(campaignId, since);
    }

    public Map<String, Object> getQueueCountsForUser(Long userId) {
        List<Object[]> rows = postQueueRepository.countByStatusForUser(userId);
        long pending = 0;
        long processing = 0;
        long published = 0;
        long failed = 0;
        long all = 0;
        for (Object[] r : rows) {
            String status = (String) r[0];
            long count = ((Number) r[1]).longValue();
            all += count;
            if ("PENDING".equalsIgnoreCase(status)) {
                pending += count;
            } else if ("PROCESSING".equalsIgnoreCase(status)) {
                processing += count;
            } else if ("PUBLISHED".equalsIgnoreCase(status)) {
                published += count;
            } else if ("FAILED".equalsIgnoreCase(status) || "CANCELLED".equalsIgnoreCase(status)) {
                failed += count;
            }
        }
        Map<String, Object> res = new HashMap<>();
        res.put("all", all);
        res.put("pending", pending);
        res.put("processing", processing);
        res.put("published", published);
        res.put("failed", failed);
        return res;
    }

    public PostQueue savePost(PostQueue post) {
        return postQueueRepository.save(post);
    }

    @Transactional
    public void deletePost(Long id) {
        postQueueGroupResultRepository.deleteByPostQueue_Id(id);
        postQueueRepository.deleteById(id);
    }

    /** Danh sách bài trong khoảng [from, to) để vẽ Lịch đăng bài. */
    public List<PostQueue> getQueueByScheduleRange(LocalDateTime from, LocalDateTime to) {
        return postQueueRepository.findByScheduledAtBetween(from, to);
    }

    /**
     * Đổi giờ đăng của 1 bài (dùng cho kéo-thả trên Lịch đăng bài). Chỉ cho phép khi bài còn PENDING
     * — bài đã PROCESSING/PUBLISHED/CANCELLED thì đổi scheduledAt không có ý nghĩa gì (đã đăng rồi
     * hoặc đang đăng dở), nên chặn lại thay vì âm thầm không có tác dụng.
     */
    @Transactional
    public PostQueue reschedulePost(Long id, LocalDateTime newScheduledAt) {
        PostQueue post = postQueueRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Không tìm thấy bài viết với ID: " + id));
        if (!"PENDING".equals(post.getStatus())) {
            throw new IllegalStateException("Chỉ có thể đổi giờ bài đang chờ đăng (PENDING), bài này đang ở trạng thái " + post.getStatus());
        }
        post.setScheduledAt(newScheduledAt);
        return postQueueRepository.save(post);
    }

    /** Expose FacebookGraphApiService để các Controller có thể gọi trực tiếp khi cần. */
    public FacebookGraphApiService getFacebookGraphApiService() {
        return facebookGraphApiService;
    }

    /** Sửa tay caption của 1 bài trong hàng đợi trước khi đăng (chỉ áp dụng khi bài chưa đăng). */
    @Transactional
    public PostQueue updateContent(Long id, String newContent) {
        PostQueue post = postQueueRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Không tìm thấy bài viết với ID: " + id));
        post.setContent(newContent);
        return postQueueRepository.save(post);
    }

    public boolean publishPostNow(Long postId) {
        inFlightPosts.merge(postId, 1, Integer::sum);
        CURRENT_POST_ID.set(postId);
        try {
            return doPublishPostNow(postId);
        } finally {
            CURRENT_POST_ID.remove();
            inFlightPosts.computeIfPresent(postId, (k, v) -> v > 1 ? v - 1 : null);
        }
    }

    public boolean isInFlight(Long postId) {
        return inFlightPosts.containsKey(postId);
    }

    static boolean isRateLimited(String message) {
        if (message == null) return false;
        String m = message.toLowerCase();
        return m.contains("fb_rate_limited") || m.contains("1675004")
                || m.contains("fb_spam_block") || m.contains("giới hạn tần suất")
                || m.contains("để bảo vệ cộng đồng") || m.contains("spam");
    }

    /**
     * Facebook đang giới hạn tốc độ nick này: đăng tiếp chỉ đốt hết từng bài (và kéo dài thời gian bị giới hạn).
     * Đưa bài hiện tại về PENDING sau {@link #RATE_LIMIT_COOLDOWN_HOURS} giờ và dời luôn các bài PENDING khác của
     * cùng nick rơi vào khoảng nghỉ đó (giữ nguyên khoảng cách giữa các bài).
     */
    private void applyRateLimitCooldown(SocialAccount account, PostQueue post) {
        LocalDateTime now = LocalDateTime.now();
        LocalDateTime resumeAt = now.plusHours(RATE_LIMIT_COOLDOWN_HOURS);
        String suffix = ":" + account.getId();
        int moved = 0;
        for (PostQueue other : postQueueRepository.findByStatusAndTargetFanpageIdEndingWith("PENDING", suffix)) {
            if (other.getScheduledAt() == null || other.getScheduledAt().isBefore(resumeAt)) {
                LocalDateTime base = other.getScheduledAt() == null || other.getScheduledAt().isBefore(now) ? now : other.getScheduledAt();
                other.setScheduledAt(base.plusHours(RATE_LIMIT_COOLDOWN_HOURS));
                postQueueRepository.save(other);
                moved++;
            }
        }
        post.setStatus("PENDING");
        post.setScheduledAt(resumeAt);
        post.setErrorMessage("Facebook đang giới hạn tốc độ nick \"" + account.getPageName() + "\" (Rate limit exceeded) — hệ thống tự cho nick nghỉ "
                + RATE_LIMIT_COOLDOWN_HOURS + " giờ, bài sẽ tự đăng lại lúc " + resumeAt.toLocalTime().withSecond(0).withNano(0) + ".");
        postQueueRepository.save(post);
        log.warn("🚦 Nick {} (ID {}) bị Facebook rate limit — dời Post ID {} và {} bài khác thêm {} giờ.",
                account.getPageName(), account.getId(), post.getId(), moved, RATE_LIMIT_COOLDOWN_HOURS);
    }

    private boolean doPublishPostNow(Long postId) {
        // Chiếm quyền xử lý bài này 1 cách nguyên tử (PENDING -> PROCESSING) trước khi làm bất cứ việc gì
        // chậm (gọi Graph API + chờ xác nhận mã hóa video có thể mất 30-60s+). Nếu không "chiếm" được
        // (trả về 0), nghĩa là 1 tiến trình khác (VD: CampaignScheduler chạy song song mỗi 10s) đã hoặc
        // đang đăng bài này rồi -> bỏ qua ngay để tránh đăng trùng lặp thật lên Fanpage.
        if (postQueueRepository.markProcessingIfPending(postId) == 0) {
            log.info("⏭️ Post ID {} đã/đang được xử lý bởi tiến trình khác, bỏ qua để tránh đăng trùng.", postId);
            return false;
        }

        PostQueue post = postQueueRepository.findByIdWithCampaignAndUser(postId).orElse(null);
        if (post == null) return false;

        if (post.getOriginalUrl() != null && !post.getOriginalUrl().isBlank()
                && post.getTargetGroupNames() != null && !post.getTargetGroupNames().isBlank()) {
            if (postQueueRepository.existsActiveOrPublishedDuplicate(post.getOriginalUrl(), post.getTargetGroupNames(), postId)) {
                log.warn("⚠️ Post ID {} có original_url '{}' đã hoặc đang được đăng lên nhóm '{}'. Tự động huỷ bài trùng lặp!",
                        postId, post.getOriginalUrl(), post.getTargetGroupNames());
                post.setStatus("CANCELLED");
                post.setErrorMessage("Đã tự động huỷ vì bài viết này đã hoặc đang được đăng lên nhóm trước đó (chống spam trùng lặp).");
                postQueueRepository.save(post);
                return false;
            }
        }

        post.setStatus("PROCESSING");

        log.info("Thực hiện đăng bài ngay cho Post ID: {}", postId);

        Long userId = (post.getCampaign() != null && post.getCampaign().getUser() != null)
                ? post.getCampaign().getUser().getId()
                : null;
        List<SocialAccount> accounts = (userId != null)
                ? socialAccountRepository.findByUserId(userId)
                : socialAccountRepository.findAll();
        if (accounts.isEmpty()) {
            log.warn("User chưa kết nối Social Account/Fanpage!");
            post.setStatus("FAILED");
            post.setErrorMessage("User chưa kết nối Social Account");
            postQueueRepository.save(post);
            return false;
        }

        String targetId = post.getTargetFanpageId();
        SocialAccount account = null;

        if (targetId != null && !targetId.trim().isEmpty() && !"null".equalsIgnoreCase(targetId.trim())) {
            String[] parts = targetId.split(":", -1);
            String realPlatformId = parts[0].trim();
            String requestedAccountType = parts.length >= 2 ? parts[1].trim() : null;

            Long requestedConnectionId = null;
            if (parts.length >= 3 && !parts[2].trim().isEmpty()) {
                try {
                    requestedConnectionId = Long.valueOf(parts[2].trim());
                    final Long targetConnId = requestedConnectionId;
                    SocialAccount matchedById = accounts.stream()
                            .filter(a -> targetConnId.equals(a.getId()))
                            .findFirst()
                            .orElse(null);
                    if (matchedById != null) {
                        if ("EXPIRED".equalsIgnoreCase(matchedById.getTokenStatus())) {
                            log.warn("⚠️ Post ID {} chọn tài khoản '{}' (ID: {}) nhưng tài khoản này đã HẾT HẠN COOKIE (EXPIRED). Đang tìm Via đồng quản trị thay thế...",
                                    postId, matchedById.getPageName(), matchedById.getId());
                            SocialAccount backup = resolveBackupAccount(matchedById);
                            if (backup != null) {
                                log.info("🚀 [Auto-Failover] Đã tìm thấy tài khoản/Via đồng quản trị '{}' (ID: {}) còn hoạt động tốt cho Fanpage ID {}. Tự động chuyển quyền đăng!",
                                        backup.getPageName(), backup.getId(), realPlatformId);
                                account = backup;
                            } else {
                                post.setStatus("FAILED");
                                post.setErrorMessage("Tài khoản \"" + matchedById.getPageName() + "\" (ID: " + matchedById.getId()
                                        + ") đã hết hạn Cookie (EXPIRED) và không có Via đồng quản trị nào khác còn hoạt động. Vui lòng cập nhật lại Cookie tại trang Quản lý kết nối.");
                                postQueueRepository.save(post);
                                return false;
                            }
                        } else {
                            account = matchedById;
                        }
                    }
                } catch (NumberFormatException ignored) {
                }
            }

            // Các nhánh dưới đây chỉ chạy khi post KHÔNG có connectionId tường minh (parts[2]) hoặc
            // connectionId đó không tồn tại trong hệ thống. Tuyệt đối không tự ý nhảy sang via cá nhân khác
            // khi người dùng đã chọn đích danh một connectionId.
            if (account == null && requestedConnectionId == null) {
                if (realPlatformId.startsWith("PERSONAL_") || "PERSONAL_PROFILE".equalsIgnoreCase(realPlatformId)) {
                    List<SocialAccount> personalMatches = accounts.stream()
                            .filter(a -> "PERSONAL_PROFILE_COOKIE".equalsIgnoreCase(a.getAccountType())
                                    || "FACEBOOK_PROFILE".equalsIgnoreCase(a.getPlatform())
                                    || "PERSONAL_COOKIE".equalsIgnoreCase(a.getAccountType())
                                    || (a.getAccessToken() != null && a.getAccessToken().contains("c_user=")))
                            .filter(a -> !"EXPIRED".equalsIgnoreCase(a.getTokenStatus()))
                            .toList();
                    SocialAccount realProfile = personalMatches.stream()
                            .filter(a -> "FACEBOOK_PROFILE".equalsIgnoreCase(a.getPlatform()) || "PERSONAL_PROFILE_COOKIE".equalsIgnoreCase(a.getAccountType()))
                            .findFirst()
                            .orElse(null);
                    account = realProfile != null ? realProfile : (!personalMatches.isEmpty() ? personalMatches.get(0) : null);
                } else {
                    List<SocialAccount> matchingAccounts = accounts.stream()
                            .filter(a -> realPlatformId.equals(a.getPlatformAccountId()))
                            .filter(a -> requestedAccountType == null || requestedAccountType.isEmpty()
                                    || requestedAccountType.equalsIgnoreCase(a.getAccountType()))
                            .filter(a -> !"EXPIRED".equalsIgnoreCase(a.getTokenStatus()))
                            .toList();
                    List<SocialAccount> personalCookieMatches = matchingAccounts.stream()
                            .filter(a -> "PERSONAL_COOKIE".equals(a.getAccountType()))
                            .toList();
                    if (matchingAccounts.size() == 1) {
                        account = matchingAccounts.get(0);
                    } else if (personalCookieMatches.size() == 1) {
                        account = personalCookieMatches.get(0);
                    } else {
                        account = null;
                    }
                }
            }
        } else {
            // Không có targetFanpageId (VD: đẩy bài qua Extension — hiện chưa có UI chọn Fanpage nên
            // luôn gửi null). Tuyệt đối không được "chọn đại account vừa cập nhật gần đây nhất" —
            // updated_at bị đụng bởi health-check/cookie-refresh chạy nền định kỳ nên gần như random
            // theo thời gian, đây chính là cơ chế gốc của rất nhiều báo cáo "đăng nhầm account" trước
            // đây. Ưu tiên: (1) Fanpage mặc định "Làm Sen" nếu còn kết nối hợp lệ — đúng ý người dùng
            // muốn dùng làm mặc định; (2) nếu không có sẵn, chỉ tự chọn khi có ĐÚNG 1 account còn hạn
            // (không hề có gì để đoán nhầm); còn lại để account == null rơi xuống nhánh FAILED chung,
            // bắt user chọn rõ Fanpage đích thay vì đăng nhầm.
            List<SocialAccount> activeAccounts = accounts.stream()
                    .filter(a -> !"EXPIRED".equalsIgnoreCase(a.getTokenStatus()))
                    .toList();
            account = activeAccounts.stream()
                    .filter(a -> DEFAULT_QUICK_POST_PLATFORM_ACCOUNT_ID.equals(a.getPlatformAccountId())
                            && DEFAULT_QUICK_POST_ACCOUNT_TYPE.equalsIgnoreCase(a.getAccountType()))
                    .findFirst()
                    .orElse(activeAccounts.size() == 1 ? activeAccounts.get(0) : null);
            if (account != null) {
                targetId = account.getPlatformAccountId() + ":" + account.getAccountType() + ":" + account.getId();
                post.setTargetFanpageId(targetId);
            }
        }
        // KHÔNG được âm thầm lấy accounts.get(0) khi không resolve được account nào — thứ tự trả về
        // của findByUserId() không có gì đảm bảo, và trước đây điều này khiến bài có targetFanpageId
        // sai định dạng/không khớp bất kỳ account nào (VD chuỗi tự chế không qua flow chuẩn) bị âm
        // thầm đăng bằng BẤT KỲ account nào đứng đầu danh sách — nguồn gốc thật của nhiều báo cáo
        // "đăng nhầm account/nhóm". Thà FAILED rõ ràng để người dùng biết mà sửa targetFanpageId.
        if (account == null) {
            log.warn("⚠️ Post ID {} có targetFanpageId '{}' không khớp/không đủ rõ ràng để chọn 1 Social Account đã kết nối — không đăng để tránh đăng nhầm.", postId, targetId);
            post.setStatus("FAILED");
            post.setErrorMessage((targetId == null || targetId.trim().isEmpty())
                    ? "Bài chưa chọn Fanpage/Nhóm đích và bạn đang có nhiều tài khoản đã kết nối — vui lòng chọn rõ Fanpage đích cho bài này."
                    : "Không tìm thấy Fanpage/Account khớp với targetFanpageId '" + targetId
                            + "' — vui lòng chọn lại Fanpage/Nhóm đích cho bài này.");
            postQueueRepository.save(post);
            return false;
        }

        long startPublishMillis = System.currentTimeMillis();

        // Giới hạn số bài/ngày cho Fanpage này (tránh bị Facebook đánh dấu spam khi đăng dồn dập).
        // Nếu đã đạt giới hạn, dời bài này sang đúng giờ đó của ngày mai thay vì đăng luôn.
        if (account.getMaxPostsPerDay() != null && account.getMaxPostsPerDay() > 0) {
            LocalDateTime startOfDay = LocalDateTime.now().toLocalDate().atStartOfDay();
            long publishedToday = postQueueRepository.countPublishedTodayForFanpage(account.getPlatformAccountId(), startOfDay);
            if (publishedToday >= account.getMaxPostsPerDay()) {
                log.info("⏸️ Fanpage {} đã đạt giới hạn {} bài/ngày (đã đăng {} bài hôm nay) — dời Post ID {} sang ngày mai.",
                        account.getPageName(), account.getMaxPostsPerDay(), publishedToday, postId);
                post.setStatus("PENDING");
                post.setScheduledAt(LocalDateTime.now().plusDays(1));
                postQueueRepository.save(post);
                return false;
            }
        }

        String content = (post.getContent() != null && !post.getContent().trim().isEmpty())
                ? post.getContent()
                : (post.getTitle() != null ? post.getTitle() : "");
        List<String> mediaUrls = parseMediaUrls(post.getMediaUrls());

        if ("STORY".equals(post.getPostType())) {
            return publishStoryPost(account, post, mediaUrls);
        }

        if ("TIKTOK".equalsIgnoreCase(post.getPostType()) || "TIKTOK_COOKIE".equalsIgnoreCase(account.getAccountType()) || "TIKTOK".equalsIgnoreCase(account.getPlatform())) {
            String publishWarning = publishTikTokPost(account, post, content, mediaUrls);
            long elapsedSec = Math.max(1, (System.currentTimeMillis() - startPublishMillis) / 1000);
            post.setExecutionDurationSeconds((int) elapsedSec);
            if (publishWarning != null) {
                post.setStatus("WARNING");
                post.setErrorMessage(publishWarning);
            } else {
                post.setStatus("PUBLISHED");
                post.setPublishedAt(LocalDateTime.now());
            }
            postQueueRepository.save(post);
            log.info("✅ Đăng bài TikTok thành công cho Post ID: {} (Thời gian thực thi: {}s)", postId, elapsedSec);
            return true;
        }

        if ("THREADS".equalsIgnoreCase(post.getPostType()) || "THREADS_COOKIE".equalsIgnoreCase(account.getAccountType()) || "THREADS".equalsIgnoreCase(account.getPlatform())) {
            if (content.trim().isEmpty() && mediaUrls.isEmpty()) {
                post.setStatus("FAILED");
                post.setErrorMessage("Bài viết không có nội dung lẫn ảnh/video — không có gì để đăng lên Threads.");
                postQueueRepository.save(post);
                return false;
            }
            String publishWarning;
            try {
                publishWarning = publishThreadsPost(account, post, content, mediaUrls);
            } catch (ThreadsCookieExpiredException e) {
                log.warn("🧵 Cookie Threads của tài khoản {} (ID: {}) đã hết hạn — đánh dấu EXPIRED.", account.getPageName(), account.getId());
                account.setTokenStatus("EXPIRED");
                socialAccountRepository.save(account);
                post.setStatus("FAILED");
                post.setErrorMessage(e.getMessage());
                postQueueRepository.save(post);
                return false;
            }
            long elapsedSec = Math.max(1, (System.currentTimeMillis() - startPublishMillis) / 1000);
            post.setExecutionDurationSeconds((int) elapsedSec);
            if (publishWarning != null) {
                post.setStatus("WARNING");
                post.setErrorMessage(publishWarning);
            } else {
                post.setStatus("PUBLISHED");
            }
            post.setPublishedAt(LocalDateTime.now());
            postQueueRepository.save(post);
            log.info("✅ Đăng bài Threads thành công cho Post ID: {} (Thời gian thực thi: {}s)", postId, elapsedSec);
            return true;
        }

        // Fail fast: không có cả nội dung chữ lẫn media thì gọi Graph API/Playwright chỉ để nhận lỗi từ
        // Facebook (hoặc tệ hơn là tạo ra 1 bài đăng trống trên Fanpage thật) — chặn ngay tại đây với
        // thông báo rõ ràng thay vì tốn 1 lượt gọi mạng + để lỗi khó hiểu từ phía Facebook.
        if (content.trim().isEmpty() && mediaUrls.isEmpty()) {
            log.warn("⚠️ Post ID {} không có nội dung lẫn media, không đăng.", postId);
            post.setStatus("FAILED");
            post.setErrorMessage("Bài viết không có nội dung lẫn ảnh/video — không có gì để đăng.");
            postQueueRepository.save(post);
            return false;
        }

        // Thử đăng tối đa 5 lần: nếu gặp cookie/token hết hạn, tự động đánh dấu EXPIRED
        // và chuyển sang các tài khoản kết nối active khác của user (VD: Nick Thành An).
        SocialAccount currentAccount = account;
        for (int attempt = 0; attempt < 5; attempt++) {
            try {
                String publishWarning = null;
                if ("PAGE_TOKEN".equals(currentAccount.getAccountType())) {
                    try {
                        publishWarning = publishViaGraphApi(currentAccount, post, content, mediaUrls, post.getOriginalUrl());
                    } catch (Exception ge) {
                        log.warn("⚠️ Graph API gặp sự cố khi tải video ({}), tự động fallback sang Playwright Worker...", ge.getMessage());
                        publishViaPlaywrightWorker(currentAccount, post, content);
                    }
                } else {
                    if (post.getTargetGroupNames() != null && (post.getTargetGroupNames().startsWith("GROUP_ONLY:") || post.getTargetGroupNames().startsWith("GROUP_ONLY_ANON:"))) {
                        boolean isAnon = post.getTargetGroupNames().startsWith("GROUP_ONLY_ANON:");
                        String targetGroupId = post.getTargetGroupNames().replace("GROUP_ONLY_ANON:", "").replace("GROUP_ONLY:", "").trim();
                        publishWarning = publishToFacebookGroup(currentAccount, content, post.getMediaUrls(), post.getOriginalUrl(), targetGroupId, post.getAffiliateLink(), post, isAnon);
                    } else {
                        if (shouldUseReelGroupSharePopup(currentAccount, post, mediaUrls)) {
                            try {
                                log.info("🎥 Đang đăng Reel + chia sẻ nhóm qua màn hình Reel cho Post ID {}...", postId);
                                publishReelWithGroupsViaWorker(currentAccount, post, content, mediaUrls.get(0));
                            } catch (Exception reelError) {
                                log.warn("⚠️ Popup Reel chia sẻ nhóm thất bại ({}), chuyển sang luồng Fallback...", reelError.getMessage());
                                String pageWarning = publishViaPlaywrightWorker(currentAccount, post, content);
                                publishWarning = joinWarnings(publishWarning, pageWarning);
                                String groupWarning = publishToSelectedGroupsViaWorker(currentAccount, post, content, mediaUrls);
                                publishWarning = joinWarnings(publishWarning, groupWarning);
                            }
                        } else {
                            String pageWarning = publishViaPlaywrightWorker(currentAccount, post, content);
                            if (pageWarning != null) {
                                publishWarning = joinWarnings(publishWarning, pageWarning);
                            }
                            if (post.getTargetGroupNames() != null && !post.getTargetGroupNames().trim().isEmpty()) {
                                String groupWarning = publishToSelectedGroupsViaWorker(currentAccount, post, content, mediaUrls);
                                publishWarning = joinWarnings(publishWarning, groupWarning);
                            }
                        }
                    }
                }

                long elapsedSec = Math.max(1, (System.currentTimeMillis() - startPublishMillis) / 1000);
                post.setExecutionDurationSeconds((int) elapsedSec);
                log.info("✅ Đăng bài thành công cho Post ID: {}{} (Thời gian thực thi: {}s)", postId, currentAccount == account ? "" : " (qua tài khoản dự phòng)", elapsedSec);
                post.setStatus("PUBLISHED");
                post.setPublishedAt(LocalDateTime.now());
                if (post.getPublishedPostUrl() == null || post.getPublishedPostUrl().isBlank()) {
                    if (currentAccount != null && currentAccount.getPlatformAccountId() != null) {
                        post.setPublishedPostUrl("https://www.facebook.com/profile.php?id=" + currentAccount.getPlatformAccountId());
                    }
                }
                post.setErrorMessage(publishWarning);
                postQueueRepository.save(post);
                return true;
            } catch (GraphApiException e) {
                log.error("❌ Lỗi Graph API khi đăng bài Post ID {}: [{}] {}", postId, e.getCode(), e.getMessage());
                if (e.isInvalidToken()) {
                    currentAccount.setTokenStatus("EXPIRED");
                    socialAccountRepository.save(currentAccount);
                    SocialAccount backup = resolveBackupAccount(currentAccount);
                    if (backup != null) {
                        log.warn("🔁 Token Fanpage {} hết hạn — tự động chuyển sang tài khoản dự phòng {} cho Post ID {}",
                                currentAccount.getPageName(), backup.getPageName(), postId);
                        currentAccount = backup;
                        post.setTargetFanpageId(buildTargetFanpageId(backup));
                        continue;
                    }
                }
                post.setStatus("FAILED");
                String userMsg = e.getMessage();
                if (e.isInvalidToken()) {
                    userMsg = "Token Fanpage đã hết hạn hoặc không hợp lệ, vui lòng kết nối lại Fanpage.";
                } else if (e.getCode() == 10 || (e.getMessage() != null && e.getMessage().contains("permission"))) {
                    userMsg = "Facebook App của bạn chưa bật quyền 'pages_manage_posts'. Vui lòng gạt Loại Tài Khoản sang PERSONAL_COOKIE để đăng ngầm tự động!";
                }
                post.setErrorMessage(userMsg);
                postQueueRepository.save(post);
                return false;
            } catch (Exception e) {
                log.error("❌ Lỗi khi đăng bài Post ID {} (lần thử {}/5): {}", postId, attempt + 1, e.getMessage());
                if (isRateLimited(e.getMessage())) {
                    applyRateLimitCooldown(currentAccount, post);
                    return false;
                }
                if (isCredentialFailure(e.getMessage())) {
                    currentAccount.setTokenStatus("EXPIRED");
                    socialAccountRepository.save(currentAccount);

                    boolean isAnonOrSpecificPersonal = (post.getTargetGroupNames() != null && post.getTargetGroupNames().contains("GROUP_ONLY_ANON"))
                            || "FACEBOOK_PROFILE".equalsIgnoreCase(currentAccount.getPlatform())
                            || "PERSONAL_PROFILE_COOKIE".equalsIgnoreCase(currentAccount.getAccountType());

                    SocialAccount backup = !isAnonOrSpecificPersonal ? resolveBackupAccount(currentAccount) : null;
                    if (backup != null) {
                        log.warn("🔁 Cookie {} hết hạn/không hợp lệ — tự động chuyển sang tài khoản dự phòng {} cho Post ID {}",
                                currentAccount.getPageName(), backup.getPageName(), postId);
                        currentAccount = backup;
                        post.setTargetFanpageId(buildTargetFanpageId(backup));
                        continue;
                    } else {
                        String errMsg = "Cookie của tài khoản \"" + currentAccount.getPageName() + "\" đã hết hạn hoặc không hợp lệ trên Facebook. Vui lòng vào mục Kết nối để cập nhật lại Cookie.";
                        post.setStatus("FAILED");
                        post.setErrorMessage(errMsg);
                        postQueueRepository.save(post);
                        return false;
                    }
                }
                // Timeout đọc phản hồi từ Worker KHÔNG có nghĩa là đăng thất bại — request đã tới
                // worker, Playwright có thể vẫn đang chạy dở (mở trình duyệt, tải ảnh, chờ Facebook
                // xác nhận...) và sẽ đăng thành công vài phút sau, chỉ là Backend hết kiên nhẫn chờ
                // trước. Chốt FAILED ngay ở đây từng là nguồn gốc tình huống: bài thật ra đã đăng
                // thành công trên Facebook nhưng hệ thống báo lỗi, người dùng bấm "Đăng lại" -> đăng
                // trùng 2 lần. Để nguyên PROCESSING (đã set từ đầu hàm) — recoverStaleProcessingPosts()
                // trong CampaignScheduler sẽ tự xác minh bằng chứng thật (ID/link bài) sau 5 phút rồi
                // mới chốt PUBLISHED hoặc FAILED, thay vì đoán ngay tại đây.
                if (isAmbiguousWorkerTimeout(e)) {
                    log.warn("⏳ Post ID {} hết thời gian chờ phản hồi Worker (không rõ đã đăng thành công hay chưa) — giữ nguyên PROCESSING, chờ xác minh tự động sau 5 phút.", postId);
                    return false;
                }
                // Nếu gặp lỗi tạm thời từ Playwright Worker (DOM timeout, nuốt click, gián đoạn mạng ngầm),
                // thử lại 2 lần ngắn sau 4 giây trước khi chốt FAILED vĩnh viễn.
                if (isTransientWorkerError(e) && attempt < 2) {
                    log.warn("⚠️ Gặp lỗi tạm thời khi đăng Post ID {} (lần thử {}/3): {}. Đang tự động thử lại sau 4s...",
                            postId, attempt + 1, e.getMessage());
                    try { Thread.sleep(4000); } catch (InterruptedException ie) { Thread.currentThread().interrupt(); }
                    continue;
                }
                PostQueue latestCheck = postQueueRepository.findById(postId).orElse(post);
                if ("PUBLISHED".equalsIgnoreCase(latestCheck.getStatus())) {
                    log.info("✅ Post ID {} đã ở trạng thái PUBLISHED, không ghi đè FAILED.", postId);
                    return true;
                }
                post.setStatus("FAILED");
                post.setErrorMessage(formatFriendlyErrorMessage(e.getMessage()));
                postQueueRepository.save(post);
                return false;
            }
        }
        return false;
    }


    /**
     * Tiến độ retry Group theo thời gian thực. Request POST retry chạy đồng bộ vì mỗi
     * lượt Playwright có thể mất hàng chục giây; UI poll endpoint này để hiển thị
     * "đã xử lý x/y nhóm" thay vì chỉ có spinner không rõ trạng thái.
     */
    public GroupRetryProgress getFailedGroupRetryProgress(Long postId) {
        return groupRetryProgress.getOrDefault(postId,
                new GroupRetryProgress(0, 0, 0, 0, null, null, "IDLE"));
    }

    /**
     * Chỉ thử lại các Group mà kết quả MỚI NHẤT là FAILED. Không đăng lại
     * Fanpage và không đụng vào Group đã có kết quả PUBLISHED, tránh tạo bài trùng.
     */
    public GroupRetrySummary retryFailedGroups(Long postId) {
        if (!retryingFailedGroupPosts.add(postId)) {
            throw new IllegalStateException("Bài này đang được thử lại các Group lỗi, vui lòng chờ hoàn tất.");
        }

        int total = 0;
        int completed = 0;
        int succeeded = 0;
        int failed = 0;
        try {
            PostQueue post = postQueueRepository.findByIdWithCampaignAndUser(postId)
                    .orElseThrow(() -> new IllegalArgumentException("Không tìm thấy bài viết ID " + postId));
            if (!"PUBLISHED".equals(post.getStatus())) {
                throw new IllegalStateException("Chỉ thử lại Group riêng cho bài đã lên Page (PUBLISHED).");
            }

            Map<Long, PostQueueGroupResult> latestByGroup = new LinkedHashMap<>();
            for (PostQueueGroupResult result : postQueueGroupResultRepository
                    .findByPostQueue_IdOrderByAttemptedAtDesc(postId)) {
                if (result.getSocialAccount() != null && result.getSocialAccount().getId() != null) {
                    latestByGroup.putIfAbsent(result.getSocialAccount().getId(), result);
                }
            }
            List<SocialAccount> failedGroups = latestByGroup.values().stream()
                    .filter(result -> "FAILED".equals(result.getStatus()))
                    .map(PostQueueGroupResult::getSocialAccount)
                    .toList();
            total = failedGroups.size();
            groupRetryProgress.put(postId,
                    new GroupRetryProgress(total, 0, 0, 0, null, null, "RUNNING"));

            if (failedGroups.isEmpty()) {
                groupRetryProgress.put(postId,
                        new GroupRetryProgress(0, 0, 0, 0, null, null, "COMPLETE"));
                return new GroupRetrySummary(true, 0, 0, 0, List.of());
            }

            SocialAccount pageAccount = resolvePageAccountForGroupRetry(post);
            if (pageAccount == null || !isCookieAccount(pageAccount)) {
                throw new IllegalStateException("Không tìm thấy kết nối Cookie của Fanpage/Cá nhân để thử lại Group.");
            }

            String content = (post.getContent() != null && !post.getContent().trim().isEmpty())
                    ? post.getContent()
                    : (post.getTitle() != null ? post.getTitle() : "");
            List<String> mediaUrls = parseMediaUrls(post.getMediaUrls());
            List<Map<String, Object>> groupSummaries = new ArrayList<>();
            List<String> remainingFailures = new ArrayList<>();
            LinkedHashSet<String> publishedUrls = new LinkedHashSet<>();
            if (post.getPublishedGroupPostUrls() != null) {
                Arrays.stream(post.getPublishedGroupPostUrls().split(","))
                        .map(String::trim)
                        .filter(value -> !value.isEmpty())
                        .forEach(publishedUrls::add);
            }

            for (SocialAccount group : failedGroups) {
                String groupId = group.getPlatformAccountId();
                String groupName = group.getPageName() != null ? group.getPageName() : "Group " + groupId;
                groupRetryProgress.put(postId, new GroupRetryProgress(
                        total, completed, succeeded, failed, groupId, groupName, "RUNNING"));

                Map<String, Object> item = new LinkedHashMap<>();
                item.put("groupId", groupId);
                item.put("groupName", groupName);
                try {
                    log.info("🔁 [RETRY GROUP] Post ID {} chỉ thử lại Group {} ({}), không đăng lại Page.",
                            postId, groupName, groupId);
                    GroupPublishResult result = sendToFacebookGroupWorker(
                            pageAccount, content, mediaUrls, post.getOriginalUrl(), groupId, post.getAffiliateLink(), false, post);
                    saveGroupResult(post, group, "PUBLISHED", result.postUrl(), null);
                    if (result.postUrl() != null && !result.postUrl().trim().isEmpty()) {
                        publishedUrls.add(result.postUrl().trim());
                    }
                    succeeded++;
                    item.put("status", "PUBLISHED");
                    if (result.postUrl() != null) item.put("postUrl", result.postUrl());
                    if (result.warning() != null) item.put("warning", result.warning());
                } catch (Exception error) {
                    failed++;
                    String errorMessage = error.getMessage() != null ? error.getMessage() : "Lỗi không xác định";
                    saveGroupResult(post, group, "FAILED", null, errorMessage);
                    remainingFailures.add(groupName + " (" + groupId + "): " + errorMessage);
                    item.put("status", "FAILED");
                    item.put("error", errorMessage);
                }
                completed++;
                groupSummaries.add(item);
                groupRetryProgress.put(postId, new GroupRetryProgress(
                        total, completed, succeeded, failed, null, null, "RUNNING"));
            }

            post.setPublishedGroupPostUrls(publishedUrls.isEmpty() ? null : String.join(",", publishedUrls));
            String nonGroupWarning = removePreviousGroupFailureWarning(post.getErrorMessage());
            if (remainingFailures.isEmpty()) {
                post.setErrorMessage(nonGroupWarning);
            } else {
                String retryWarning = "Bài đã lên Page; thử lại nhóm lỗi thành công "
                        + succeeded + "/" + total + "; Group còn lỗi: " + String.join(" | ", remainingFailures);
                post.setErrorMessage(joinWarnings(nonGroupWarning, retryWarning));
            }
            postQueueRepository.save(post);

            groupRetryProgress.put(postId, new GroupRetryProgress(
                    total, completed, succeeded, failed, null, null, "COMPLETE"));
            return new GroupRetrySummary(failed == 0, total, succeeded, failed, groupSummaries);
        } catch (RuntimeException error) {
            groupRetryProgress.put(postId, new GroupRetryProgress(
                    total, completed, succeeded, failed, null, null, "FAILED"));
            throw error;
        } finally {
            retryingFailedGroupPosts.remove(postId);
        }
    }

    private SocialAccount resolvePageAccountForGroupRetry(PostQueue post) {
        Long userId = post.getCampaign() != null && post.getCampaign().getUser() != null
                ? post.getCampaign().getUser().getId()
                : null;
        List<SocialAccount> accounts = userId != null
                ? socialAccountRepository.findByUserId(userId)
                : socialAccountRepository.findAll();
        String target = post.getTargetFanpageId();
        if (target == null || target.trim().isEmpty()) return null;
        String[] parts = target.split(":", -1);
        String platformId = parts[0].trim();

        if (parts.length >= 3 && !parts[2].trim().isEmpty()) {
            try {
                Long connectionId = Long.valueOf(parts[2].trim());
                SocialAccount exact = accounts.stream()
                        .filter(account -> connectionId.equals(account.getId()))
                        .filter(account -> platformId.equals(account.getPlatformAccountId()))
                        .filter(account -> !"EXPIRED".equalsIgnoreCase(account.getTokenStatus()))
                        .findFirst()
                        .orElse(null);
                if (exact != null) return exact;
            } catch (NumberFormatException ignored) { }
        }

        // Không có connectionId tường minh (hoặc đã EXPIRED) — chỉ tự chọn khi khớp DUY NHẤT, cùng
        // nguyên tắc chống "đăng nhầm account" đã áp dụng ở resolveTargetAccount()/resolvePersonalCookieAccount().
        List<SocialAccount> matches = accounts.stream()
                .filter(account -> platformId.equals(account.getPlatformAccountId()))
                .filter(account -> "PERSONAL_COOKIE".equals(account.getAccountType()))
                .filter(account -> !"EXPIRED".equalsIgnoreCase(account.getTokenStatus()))
                .toList();
        return matches.size() == 1 ? matches.get(0) : null;
    }

    private String removePreviousGroupFailureWarning(String warning) {
        if (warning == null || warning.trim().isEmpty()) return null;
        String value = warning.trim();
        int marker = value.indexOf("Bài đã lên Page");
        if (marker < 0) return value;
        String prefix = value.substring(0, marker).replaceFirst("\\s*\\|\\s*$", "").trim();
        return prefix.isEmpty() ? null : prefix;
    }

    /** Tìm account dự phòng: Ưu tiên tài khoản dự phòng chỉ định, sau đó là Via đồng quản trị cùng Page, rồi mới tới các kết nối khác */
    public SocialAccount resolveBackupAccount(SocialAccount primary) {
        if (primary == null) return null;
        // 1. Tài khoản dự phòng được cấu hình tường minh
        if (primary.getBackupAccountId() != null && !primary.getBackupAccountId().equals(primary.getId())) {
            SocialAccount explicitBackup = socialAccountRepository.findById(primary.getBackupAccountId()).orElse(null);
            if (explicitBackup != null && !"EXPIRED".equalsIgnoreCase(explicitBackup.getTokenStatus())) {
                return explicitBackup;
            }
        }

        // 2. ƯU TIÊN HÀNG ĐẦU: Tìm Via đồng quản trị CÙNG FANPAGE này
        if (primary.getPlatformAccountId() != null && !primary.getPlatformAccountId().isBlank()) {
            Long userId = primary.getUser() != null ? primary.getUser().getId() : null;
            List<SocialAccount> coAdmins = findCandidatePostingAccountsForPage(userId, primary.getPlatformAccountId(), null);
            SocialAccount altCoAdmin = coAdmins.stream()
                    .filter(a -> !a.getId().equals(primary.getId()))
                    .findFirst()
                    .orElse(null);
            if (altCoAdmin != null) {
                log.info("🎯 [Co-Admin Failover] Đã tự động chọn Via đồng quản trị '{}' (ID: {}) cho Fanpage ID {}",
                        altCoAdmin.getPageName(), altCoAdmin.getId(), primary.getPlatformAccountId());
                return altCoAdmin;
            }
        }

        if (primary.getUser() != null) {
            String primaryPlatform = primary.getPlatform();
            // 3. Tìm tài khoản cùng platform còn active
            SocialAccount samePlatformBackup = socialAccountRepository.findByUserId(primary.getUser().getId()).stream()
                    .filter(a -> !a.getId().equals(primary.getId()))
                    .filter(a -> primaryPlatform == null || primaryPlatform.equalsIgnoreCase(a.getPlatform()))
                    .filter(a -> !"EXPIRED".equalsIgnoreCase(a.getTokenStatus()))
                    .findFirst()
                    .orElse(null);
            if (samePlatformBackup != null) return samePlatformBackup;

            // 4. Nếu không có cùng platform, tìm bất kỳ tài khoản/Via có Cookie active hợp lệ khác của user để chống đứng hệ thống
            return socialAccountRepository.findByUserId(primary.getUser().getId()).stream()
                    .filter(a -> !a.getId().equals(primary.getId()))
                    .filter(a -> a.getAccessToken() != null && a.getAccessToken().contains("c_user="))
                    .filter(a -> !"EXPIRED".equalsIgnoreCase(a.getTokenStatus()))
                    .findFirst()
                    .orElse(null);
        }
        return null;
    }

    /**
     * Tìm tất cả các tài khoản / Via Facebook có quyền quản trị Fanpage này và đang hoạt động tốt (tokenStatus != 'EXPIRED').
     * Tra cứu chéo giữa bảng social_accounts và bảng kiểm kê quyền facebook_page_accesses.
     */
    public List<SocialAccount> findCandidatePostingAccountsForPage(Long userId, String pagePlatformId, Long preferredConnectionId) {
        List<SocialAccount> candidates = new ArrayList<>();
        Set<String> seenViaCUsers = new HashSet<>();
        Set<Long> seenAccountIds = new HashSet<>();

        // 1. Kiểm tra preferred connection trước nếu có
        if (preferredConnectionId != null) {
            SocialAccount preferred = socialAccountRepository.findById(preferredConnectionId).orElse(null);
            if (preferred != null && !"EXPIRED".equalsIgnoreCase(preferred.getTokenStatus())) {
                candidates.add(preferred);
                seenAccountIds.add(preferred.getId());
                String cUser = extractCUserFromAccount(preferred);
                if (cUser != null) seenViaCUsers.add(cUser);
            }
        }

        // 2. Tìm các kết nối cùng platformAccountId của Fanpage trong social_accounts
        List<SocialAccount> userAccounts = (userId != null)
                ? socialAccountRepository.findByUserId(userId)
                : socialAccountRepository.findAll();

        for (SocialAccount acc : userAccounts) {
            if (seenAccountIds.contains(acc.getId())) continue;
            if (pagePlatformId != null && pagePlatformId.equals(acc.getPlatformAccountId())
                    && !"EXPIRED".equalsIgnoreCase(acc.getTokenStatus())) {
                String cUser = extractCUserFromAccount(acc);
                if (cUser == null || !seenViaCUsers.contains(cUser)) {
                    candidates.add(acc);
                    seenAccountIds.add(acc.getId());
                    if (cUser != null) seenViaCUsers.add(cUser);
                }
            }
        }

        // 3. Tra cứu bảng facebook_page_accesses để tìm các Via đồng quản trị khác
        if (pagePlatformId != null && !pagePlatformId.isBlank()) {
            List<FacebookPageAccess> accesses = (userId != null)
                    ? facebookPageAccessRepository.findByUserIdAndPageIdAndActiveTrue(userId, pagePlatformId)
                    : facebookPageAccessRepository.findByPageIdAndActiveTrue(pagePlatformId);

            for (FacebookPageAccess access : accesses) {
                String viaUid = access.getPersonalProfileId();
                if (viaUid == null || seenViaCUsers.contains(viaUid)) continue;

                // Tìm kết nối của Via này CHO ĐÚNG Page này. Không được lấy kết nối của Via đó cho Page
                // khác: publishPostNow dùng connectionId làm danh tính đăng, nên kết nối "BaT - Ngọc Hà Shop"
                // của cùng nick sẽ đăng bài Làm Sen dưới tên BaT. Via chưa có kết nối riêng → bỏ qua.
                for (SocialAccount acc : userAccounts) {
                    if (seenAccountIds.contains(acc.getId())) continue;
                    if (!pagePlatformId.equals(acc.getPlatformAccountId())) continue;
                    String accCUser = extractCUserFromAccount(acc);
                    if (viaUid.equals(accCUser)) {
                        if (!"EXPIRED".equalsIgnoreCase(acc.getTokenStatus())
                                && acc.getAccessToken() != null && acc.getAccessToken().contains("c_user=")) {
                            candidates.add(acc);
                            seenAccountIds.add(acc.getId());
                            seenViaCUsers.add(viaUid);
                            break;
                        }
                    }
                }
            }
        }

        return candidates;
    }

    public static String extractCUserFromAccount(SocialAccount acc) {
        if (acc == null || acc.getAccessToken() == null) return null;
        Matcher m = Pattern.compile("(?:^|;\\s*)c_user=([^;\\s]+)").matcher(acc.getAccessToken());
        return m.find() ? m.group(1).trim() : null;
    }

    /** Dựng lại chuỗi targetFanpageId dạng "platformAccountId:accountType:connectionId" để ghi vào Post khi failover. */
    private String buildTargetFanpageId(SocialAccount account) {
        return account.getPlatformAccountId() + ":" + account.getAccountType() + ":" + account.getId();
    }

    /** Nhận diện lỗi do token/cookie hết hạn hoặc không hợp lệ từ message lỗi của Worker/Graph API. */
    private boolean isCredentialFailure(String message) {
        if (message == null) return false;
        String m = message.toLowerCase();
        return m.contains("hết hạn") || m.contains("đăng nhập lại") || m.contains("invalid") 
                || m.contains("cookie") || m.contains("phiên đăng nhập")
                || m.contains("không thể mở modal tạo bài viết")
                || m.contains("đăng nhập") || m.contains("login");
    }

    /**
     * Đăng Story cho 1 bài postType=STORY trong hàng đợi. Cùng nguyên tắc thành công/thất bại với
     * bài Feed (set status/publishedAt/errorMessage) để tái dùng nguyên UI trạng thái hiện có.
     * PAGE_TOKEN dùng Graph API (giữ nguyên fallback "pending" giống endpoint /post-story cũ để
     * tránh đăng trùng khi Meta còn đang mã hoá video), PERSONAL_COOKIE dùng thẳng Playwright Worker.
     */
    private boolean publishStoryPost(SocialAccount account, PostQueue post, List<String> mediaUrls) {
        if (mediaUrls.isEmpty()) {
            post.setStatus("FAILED");
            post.setErrorMessage("Bài Story không có media (ảnh/video) để đăng.");
            postQueueRepository.save(post);
            return false;
        }
        String mediaUrl = mediaUrls.get(0);
        try {
            if ("PERSONAL_COOKIE".equals(account.getAccountType())) {
                publishStoryViaWorker(account, mediaUrl, post.getOriginalUrl(), post.getAffiliateLink());
            } else {
                Map<String, Object> result = isVideoUrl(mediaUrl)
                        ? facebookGraphApiService.publishVideoStory(account.getPlatformAccountId(), account.getAccessToken(), mediaUrl)
                        : facebookGraphApiService.publishPhotoStory(account.getPlatformAccountId(), account.getAccessToken(), mediaUrl);
                boolean success = result != null && (
                        result.containsKey("post_id") || result.containsKey("id")
                        || result.containsKey("photo_id") || result.containsKey("video_id")
                        || Boolean.TRUE.equals(result.get("success")));
                if (!success) {
                    String errorMsg = result != null && result.get("error") != null
                            ? String.valueOf(result.get("error"))
                            : "Không đăng được Story qua Graph API.";
                    if (result != null && Boolean.TRUE.equals(result.get("pending"))) {
                        // Meta còn đang xác nhận mã hoá — không fallback ngay để tránh đăng trùng 2 Story.
                        post.setStatus("FAILED");
                        post.setErrorMessage("Story đang chờ Meta xử lý, thử lại sau: " + errorMsg);
                        postQueueRepository.save(post);
                        return false;
                    }
                    log.warn("⚠️ Story qua Graph API thất bại ({}), chuyển sang Playwright Worker...", errorMsg);
                    publishStoryViaWorker(account, mediaUrl, post.getOriginalUrl(), post.getAffiliateLink());
                }
            }
            log.info("✅ Đăng Story thành công cho Post ID: {}", post.getId());
            post.setStatus("PUBLISHED");
            post.setPublishedAt(LocalDateTime.now());
            postQueueRepository.save(post);
            return true;
        } catch (Exception e) {
            log.error("❌ Lỗi khi đăng Story Post ID {}: {}", post.getId(), e.getMessage());
            post.setStatus("FAILED");
            post.setErrorMessage(e.getMessage());
            postQueueRepository.save(post);
            return false;
        }
    }

    private String publishViaGraphApi(SocialAccount account, PostQueue post, String content, List<String> mediaUrls, String originalUrl) {
        String pageId = account.getPlatformAccountId();
        String pageAccessToken = account.getAccessToken();

        // KHÔNG được giao lịch hẹn cho Facebook tự xử lý (published=false + scheduled_publish_time):
        // hệ thống của mình đã tự quản lý toàn bộ lịch đăng qua CampaignScheduler (post chỉ được gọi
        // đến hàm này khi đã đến đúng giờ, hoặc khi người dùng bấm "Đăng ngay" ép đăng sớm hơn lịch).
        // Từng có bug: bấm "Đăng ngay" cho 1 bài còn scheduledAt xa trong tương lai khiến Facebook coi
        // đó là hẹn giờ thật, tạo bài ở trạng thái "chưa xuất bản" — Admin xem vẫn thấy nhưng người
        // ngoài không thấy gì, và có bài bị kẹt vĩnh viễn dù đã quá giờ hẹn rất lâu. Mọi lần gọi đến
        // đây đều có nghĩa là "đăng NGAY BÂY GIỜ", nên luôn để null (published=true tức thì).
        Long scheduledPublishTime = null;

        if (mediaUrls.isEmpty()) {
            Map<String, Object> textResp = facebookGraphApiService.publishText(pageId, pageAccessToken, content, scheduledPublishTime);
            return commentAffiliateLinkIfAny(pageAccessToken, textResp, post);
        }

        List<String> explicitVideoUrls = mediaUrls.stream().filter(this::isVideoUrl).toList();
        List<String> explicitPhotoUrls = mediaUrls.stream().filter(url -> !isVideoUrl(url)).toList();
        if ((!explicitVideoUrls.isEmpty() && !explicitPhotoUrls.isEmpty()) || explicitVideoUrls.size() > 1) {
            log.info("📦 Media hỗn hợp/nhiều video: tách thành {} bài video và {} album ảnh để đăng đủ.",
                    explicitVideoUrls.size(), explicitPhotoUrls.isEmpty() ? 0 : 1);
            String combinedWarning = null;
            for (String videoUrl : explicitVideoUrls) {
                combinedWarning = joinWarnings(combinedWarning,
                        publishViaGraphApi(account, post, content, List.of(videoUrl), originalUrl));
            }
            if (!explicitPhotoUrls.isEmpty()) {
                combinedWarning = joinWarnings(combinedWarning,
                        publishViaGraphApi(account, post, content, explicitPhotoUrls, null));
            }
            return combinedWarning;
        }

        String mediaUrl = mediaUrls.get(0);
        // Nếu mediaUrl là file ảnh .jpg nhưng thuộc dạng video (từ Threads / Facebook Group / clip mèo), tự động giải mã lấy link .mp4 video thực tế
        if (!isVideoUrl(mediaUrl) && originalUrl != null && !originalUrl.trim().isEmpty()) {
            try {
                log.info("🔍 Kiểm tra xem bài viết gốc {} có chứa Video .MP4 ngầm không...", originalUrl);
                Map<String, String> req = Map.of("url", originalUrl);
                Map<?, ?> resp = WorkerRetryHelper.postWithConnectionRetry(restTemplate, workerRouterService.getPostingWorkerUrl("/api/extract-video"), req, Map.class);
                if (resp != null && Boolean.TRUE.equals(resp.get("success")) && resp.get("videoUrl") != null) {
                    mediaUrl = resp.get("videoUrl").toString();
                    log.info("🎬 Đã tìm thấy link MP4 video thực tế: {}", mediaUrl);
                }
            } catch (Exception e) {}
        }

        String targetId = (post != null && post.getTargetFanpageId() != null) ? post.getTargetFanpageId().split(":")[0].trim() : pageId;

        if (!targetId.equals(pageId) && targetId.matches("\\d+")) {
            log.info("📢 Thực hiện đăng bài trực tiếp vào Group ID {} qua Graph API chính thức của Facebook...", targetId);
            if (mediaUrls.isEmpty()) {
                facebookGraphApiService.publishTextToGroup(targetId, pageAccessToken, content);
            } else if (isVideoUrl(mediaUrl)) {
                facebookGraphApiService.publishVideoToGroup(targetId, pageAccessToken, content, mediaUrl);
            } else if (mediaUrls.size() > 1) {
                List<String> photoIds = new ArrayList<>();
                for (String url : mediaUrls) {
                    String photoId = facebookGraphApiService.uploadUnpublishedPhoto(targetId, pageAccessToken, url);
                    if (photoId != null) photoIds.add(photoId);
                }
                if (photoIds.isEmpty()) throw new IllegalStateException("Không tải được ảnh nào để tạo album Group");
                facebookGraphApiService.publishAlbum(targetId, pageAccessToken, content, photoIds);
            } else {
                facebookGraphApiService.publishPhotoToGroup(targetId, pageAccessToken, content, mediaUrls.get(0));
            }
            return null;
        }

        if (isVideoUrl(mediaUrl)) {
            log.info("🎬 Thực hiện xuất bản VIDEO MP4 chuẩn lên Fanpage (ID: {})...", pageId);
            Map<String, Object> videoResp = facebookGraphApiService.publishVideo(pageId, pageAccessToken, content, mediaUrl, scheduledPublishTime);
            String videoWarning = (videoResp != null && Boolean.TRUE.equals(videoResp.get("pending")))
                    ? String.valueOf(videoResp.get("warning"))
                    : null;

            // Tự động enable Crossposting cho video vừa đăng (cho phép đăng sang các Fanpage phụ không cần re-upload)
            if (videoResp != null && videoResp.containsKey("id")) {
                String publishedVideoId = videoResp.get("id").toString();
                log.info("🌐 Video ID {}: Tự động bật quyền BM Crossposting...", publishedVideoId);
                try {
                    // Bật crosspost cho toàn bộ Business Manager
                    restTemplate.postForObject(
                        "https://graph.facebook.com/v26.0/" + publishedVideoId + "?allow_bm_crossposting=true&access_token=" + pageAccessToken,
                        null, Map.class
                    );
                    log.info("✅ Đã bật BM Crossposting cho Video ID: {}", publishedVideoId);
                } catch (Exception ce) {
                    log.warn("⚠️ Không bật được BM Crossposting (video vẫn đăng thành công): {}", ce.getMessage());
                }
            }

            // Đồng thời xuất bản Video lên Facebook Page Story 24h qua Meta Graph API chính thức
            try {
                log.info("📖 Đồng thời tự động đẩy Video lên Facebook Story 24h via Graph API...");
                Map<String, Object> vStoryRes = facebookGraphApiService.publishVideoStory(pageId, pageAccessToken, mediaUrl);
                if (vStoryRes == null || !Boolean.TRUE.equals(vStoryRes.get("success"))) {
                    log.info("📖 Chuyển sang đẩy Video Story via Playwright Worker...");
                    publishStoryViaWorker(account, mediaUrl, originalUrl);
                }
            } catch (Exception se) {
                log.warn("⚠️ Đẩy Video Story gặp sự cố (không ảnh hưởng độc lập tới trạng thái đăng lên Tường): {}", se.getMessage());
            }
            String commentWarning = commentAffiliateLinkIfAny(pageAccessToken, videoResp, post);
            return joinWarnings(videoWarning, commentWarning);
        }

        List<String> photoUrls = mediaUrls.stream().filter(url -> !isVideoUrl(url)).toList();
        if (photoUrls.size() == 1) {
            Map<String, Object> photoResp = facebookGraphApiService.publishPhoto(pageId, pageAccessToken, content, photoUrls.get(0), scheduledPublishTime);
            // Đồng thời xuất bản Ảnh lên Facebook Page Story 24h qua Graph API
            try {
                log.info("📖 Đồng thời tự động đẩy Ảnh lên Facebook Story 24h qua Graph API...");
                facebookGraphApiService.publishPhotoStory(pageId, pageAccessToken, photoUrls.get(0));
            } catch (Exception se) {
                log.warn("⚠️ Đẩy Photo Story gặp sự cố (bài trên tường vẫn thành công 100%): {}", se.getMessage());
            }
            return commentAffiliateLinkIfAny(pageAccessToken, photoResp, post);
        } else {
            List<String> photoIds = new ArrayList<>();
            for (String url : photoUrls) {
                String photoId = facebookGraphApiService.uploadUnpublishedPhoto(pageId, pageAccessToken, url);
                if (photoId != null) {
                    photoIds.add(photoId);
                }
            }
            Map<String, Object> albumResp = facebookGraphApiService.publishAlbum(pageId, pageAccessToken, content, photoIds);
            return commentAffiliateLinkIfAny(pageAccessToken, albumResp, post);
        }
    }

    private String joinWarnings(String a, String b) {
        if (a == null || a.trim().isEmpty()) return b;
        if (b == null || b.trim().isEmpty()) return a;
        return a + " | " + b;
    }

    /**
     * Tự động comment link affiliate vào bài vừa đăng thành công (nếu người dùng có cấu hình).
     * Thất bại khi comment không ảnh hưởng tới việc bài đăng chính đã thành công, nhưng lỗi được
     * trả về dưới dạng warning để hiển thị lên UI thay vì chỉ nằm im trong log server.
     */
    private String commentAffiliateLinkIfAny(String pageAccessToken, Map<String, Object> publishResp, PostQueue post) {
        if (publishResp != null && publishResp.get("id") != null && post != null) {
            // Lưu lại ID bài viết thật trên Facebook để sau này có thể tra insights (reach/like/comment)
            // qua Graph API — trước đây ID này chỉ dùng tạm để comment affiliate rồi bị bỏ đi.
            post.setFbPostId(publishResp.get("id").toString());
        }
        boolean autoCommentEnabled = false;
        if (!autoCommentEnabled) return null;
        String affiliateLink = post != null ? post.getAffiliateLink() : null;
        if (affiliateLink == null || affiliateLink.trim().isEmpty()) return null;
        if (publishResp == null || publishResp.get("id") == null) return null;
        String postId = publishResp.get("id").toString();
        try {
            log.info("💬 Tự động comment Link Affiliate vào bài vừa đăng (Post ID: {})...", postId);
            facebookGraphApiService.commentOnPost(postId, pageAccessToken, affiliateLink.trim());
            return null;
        } catch (Exception ce) {
            log.warn("⚠️ Comment Link Affiliate thất bại (bài đăng vẫn thành công 100%): {}", ce.getMessage());
            return "Comment Link Affiliate thất bại: " + ce.getMessage();
        }
    }

    private String publishViaPlaywrightWorker(SocialAccount account, PostQueue post, String content) {
        List<String> mediaUrls = parseMediaUrls(post.getMediaUrls());
        log.info("📦 [PLAYWRIGHT ENGINE] Gửi {} media trong cùng một bài Facebook (postType: {}).", mediaUrls.size(), post.getPostType());
        String effectiveTargetFanpageId = (post.getTargetFanpageId() != null && !post.getTargetFanpageId().trim().isEmpty() && !"null".equalsIgnoreCase(post.getTargetFanpageId()))
                ? post.getTargetFanpageId().split(":")[0].trim()
                : account.getPlatformAccountId();
        return sendToPlaywrightWorker(account, content, mediaUrls, post.getOriginalUrl(), post.getAffiliateLink(), post.getPostType(), effectiveTargetFanpageId);
    }

    private String sendToPlaywrightWorker(SocialAccount account, String content, List<String> mediaUrls,
                                        String originalUrl, String affiliateLink, String postType, String targetFanpageId) {
        String finalFanpageId = (targetFanpageId != null && !targetFanpageId.isBlank()) ? targetFanpageId : account.getPlatformAccountId();
        log.info("🎭 [PLAYWRIGHT ENGINE] Đang gửi yêu cầu đăng bài tự động qua Playwright Worker cho Fanpage ID {}...", finalFanpageId);
        String playwrightUrl = workerRouterService.getPostingWorkerUrl("/api/post-facebook");
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);

        Map<String, Object> requestBody = new HashMap<>();
        requestBody.put("cookieString", account.getAccessToken());
        requestBody.put("targetFanpageId", finalFanpageId);
        requestBody.put("socialAccountId", String.valueOf(account.getId()));
        if (account.getProxyUrl() != null && !account.getProxyUrl().isBlank()) {
            requestBody.put("proxyUrl", account.getProxyUrl().trim());
        }
        if (account.getUserAgent() != null && !account.getUserAgent().isBlank()) {
            requestBody.put("userAgent", account.getUserAgent().trim());
        }
        requestBody.put("content", content);
        if (!mediaUrls.isEmpty()) {
            requestBody.put("mediaUrls", mediaUrls);
        }
        if (originalUrl != null) {
            requestBody.put("originalUrl", originalUrl);
        }

        // QUY TẮC BẢO VỆ UY TÍN: Fanpage Vietnam Real Estate (ID 100053405437835) tuyệt đối không gắn link Shopee/Affiliate/bán hàng!
        boolean isVietnamRealEstate = account != null && (
                "100053405437835".equals(account.getPlatformAccountId()) ||
                (account.getPageName() != null && (account.getPageName().toLowerCase().contains("real estate") || account.getPageName().toLowerCase().contains("bất động sản")))
        );
        if (isVietnamRealEstate && affiliateLink != null && (affiliateLink.toLowerCase().contains("shopee") || affiliateLink.toLowerCase().contains("shp.ee") || affiliateLink.toLowerCase().contains("affiliate"))) {
            log.warn("🛡️ [BẢO VỆ FANPAGE] Fanpage Vietnam Real Estate: Đã tự động chặn và loại bỏ link Shopee/Affiliate trong bình luận!");
            affiliateLink = null;
        }

        if (affiliateLink != null && !affiliateLink.trim().isEmpty()) {
            requestBody.put("affiliateLink", affiliateLink.trim());
        }
        if (postType != null && !postType.isBlank()) {
            requestBody.put("postType", postType.trim());
            if ("COLOR_BACKGROUND".equalsIgnoreCase(postType.trim()) || "RED_PHOTO_TRICK".equalsIgnoreCase(postType.trim())) {
                requestBody.put("backgroundColor", "RED");
            }
        }

        HttpEntity<Map<String, Object>> request = new HttpEntity<>(requestBody, headers);
        try {
            Map<?, ?> resp = postToWorkerWithConnectionRetry(playwrightUrl, request);
            if (resp != null && resp.get("warning") != null) {
                return resp.get("warning").toString();
            }
        } catch (Exception e) {
            throw new RuntimeException("Lỗi Playwright Worker: " + e.getMessage(), e);
        }
        return null;
    }

    private String publishTikTokPost(SocialAccount account, PostQueue post, String content, List<String> mediaUrls) {
        log.info("🎵 [TIKTOK ENGINE] Đang gửi yêu cầu đăng bài TikTok qua Playwright Worker cho Account ID {}...", account.getId());
        String playwrightUrl = workerRouterService.getPostingWorkerUrl("/api/post-tiktok");
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);

        Map<String, Object> requestBody = new HashMap<>();
        requestBody.put("cookieString", account.getAccessToken());
        requestBody.put("socialAccountId", String.valueOf(account.getId()));
        requestBody.put("caption", content);
        if (!mediaUrls.isEmpty()) {
            requestBody.put("videoUrl", mediaUrls.get(0));
            requestBody.put("mediaUrls", mediaUrls);
        } else if (post.getOriginalUrl() != null) {
            requestBody.put("videoUrl", post.getOriginalUrl());
        }

        HttpEntity<Map<String, Object>> request = new HttpEntity<>(requestBody, headers);
        try {
            Map<?, ?> resp = postToWorkerWithConnectionRetry(playwrightUrl, request);
            if (resp != null && resp.get("warning") != null) {
                return resp.get("warning").toString();
            }
        } catch (Exception e) {
            throw new RuntimeException("Lỗi Playwright TikTok Worker: " + e.getMessage(), e);
        }
        return null;
    }

    private static class ThreadsCookieExpiredException extends RuntimeException {
        ThreadsCookieExpiredException(String message) {
            super(message);
        }
    }

    private String publishThreadsPost(SocialAccount account, PostQueue post, String content, List<String> mediaUrls) {
        log.info("🧵 [THREADS ENGINE] Đang gửi yêu cầu đăng bài Threads qua Playwright Worker cho Account ID {}...", account.getId());
        String playwrightUrl = workerRouterService.getPostingWorkerUrl("/api/post-threads");
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);

        Map<String, Object> requestBody = new HashMap<>();
        requestBody.put("cookieString", account.getAccessToken());
        requestBody.put("socialAccountId", String.valueOf(account.getId()));
        requestBody.put("content", content);
        requestBody.put("mediaUrls", mediaUrls);

        HttpEntity<Map<String, Object>> request = new HttpEntity<>(requestBody, headers);
        try {
            Map<?, ?> resp = postToWorkerWithConnectionRetry(playwrightUrl, request);
            if (resp != null && resp.get("postUrl") != null) {
                post.setPublishedPostUrl(resp.get("postUrl").toString());
            }
            // Threads xoay vòng cookie theo phiên — lưu bản mới nhất worker trả về để nick sống lâu hơn.
            if (resp != null && resp.get("cookieString") instanceof String fresh && fresh.contains("sessionid=")) {
                account.setAccessToken(fresh);
                account.setTokenStatus("OK");
                socialAccountRepository.save(account);
            }
            if (resp != null && resp.get("warning") != null) {
                return resp.get("warning").toString();
            }
        } catch (HttpStatusCodeException e) {
            String body = e.getResponseBodyAsString();
            if (body != null && body.contains("THREADS_COOKIE_EXPIRED")) {
                throw new ThreadsCookieExpiredException("Cookie Threads của tài khoản \"" + account.getPageName()
                        + "\" đã hết hạn. Vui lòng cập nhật lại Cookie tại trang Quản lý kết nối.");
            }
            throw new RuntimeException("Lỗi Playwright Threads Worker: " + (body != null && !body.isBlank() ? body : e.getMessage()), e);
        } catch (Exception e) {
            throw new RuntimeException("Lỗi Playwright Threads Worker: " + e.getMessage(), e);
        }
        return null;
    }

    /**
     * Kiểm tra điều kiện để dùng popup "Chia sẻ lên nhóm" trên màn hình Facebook Thước phim (Reel).
     * Chỉ sử dụng popup chia sẻ nhóm khi:
     * 1. Bài là 1 video Reel duy nhất (ảnh/text hoặc nhiều media màn này không hỗ trợ).
     * 2. Số lượng nhóm <= 9.
     * 3. Tên nhóm không bị trùng lặp mơ hồ (nếu trong DB có 2 nhóm trùng tên nhau nhưng user chỉ chọn 1 nhóm,
     *    popup Facebook không hiển thị Group ID để phân biệt -> bắt buộc dùng fallback đăng trực tiếp vào từng Group ID).
     */
    private boolean shouldUseReelGroupSharePopup(SocialAccount pageAccount, PostQueue post, List<String> mediaUrls) {
        if (post == null || post.getTargetGroupNames() == null || post.getTargetGroupNames().trim().isEmpty()) {
            return false;
        }
        if (post.getTargetGroupNames().startsWith("GROUP_ONLY:")) {
            return false;
        }

        // 1. Phải có đúng 1 video Reel
        if (mediaUrls.size() != 1 || !isVideoUrl(mediaUrls.get(0))) {
            log.info("ℹ️ [ReelGroupCheck] Post ID {} không phải 1 video Reel duy nhất ({} media) -> Dùng luồng Fallback.", post.getId(), mediaUrls.size());
            return false;
        }

        // Parse danh sách tên/ID nhóm được chọn
        List<String> requestedTargets = Arrays.stream(post.getTargetGroupNames().split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .toList();

        if (requestedTargets.isEmpty()) {
            return false;
        }

        // 2. Không quá 9 nhóm
        if (requestedTargets.size() > 9) {
            log.info("ℹ️ [ReelGroupCheck] Post ID {} chọn {} nhóm (> 9 nhóm) -> Dùng luồng Fallback.", post.getId(), requestedTargets.size());
            return false;
        }

        // 3. Kiểm tra xem có 2 nhóm trùng tên mà người dùng chỉ chọn 1 nhóm hay không
        Long userId = (post.getCampaign() != null && post.getCampaign().getUser() != null)
                ? post.getCampaign().getUser().getId()
                : (pageAccount != null && pageAccount.getUser() != null ? pageAccount.getUser().getId() : null);

        List<SocialAccount> configuredGroups = (userId != null ? socialAccountRepository.findByUserId(userId) : socialAccountRepository.findAll()).stream()
                .filter(candidate -> "FACEBOOK_GROUP".equals(candidate.getPlatform()))
                .filter(candidate -> candidate.getPlatformAccountId() != null && !candidate.getPlatformAccountId().trim().isEmpty())
                .toList();

        Map<String, List<SocialAccount>> groupsByName = new HashMap<>();
        for (SocialAccount g : configuredGroups) {
            String normName = normalizeFacebookName(g.getPageName()).toLowerCase();
            if (!normName.isEmpty()) {
                groupsByName.computeIfAbsent(normName, k -> new ArrayList<>()).add(g);
            }
        }

        Set<String> selectedGroupIds = new HashSet<>();
        for (String requested : requestedTargets) {
            String normReq = normalizeFacebookName(requested).toLowerCase();
            configuredGroups.stream()
                    .filter(g -> requested.equals(g.getPlatformAccountId())
                            || normReq.equals(normalizeFacebookName(g.getPageName()).toLowerCase()))
                    .forEach(g -> selectedGroupIds.add(g.getPlatformAccountId()));
        }

        for (Map.Entry<String, List<SocialAccount>> entry : groupsByName.entrySet()) {
            List<SocialAccount> sameNameGroups = entry.getValue();
            if (sameNameGroups.size() >= 2) {
                long selectedCount = sameNameGroups.stream().filter(g -> selectedGroupIds.contains(g.getPlatformAccountId())).count();
                if (selectedCount > 0 && selectedCount < sameNameGroups.size()) {
                    log.info("ℹ️ [ReelGroupCheck] Post ID {} chọn {}/{} nhóm cùng tên '{}' -> Popup FB không phân biệt được Group ID -> Dùng luồng Fallback.",
                            post.getId(), selectedCount, sameNameGroups.size(), entry.getKey());
                    return false;
                }
            }
        }

        log.info("✅ [ReelGroupCheck] Post ID {} đủ điều kiện dùng popup Reel chia sẻ nhóm ({} nhóm).", post.getId(), requestedTargets.size());
        return true;
    }

    /**
     * Đăng Video dạng Reel lên Fanpage VÀ đồng thời share vào các Group Facebook đã chọn cho bài này
     * (post.getTargetGroupNames(), danh sách tên group cách nhau bởi dấu phẩy). Dùng chung 1 phiên
     * Playwright/cookie với publishViaPlaywrightWorker, chỉ khác endpoint worker được gọi.
     */
    private void publishReelWithGroupsViaWorker(SocialAccount account, PostQueue post, String content, String videoUrl) {
        String playwrightUrl = workerRouterService.getPostingWorkerUrl("/api/post-facebook-reel-groups");
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);

        List<String> groupNames = Arrays.stream(post.getTargetGroupNames().split(","))
                .map(String::trim)
                .map(s -> s.startsWith("GROUP_ONLY:") ? s.substring("GROUP_ONLY:".length()).trim() : s)
                .filter(s -> !s.isEmpty())
                .toList();

        Map<String, Object> requestBody = new HashMap<>();
        requestBody.put("cookieString", account.getAccessToken());
        requestBody.put("targetFanpageId", account.getPlatformAccountId());
        requestBody.put("socialAccountId", account.getId());
        requestBody.put("content", content);
        requestBody.put("mediaUrls", videoUrl);
        requestBody.put("groupNames", groupNames);

        HttpEntity<Map<String, Object>> request = new HttpEntity<>(requestBody, headers);
        WorkerRetryHelper.postWithConnectionRetry(restTemplate, playwrightUrl, request, String.class);
    }

    /**
     * Đăng trực tiếp cùng một bài vào từng Group sau khi bài trên Page đã thành công.
     * targetGroupNames giữ tên cũ để tương thích DB, nhưng dữ liệu mới lưu Group ID.
     * Nếu gặp bản ghi cũ lưu tên, một tên "Đảo Mèo" sẽ khớp cả hai Group
     * cùng tên thay vì chỉ lấy Group đầu tiên.
     */
    private String publishToSelectedGroupsViaWorker(SocialAccount pageAccount, PostQueue post,
                                                     String content, List<String> mediaUrls) {
        if (!isCookieAccount(pageAccount) || pageAccount.getAccessToken() == null || !pageAccount.getAccessToken().contains("c_user=")) {
            Long userId = (post.getCampaign() != null && post.getCampaign().getUser() != null)
                    ? post.getCampaign().getUser().getId()
                    : (pageAccount.getUser() != null ? pageAccount.getUser().getId() : null);
            SocialAccount cookieAccount = (userId != null ? socialAccountRepository.findByUserId(userId) : socialAccountRepository.findAll()).stream()
                    .filter(a -> a.getAccessToken() != null && a.getAccessToken().contains("c_user="))
                    .findFirst()
                    .orElse(null);
            if (cookieAccount == null) {
                return "Bài đã lên Page nhưng không thể đăng Group: chưa có Cookie cá nhân (chứa c_user) để thực hiện chia sẻ vào Group.";
            }
        }

        boolean isAnonymous = post.getTargetGroupNames() != null && post.getTargetGroupNames().contains("_ANON:");
        Set<String> requestedTargets = Arrays.stream(post.getTargetGroupNames().split(","))
                .map(String::trim)
                .map(s -> s.startsWith("GROUP_ONLY_ANON:") ? s.substring("GROUP_ONLY_ANON:".length()).trim() : (s.startsWith("GROUP_ONLY:") ? s.substring("GROUP_ONLY:".length()).trim() : s))
                .filter(value -> !value.isEmpty())
                .collect(java.util.stream.Collectors.toCollection(LinkedHashSet::new));

        Long userId = (post.getCampaign() != null && post.getCampaign().getUser() != null)
                ? post.getCampaign().getUser().getId()
                : null;
        List<SocialAccount> configuredGroups = (userId != null ? socialAccountRepository.findByUserId(userId) : socialAccountRepository.findAll()).stream()
                .filter(candidate -> "FACEBOOK_GROUP".equals(candidate.getPlatform()))
                .filter(candidate -> candidate.getPlatformAccountId() != null
                        && !candidate.getPlatformAccountId().trim().isEmpty())
                .toList();

        Map<String, SocialAccount> selectedByGroupId = new LinkedHashMap<>();
        for (String requested : requestedTargets) {
            String normalizedRequestedName = normalizeFacebookName(requested);
            configuredGroups.stream()
                    .filter(group -> requested.equals(group.getPlatformAccountId())
                            || normalizedRequestedName.equalsIgnoreCase(normalizeFacebookName(group.getPageName())))
                    .forEach(group -> selectedByGroupId.put(group.getPlatformAccountId(), group));
        }

        if (selectedByGroupId.isEmpty()) {
            log.warn("⚠️ Post ID {} không tìm thấy Group ID/tên khớp với: {}", post.getId(), requestedTargets);
            return "Bài đã lên Page nhưng không tìm thấy Group đã chọn trong trang Kết nối.";
        }

        List<String> failures = new ArrayList<>();
        List<String> groupPostUrls = new ArrayList<>();
        int successCount = 0;
        for (SocialAccount group : selectedByGroupId.values()) {
            SocialAccount activeTargetGroup = group;

            // 1. Kiểm tra nếu Group đã bị đánh dấu KICKED/PRIVATE ➔ Chuyển ngay sang Group dự phòng
            if ("KICKED_OR_NOT_JOINED".equals(group.getGroupHealthStatus()) || "PRIVATE_NO_ACCESS".equals(group.getGroupHealthStatus())) {
                if (group.getFallbackGroupId() != null) {
                    SocialAccount fallback = socialAccountRepository.findById(group.getFallbackGroupId()).orElse(null);
                    if (fallback != null) {
                        log.info("🔀 [GroupHealth] Group '{}' bị KICK/Chặn ➔ Tự động chuyển hướng đăng sang Group dự phòng '{}' (ID: {})...",
                                group.getPageName(), fallback.getPageName(), fallback.getPlatformAccountId());
                        activeTargetGroup = fallback;
                    }
                }
            }

            try {
                log.info("📤 [PAGE→GROUP] Post ID {} đang đăng {} media vào Group {} (ID {}, isAnonymous={}).",
                        post.getId(), mediaUrls.size(), activeTargetGroup.getPageName(), activeTargetGroup.getPlatformAccountId(), isAnonymous);
                GroupPublishResult result = sendToFacebookGroupWorker(pageAccount, content, mediaUrls, post.getOriginalUrl(),
                        activeTargetGroup.getPlatformAccountId(), post.getAffiliateLink(), isAnonymous, post);
                if (result.postUrl() != null) {
                    groupPostUrls.add(result.postUrl());
                }
                successCount++;
                saveGroupResult(post, activeTargetGroup, "PUBLISHED", result.postUrl(), null);
            } catch (Exception groupError) {
                // 2. Nếu bị lỗi do không tìm thấy ô đăng bài lúc runtime (vừa bị kick) ➔ Thử fallback
                if (groupError.getMessage() != null && groupError.getMessage().contains("chưa gia nhập Group") && activeTargetGroup.getFallbackGroupId() != null) {
                    SocialAccount fallback = socialAccountRepository.findById(activeTargetGroup.getFallbackGroupId()).orElse(null);
                    if (fallback != null) {
                        try {
                            log.info("🔀 [GroupHealth] Phát hiện bị Kick lúc đăng bài ➔ Thử đăng vào Group dự phòng '{}' (ID: {})...",
                                    fallback.getPageName(), fallback.getPlatformAccountId());
                            GroupPublishResult fallbackResult = sendToFacebookGroupWorker(pageAccount, content, mediaUrls, post.getOriginalUrl(),
                                    fallback.getPlatformAccountId(), post.getAffiliateLink(), isAnonymous, post);
                            if (fallbackResult.postUrl() != null) {
                                groupPostUrls.add(fallbackResult.postUrl());
                            }
                            successCount++;
                            saveGroupResult(post, fallback, "PUBLISHED", fallbackResult.postUrl(), null);
                            // Cập nhật lại cờ sức khỏe cho Group bị kick
                            group.setGroupHealthStatus("KICKED_OR_NOT_JOINED");
                            group.setGroupHealthCheckedAt(java.time.LocalDateTime.now());
                            socialAccountRepository.save(group);
                            continue;
                        } catch (Exception fbErr) {
                            log.error("❌ Lỗi cả trên Group dự phòng {}: {}", fallback.getPageName(), fbErr.getMessage());
                        }
                    }
                }

                log.error("❌ [PAGE→GROUP] Post ID {} lỗi Group {} (ID {}): {}", post.getId(),
                        activeTargetGroup.getPageName(), activeTargetGroup.getPlatformAccountId(), groupError.getMessage());
                failures.add((activeTargetGroup.getPageName() != null ? activeTargetGroup.getPageName() : "Group")
                        + " (" + activeTargetGroup.getPlatformAccountId() + "): " + groupError.getMessage());
                saveGroupResult(post, activeTargetGroup, "FAILED", null, groupError.getMessage());
            }
        }

        if (!groupPostUrls.isEmpty()) {
            post.setPublishedGroupPostUrls(String.join(",", groupPostUrls));
        }

        if (failures.isEmpty()) {
            log.info("✅ [PAGE→GROUP] Post ID {} đã đăng xong vào {}/{} Group.", post.getId(),
                    successCount, selectedByGroupId.size());
            return null;
        }
        return "Bài đã lên Page và " + successCount + "/" + selectedByGroupId.size()
                + " Group; Group lỗi: " + String.join(" | ", failures);
    }

    private String normalizeFacebookName(String value) {
        if (value == null) return "";
        return value.replaceFirst("^[^\\p{L}\\p{N}@]+", "").trim();
    }

    /** Ghi log kết quả đăng vào 1 Group cụ thể — nguồn dữ liệu chính xác để tính KPI theo Group (khác targetGroupNames/publishedGroupPostUrls không đảm bảo khớp thứ tự). */
    private void saveGroupResult(PostQueue post, SocialAccount groupAccount, String status, String postUrl, String errorMessage) {
        if (post == null || groupAccount == null) return;
        LocalDateTime attemptedAt = LocalDateTime.now();

        try {
            if ("PUBLISHED".equalsIgnoreCase(status)) {
                try {
                    List<PostQueueGroupResult> oldFailed = postQueueGroupResultRepository.findByPostQueue_IdOrderByAttemptedAtDesc(post.getId())
                            .stream()
                            .filter(r -> r.getSocialAccount() != null && groupAccount.getId().equals(r.getSocialAccount().getId()))
                            .filter(r -> "FAILED".equalsIgnoreCase(r.getStatus()))
                            .toList();
                    if (!oldFailed.isEmpty()) {
                        postQueueGroupResultRepository.deleteAll(oldFailed);
                    }
                } catch (Exception ignored) {}
            }

            postQueueGroupResultRepository.save(PostQueueGroupResult.builder()
                    .postQueue(post)
                    .socialAccount(groupAccount)
                    .status(status)
                    .postUrl(postUrl)
                    .errorMessage(errorMessage)
                    .attemptedAt(attemptedAt)
                    .build());
            // Một bài Page + nhiều Group có thể chạy khá lâu. Cập nhật heartbeat sau từng Group để bộ
            // phục hồi không hiểu nhầm một tiến trình còn sống là bài bị treo.
            postQueueRepository.touchProcessing(post.getId(), attemptedAt);
        } catch (Exception ex) {
            log.warn("⚠️ Không lưu được PostQueueGroupResult cho Post ID {} (không ảnh hưởng đến kết quả bài đăng): {}", post.getId(), ex.getMessage());
        }
    }

    /** Resolve SocialAccount (FACEBOOK_GROUP) theo platformAccountId — dùng để ghi log kết quả đăng đường GROUP_ONLY. */
    private SocialAccount resolveGroupAccountById(Long userId, String targetGroupId) {
        if (targetGroupId == null || targetGroupId.trim().isEmpty()) return null;
        String id = targetGroupId.trim();
        List<SocialAccount> accounts = userId != null ? socialAccountRepository.findByUserId(userId) : socialAccountRepository.findAll();
        return accounts.stream()
                .filter(a -> "FACEBOOK_GROUP".equals(a.getPlatform()))
                .filter(a -> id.equals(a.getPlatformAccountId()))
                .findFirst()
                .orElse(null);
    }

    /**
     * Đăng bài vào 1 Group Facebook dưới danh nghĩa 1 Fanpage (khác với đăng lên tường Fanpage bình
     * thường). Bắt buộc dùng account loại PERSONAL_COOKIE (cookie tài khoản cá nhân quản trị Fanpage
     * đó) vì Facebook Graph API không hỗ trợ đăng bài vào Group cho ứng dụng bên thứ 3. Fanpage cũng
     * phải ĐÃ LÀ THÀNH VIÊN của Group trước (tự thêm trên Facebook, tool không tự làm thay được).
     */
    public String publishToFacebookGroup(SocialAccount account, String content, String mediaUrls, String originalUrl, String targetGroupId) {
        return publishToFacebookGroup(account, content, mediaUrls, originalUrl, targetGroupId, null, null);
    }

    public String publishToFacebookGroup(SocialAccount account, String content, String mediaUrls, String originalUrl, String targetGroupId, String affiliateLink) {
        return publishToFacebookGroup(account, content, mediaUrls, originalUrl, targetGroupId, affiliateLink, null);
    }

    /**
     * post: truyền vào khi có PostQueue đang xử lý (VD: chế độ GROUP_ONLY trong publishPostNow) để tự
     * lưu lại link bài viết thật trên Facebook vào PostQueue.publishedPostUrl cho Lịch sử/Báo cáo.
     * Null nếu gọi từ nơi không có PostQueue để lưu (VD: endpoint đăng nhanh không qua hàng đợi).
     */
    public String publishToFacebookGroup(SocialAccount account, String content, String mediaUrls, String originalUrl, String targetGroupId, String affiliateLink, PostQueue post) {
        return publishToFacebookGroup(account, content, mediaUrls, originalUrl, targetGroupId, affiliateLink, post, false);
    }

    private boolean isCookieAccount(SocialAccount account) {
        if (account == null) return false;
        String type = account.getAccountType();
        String platform = account.getPlatform();
        return "PERSONAL_COOKIE".equalsIgnoreCase(type)
                || "PERSONAL_PROFILE_COOKIE".equalsIgnoreCase(type)
                || "FACEBOOK_PROFILE".equalsIgnoreCase(platform)
                || "FACEBOOK_PERSONAL".equalsIgnoreCase(platform)
                || (account.getAccessToken() != null && account.getAccessToken().contains("c_user="));
    }

    public String publishToFacebookGroup(SocialAccount account, String content, String mediaUrls, String originalUrl, String targetGroupId, String affiliateLink, PostQueue post, boolean isAnonymous) {
        if (!isCookieAccount(account)) {
            throw new IllegalStateException("Đăng vào Group chỉ hỗ trợ tài khoản có Cookie cá nhân (Facebook không cho phép Page Access Token đăng vào Group). Vui lòng kiểm tra lại tài khoản \"" + (account != null ? account.getPageName() : "") + "\".");
        }

        List<String> parsedMediaUrls = parseMediaUrls(mediaUrls);
        log.info("📦 [GROUP] Gửi {} media trong cùng một bài Group (isAnonymous={}).", parsedMediaUrls.size(), isAnonymous);
        Long userId = (post != null && post.getCampaign() != null && post.getCampaign().getUser() != null)
                ? post.getCampaign().getUser().getId()
                : (account.getUser() != null ? account.getUser().getId() : null);
        SocialAccount groupAccount = resolveGroupAccountById(userId, targetGroupId);
        try {
            GroupPublishResult result = sendToFacebookGroupWorker(account, content, parsedMediaUrls, originalUrl, targetGroupId, affiliateLink, isAnonymous, post);
            if (post != null && result.postUrl() != null) {
                post.setPublishedPostUrl(result.postUrl());
            }
            saveGroupResult(post, groupAccount, "PUBLISHED", result.postUrl(), null);
            return result.warning();
        } catch (RuntimeException e) {
            saveGroupResult(post, groupAccount, "FAILED", null, e.getMessage());
            throw e;
        }
    }

    /** Kết quả gọi worker đăng bài vào Group: cảnh báo (nếu có) + link bài viết thật vừa đăng (nếu dò được). */
    private record GroupPublishResult(String warning, String postUrl) {}

    private GroupPublishResult sendToFacebookGroupWorker(SocialAccount account, String content, List<String> mediaUrls,
                                            String originalUrl, String targetGroupId, String affiliateLink) {
        return sendToFacebookGroupWorker(account, content, mediaUrls, originalUrl, targetGroupId, affiliateLink, false, null);
    }

    private GroupPublishResult sendToFacebookGroupWorker(SocialAccount account, String content, List<String> mediaUrls,
                                            String originalUrl, String targetGroupId, String affiliateLink, boolean isAnonymous) {
        return sendToFacebookGroupWorker(account, content, mediaUrls, originalUrl, targetGroupId, affiliateLink, isAnonymous, null);
    }

    private GroupPublishResult sendToFacebookGroupWorker(SocialAccount account, String content, List<String> mediaUrls,
                                            String originalUrl, String targetGroupId, String affiliateLink, boolean isAnonymous, PostQueue post) {
        String playwrightUrl = workerRouterService.getPostingWorkerUrl("/api/post-facebook-group");
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);

        boolean isExplicitPersonal = (post != null && post.getTargetFanpageId() != null && post.getTargetFanpageId().contains("PERSONAL_PROFILE"))
                || (account != null && ("FACEBOOK_PERSONAL".equalsIgnoreCase(account.getPlatform()) || "FACEBOOK_PROFILE".equalsIgnoreCase(account.getPlatform())))
                || (account != null && "PERSONAL_PROFILE".equalsIgnoreCase(account.getPlatformAccountId()))
                || (account != null && "PERSONAL_PROFILE_COOKIE".equalsIgnoreCase(account.getAccountType()))
                || (account != null && account.getPageName() != null && account.getPageName().toLowerCase().contains("cá nhân"));

        SocialAccount effectiveAccount = account;
        if (!isExplicitPersonal && (effectiveAccount == null || "FACEBOOK_GROUP".equalsIgnoreCase(effectiveAccount.getPlatform())) && targetGroupId != null && !targetGroupId.isBlank()) {
            Long userId = (account != null && account.getUser() != null) ? account.getUser().getId() : null;
            SocialAccount groupAcc = resolveGroupAccountById(userId, targetGroupId);
            if (groupAcc != null && groupAcc.getPostingIdentityAccountId() != null) {
                SocialAccount groupIdentityAcc = socialAccountRepository.findById(groupAcc.getPostingIdentityAccountId()).orElse(null);
                if (groupIdentityAcc != null && !"EXPIRED".equalsIgnoreCase(groupIdentityAcc.getTokenStatus())) {
                    log.info("🎯 [GroupPosting] Bài viết chưa chỉ định Fanpage — tự động dùng danh tính mặc định của Group '{}' là Page '{}' (ID: {})",
                            groupAcc.getPageName(), groupIdentityAcc.getPageName(), groupIdentityAcc.getPlatformAccountId());
                    effectiveAccount = groupIdentityAcc;
                }
            }
        }

        String cookieString = effectiveAccount != null ? effectiveAccount.getAccessToken() : null;
        if (cookieString == null || !cookieString.contains("c_user=")) {
            Long userId = effectiveAccount != null && effectiveAccount.getUser() != null ? effectiveAccount.getUser().getId() : (account != null && account.getUser() != null ? account.getUser().getId() : null);
            if (userId != null) {
                List<SocialAccount> cookieAccounts = socialAccountRepository.findByUserId(userId).stream()
                        .filter(a -> a.getAccessToken() != null && a.getAccessToken().contains("c_user="))
                        .filter(a -> !"EXPIRED".equalsIgnoreCase(a.getTokenStatus()))
                        .toList();
                if (cookieAccounts.size() == 1) {
                    cookieString = cookieAccounts.get(0).getAccessToken();
                } else if (cookieAccounts.size() > 1) {
                    String candidateList = cookieAccounts.stream()
                            .map(a -> a.getId() + " (" + (a.getPageName() != null ? a.getPageName() : "?") + ")")
                            .collect(java.util.stream.Collectors.joining(", "));
                    throw new IllegalStateException("Có " + cookieAccounts.size()
                            + " tài khoản cá nhân đã kết nối (" + candidateList
                            + ") — không thể tự chọn account nào là thành viên của Group '" + targetGroupId
                            + "' để đăng. Vui lòng vào trang Kết nối, mở Group này và chọn rõ 'Danh tính đăng bài' (posting identity).");
                }
            }
        }

        Map<String, Object> requestBody = new HashMap<>();
        requestBody.put("cookieString", cookieString);
        requestBody.put("targetGroupId", targetGroupId);
        requestBody.put("isAnonymous", isAnonymous);
        // Status nền đỏ: Group không có mẹo 3 chấm như Fanpage nên RED_PHOTO_TRICK cũng đăng thẳng dạng nền đỏ thuần chữ.
        String groupPostType = post != null ? post.getPostType() : null;
        if ("COLOR_BACKGROUND".equalsIgnoreCase(groupPostType) || "RED_PHOTO_TRICK".equalsIgnoreCase(groupPostType)) {
            requestBody.put("postType", "COLOR_BACKGROUND");
            requestBody.put("backgroundColor", "RED");
        }

        boolean isPersonal = isExplicitPersonal || isAnonymous
                || (effectiveAccount != null && ("FACEBOOK_PERSONAL".equalsIgnoreCase(effectiveAccount.getPlatform()) || "FACEBOOK_PROFILE".equalsIgnoreCase(effectiveAccount.getPlatform())))
                || (effectiveAccount != null && "PERSONAL_PROFILE".equalsIgnoreCase(effectiveAccount.getPlatformAccountId()))
                || (effectiveAccount != null && "PERSONAL_PROFILE_COOKIE".equalsIgnoreCase(effectiveAccount.getAccountType()))
                || (effectiveAccount != null && effectiveAccount.getPageName() != null && effectiveAccount.getPageName().toLowerCase().contains("cá nhân"));

        if (isPersonal) {
            requestBody.put("isPersonalProfile", true);
            String personalName = (effectiveAccount != null && effectiveAccount.getPageName() != null && !effectiveAccount.getPageName().isBlank())
                    ? effectiveAccount.getPageName()
                    : (account != null && account.getPageName() != null ? account.getPageName() : "Nick cá nhân");
            requestBody.put("pageName", personalName);
            requestBody.put("targetProfileName", personalName);
            requestBody.put("pageId", "PERSONAL_PROFILE");
            requestBody.put("targetFanpageId", "PERSONAL_PROFILE");
        } else {
            requestBody.put("pageName", effectiveAccount != null ? effectiveAccount.getPageName() : "Trang Facebook");
            requestBody.put("pageId", effectiveAccount != null ? effectiveAccount.getPlatformAccountId() : null);
            requestBody.put("targetFanpageId", effectiveAccount != null ? effectiveAccount.getPlatformAccountId() : null);
        }

        requestBody.put("socialAccountId", String.valueOf(effectiveAccount != null ? effectiveAccount.getId() : (account != null ? account.getId() : "")));
        SocialAccount proxyAccount = effectiveAccount != null ? effectiveAccount : account;
        if (proxyAccount != null && proxyAccount.getProxyUrl() != null && !proxyAccount.getProxyUrl().isBlank()) {
            requestBody.put("proxyUrl", proxyAccount.getProxyUrl().trim());
        }
        if (proxyAccount != null && proxyAccount.getUserAgent() != null && !proxyAccount.getUserAgent().isBlank()) {
            requestBody.put("userAgent", proxyAccount.getUserAgent().trim());
        }
        requestBody.put("content", content);
        if (!mediaUrls.isEmpty()) {
            requestBody.put("mediaUrls", mediaUrls);
        }
        if (originalUrl != null) {
            requestBody.put("originalUrl", originalUrl);
        }
        if (affiliateLink != null && !affiliateLink.trim().isEmpty()) {
            requestBody.put("affiliateLink", affiliateLink.trim());
        }
        // Bình luận link vào bài trong Nhóm là opt-in: chỉ bật khi người dùng tick ở giao diện
        // (PostQueue.enableGroupComment), khác với leg Fanpage vốn tự bình luận mặc định.
        requestBody.put("enableGroupComment", post != null && Boolean.TRUE.equals(post.getEnableGroupComment()));

        HttpEntity<Map<String, Object>> request = new HttpEntity<>(requestBody, headers);
        try {
            Map<?, ?> resp = postToWorkerWithConnectionRetry(playwrightUrl, request);
            String warning = resp != null && resp.get("warning") != null ? resp.get("warning").toString() : null;
            String postUrl = resp != null && resp.get("groupPostUrl") != null ? resp.get("groupPostUrl").toString() : null;
            return new GroupPublishResult(warning, postUrl);
        } catch (Exception e) {
            throw new RuntimeException("Lỗi Playwright Worker: " + e.getMessage(), e);
        }
    }

    // Lỗi kết nối (ResourceAccessException/Connection refused) xảy ra khi request còn chưa tới được
    // worker — nghĩa là Playwright chắc chắn CHƯA mở trình duyệt/bấm Đăng, nên thử lại 1 lần sau vài
    // giây là an toàn tuyệt đối (không có rủi ro đăng trùng). Ca hay gặp: worker vừa restart/respawn.
    // NGƯỢC LẠI, timeout đọc phản hồi (SocketTimeoutException) nghĩa là request ĐÃ tới worker và
    // worker CÓ THỂ đang thật sự đăng bài dở dang — retry ở đây sẽ gửi thêm 1 request đăng bài y hệt
    // trong lúc worker vẫn có thể đang chạy, dễ tạo ra 2 phiên Playwright cùng đăng 1 nội dung -> đăng
    // trùng. Nên KHÔNG retry khi timeout, chỉ ném lỗi để publishPostNow() xử lý riêng (xem
    // isAmbiguousWorkerTimeout()) — để nguyên PROCESSING, chờ recoverStaleProcessingPosts() xác minh.
    // Số lần thử lại khi KHÔNG kết nối được worker (Connection refused) — worker vừa restart/respawn
    // có thể mất hơn vài giây để mở cổng lại (đặc biệt lúc nhiều tiến trình worker tranh port lẫn nhau),
    // 1 lần retry 5s cũ hay không đủ. Tăng lên 4 lần thử với backoff tăng dần, tổng chờ tối đa ~29s.
    private static final int[] WORKER_CONNECTION_RETRY_DELAYS_MS = { 5000, 8000, 8000, 8000 };

    private Map<?, ?> postToWorkerWithConnectionRetry(String playwrightUrl, HttpEntity<Map<String, Object>> request) {
        Long currentPostId = CURRENT_POST_ID.get();
        if (currentPostId != null) {
            HttpHeaders tagged = new HttpHeaders();
            tagged.putAll(request.getHeaders());
            tagged.set("X-Post-Queue-Id", String.valueOf(currentPostId));
            request = new HttpEntity<>(request.getBody(), tagged);
        }
        for (int attempt = 0; ; attempt++) {
            try {
                return restTemplate.postForObject(playwrightUrl, request, Map.class);
            } catch (ResourceAccessException e) {
                if (e.getCause() instanceof SocketTimeoutException) {
                    throw e;
                }
                if (attempt >= WORKER_CONNECTION_RETRY_DELAYS_MS.length) {
                    throw e;
                }
                int delayMs = WORKER_CONNECTION_RETRY_DELAYS_MS[attempt];
                log.warn("⚠️ Không kết nối được Playwright Worker ({}), thử lại lần {}/{} sau {}ms...",
                        e.getMessage(), attempt + 1, WORKER_CONNECTION_RETRY_DELAYS_MS.length, delayMs);
                try {
                    Thread.sleep(delayMs);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    throw e;
                }
            }
        }
    }

    // Nhận diện timeout "mập mờ" — request đã gửi tới worker, chưa rõ worker có đăng thành công hay
    // không (khác với lỗi worker trả về rõ ràng, VD "Không thể mở Modal..." — trường hợp đó worker ĐÃ
    // xác nhận thất bại, an toàn để báo FAILED ngay).
    private static boolean isAmbiguousWorkerTimeout(Throwable e) {
        Throwable cur = e;
        while (cur != null) {
            if (cur instanceof SocketTimeoutException) return true;
            cur = cur.getCause();
        }
        return false;
    }

    private boolean isTransientWorkerError(Throwable e) {
        if (e == null) return false;
        String msg = e.getMessage() != null ? e.getMessage() : "";
        if (isCredentialFailure(msg)) return false;
        String lower = msg.toLowerCase();
        if (lower.contains("không khớp") || lower.contains("chưa kết nối") || lower.contains("không có nội dung")
                || lower.contains("chưa gia nhập") || lower.contains("bị cấm") || lower.contains("targetfanpageid")) {
            return false;
        }
        return true;
    }

    public static String formatFriendlyErrorMessage(String raw) {
        if (raw == null || raw.isBlank()) return "Lỗi không xác định khi đăng bài.";
        String lower = raw.toLowerCase();
        if (lower.contains("c_user") || lower.contains("i_user") || lower.contains("session expired") || lower.contains("checkpoint") || lower.contains("invalid token") || lower.contains("hết hạn")) {
            return "Phiên đăng nhập Facebook (Cookie/Token) đã hết hạn hoặc bị gỡ. Vui lòng kết nối lại tài khoản.";
        }
        if (lower.contains("spam") || lower.contains("giới hạn tần suất") || lower.contains("để bảo vệ cộng đồng")) {
            return "Facebook đang tạm chặn đăng bài do giới hạn tần suất (Spam Limit): \"Để bảo vệ cộng đồng khỏi spam, chúng tôi giới hạn tần suất bạn đăng bài...\". Hệ thống đã tự dời lịch đăng lại sau.";
        }
        if (lower.contains("chưa gia nhập") || lower.contains("không tìm thấy ô đăng") || lower.contains("not member") || lower.contains("thành viên")) {
            return "Không tìm thấy ô đăng bài trong Nhóm — Danh tính cá nhân hoặc Fanpage chưa gia nhập hoặc chưa được duyệt thành viên trong Nhóm này.";
        }
        if (lower.contains("không thể tải file") || lower.contains("cdn") || lower.contains("hỏng media") || lower.contains("0/")) {
            return "Không thể tải file Video/Ảnh từ CDN lưu trữ. Đường dẫn media gốc có thể bị lỗi hoặc hỏng.";
        }
        if (lower.contains("timeout") || lower.contains("waiting for locator") || lower.contains("waiting for selector")) {
            return "Giao diện Facebook phản hồi chậm hoặc có thay đổi làm hết thời gian chờ nút tương tác (" + raw + ").";
        }
        return raw;
    }


    public void publishStoryViaWorker(SocialAccount account, String mediaUrl, String originalUrl) {
        publishStoryViaWorker(account, mediaUrl, originalUrl, null);
    }

    public void publishStoryViaWorker(SocialAccount account, String mediaUrl, String originalUrl, String affiliateLink) {
        String playwrightUrl = workerRouterService.getPostingWorkerUrl("/api/post-story");
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);

        String cookieString = account.getAccessToken();
        if (!"PERSONAL_COOKIE".equals(account.getAccountType()) && account.getUser() != null) {
            List<SocialAccount> cookieAccounts = socialAccountRepository.findByUserId(account.getUser().getId())
                    .stream()
                    .filter(a -> "PERSONAL_COOKIE".equals(a.getAccountType()))
                    .toList();
            if (!cookieAccounts.isEmpty()) {
                cookieString = cookieAccounts.get(0).getAccessToken();
            }
        }

        Map<String, Object> requestBody = new HashMap<>();
        requestBody.put("cookieString", cookieString);
        requestBody.put("targetFanpageId", account.getPlatformAccountId());
        if (mediaUrl != null) {
            requestBody.put("mediaUrls", List.of(mediaUrl));
        }
        if (originalUrl != null) {
            requestBody.put("originalUrl", originalUrl);
        }
        if (affiliateLink != null && !affiliateLink.trim().isEmpty()) {
            requestBody.put("affiliateLink", affiliateLink.trim());
        }

        log.info("🚀 Gửi yêu cầu Đăng Story sang Playwright Worker cho Fanpage {} ({})", account.getPageName(), account.getPlatformAccountId());
        HttpEntity<Map<String, Object>> request = new HttpEntity<>(requestBody, headers);
        WorkerRetryHelper.postWithConnectionRetry(restTemplate, playwrightUrl, request, String.class);
    }

    private static final List<String> VIDEO_EXTENSIONS = List.of(".mp4", ".mov", ".webm");

    private List<String> parseMediaUrls(String mediaUrls) {
        if (mediaUrls == null || mediaUrls.trim().isEmpty()) return List.of();
        String trimmed = mediaUrls.trim();

        if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
            try {
                com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();
                List<String> list = mapper.readValue(trimmed, new com.fasterxml.jackson.core.type.TypeReference<List<String>>() {});
                return list.stream().filter(s -> s != null && !s.trim().isEmpty()).map(String::trim).toList();
            } catch (Exception ignored) {}
        }

        return Arrays.stream(trimmed.split(","))
                .map(String::trim)
                .map(s -> s.replaceAll("^[\"\\[\\]']+|[\"\\[\\]']+$", "").trim())
                .filter(s -> !s.isEmpty() && s.startsWith("http"))
                .toList();
    }

    private boolean isVideoUrl(String url) {
        if (url == null || url.trim().isEmpty()) return false;
        String lower = url.toLowerCase();
        return lower.contains(".mp4") || lower.contains(".mov") || lower.contains(".webm")
                || lower.contains("/video/") || lower.contains("/v/t16/") || lower.contains("video")
                || lower.contains("/m84/") || lower.contains("/m86/") || lower.contains("/o1/v/");
    }

    /**
     * Chuyển 1 bài đăng ở trạng thái FAILED sang PENDING để thử đăng lại.
     */
    @Transactional
    public PostQueue resetFailedPost(Long id) {
        PostQueue post = postQueueRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Không tìm thấy bài viết #" + id));
        post.setStatus("PENDING");
        post.setErrorMessage(null);
        post.setRetryCount(0);
        post.setScheduledAt(LocalDateTime.now());
        return postQueueRepository.save(post);
    }

    /**
     * Chuyển danh sách (hoặc tất cả) bài đăng lỗi FAILED sang PENDING để thử đăng lại.
     */
    /**
     * Chuyển danh sách (hoặc tất cả) bài đăng lỗi FAILED sang PENDING để thử đăng lại.
     */
    @Transactional
    public int resetFailedPostsBatch(List<Long> ids) {
        return resetFailedPostsBatch(ids, 900, null);
    }

    /**
     * Chuyển danh sách (hoặc tất cả) bài đăng lỗi FAILED sang PENDING với tuỳ chọn giãn cách hoặc hạn chót trong ngày.
     */
    @Transactional
    public int resetFailedPostsBatch(List<Long> ids, Integer spacingSeconds, String targetDeadline) {
        List<PostQueue> failedPosts;
        if (ids != null && !ids.isEmpty()) {
            failedPosts = postQueueRepository.findAllById(ids).stream()
                    .filter(p -> "FAILED".equals(p.getStatus()))
                    .sorted(Comparator.comparing(PostQueue::getId))
                    .toList();
        } else {
            failedPosts = postQueueRepository.findByStatusOrderByIdAsc("FAILED");
        }
        if (failedPosts.isEmpty()) {
            return 0;
        }

        LocalDateTime now = LocalDateTime.now();
        int step = (spacingSeconds != null && spacingSeconds > 0) ? spacingSeconds : 900;

        // Nếu người dùng chọn hạn chót trước 23h hôm nay
        if ("TODAY_23H".equalsIgnoreCase(targetDeadline)) {
            LocalDateTime endOfToday = now.withHour(22).withMinute(55).withSecond(0);
            if (endOfToday.isAfter(now)) {
                long totalSeconds = java.time.Duration.between(now, endOfToday).getSeconds();
                step = Math.max(600, (int) (totalSeconds / failedPosts.size()));
            }
        }

        LocalDateTime cursor = now;
        for (int i = 0; i < failedPosts.size(); i++) {
            PostQueue post = failedPosts.get(i);
            post.setStatus("PENDING");
            post.setErrorMessage(null);
            post.setRetryCount(0);
            post.setScheduledAt(cursor);
            cursor = cursor.plusSeconds(step);
        }
        postQueueRepository.saveAll(failedPosts);

        // Xóa sạch các group result FAILED cũ của các bài này để giao diện không còn báo lỗi Group sót lại
        for (PostQueue post : failedPosts) {
            try {
                postQueueGroupResultRepository.deleteByPostQueue_Id(post.getId());
            } catch (Exception ignored) {}
        }

        log.info("🔄 [Reset Failed] Đã chuyển thành công {} bài lỗi về PENDING với bước nhảy {}s/bài.", failedPosts.size(), step);
        return failedPosts.size();
    }
}
