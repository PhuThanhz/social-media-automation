package com.autopost.saas.service;

import com.autopost.saas.util.LocalServices;
import com.autopost.saas.util.PooledRestTemplateFactory;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Điều phối tải giữa 2 Playwright Worker (Port 3001 và Port 3002).
 * - Đăng bài (PostQueue): Round-robin chia đều giữa 2 worker để tăng tốc độ gấp 2 lần.
 * - Cào bài (Scraper): Ưu tiên gửi sang Worker 2 (3002) để Worker 1 (3001) không bị nghẽn luồng đăng.
 */
@Slf4j
@Service
public class WorkerRouterService {

    private final List<String> workerUrls;
    private final AtomicInteger postingIndex = new AtomicInteger(0);
    private final RestTemplate healthCheckClient = PooledRestTemplateFactory.create(2000, 3000);

    public WorkerRouterService(
            @Value("${worker.urls:http://localhost:3001,http://localhost:3002}") String configuredUrls,
            @Value("${worker.base-url:http://localhost:3001}") String defaultBaseUrl
    ) {
        List<String> urls = new ArrayList<>();
        if (configuredUrls != null && !configuredUrls.isBlank()) {
            Arrays.stream(configuredUrls.split(","))
                    .map(String::trim)
                    .filter(s -> !s.isEmpty())
                    .forEach(urls::add);
        }
        if (urls.isEmpty()) {
            urls.add(defaultBaseUrl != null && !defaultBaseUrl.isBlank() ? defaultBaseUrl.trim() : LocalServices.WORKER_BASE);
        }
        this.workerUrls = List.copyOf(urls);
        log.info("🚀 [WorkerRouterService] Đã kích hoạt hệ thống Đa Worker với {} tiến trình: {}", workerUrls.size(), workerUrls);
    }

    /**
     * Dành cho ĐĂNG BÀI: Luân phiên (Round-Robin) giữa các Worker nếu không truyền accountKey.
     */
    public String getPostingWorkerUrl(String apiPath) {
        return getPostingWorkerUrl(apiPath, null);
    }

    /**
     * Dành cho ĐĂNG BÀI THEO ACCOUNT (Account Affinity):
     * - Mỗi VIA/Account được gán ưu tiên cho 1 Worker cố định để lưu giữ trọn vẹn browser profile,
     *   session cookie và fingerprint trong thư mục browser_profiles của worker đó.
     * - Giúp các VIA khác nhau tự động chạy trên các Worker khác nhau (song song hoàn toàn).
     * - Nếu worker ưu tiên không phản hồi -> tự động fallback sang worker khác còn sống.
     */
    public String getPostingWorkerUrl(String apiPath, String accountKey) {
        String base = getOptimalPostingWorkerUrl(accountKey);
        return buildFullUrl(base, apiPath);
    }

    /**
     * Dành cho CÀO BÀI & TẢI MEDIA: Ưu tiên gửi sang Worker 2 (3002) nếu có, fallback về Worker 1.
     */
    public String getScrapingWorkerUrl(String apiPath) {
        String base;
        if (workerUrls.size() > 1) {
            String worker2 = workerUrls.get(1);
            if (isWorkerAlive(worker2)) {
                base = worker2;
            } else {
                log.warn("⚠️ Worker cào bài ({}) không phản hồi, tự động chuyển về Worker chính ({})", worker2, workerUrls.get(0));
                base = workerUrls.get(0);
            }
        } else {
            base = workerUrls.get(0);
        }
        return buildFullUrl(base, apiPath);
    }

    public String getDefaultWorkerUrl(String apiPath) {
        return buildFullUrl(workerUrls.get(0), apiPath);
    }

    public List<String> getAllWorkerUrls() {
        return workerUrls;
    }

    private final Map<String, Long> workerHealthCache = new java.util.concurrent.ConcurrentHashMap<>();
    private final Map<String, Boolean> workerHealthStatus = new java.util.concurrent.ConcurrentHashMap<>();
    private static final long HEALTH_CACHE_TTL_MS = 5000;

    public boolean isWorkerAlive(String baseUrl) {
        long now = System.currentTimeMillis();
        Long cachedTime = workerHealthCache.get(baseUrl);
        Boolean cachedStatus = workerHealthStatus.get(baseUrl);
        if (cachedTime != null && cachedStatus != null && (now - cachedTime < HEALTH_CACHE_TTL_MS)) {
            return cachedStatus;
        }
        boolean alive = false;
        try {
            Map<?, ?> resp = healthCheckClient.getForObject(buildFullUrl(baseUrl, "/api/health"), Map.class);
            alive = (resp != null && "ok".equals(resp.get("status")));
        } catch (Exception ignored) {
            alive = false;
        }
        workerHealthCache.put(baseUrl, now);
        workerHealthStatus.put(baseUrl, alive);
        return alive;
    }

    public boolean isAnyWorkerAlive() {
        for (String url : workerUrls) {
            if (isWorkerAlive(url)) return true;
        }
        return false;
    }

    private String getOptimalPostingWorkerUrl(String accountKey) {
        if (workerUrls.isEmpty()) return LocalServices.WORKER_BASE;
        if (workerUrls.size() == 1) return workerUrls.get(0);

        if (accountKey != null && !accountKey.isBlank()) {
            int total = workerUrls.size();
            int preferredIdx = Math.abs(accountKey.hashCode()) % total;
            String preferredCandidate = workerUrls.get(preferredIdx);
            if (isWorkerAlive(preferredCandidate)) {
                return preferredCandidate;
            }
            log.warn("⚠️ Worker ưu tiên ({}) cho account '{}' không phản hồi, tự động chuyển worker dự phòng.",
                    preferredCandidate, accountKey);
        }

        return getNextPostingWorkerUrl();
    }

    private String getNextPostingWorkerUrl() {
        int total = workerUrls.size();
        if (total == 1) return workerUrls.get(0);

        // Thử tối đa số worker lần để tìm worker còn sống
        for (int i = 0; i < total; i++) {
            int idx = Math.abs(postingIndex.getAndIncrement() % total);
            String candidate = workerUrls.get(idx);
            if (isWorkerAlive(candidate)) {
                return candidate;
            }
        }
        // Nếu health check fail hết, vẫn trả về theo thứ tự để retry helper xử lý
        int idx = Math.abs(postingIndex.getAndIncrement() % total);
        return workerUrls.get(idx);
    }

    private String buildFullUrl(String base, String apiPath) {
        String cleanBase = base.endsWith("/") ? base.substring(0, base.length() - 1) : base;
        String cleanPath = apiPath.startsWith("/") ? apiPath : "/" + apiPath;
        return cleanBase + cleanPath;
    }
}
