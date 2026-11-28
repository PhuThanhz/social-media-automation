package com.autopost.saas.service.telegram;

import com.autopost.saas.entity.SocialAccount;
import com.autopost.saas.entity.User;
import com.autopost.saas.repository.SocialAccountRepository;
import com.autopost.saas.repository.UserRepository;
import com.autopost.saas.util.LocalServices;
import com.autopost.saas.util.PooledRestTemplateFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestTemplate;

import java.util.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;

/** Dùng chung cho bot: user mà bot thay mặt, danh sách Trang/nhóm/nick Threads, gọi loopback, thread nền. */
@Component
public class TelegramSupport {

    static final String THREADS_ACCOUNT_TYPE = "THREADS_COOKIE";

    private final SocialAccountRepository socialAccountRepository;
    private final UserRepository userRepository;
    private final int serverPort;
    private final RestTemplate loopback = LocalServices.withSessionToken(PooledRestTemplateFactory.create(10_000, 600_000));

    /** Việc chạy lâu (cào link, tạo bài, AI, tải file) — không chặn thread polling. */
    final ExecutorService jobs = Executors.newFixedThreadPool(3, daemon("telegram-job"));
    /** Hẹn giờ ngắn (gom album ảnh gửi thành nhiều tin). */
    final ScheduledExecutorService timers = Executors.newSingleThreadScheduledExecutor(daemon("telegram-timer"));

    public TelegramSupport(SocialAccountRepository socialAccountRepository, UserRepository userRepository,
                           @Value("${server.port:8081}") int serverPort) {
        this.socialAccountRepository = socialAccountRepository;
        this.userRepository = userRepository;
        this.serverPort = serverPort;
    }

    private static java.util.concurrent.ThreadFactory daemon(String name) {
        return r -> {
            Thread t = new Thread(r, name);
            t.setDaemon(true);
            return t;
        };
    }

    void shutdown() {
        jobs.shutdownNow();
        timers.shutdownNow();
    }

    int serverPort() {
        return serverPort;
    }

    User botUser() {
        return userRepository.findByEmail("admin@gmail.com")
                .orElseGet(() -> userRepository.findFirstByOrderByIdAsc().orElseThrow());
    }

    /** Cùng bộ lọc với trang "Đăng tự động": Fanpage dùng cookie, gộp trùng tên, ưu tiên cookie còn hạn / ID mới. */
    List<SocialAccount> postingPages(User user) {
        Map<String, SocialAccount> latestByPage = new LinkedHashMap<>();
        for (SocialAccount a : socialAccountRepository.findByUserId(user.getId())) {
            if (!"FACEBOOK_PAGE".equals(a.getPlatform())) continue;
            if (a.getAccountType() != null && !"PERSONAL_COOKIE".equals(a.getAccountType())) continue;
            String key = (a.getPageName() != null ? a.getPageName() : String.valueOf(a.getPlatformAccountId())).trim().toLowerCase();
            SocialAccount cur = latestByPage.get(key);
            boolean curExpired = cur != null && "EXPIRED".equals(cur.getTokenStatus());
            boolean aExpired = "EXPIRED".equals(a.getTokenStatus());
            if (cur == null || (curExpired && !aExpired) || (a.getId() > cur.getId() && !(!curExpired && aExpired))) {
                latestByPage.put(key, a);
            }
        }
        return latestByPage.values().stream()
                .sorted(Comparator.comparing(a -> a.getPageName() != null ? a.getPageName() : "", String.CASE_INSENSITIVE_ORDER))
                .toList();
    }

    /** Nhóm Facebook như ô chọn nhóm trên web (bỏ nguồn cào, bỏ nhóm Phim, phải có ID nhóm). */
    List<SocialAccount> groups(User user) {
        return socialAccountRepository.findByUserId(user.getId()).stream()
                .filter(a -> "FACEBOOK_GROUP".equals(a.getPlatform()))
                .filter(a -> !"CRAWL_SOURCE".equals(a.getAccountType()))
                .filter(a -> a.getPageName() == null || !a.getPageName().contains("[🎬 Phim]"))
                .filter(a -> a.getPlatformAccountId() != null && !a.getPlatformAccountId().isBlank())
                .sorted(Comparator.comparing(a -> a.getPageName() != null ? a.getPageName() : "", String.CASE_INSENSITIVE_ORDER))
                .toList();
    }

    List<SocialAccount> threadsAccounts(User user) {
        return socialAccountRepository.findByUserId(user.getId()).stream()
                .filter(TelegramSupport::isThreadsAccount)
                .sorted(Comparator.comparing(SocialAccount::getId)).toList();
    }

    Map<Long, String> accountNames(User user) {
        Map<Long, String> m = new HashMap<>();
        for (SocialAccount a : socialAccountRepository.findByUserId(user.getId())) m.put(a.getId(), label(a));
        return m;
    }

    static boolean isThreadsAccount(SocialAccount a) {
        return "THREADS".equalsIgnoreCase(a.getPlatform()) || THREADS_ACCOUNT_TYPE.equalsIgnoreCase(a.getAccountType());
    }

    static String targetValue(SocialAccount a) {
        return a.getPlatformAccountId() + ":" + (a.getAccountType() != null ? a.getAccountType() : "PERSONAL_COOKIE") + ":" + a.getId();
    }

    static String label(SocialAccount a) {
        return a.getPageName() != null && !a.getPageName().isBlank() ? a.getPageName() : String.valueOf(a.getPlatformAccountId());
    }

    Map<String, Object> postLocal(String path, Map<String, Object> body) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        return loopback.exchange("http://localhost:" + serverPort + path, HttpMethod.POST, new HttpEntity<>(body, headers),
                new ParameterizedTypeReference<Map<String, Object>>() {
                }).getBody();
    }

    record Fetched(byte[] data, String contentType) {
    }

    private final java.net.http.HttpClient mediaClient = java.net.http.HttpClient.newBuilder()
            .followRedirects(java.net.http.HttpClient.Redirect.NORMAL)
            .connectTimeout(java.time.Duration.ofSeconds(15)).build();

    /** Tải ảnh/video (link cào được hoặc /uploads local) để gửi xem trước; vượt maxBytes thì ném lỗi. */
    Fetched fetchMedia(String url, long maxBytes) throws Exception {
        java.net.URI uri = java.net.URI.create(url);
        java.net.http.HttpRequest.Builder b = java.net.http.HttpRequest.newBuilder(uri)
                .timeout(java.time.Duration.ofSeconds(90))
                .header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36");
        LocalServices.withSessionToken(b, uri);
        java.net.http.HttpResponse<java.io.InputStream> res = mediaClient.send(b.GET().build(),
                java.net.http.HttpResponse.BodyHandlers.ofInputStream());
        if (res.statusCode() >= 400) {
            res.body().close();
            throw new IllegalStateException("HTTP " + res.statusCode());
        }
        long declared = res.headers().firstValueAsLong("Content-Length").orElse(-1);
        if (declared > maxBytes) {
            res.body().close();
            throw new IllegalStateException("quá lớn (" + (declared / 1024 / 1024) + "MB)");
        }
        try (java.io.InputStream in = res.body()) {
            byte[] data = in.readNBytes((int) Math.min(Integer.MAX_VALUE - 8, maxBytes + 1));
            if (data.length > maxBytes) throw new IllegalStateException("quá lớn (> " + (maxBytes / 1024 / 1024) + "MB)");
            return new Fetched(data, res.headers().firstValue("Content-Type").orElse(""));
        }
    }

    static String errorMessageOf(HttpStatusCodeException e) {
        String raw = e.getResponseBodyAsString();
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("\"message\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"").matcher(raw);
        return m.find() ? m.group(1).replace("\\\"", "\"") : "HTTP " + e.getStatusCode().value();
    }

    static long num(Object o) {
        if (o instanceof Number n) return n.longValue();
        if (o == null) return 0;
        try {
            return Long.parseLong(o.toString());
        } catch (NumberFormatException e) {
            return 0;
        }
    }
}
