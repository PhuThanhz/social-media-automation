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
import com.autopost.saas.service.GeminiService;
import com.autopost.saas.service.ScraperService;
import com.autopost.saas.util.PooledRestTemplateFactory;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;

import java.time.LocalDateTime;
import java.util.*;

/**
 * API riêng cho trang "Threads Studio": quản lý nick Threads, soạn/hẹn giờ bài, lịch sử đăng.
 * Bài tạo ở đây vẫn là PostQueue bình thường (postType=THREADS, targetFanpageId
 * "username:THREADS_COOKIE:connectionId") nên CampaignScheduler tự đăng đúng giờ và tự retry khi lỗi
 * qua nhánh Threads trong PostQueueService.publishPostNow().
 */
@RestController
@RequestMapping("/api/threads")
@RequiredArgsConstructor
@Slf4j
@CrossOrigin(originPatterns = "*")
public class ThreadsController {

    private static final String QUICK_POST_CAMPAIGN_NAME = "Quick Posts";
    private static final String THREADS_ACCOUNT_TYPE = "THREADS_COOKIE";
    private static final int MAX_MEDIA = 10;

    private final SocialAccountRepository socialAccountRepository;
    private final PostQueueRepository postQueueRepository;
    private final CampaignRepository campaignRepository;
    private final UserRepository userRepository;
    private final GeminiService geminiService;
    private final ScraperService scraperService;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final RestTemplate restTemplate = PooledRestTemplateFactory.create(10000, 120000);

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
                .orElseGet(() -> campaignRepository.save(Campaign.builder()
                        .user(user)
                        .name(QUICK_POST_CAMPAIGN_NAME)
                        .sourceType("DIRECT_LINK")
                        .sourceUrl("")
                        .aiRewriteEnabled(false)
                        .postingIntervalMinutes(60)
                        .cronExpression("MANUAL")
                        .status("ACTIVE")
                        .build()));
    }

    private static boolean isThreadsAccount(SocialAccount a) {
        return "THREADS".equalsIgnoreCase(a.getPlatform()) || THREADS_ACCOUNT_TYPE.equalsIgnoreCase(a.getAccountType());
    }

    private List<SocialAccount> threadsAccounts(User user) {
        return socialAccountRepository.findByUserId(user.getId()).stream()
                .filter(ThreadsController::isThreadsAccount)
                .sorted(Comparator.comparing(SocialAccount::getId))
                .toList();
    }

    private Optional<SocialAccount> findOwnedThreadsAccount(User user, Long accountId) {
        return threadsAccounts(user).stream().filter(a -> a.getId().equals(accountId)).findFirst();
    }

    private static Long connectionIdOf(PostQueue post) {
        String target = post.getTargetFanpageId();
        if (target == null) return null;
        String[] parts = target.split(":", -1);
        if (parts.length < 3) return null;
        try {
            return Long.valueOf(parts[2].trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private Map<String, Object> accountDto(SocialAccount a) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", a.getId());
        m.put("pageName", a.getPageName());
        m.put("username", a.getPlatformAccountId());
        m.put("tokenStatus", a.getTokenStatus());
        m.put("tokenCheckedAt", a.getTokenCheckedAt());
        m.put("maxPostsPerDay", a.getMaxPostsPerDay());
        return m;
    }

    private List<String> parseMedia(String raw) {
        if (raw == null || raw.isBlank()) return List.of();
        try {
            return Arrays.asList(objectMapper.readValue(raw, String[].class));
        } catch (JsonProcessingException e) {
            return Arrays.stream(raw.split(",")).map(String::trim).filter(s -> !s.isEmpty()).toList();
        }
    }

    private Map<String, Object> postDto(PostQueue p) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", p.getId());
        m.put("accountId", connectionIdOf(p));
        m.put("content", p.getContent());
        m.put("mediaUrls", parseMedia(p.getMediaUrls()));
        m.put("originalUrl", p.getOriginalUrl());
        m.put("status", p.getStatus());
        m.put("scheduledAt", p.getScheduledAt());
        m.put("publishedAt", p.getPublishedAt());
        m.put("publishedPostUrl", p.getPublishedPostUrl());
        m.put("errorMessage", p.getErrorMessage());
        m.put("executionDurationSeconds", p.getExecutionDurationSeconds());
        m.put("retryCount", p.getRetryCount());
        m.put("createdAt", p.getCreatedAt());
        return m;
    }

    @GetMapping("/accounts")
    public List<Map<String, Object>> listAccounts(Authentication authentication) {
        return threadsAccounts(resolveUser(authentication)).stream().map(this::accountDto).toList();
    }

    /** Mở Threads bằng cookie của nick để kiểm tra còn đăng nhập + lấy tên/avatar/follower thật. */
    @PostMapping("/accounts/{id}/check")
    public ResponseEntity<Map<String, Object>> checkAccount(@PathVariable Long id, Authentication authentication) {
        User user = resolveUser(authentication);
        SocialAccount account = findOwnedThreadsAccount(user, id).orElse(null);
        if (account == null) {
            return ResponseEntity.status(404).body(Map.of("success", false, "message", "Không tìm thấy nick Threads này"));
        }
        Map<?, ?> info;
        try {
            info = restTemplate.postForObject(LocalServices.WORKER_BASE + "/api/threads-account-info",
                    Map.of("cookieString", account.getAccessToken() == null ? "" : account.getAccessToken()), Map.class);
        } catch (Exception e) {
            log.warn("🧵 Kiểm tra nick Threads {} thất bại: {}", id, e.getMessage());
            return ResponseEntity.status(502).body(Map.of("success", false, "message", "Không gọi được Playwright Worker: " + e.getMessage()));
        }
        if (info == null) {
            return ResponseEntity.status(502).body(Map.of("success", false, "message", "Worker không trả dữ liệu"));
        }

        boolean loggedIn = Boolean.TRUE.equals(info.get("loggedIn"));
        account.setTokenStatus(loggedIn ? "OK" : "EXPIRED");
        if (loggedIn && info.get("cookieString") instanceof String fresh && !fresh.isBlank()) {
            account.setAccessToken(fresh);
        }
        account.setTokenCheckedAt(LocalDateTime.now());
        if (loggedIn && info.get("username") != null) {
            String username = info.get("username").toString();
            account.setPlatformAccountId(username);
            if (account.getPageName() == null || account.getPageName().isBlank() || account.getPageName().startsWith("Threads @")) {
                Object fullName = info.get("fullName");
                account.setPageName(fullName != null ? fullName.toString() : "Threads @" + username);
            }
        }
        socialAccountRepository.save(account);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("success", true);
        result.put("account", accountDto(account));
        Map<String, Object> safeInfo = new LinkedHashMap<>();
        info.forEach((k, v) -> { if (!"cookieString".equals(k)) safeInfo.put(String.valueOf(k), v); });
        result.put("info", safeInfo);
        return ResponseEntity.ok(result);
    }

    /** Tạo mới hoặc cập nhật nick Threads theo username (hoặc theo accountId khi đăng nhập lại cho 1 nick cụ thể). */
    private SocialAccount upsertThreadsAccount(User user, Long accountId, String username, String fullName, String cookieString) {
        SocialAccount account = null;
        if (accountId != null) {
            account = findOwnedThreadsAccount(user, accountId).orElse(null);
        }
        if (account == null && username != null) {
            account = threadsAccounts(user).stream()
                    .filter(a -> username.equalsIgnoreCase(a.getPlatformAccountId()))
                    .findFirst().orElse(null);
        }
        if (account == null) {
            account = new SocialAccount();
            account.setUser(user);
            account.setPlatform("THREADS");
            account.setAccountType(THREADS_ACCOUNT_TYPE);
        }
        if (username != null) account.setPlatformAccountId(username);
        if (account.getPageName() == null || account.getPageName().isBlank() || account.getPageName().startsWith("Threads @")) {
            account.setPageName(fullName != null && !fullName.isBlank() ? fullName : "Threads @" + username);
        }
        account.setAccessToken(cookieString);
        account.setTokenStatus("OK");
        account.setTokenCheckedAt(LocalDateTime.now());
        return socialAccountRepository.save(account);
    }

    private Map<?, ?> fetchAccountInfo(String cookieString) {
        return restTemplate.postForObject(LocalServices.WORKER_BASE + "/api/threads-account-info",
                Map.of("cookieString", cookieString), Map.class);
    }

    /** Thêm (hoặc cập nhật) nick bằng chuỗi cookie dán tay — kiểm tra cookie thật trước khi lưu. Body: {cookieString, accountId?}. */
    @PostMapping("/accounts")
    public ResponseEntity<Map<String, Object>> addByCookie(@RequestBody Map<String, Object> body, Authentication authentication) {
        String cookie = body.get("cookieString") != null ? body.get("cookieString").toString().trim() : "";
        if (!cookie.contains("sessionid=")) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", "Chuỗi cookie phải có sessionid=... (copy đủ các cookie của threads.com)"));
        }
        Map<?, ?> info;
        try {
            info = fetchAccountInfo(cookie);
        } catch (Exception e) {
            return ResponseEntity.status(502).body(Map.of("success", false, "message", "Không gọi được Playwright Worker: " + e.getMessage()));
        }
        if (info == null || !Boolean.TRUE.equals(info.get("loggedIn"))) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", "Cookie không đăng nhập được Threads (sai hoặc đã hết hạn)."));
        }
        Long accountId = body.get("accountId") != null ? Long.valueOf(String.valueOf(body.get("accountId"))) : null;
        String fresh = info.get("cookieString") instanceof String f && !f.isBlank() ? f : cookie;
        SocialAccount saved = upsertThreadsAccount(resolveUser(authentication), accountId,
                String.valueOf(info.get("username")), info.get("fullName") != null ? info.get("fullName").toString() : null, fresh);
        log.info("🧵 Đã lưu nick Threads @{} (ID {}) bằng cookie", saved.getPlatformAccountId(), saved.getId());
        return ResponseEntity.ok(Map.of("success", true, "account", accountDto(saved)));
    }

    private static String cookieValue(String cookieString, String name) {
        if (cookieString == null) return null;
        for (String pair : cookieString.split(";")) {
            String[] kv = pair.trim().split("=", 2);
            if (kv.length == 2 && kv[0].trim().equals(name)) return kv[1].trim();
        }
        return null;
    }

    /**
     * Extension Chrome gửi cookie Threads của trình duyệt người dùng (đang đăng nhập sẵn) — gọi mỗi khi cookie
     * đổi hoặc định kỳ. Nếu đã có nick cùng ds_user_id thì chỉ cập nhật cookie (nhanh, không mở trình duyệt);
     * nick mới thì kiểm tra qua worker rồi tạo như addByCookie. Body: {cookieString}.
     */
    @PostMapping("/accounts/sync-cookie")
    public ResponseEntity<Map<String, Object>> syncCookie(@RequestBody Map<String, Object> body, Authentication authentication) {
        String cookie = body.get("cookieString") != null ? body.get("cookieString").toString().trim() : "";
        String dsUserId = cookieValue(cookie, "ds_user_id");
        if (cookieValue(cookie, "sessionid") == null || dsUserId == null) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", "Chrome chưa đăng nhập Threads (thiếu sessionid/ds_user_id)"));
        }
        User user = resolveUser(authentication);
        SocialAccount existing = threadsAccounts(user).stream()
                .filter(a -> dsUserId.equals(cookieValue(a.getAccessToken(), "ds_user_id")))
                .findFirst().orElse(null);
        if (existing == null) {
            return addByCookie(Map.of("cookieString", cookie), authentication);
        }
        boolean changed = !cookie.equals(existing.getAccessToken()) || !"OK".equalsIgnoreCase(existing.getTokenStatus());
        if (changed) {
            existing.setAccessToken(cookie);
            existing.setTokenStatus("OK");
            existing.setTokenCheckedAt(LocalDateTime.now());
            socialAccountRepository.save(existing);
            log.info("🧵 Extension đồng bộ cookie mới cho nick Threads @{} (ID {})", existing.getPlatformAccountId(), existing.getId());
        }
        return ResponseEntity.ok(Map.of("success", true, "changed", changed, "account", accountDto(existing)));
    }

    /** Mở cửa sổ Chrome thật trên máy chạy worker để người dùng tự đăng nhập Threads. Body: {accountId?}. */
    @PostMapping("/login/start")
    public ResponseEntity<Map<String, Object>> startLogin(@RequestBody(required = false) Map<String, Object> body, Authentication authentication) {
        Object rawId = body != null ? body.get("accountId") : null;
        String profileKey = "new";
        if (rawId != null) {
            SocialAccount acc = findOwnedThreadsAccount(resolveUser(authentication), Long.valueOf(String.valueOf(rawId))).orElse(null);
            if (acc == null) {
                return ResponseEntity.status(404).body(Map.of("success", false, "message", "Không tìm thấy nick Threads này"));
            }
            profileKey = "acc" + acc.getId();
        }
        try {
            Map<?, ?> resp = restTemplate.postForObject(LocalServices.WORKER_BASE + "/api/threads-login/start", Map.of("profileKey", profileKey), Map.class);
            return ResponseEntity.ok(Map.of("success", true, "sessionId", String.valueOf(resp != null ? resp.get("sessionId") : "")));
        } catch (org.springframework.web.client.HttpClientErrorException e) {
            return ResponseEntity.status(e.getStatusCode()).body(Map.of("success", false, "message", "Đang có 1 cửa sổ đăng nhập Threads mở sẵn — hoàn tất hoặc đóng nó trước."));
        } catch (Exception e) {
            return ResponseEntity.status(502).body(Map.of("success", false, "message", "Không gọi được Playwright Worker: " + e.getMessage()));
        }
    }

    /** Theo dõi phiên đăng nhập; khi thành công thì lưu cookie vào nick (tạo mới nếu chưa có). */
    @GetMapping("/login/{sessionId}")
    public ResponseEntity<Map<String, Object>> loginStatus(@PathVariable String sessionId, @RequestParam(required = false) Long accountId,
                                                           Authentication authentication) {
        Map<?, ?> resp;
        try {
            resp = restTemplate.getForObject(LocalServices.WORKER_BASE + "/api/threads-login/" + sessionId, Map.class);
        } catch (Exception e) {
            return ResponseEntity.status(502).body(Map.of("success", false, "message", "Không lấy được trạng thái đăng nhập: " + e.getMessage()));
        }
        if (resp == null) {
            return ResponseEntity.status(502).body(Map.of("success", false, "message", "Worker không trả dữ liệu"));
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("success", true);
        result.put("status", resp.get("status"));
        result.put("message", resp.get("message"));
        if ("SUCCESS".equals(resp.get("status")) && resp.get("cookieString") instanceof String cookie) {
            String username = String.valueOf(resp.get("username"));
            String fullName = null;
            try {
                Map<?, ?> info = fetchAccountInfo(cookie);
                if (info != null && info.get("fullName") != null) fullName = info.get("fullName").toString();
            } catch (Exception ignored) { }
            SocialAccount saved = upsertThreadsAccount(resolveUser(authentication), accountId, username, fullName, cookie);
            result.put("account", accountDto(saved));
        }
        return ResponseEntity.ok(result);
    }

    @PostMapping("/login/{sessionId}/cancel")
    public ResponseEntity<Map<String, Object>> cancelLogin(@PathVariable String sessionId) {
        try {
            restTemplate.postForObject(LocalServices.WORKER_BASE + "/api/threads-login/" + sessionId + "/cancel", Map.of(), Map.class);
        } catch (Exception ignored) { }
        return ResponseEntity.ok(Map.of("success", true));
    }

    @GetMapping("/posts")
    public List<Map<String, Object>> listPosts(@RequestParam(required = false) Long accountId, Authentication authentication) {
        Set<Long> ownedIds = new HashSet<>();
        threadsAccounts(resolveUser(authentication)).forEach(a -> ownedIds.add(a.getId()));
        return postQueueRepository.findTop500ByTargetFanpageIdContainingOrderByIdDesc(":" + THREADS_ACCOUNT_TYPE + ":").stream()
                .filter(p -> {
                    Long connId = connectionIdOf(p);
                    return connId != null && ownedIds.contains(connId) && (accountId == null || accountId.equals(connId));
                })
                .map(this::postDto)
                .toList();
    }

    private List<Long> parseIds(Object raw) {
        List<Long> ids = new ArrayList<>();
        if (raw instanceof List<?> list) {
            for (Object o : list) {
                try { ids.add(Long.valueOf(String.valueOf(o))); } catch (NumberFormatException ignored) { }
            }
        } else if (raw != null) {
            try { ids.add(Long.valueOf(String.valueOf(raw))); } catch (NumberFormatException ignored) { }
        }
        return ids.stream().distinct().toList();
    }

    private static int intOf(Object raw, int fallback, int min, int max) {
        try {
            return Math.max(min, Math.min(max, Integer.parseInt(String.valueOf(raw))));
        } catch (Exception e) {
            return fallback;
        }
    }

    private static boolean boolOf(Object raw) {
        return Boolean.TRUE.equals(raw) || "true".equalsIgnoreCase(String.valueOf(raw));
    }

    /** Đọc accountIds, kiểm tra thuộc user & còn hạn. Trả về lỗi (message) nếu không hợp lệ. */
    private Object resolveTargetAccounts(User user, Map<String, Object> body) {
        List<Long> ids = parseIds(body.get("accountIds") != null ? body.get("accountIds") : body.get("accountId"));
        if (ids.isEmpty()) return "Vui lòng chọn ít nhất 1 nick Threads";
        Map<Long, SocialAccount> owned = new HashMap<>();
        threadsAccounts(user).forEach(a -> owned.put(a.getId(), a));
        List<SocialAccount> result = new ArrayList<>();
        for (Long id : ids) {
            SocialAccount acc = owned.get(id);
            if (acc == null) return "Nick Threads #" + id + " không hợp lệ";
            if ("EXPIRED".equalsIgnoreCase(acc.getTokenStatus())) {
                return "Cookie của nick \"" + acc.getPageName() + "\" đã hết hạn — cập nhật cookie ở trang Quản lý kết nối hoặc bỏ chọn nick này.";
            }
            result.add(acc);
        }
        return result;
    }

    private LocalDateTime resolveStartTime(Map<String, Object> body) {
        if (boolOf(body.get("publishNow"))) return LocalDateTime.now();
        Object raw = body.get("scheduledAt");
        if (raw == null || raw.toString().isBlank()) return null;
        try {
            return LocalDateTime.parse(raw.toString());
        } catch (Exception e) {
            return null;
        }
    }

    private PostQueue buildPost(Campaign campaign, SocialAccount account, String content, List<String> mediaUrls,
                                String sourceUrl, LocalDateTime scheduledAt) {
        String mediaJson;
        try {
            mediaJson = mediaUrls.isEmpty() ? null : objectMapper.writeValueAsString(mediaUrls);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Lỗi lưu danh sách media", e);
        }
        String firstLine = content.isEmpty() ? "Bài Threads (media)" : content.split("\n", 2)[0];
        return PostQueue.builder()
                .campaign(campaign)
                .title(firstLine.length() > 120 ? firstLine.substring(0, 120) + "…" : firstLine)
                .content(content)
                .mediaUrls(mediaJson)
                .originalUrl(sourceUrl != null && !sourceUrl.isBlank() ? sourceUrl.trim() : "threads-studio://" + System.nanoTime())
                .status("PENDING")
                .postType("THREADS")
                .targetFanpageId(account.getPlatformAccountId() + ":" + THREADS_ACCOUNT_TYPE + ":" + account.getId())
                .scheduledAt(scheduledAt)
                .build();
    }

    /** AI viết lại để mỗi nick đăng 1 phiên bản khác nhau (tránh Threads coi là spam trùng lặp). Lỗi thì giữ bản gốc. */
    private String varyForAccount(String content) {
        if (content.isBlank() || !geminiService.isConfigured()) return content;
        try {
            String rewritten = geminiService.rewriteForThreads(content, content.codePointCount(0, content.length()) > 450 ? "THREAD" : "REWRITE");
            return rewritten == null || rewritten.isBlank() ? content : rewritten.trim();
        } catch (Exception e) {
            log.warn("🧵 AI viết lại cho nick khác thất bại, giữ nội dung gốc: {}", e.getMessage());
            return content;
        }
    }

    /**
     * Tạo bài Threads cho 1 hoặc NHIỀU nick. Body: {accountIds[] (hoặc accountId), content, mediaUrls[], sourceUrl?,
     * publishNow? | scheduledAt?, staggerMinutes? (giãn cách giữa các nick, mặc định 5), varyContent? (AI viết lại
     * khác nhau cho từng nick)}. "Đăng ngay" = đặt lịch ngay — scheduler quét mỗi 10s sẽ đăng lần lượt từng nick.
     */
    @PostMapping("/posts")
    public ResponseEntity<Map<String, Object>> createPost(@RequestBody Map<String, Object> body, Authentication authentication) {
        User user = resolveUser(authentication);
        Object resolved = resolveTargetAccounts(user, body);
        if (resolved instanceof String error) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", error));
        }
        @SuppressWarnings("unchecked")
        List<SocialAccount> targets = (List<SocialAccount>) resolved;

        String content = body.get("content") != null ? body.get("content").toString().trim() : "";
        List<String> mediaUrls = new ArrayList<>();
        if (body.get("mediaUrls") instanceof List<?> list) {
            for (Object o : list) {
                if (o != null && !o.toString().isBlank()) mediaUrls.add(o.toString().trim());
            }
        }
        if (content.isEmpty() && mediaUrls.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", "Bài viết cần có nội dung hoặc ảnh/video"));
        }
        if (mediaUrls.size() > MAX_MEDIA) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", "Threads chỉ cho tối đa " + MAX_MEDIA + " ảnh/video mỗi bài"));
        }
        LocalDateTime start = resolveStartTime(body);
        if (start == null) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", "Vui lòng chọn giờ đăng hợp lệ hoặc bật Đăng ngay"));
        }
        int stagger = intOf(body.get("staggerMinutes"), 5, 0, 720);
        boolean vary = boolOf(body.get("varyContent"));
        String sourceUrl = body.get("sourceUrl") != null ? body.get("sourceUrl").toString() : null;

        Campaign campaign = resolveQuickPostCampaign(user);
        List<Map<String, Object>> created = new ArrayList<>();
        for (int i = 0; i < targets.size(); i++) {
            SocialAccount account = targets.get(i);
            String accountContent = (vary && i > 0) ? varyForAccount(content) : content;
            PostQueue post = postQueueRepository.save(buildPost(campaign, account, accountContent, mediaUrls, sourceUrl,
                    start.plusMinutes((long) i * stagger)));
            created.add(postDto(post));
            log.info("🧵 [Threads Studio] Tạo Post ID {} cho nick {} lúc {}", post.getId(), account.getPageName(), post.getScheduledAt());
        }
        return ResponseEntity.ok(Map.of("success", true, "count", created.size(), "posts", created));
    }

    /**
     * Đăng hàng loạt từ link cho 1 hoặc nhiều nick. Body: {urls[], accountIds[], mode: ROUND_ROBIN | ALL,
     * intervalMinutes (khoảng cách giữa 2 bài trên CÙNG 1 nick), staggerMinutes (lệch giữa các nick),
     * publishNow? | scheduledAt?, includeCredit?}.
     * - ROUND_ROBIN: chia đều link cho các nick theo vòng (link 1 → nick A, link 2 → nick B...).
     * - ALL: mỗi link đăng lên TẤT CẢ nick (lệch nhau staggerMinutes để không đăng cùng lúc).
     */
    @PostMapping("/bulk")
    public ResponseEntity<Map<String, Object>> bulk(@RequestBody Map<String, Object> body, Authentication authentication) {
        User user = resolveUser(authentication);
        Object resolved = resolveTargetAccounts(user, body);
        if (resolved instanceof String error) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", error));
        }
        @SuppressWarnings("unchecked")
        List<SocialAccount> targets = (List<SocialAccount>) resolved;

        List<String> urls = new ArrayList<>();
        if (body.get("urls") instanceof List<?> list) {
            for (Object o : list) {
                if (o != null && !o.toString().isBlank()) urls.add(o.toString().trim());
            }
        }
        if (urls.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", "Dán ít nhất 1 link"));
        }
        LocalDateTime start = resolveStartTime(body);
        if (start == null) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", "Vui lòng chọn giờ bắt đầu hợp lệ hoặc bật Đăng ngay"));
        }
        boolean allAccounts = "ALL".equalsIgnoreCase(String.valueOf(body.get("mode")));
        int interval = intOf(body.get("intervalMinutes"), 30, 1, 1440);
        int stagger = intOf(body.get("staggerMinutes"), 3, 0, 720);
        boolean includeCredit = boolOf(body.get("includeCredit"));

        Campaign campaign = resolveQuickPostCampaign(user);
        List<Map<String, Object>> created = new ArrayList<>();
        List<Map<String, String>> failed = new ArrayList<>();
        for (int i = 0; i < urls.size(); i++) {
            String url = urls.get(i);
            Map<String, Object> item;
            try {
                String sourceType = url.contains("facebook.com") || url.contains("fb.watch")
                        ? "FB_PAGE"
                        : (url.contains("tiktok.com") || url.contains("douyin.com") ? "TIKTOK" : "WEBSITE_CRAWLER");
                List<Map<String, Object>> items = scraperService.fetchScrapedItems(url, sourceType, 1, includeCredit, null);
                item = items.isEmpty() ? null : items.get(0);
            } catch (Exception e) {
                failed.add(Map.of("url", url, "error", e.getMessage() == null ? "Lỗi cào bài" : e.getMessage()));
                continue;
            }
            if (item == null) {
                failed.add(Map.of("url", url, "error", "Không lấy được nội dung"));
                continue;
            }
            String content = Objects.toString(item.get("content") != null ? item.get("content") : item.get("title"), "").trim();
            List<String> media = new ArrayList<>();
            if (item.get("mediaUrls") instanceof List<?> ml) {
                for (Object o : ml) {
                    if (o != null && !o.toString().isBlank() && media.size() < MAX_MEDIA) media.add(o.toString());
                }
            }
            if (content.isEmpty() && media.isEmpty()) {
                failed.add(Map.of("url", url, "error", "Link không có nội dung hay ảnh/video"));
                continue;
            }

            if (allAccounts) {
                for (int a = 0; a < targets.size(); a++) {
                    LocalDateTime at = start.plusMinutes((long) i * interval + (long) a * stagger);
                    created.add(postDto(postQueueRepository.save(buildPost(campaign, targets.get(a), content, media, url, at))));
                }
            } else {
                int accIdx = i % targets.size();
                int slot = i / targets.size();
                LocalDateTime at = start.plusMinutes((long) slot * interval + (long) accIdx * stagger);
                created.add(postDto(postQueueRepository.save(buildPost(campaign, targets.get(accIdx), content, media, url, at))));
            }
        }
        log.info("🧵 [Threads Studio] Hàng loạt: {} link → {} bài cho {} nick ({}), lỗi {} link",
                urls.size(), created.size(), targets.size(), allAccounts ? "ALL" : "ROUND_ROBIN", failed.size());
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("success", true);
        result.put("count", created.size());
        result.put("posts", created);
        result.put("failed", failed);
        return ResponseEntity.ok(result);
    }

    /** Đặt giới hạn số bài/ngày cho 1 nick (publishPostNow tự dời bài vượt giới hạn sang ngày mai). */
    @PatchMapping("/accounts/{id}")
    public ResponseEntity<Map<String, Object>> updateAccount(@PathVariable Long id, @RequestBody Map<String, Object> body, Authentication authentication) {
        SocialAccount account = findOwnedThreadsAccount(resolveUser(authentication), id).orElse(null);
        if (account == null) {
            return ResponseEntity.status(404).body(Map.of("success", false, "message", "Không tìm thấy nick Threads này"));
        }
        if (body.containsKey("maxPostsPerDay")) {
            Object raw = body.get("maxPostsPerDay");
            account.setMaxPostsPerDay(raw == null || String.valueOf(raw).isBlank() ? null : intOf(raw, 0, 0, 200));
            if (account.getMaxPostsPerDay() != null && account.getMaxPostsPerDay() == 0) account.setMaxPostsPerDay(null);
        }
        socialAccountRepository.save(account);
        return ResponseEntity.ok(Map.of("success", true, "account", accountDto(account)));
    }

    /** Đưa bài lỗi/đã huỷ về hàng đợi để đăng lại ngay (scheduler sẽ nhận trong ~10s). */
    @PostMapping("/posts/{id}/requeue")
    public ResponseEntity<Map<String, Object>> requeue(@PathVariable Long id, Authentication authentication) {
        Set<Long> ownedIds = new HashSet<>();
        threadsAccounts(resolveUser(authentication)).forEach(a -> ownedIds.add(a.getId()));
        PostQueue post = postQueueRepository.findById(id).orElse(null);
        if (post == null || !ownedIds.contains(connectionIdOf(post))) {
            return ResponseEntity.status(404).body(Map.of("success", false, "message", "Không tìm thấy bài Threads này"));
        }
        if ("PROCESSING".equalsIgnoreCase(post.getStatus()) || "PUBLISHED".equalsIgnoreCase(post.getStatus())) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", "Bài này đã/đang được đăng"));
        }
        post.setStatus("PENDING");
        post.setErrorMessage(null);
        post.setScheduledAt(LocalDateTime.now());
        postQueueRepository.save(post);
        return ResponseEntity.ok(Map.of("success", true, "post", postDto(post)));
    }

    @PostMapping("/ai-rewrite")
    public ResponseEntity<Map<String, Object>> aiRewrite(@RequestBody Map<String, String> body) {
        String content = body.getOrDefault("content", "").trim();
        if (content.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", "Chưa có nội dung để AI viết lại"));
        }
        try {
            String result = geminiService.rewriteForThreads(content, body.get("mode"));
            return ResponseEntity.ok(Map.of("success", true, "content", result == null ? "" : result.trim()));
        } catch (IllegalStateException e) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", e.getMessage()));
        } catch (Exception e) {
            log.warn("🧵 AI viết lại Threads lỗi: {}", e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("success", false, "message", "AI viết lại thất bại: " + e.getMessage()));
        }
    }
}
