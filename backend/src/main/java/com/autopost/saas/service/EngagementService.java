package com.autopost.saas.service;

import com.autopost.saas.entity.SocialAccount;
import com.autopost.saas.repository.SocialAccountRepository;
import com.autopost.saas.util.PooledRestTemplateFactory;
import com.autopost.saas.util.WorkerRetryHelper;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.*;

@Service
@RequiredArgsConstructor
@Slf4j
public class EngagementService {

    private final SocialAccountRepository socialAccountRepository;
    private final RestTemplate restTemplate = PooledRestTemplateFactory.create(10_000, 600_000);

    @Value("${worker.base-url:http://localhost:3001}")
    private String workerBaseUrl;

    @Data
    public static class PageItemDto {
        private String id;
        private String name;
    }

    @Data
    public static class BuffLikeRequestDto {
        private String targetUrl;
        private String reactionType; // LIKE, LOVE, CARE, HAHA, WOW, SAD, ANGRY
        private List<PageItemDto> selectedPages;
        private List<Long> socialAccountIds;
        private String cookieString;
        private Integer delayMs;
    }

    @Data
    public static class BuffViewRequestDto {
        private String targetUrl;
        private Integer targetViews;
        private Integer concurrency;
        private Integer watchTimeSeconds;
        private String cookieString;
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> buffLike(Long userId, BuffLikeRequestDto request) {
        log.info("[EngagementService] User {} requesting buff like for target: {}", userId, request.getTargetUrl());

        String cookie = request.getCookieString();
        List<PageItemDto> pages = request.getSelectedPages();

        if ((pages == null || pages.isEmpty()) && request.getSocialAccountIds() != null && !request.getSocialAccountIds().isEmpty()) {
            pages = new ArrayList<>();
            List<SocialAccount> accounts = socialAccountRepository.findAllById(request.getSocialAccountIds());
            for (SocialAccount acc : accounts) {
                if (acc.getPlatformAccountId() != null && !acc.getPlatformAccountId().isBlank()) {
                    PageItemDto p = new PageItemDto();
                    p.setId(acc.getPlatformAccountId());
                    p.setName(acc.getPageName() != null ? acc.getPageName() : "Page " + acc.getPlatformAccountId());
                    pages.add(p);
                }
                if ((cookie == null || cookie.isBlank()) && acc.getAccessToken() != null && acc.getAccessToken().contains("c_user=")) {
                    cookie = acc.getAccessToken();
                }
            }
        }

        Map<String, Object> body = new HashMap<>();
        body.put("cookieString", cookie);
        body.put("targetUrl", request.getTargetUrl());
        body.put("reactionType", request.getReactionType() != null ? request.getReactionType() : "LIKE");
        body.put("selectedPages", pages != null ? pages : Collections.emptyList());
        body.put("delayMs", request.getDelayMs() != null ? request.getDelayMs() : 1500);

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);

        try {
            return WorkerRetryHelper.postWithConnectionRetry(restTemplate, workerBaseUrl + "/api/buff-like", new HttpEntity<>(body, headers), Map.class);
        } catch (Exception e) {
            log.error("[EngagementService] Lỗi khi gọi worker /api/buff-like: {}", e.getMessage(), e);
            Map<String, Object> err = new HashMap<>();
            err.put("success", false);
            err.put("error", "Lỗi kết nối Worker Playwright: " + e.getMessage());
            return err;
        }
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> buffView(Long userId, BuffViewRequestDto request) {
        log.info("[EngagementService] User {} requesting buff view for target: {}", userId, request.getTargetUrl());

        Map<String, Object> body = new HashMap<>();
        body.put("targetUrl", request.getTargetUrl());
        body.put("targetViews", request.getTargetViews() != null ? request.getTargetViews() : 10);
        body.put("concurrency", request.getConcurrency() != null ? request.getConcurrency() : 2);
        body.put("watchTimeSeconds", request.getWatchTimeSeconds() != null ? request.getWatchTimeSeconds() : 6);
        body.put("cookieString", request.getCookieString());

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);

        try {
            return WorkerRetryHelper.postWithConnectionRetry(restTemplate, workerBaseUrl + "/api/buff-view", new HttpEntity<>(body, headers), Map.class);
        } catch (Exception e) {
            log.error("[EngagementService] Lỗi khi gọi worker /api/buff-view: {}", e.getMessage(), e);
            Map<String, Object> err = new HashMap<>();
            err.put("success", false);
            err.put("error", "Lỗi kết nối Worker Playwright: " + e.getMessage());
            return err;
        }
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> scanPages(String cookieString) {
        Map<String, Object> body = new HashMap<>();
        body.put("cookieString", cookieString);

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);

        try {
            return WorkerRetryHelper.postWithConnectionRetry(restTemplate, workerBaseUrl + "/api/buff-get-pages", new HttpEntity<>(body, headers), Map.class);
        } catch (Exception e) {
            log.error("[EngagementService] Lỗi khi gọi worker /api/buff-get-pages: {}", e.getMessage(), e);
            Map<String, Object> err = new HashMap<>();
            err.put("success", false);
            err.put("error", "Lỗi quét Fanpage từ Worker: " + e.getMessage());
            return err;
        }
    }
}
