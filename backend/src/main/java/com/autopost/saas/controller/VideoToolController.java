package com.autopost.saas.controller;

import com.autopost.saas.util.LocalServices;
import com.autopost.saas.service.FacebookGraphApiService;
import com.autopost.saas.util.PooledRestTemplateFactory;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestTemplate;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/tools")
@CrossOrigin(originPatterns = "*")
@Slf4j
@RequiredArgsConstructor
public class VideoToolController {

    private final RestTemplate restTemplate = PooledRestTemplateFactory.create(10000, 300000);
    private final FacebookGraphApiService facebookGraphApiService;
    private final com.autopost.saas.service.GeminiService geminiService;
    private final com.autopost.saas.repository.SocialAccountRepository socialAccountRepository;
    private final com.autopost.saas.repository.PostQueueRepository postQueueRepository;
    private final com.autopost.saas.service.RedditService redditService;

    @GetMapping("/proxy-image")
    public ResponseEntity<byte[]> proxyImage(@RequestParam String url) {
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
            HttpEntity<Void> entity = new HttpEntity<>(headers);
            ResponseEntity<byte[]> response = restTemplate.exchange(url, org.springframework.http.HttpMethod.GET, entity, byte[].class);

            HttpHeaders responseHeaders = new HttpHeaders();
            if (response.getHeaders().getContentType() != null) {
                responseHeaders.setContentType(response.getHeaders().getContentType());
            } else {
                responseHeaders.setContentType(MediaType.IMAGE_JPEG);
            }
            responseHeaders.setCacheControl("public, max-age=86400");
            return new ResponseEntity<>(response.getBody(), responseHeaders, HttpStatus.OK);
        } catch (Exception e) {
            log.warn("Lỗi proxy ảnh: {} - URL: {}", e.getMessage(), url);
            return ResponseEntity.notFound().build();
        }
    }

    @SuppressWarnings("unchecked")
    @PostMapping("/extract-video")
    public ResponseEntity<Map<String, Object>> extractVideo(@RequestBody Map<String, String> body) {
        try {
            Map<String, String> payload = new java.util.HashMap<>(body);
            String url = payload.get("url");

            // Tự động nạp Facebook Cookie còn hoạt động tốt nhất nếu chưa có
            String cookieString = payload.get("cookieString");
            if ((cookieString == null || cookieString.isBlank()) && url != null
                    && (url.contains("facebook.com") || url.contains("fb.watch") || url.contains("fb.me"))) {
                cookieString = socialAccountRepository.findByAccountType("PERSONAL_COOKIE").stream()
                        .filter(a -> a.getAccessToken() != null && !a.getAccessToken().isBlank())
                        .sorted((a, b) -> {
                            boolean aOk = "OK".equals(a.getTokenStatus());
                            boolean bOk = "OK".equals(b.getTokenStatus());
                            if (aOk && !bOk) return -1;
                            if (!aOk && bOk) return 1;
                            java.time.LocalDateTime tA = a.getUpdatedAt() != null ? a.getUpdatedAt() : java.time.LocalDateTime.MIN;
                            java.time.LocalDateTime tB = b.getUpdatedAt() != null ? b.getUpdatedAt() : java.time.LocalDateTime.MIN;
                            return tB.compareTo(tA);
                        })
                        .map(com.autopost.saas.entity.SocialAccount::getAccessToken)
                        .findFirst()
                        .orElse(null);
                if (cookieString != null && !cookieString.isBlank()) {
                    payload.put("cookieString", cookieString);
                }
            }

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            HttpEntity<Map<String, String>> request = new HttpEntity<>(payload, headers);
            Map<String, Object> response = restTemplate.postForObject(
                    LocalServices.WORKER_BASE + "/api/extract-video", request, Map.class);
            if (response != null && Boolean.TRUE.equals(response.get("success"))) {
                String sourceType = String.valueOf(response.get("sourceType"));
                String caption = (String) response.get("content");
                if (caption == null) caption = (String) response.get("title");
                
                // Nếu là nguồn Douyin hoặc có tiếng Trung, tự động dùng Gemini dịch sang tiếng Việt tự nhiên
                if (("DOUYIN".equalsIgnoreCase(sourceType) || containsChinese(caption)) && caption != null && !caption.isBlank()) {
                    try {
                        String translated = geminiService.translateAndAdaptChineseCaption(caption);
                        if (translated != null && !translated.isBlank() && !translated.equalsIgnoreCase(caption)) {
                            response = new java.util.HashMap<>(response);
                            response.put("originalCaption", caption);
                            response.put("content", translated);
                            response.put("title", translated.length() > 120 ? translated.substring(0, 120) : translated);
                            response.put("isTranslated", true);
                        }
                    } catch (Exception ex) {
                        log.warn("Không thể dịch caption Douyin: {}", ex.getMessage());
                    }
                }
            }
            return ResponseEntity.ok(response != null ? response : Map.of("success", false, "error", "Không nhận được phản hồi từ Worker"));
        } catch (HttpStatusCodeException e) {
            log.warn("Worker trả lỗi khi trích xuất video: {}", e.getResponseBodyAsString());
            return ResponseEntity.ok(Map.of("success", false, "error", e.getResponseBodyAsString()));
        } catch (Exception e) {
            log.error("Lỗi khi gọi Worker trích xuất video: {}", e.getMessage());
            return ResponseEntity.ok(Map.of("success", false, "error", e.getMessage()));
        }
    }

    @SuppressWarnings("unchecked")
    @PostMapping("/scrape-article")
    public ResponseEntity<Map<String, Object>> scrapeArticle(@RequestBody Map<String, String> body) {
        String url = body != null ? body.get("url") : null;
        if (url != null && (url.contains("reddit.com") || url.contains("redd.it"))) {
            try {
                Map<String, Object> rPost = redditService.fetchSinglePost(url.trim());
                List<String> mediaUrls = (List<String>) rPost.getOrDefault("mediaUrls", List.of());
                String coverImage = (String) rPost.get("previewCover");
                if (coverImage == null && !mediaUrls.isEmpty()) {
                    coverImage = mediaUrls.get(0);
                }
                List<Map<String, String>> images = mediaUrls.stream()
                        .map(mUrl -> Map.of("url", mUrl, "caption", ""))
                        .toList();
                String caption = (String) rPost.getOrDefault("caption", "");
                String title = caption.contains("\n") ? caption.substring(0, caption.indexOf("\n")).trim() : caption;
                if (title.isBlank()) title = "Reddit " + rPost.getOrDefault("subreddit", "");

                Map<String, Object> res = new HashMap<>();
                res.put("success", true);
                res.put("url", url);
                res.put("title", title);
                res.put("sapo", "");
                res.put("content", caption);
                res.put("coverImage", coverImage != null ? coverImage : "");
                res.put("images", images);
                res.put("siteName", "Reddit " + rPost.getOrDefault("subreddit", ""));
                res.put("domain", "reddit.com");
                return ResponseEntity.ok(res);
            } catch (Exception re) {
                log.warn("Lỗi cào Reddit bài đơn: {}", re.getMessage());
                return ResponseEntity.ok(Map.of("success", false, "error", "Không thể lấy bài Reddit: " + re.getMessage()));
            }
        }
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            HttpEntity<Map<String, String>> request = new HttpEntity<>(body, headers);
            Map<String, Object> response = restTemplate.postForObject(
                    LocalServices.WORKER_BASE + "/api/scrape-article", request, Map.class);
            return ResponseEntity.ok(response);
        } catch (HttpStatusCodeException e) {
            log.warn("Worker trả lỗi khi cào bài báo: {}", e.getResponseBodyAsString());
            return ResponseEntity.status(e.getStatusCode()).body(Map.of("success", false, "error", e.getResponseBodyAsString()));
        } catch (Exception e) {
            log.error("Lỗi khi gọi Worker cào bài báo: {}", e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("success", false, "error", e.getMessage()));
        }
    }

    @SuppressWarnings("unchecked")
    @PostMapping("/scrape-category-links")
    public ResponseEntity<Map<String, Object>> scrapeCategoryLinks(@RequestBody Map<String, Object> body) {
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            HttpEntity<Map<String, Object>> request = new HttpEntity<>(body, headers);
            Map<String, Object> response = restTemplate.postForObject(
                    LocalServices.WORKER_BASE + "/api/scrape-category-links", request, Map.class);
            return ResponseEntity.ok(response);
        } catch (HttpStatusCodeException e) {
            log.warn("Worker trả lỗi khi quét chuyên mục bài báo: {}", e.getResponseBodyAsString());
            return ResponseEntity.status(e.getStatusCode()).body(Map.of("success", false, "error", e.getResponseBodyAsString()));
        } catch (Exception e) {
            log.error("Lỗi khi gọi Worker quét chuyên mục bài báo: {}", e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("success", false, "error", e.getMessage()));
        }
    }

    @SuppressWarnings("unchecked")
    @PostMapping("/parse-rss")
    public ResponseEntity<Map<String, Object>> parseRssFeed(@RequestBody Map<String, Object> body) {
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            HttpEntity<Map<String, Object>> request = new HttpEntity<>(body, headers);
            Map<String, Object> response = restTemplate.postForObject(
                    LocalServices.WORKER_BASE + "/api/parse-rss", request, Map.class);
            return ResponseEntity.ok(response);
        } catch (HttpStatusCodeException e) {
            log.warn("Worker trả lỗi khi đọc RSS feed: {}", e.getResponseBodyAsString());
            return ResponseEntity.status(e.getStatusCode()).body(Map.of("success", false, "error", e.getResponseBodyAsString()));
        } catch (Exception e) {
            log.error("Lỗi khi gọi Worker đọc RSS feed: {}", e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("success", false, "error", e.getMessage()));
        }
    }

    private boolean containsChinese(String text) {
        if (text == null) return false;
        for (char c : text.toCharArray()) {
            Character.UnicodeScript sc = Character.UnicodeScript.of(c);
            if (sc == Character.UnicodeScript.HAN) return true;
        }
        return false;
    }

    /** Viết lại bài báo/tin tức BĐS bằng Gemini AI theo phong cách lựa chọn */
    @PostMapping("/rewrite-article-ai")
    public ResponseEntity<Map<String, Object>> rewriteArticleAi(@RequestBody Map<String, String> body) {
        String title = body.get("title");
        String sapo = body.get("sapo");
        String content = body.get("content");
        String style = body.get("style");
        String apiKey = body.get("apiKey");

        if ((content == null || content.trim().isEmpty()) && (title == null || title.trim().isEmpty())) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", "Thiếu nội dung hoặc tiêu đề bài báo để AI xử lý"));
        }

        try {
            String rewrittenContent = geminiService.rewriteRealEstateArticle(title, sapo, content, style, apiKey);
            return ResponseEntity.ok(Map.of("success", true, "rewrittenContent", rewrittenContent));
        } catch (Exception e) {
            log.error("Lỗi khi Gemini AI viết lại bài báo BĐS: {}", e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("success", false, "error", e.getMessage()));
        }
    }

    /** Viết lại bài đăng Viral (Facebook/Threads) bằng Gemini AI */
    @PostMapping("/gemini-rewrite")
    public ResponseEntity<Map<String, Object>> geminiRewrite(@RequestBody Map<String, String> body) {
        String content = body.getOrDefault("content", "").trim();
        String mode = body.getOrDefault("mode", "REWRITE").trim();
        String platform = body.getOrDefault("platform", "FACEBOOK").trim();
        String apiKey = body.get("apiKey");

        if (content.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", "Chưa có nội dung để AI xử lý"));
        }

        try {
            String rewritten = geminiService.rewriteViralPost(content, platform, mode, apiKey);
            return ResponseEntity.ok(Map.of("success", true, "rewritten", rewritten));
        } catch (IllegalStateException e) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", e.getMessage()));
        } catch (Exception e) {
            log.warn("Gemini rewrite error: {}", e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("success", false, "error", "Lỗi AI: " + e.getMessage()));
        }
    }

    /** Dùng Gemini AI để phân tích, chấm điểm chất lượng (1-100) và lọc bài viết cào được */
    @SuppressWarnings("unchecked")
    @PostMapping("/gemini-curate-posts")
    public ResponseEntity<Map<String, Object>> geminiCuratePosts(@RequestBody Map<String, Object> body) {
        List<Map<String, Object>> posts = (List<Map<String, Object>>) body.get("posts");
        String topic = (String) body.getOrDefault("topic", "Nội dung chất lượng");
        String apiKey = (String) body.get("apiKey");

        if (posts == null || posts.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", "Danh sách bài viết trống"));
        }

        try {
            List<Map<String, Object>> curated = geminiService.curateAndScoreViralPosts(posts, topic, apiKey);
            return ResponseEntity.ok(Map.of("success", true, "items", curated));
        } catch (Exception e) {
            log.error("Lỗi Gemini Curate Posts: {}", e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("success", false, "error", e.getMessage()));
        }
    }


    @SuppressWarnings("unchecked")
    @PostMapping("/hunt-threads")
    public ResponseEntity<Map<String, Object>> huntThreads(@RequestBody Map<String, Object> body) {
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            HttpEntity<Map<String, Object>> request = new HttpEntity<>(body, headers);
            Map<String, Object> response = restTemplate.postForObject(
                    LocalServices.WORKER_BASE + "/api/hunt-threads", request, Map.class);
            if (response != null && Boolean.TRUE.equals(response.get("success")) && response.get("items") instanceof List) {
                List<Map<String, Object>> items = (List<Map<String, Object>>) response.get("items");
                try {
                    List<com.autopost.saas.entity.PostQueue> allPosts = postQueueRepository.findAll();
                    int alreadyCount = 0;
                    for (Map<String, Object> item : items) {
                        String url = (String) item.get("url");
                        String caption = (String) item.get("caption");
                        if (caption == null) caption = (String) item.get("content");
                        boolean already = false;
                        String status = null;

                        if (url != null && !url.isBlank()) {
                            String trimmed = url.trim().toLowerCase();
                            for (com.autopost.saas.entity.PostQueue pq : allPosts) {
                                if (pq.getOriginalUrl() != null && pq.getOriginalUrl().trim().equalsIgnoreCase(trimmed)) {
                                    already = true;
                                    status = pq.getStatus();
                                    break;
                                }
                            }
                        }
                        if (!already && caption != null && !caption.isBlank()) {
                            for (com.autopost.saas.entity.PostQueue pq : allPosts) {
                                if (com.autopost.saas.util.FacebookPostIds.isSameContent(caption, pq.getContent())) {
                                    already = true;
                                    status = pq.getStatus();
                                    break;
                                }
                            }
                        }
                        item.put("isAlreadyImported", already);
                        if (already) {
                            alreadyCount++;
                            item.put("postStatus", status != null ? status : "PUBLISHED");
                        }
                    }
                    response.put("alreadyImportedCount", alreadyCount);
                } catch (Exception ex) {
                    log.warn("Không thể kiểm tra trùng Threads: {}", ex.getMessage());
                }
            }
            return ResponseEntity.ok(response != null ? response : Map.of("success", false, "error", "Không nhận được phản hồi từ Worker"));
        } catch (Exception e) {
            log.error("Lỗi khi gọi Worker hunt-threads: {}", e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("success", false, "error", e.getMessage()));
        }
    }

    @SuppressWarnings("unchecked")
    @PostMapping("/hunt-groups-by-keyword")
    public ResponseEntity<Map<String, Object>> huntGroupsByKeyword(@RequestBody Map<String, Object> body) {
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            HttpEntity<Map<String, Object>> request = new HttpEntity<>(body, headers);
            Map<String, Object> response = restTemplate.postForObject(
                    LocalServices.WORKER_BASE + "/api/hunt-facebook-groups-by-keyword", request, Map.class);
            return ResponseEntity.ok(response != null ? response : Map.of("success", false, "error", "Không nhận được phản hồi từ Worker"));
        } catch (Exception e) {
            log.error("Lỗi khi gọi Worker hunt-groups-by-keyword: {}", e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("success", false, "error", e.getMessage()));
        }
    }



    @SuppressWarnings("unchecked")
    @PostMapping("/hunt-tiktok-channel")
    public ResponseEntity<Map<String, Object>> huntTikTokChannel(@RequestBody Map<String, Object> body) {
        try {
            Map<String, Object> reqBody = new java.util.HashMap<>(body);
            // Thu thập các link / ID TikTok đã có trong Lịch Đăng (post_queue)
            java.util.Map<String, String> existingPostsMap = new java.util.HashMap<>();
            java.util.List<String> excludeIds = new java.util.ArrayList<>();
            try {
                List<com.autopost.saas.entity.PostQueue> allPosts = postQueueRepository.findAll();
                for (com.autopost.saas.entity.PostQueue pq : allPosts) {
                    if (pq.getOriginalUrl() != null && !pq.getOriginalUrl().isBlank()) {
                        String orig = pq.getOriginalUrl().trim();
                        String status = pq.getStatus() != null ? pq.getStatus() : "PENDING";
                        existingPostsMap.put(orig.toLowerCase(), status);
                        String tId = extractTikTokVideoId(orig);
                        if (tId != null) {
                            existingPostsMap.put(tId, status);
                            excludeIds.add(tId);
                        }
                    }
                }
                reqBody.put("excludeIds", excludeIds);
            } catch (Exception ex) {
                log.warn("Không thể lấy danh sách bài TikTok đã đăng: {}", ex.getMessage());
            }

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            HttpEntity<Map<String, Object>> request = new HttpEntity<>(reqBody, headers);
            Map<String, Object> response = restTemplate.postForObject(
                    LocalServices.WORKER_BASE + "/api/hunt-tiktok-channel", request, Map.class);

            if (response != null && Boolean.TRUE.equals(response.get("success")) && response.get("items") instanceof List) {
                List<Map<String, Object>> items = (List<Map<String, Object>>) response.get("items");
                int alreadyImportedCount = 0;
                for (Map<String, Object> item : items) {
                    String vId = item.get("id") != null ? item.get("id").toString().trim() : "";
                    String vUrl = item.get("url") != null ? item.get("url").toString().trim() : "";
                    boolean already = false;
                    String status = null;

                    if (!vId.isBlank() && existingPostsMap.containsKey(vId)) {
                        already = true;
                        status = existingPostsMap.get(vId);
                    } else if (!vUrl.isBlank() && existingPostsMap.containsKey(vUrl.toLowerCase())) {
                        already = true;
                        status = existingPostsMap.get(vUrl.toLowerCase());
                    } else {
                        for (Map.Entry<String, String> entry : existingPostsMap.entrySet()) {
                            if (isSameTikTokVideo(vId, vUrl, entry.getKey())) {
                                already = true;
                                status = entry.getValue();
                                break;
                            }
                        }
                    }

                    item.put("isAlreadyImported", already);
                    if (status != null) {
                        item.put("postStatus", status);
                    }
                    if (already) {
                        alreadyImportedCount++;
                    }
                }
                response.put("alreadyImportedCount", alreadyImportedCount);
                log.info("🎯 Quét TikTok xong: {} video, trong đó {} video ĐÃ TỪNG ĐĂNG / ĐÃ CÓ trong lịch.", items.size(), alreadyImportedCount);
            }
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            log.error("Lỗi gọi Worker hunt-tiktok-channel: {}", e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("success", false, "error", e.getMessage()));
        }
    }

    @SuppressWarnings("unchecked")
    @PostMapping("/post-tiktok")
    public ResponseEntity<Map<String, Object>> postTikTok(@RequestBody Map<String, Object> body) {
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            HttpEntity<Map<String, Object>> request = new HttpEntity<>(body, headers);
            Map<String, Object> response = restTemplate.postForObject(
                    LocalServices.WORKER_BASE + "/api/post-tiktok", request, Map.class);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            log.error("Lỗi gọi Worker post-tiktok: {}", e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("success", false, "error", e.getMessage()));
        }
    }

    @SuppressWarnings("unchecked")
    @PostMapping("/hunt-facebook-group")
    public ResponseEntity<Map<String, Object>> huntFacebookGroup(@RequestBody Map<String, Object> body) {
        try {
            Map<String, Object> reqBody = new java.util.HashMap<>(body);
            int targetLimit = 10;
            if (reqBody.get("limit") != null) {
                try {
                    targetLimit = Integer.parseInt(reqBody.get("limit").toString());
                } catch (Exception ignored) {}
            }
            // Worker đếm bài CHƯA ĐĂNG (loại trừ theo excludeUrls, excludeIds và excludeSnippets)
            // nên chuyển targetLimit trực tiếp sang Worker để Worker cuộn sâu đến khi đủ số bài MỚI yêu cầu
            int rawLimit = Math.min(Math.max(targetLimit, 5), 100);
            // Lọc theo ngày (dateFrom/dateTo dạng YYYY-MM-DD): Worker tự dừng khi cuộn qua ngày bắt đầu,
            // nên cho phép lấy nhiều hơn để vẫn đủ bài mới sau khi lọc trùng
            boolean dateMode = (reqBody.get("dateFrom") != null && !reqBody.get("dateFrom").toString().isBlank())
                    || (reqBody.get("dateTo") != null && !reqBody.get("dateTo").toString().isBlank());
            if (dateMode) {
                rawLimit = 200;
            }
            reqBody.put("limit", rawLimit);

            String cookieString = (String) reqBody.get("cookieString");
            boolean isProvidedCookieExpired = false;
            if (cookieString != null && !cookieString.isBlank()) {
                String cUser = com.autopost.saas.service.SocialAccountService.extractCUser(cookieString);
                if (cUser != null) {
                    isProvidedCookieExpired = socialAccountRepository.findAll().stream()
                            .anyMatch(a -> "EXPIRED".equalsIgnoreCase(a.getTokenStatus())
                                    && a.getAccessToken() != null
                                    && a.getAccessToken().contains("c_user=" + cUser));
                }
            }

            if (cookieString == null || cookieString.isBlank() || isProvidedCookieExpired) {
                // Tự động fallback sang Cookie Facebook còn hạn (tokenStatus == "OK") từ CSDL
                try {
                    String healthyCookie = socialAccountRepository.findAll().stream()
                            .filter(a -> a.getAccessToken() != null && !a.getAccessToken().isBlank() && "OK".equalsIgnoreCase(a.getTokenStatus()))
                            .sorted((a, b) -> Long.compare(b.getId(), a.getId()))
                            .map(com.autopost.saas.entity.SocialAccount::getAccessToken)
                            .findFirst()
                            .orElse(null);
                    if (healthyCookie != null) {
                        cookieString = healthyCookie;
                        reqBody.put("cookieString", cookieString);
                    }
                } catch (Exception ignored) {}
            }

            // Lấy danh sách URL, ID và trích đoạn nội dung các bài viết đã có trong Lịch Đăng để báo cho Worker cuộn sâu lấy đủ số bài MỚI chưa đăng
            java.util.Set<String> existingUrls = new java.util.HashSet<>();
            java.util.Set<String> existingIds = new java.util.HashSet<>();
            java.util.List<String> existingSnippets = new java.util.ArrayList<>();
            List<com.autopost.saas.entity.PostQueue> allPosts = java.util.Collections.emptyList();
            try {
                allPosts = postQueueRepository.findAll();
                for (com.autopost.saas.entity.PostQueue pq : allPosts) {
                    if (pq.getOriginalUrl() != null && !pq.getOriginalUrl().isBlank()) {
                        String orig = pq.getOriginalUrl().trim();
                        existingUrls.add(orig);
                        String id = com.autopost.saas.util.FacebookPostIds.extractPostId(orig);
                        if (id != null && !id.isBlank()) existingIds.add(id);
                    }
                    if (pq.getPublishedPostUrl() != null && !pq.getPublishedPostUrl().isBlank()) {
                        String pub = pq.getPublishedPostUrl().trim();
                        existingUrls.add(pub);
                        String id = com.autopost.saas.util.FacebookPostIds.extractPostId(pub);
                        if (id != null && !id.isBlank()) existingIds.add(id);
                    }
                    if (pq.getContent() != null && !pq.getContent().isBlank()) {
                        String clean = com.autopost.saas.util.FacebookPostIds.normalizeContentForDedup(pq.getContent());
                        if (clean.length() >= 30) {
                            existingSnippets.add(clean.substring(0, Math.min(clean.length(), 100)));
                        }
                    }
                }
                reqBody.put("excludeUrls", new java.util.ArrayList<>(existingUrls));
                reqBody.put("excludeIds", new java.util.ArrayList<>(existingIds));
                reqBody.put("excludeSnippets", existingSnippets);
            } catch (Exception ex) {
                log.warn("Không thể lấy danh sách bài đã đăng: {}", ex.getMessage());
            }

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            HttpEntity<Map<String, Object>> request = new HttpEntity<>(reqBody, headers);
            Map<String, Object> response = restTemplate.postForObject(
                    LocalServices.WORKER_BASE + "/api/hunt-facebook-group", request, Map.class);

            if (response != null && Boolean.TRUE.equals(response.get("success")) && response.get("items") instanceof List) {
                List<Map<String, Object>> items = (List<Map<String, Object>>) response.get("items");
                try {
                    int alreadyCount = 0;
                    for (Map<String, Object> item : items) {
                        String url = (String) item.get("url");
                        String caption = (String) item.get("caption");
                        if (caption == null) caption = (String) item.get("content");
                        if (caption == null) caption = (String) item.get("title");

                        boolean alreadyImported = false;
                        String postStatus = null;

                        // 1. Kiểm tra theo URL và Post ID Facebook
                        if (url != null && !url.isBlank()) {
                            String trimmedUrl = url.trim();
                            for (com.autopost.saas.entity.PostQueue pq : allPosts) {
                                if (isSameFacebookPostUrl(trimmedUrl, pq.getOriginalUrl())
                                        || isSameFacebookPostUrl(trimmedUrl, pq.getPublishedPostUrl())) {
                                    alreadyImported = true;
                                    postStatus = pq.getStatus();
                                    break;
                                }
                            }
                        }

                        // 2. Kiểm tra theo nội dung Caption / Content (so trùng triệt để giữa link share và permalink)
                        if (!alreadyImported && caption != null && !caption.isBlank()) {
                            for (com.autopost.saas.entity.PostQueue pq : allPosts) {
                                if (com.autopost.saas.util.FacebookPostIds.isSameContent(caption, pq.getContent())
                                        || com.autopost.saas.util.FacebookPostIds.isSameContent(caption, pq.getTitle())) {
                                    alreadyImported = true;
                                    postStatus = pq.getStatus();
                                    break;
                                }
                            }
                        }

                        // 3. Nếu Worker đã đánh dấu trùng từ trước qua excludeIds/excludeSnippets
                        if (!alreadyImported && Boolean.TRUE.equals(item.get("isAlreadyImported"))) {
                            alreadyImported = true;
                        }

                        item.put("isAlreadyImported", alreadyImported);
                        if (alreadyImported) {
                            alreadyCount++;
                            item.put("postStatus", postStatus != null ? postStatus : "PUBLISHED");
                        }
                    }
                    response.put("alreadyImportedCount", alreadyCount);
                    log.info("🎯 Kiểm tra trùng Facebook: tổng {} bài, có {} bài ĐÃ TỪNG ĐĂNG / ĐÃ CÓ trong lịch.", items.size(), alreadyCount);
                } catch (Exception ex) {
                    log.warn("Không thể kiểm tra trùng bài viết: {}", ex.getMessage());
                }
            }
            return ResponseEntity.ok(response);
        } catch (HttpStatusCodeException hse) {
            String errorMsg = hse.getResponseBodyAsString();
            try {
                com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();
                Map<?, ?> errMap = mapper.readValue(errorMsg, Map.class);
                if (errMap.get("error") != null) {
                    errorMsg = errMap.get("error").toString();
                }
            } catch (Exception ignored) {}
            log.error("Lỗi gọi Worker hunt-facebook-group: {}", errorMsg);
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", errorMsg));
        } catch (Exception e) {
            log.error("Lỗi gọi Worker hunt-facebook-group: {}", e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("success", false, "error", e.getMessage()));
        }
    }

    /**
     * Lấy danh sách video đã đăng trên Fanpage qua Graph API
     * GET /api/tools/page-videos?pageId=...&accessToken=...
     */
    @GetMapping("/page-videos")
    public ResponseEntity<Map<String, Object>> getPageVideos(
            @RequestParam String pageId,
            @RequestParam String accessToken) {
        try {
            Map<String, Object> result = facebookGraphApiService.getPageVideos(pageId, accessToken);
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            log.error("Lỗi lấy video Fanpage: {}", e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("success", false, "error", e.getMessage()));
        }
    }

    /**
     * Đăng chéo một video đã tải lên sang các Fanpage khác
     * POST /api/tools/crosspost-video
     * Body: { videoId, originalAccessToken, targetPages: [{pageId, accessToken, title?, description?}] }
     */
    @SuppressWarnings("unchecked")
    @PostMapping("/crosspost-video")
    public ResponseEntity<Map<String, Object>> crosspostVideo(@RequestBody Map<String, Object> body) {
        try {
            String videoId = (String) body.get("videoId");
            String originalAccessToken = (String) body.get("originalAccessToken");
            List<Map<String, String>> targetPages = (List<Map<String, String>>) body.get("targetPages");

            if (videoId == null || originalAccessToken == null || targetPages == null || targetPages.isEmpty()) {
                return ResponseEntity.badRequest().body(Map.of("success", false, "error", "Thiếu videoId, originalAccessToken hoặc targetPages"));
            }

            // Bước 1: Enable crossposting cho tất cả target pages
            List<String> targetPageIds = targetPages.stream().map(p -> p.get("pageId")).toList();
            facebookGraphApiService.allowVideoCrossposting(videoId, originalAccessToken, targetPageIds);

            // Bước 2: Crosspost sang từng trang
            int success = 0;
            for (Map<String, String> target : targetPages) {
                String targetPageId = target.get("pageId");
                String targetToken = target.get("accessToken");
                String title = target.get("title");
                String description = target.get("description");
                Map<String, Object> res = facebookGraphApiService.crosspostVideo(targetPageId, targetToken, videoId, title, description);
                if (res != null && res.containsKey("id")) {
                    success++;
                    log.info("✅ Đăng chéo thành công sang Fanpage {} (PostID: {})", targetPageId, res.get("id"));
                }
            }
            return ResponseEntity.ok(Map.of("success", true, "crosspostedCount", success, "totalTargets", targetPages.size()));
        } catch (Exception e) {
            log.error("Lỗi khi Đăng Chéo Video: {}", e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("success", false, "error", e.getMessage()));
        }
    }

    /**
     * Cho phép crosspost video sang tất cả trang trong Business Manager
     * POST /api/tools/allow-bm-crosspost
     * Body: { videoId, accessToken }
     */
    @PostMapping("/allow-bm-crosspost")
    public ResponseEntity<Map<String, Object>> allowBmCrosspost(@RequestBody Map<String, String> body) {
        try {
            String videoId = body.get("videoId");
            String accessToken = body.get("accessToken");
            String url = "https://graph.facebook.com/v26.0/" + videoId + "?allow_bm_crossposting=true&access_token=" + accessToken;
            Map result = restTemplate.postForObject(url, null, Map.class);
            return ResponseEntity.ok(result != null ? result : Map.of("success", false));
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of("success", false, "error", e.getMessage()));
        }
    }

    private boolean isSameFacebookPostUrl(String url1, String url2) {
        if (url1 == null || url2 == null) return false;
        String u1 = url1.trim();
        String u2 = url2.trim();
        if (u1.isBlank() || u2.isBlank()) return false;
        if (u1.equalsIgnoreCase(u2)) return true;

        if (u1.matches("^https?://(www\\.)?facebook\\.com/groups/[^/]+/?$") || 
            u2.matches("^https?://(www\\.)?facebook\\.com/groups/[^/]+/?$")) {
            return false;
        }

        String norm1 = com.autopost.saas.util.FacebookPostIds.normalizeFacebookUrl(u1);
        String norm2 = com.autopost.saas.util.FacebookPostIds.normalizeFacebookUrl(u2);
        if (!norm1.isBlank() && norm1.equalsIgnoreCase(norm2)) return true;

        String id1 = extractFacebookPostId(u1);
        String id2 = extractFacebookPostId(u2);
        return id1 != null && !id1.isBlank() && id1.equalsIgnoreCase(id2);
    }

    private String extractFacebookPostId(String url) {
        return com.autopost.saas.util.FacebookPostIds.extractPostId(url);
    }

    private String extractTikTokVideoId(String url) {
        if (url == null || url.isBlank()) return null;
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("(?:video|v)/(\\d{15,25})").matcher(url);
        if (m.find()) {
            return m.group(1);
        }
        if (url.matches("^\\d{15,25}$")) {
            return url;
        }
        return null;
    }

    private boolean isSameTikTokVideo(String targetId, String targetUrl, String existingUrl) {
        if (existingUrl == null || existingUrl.isBlank()) return false;
        String exist = existingUrl.trim();
        if (targetUrl != null && targetUrl.equalsIgnoreCase(exist)) return true;
        if (targetId != null && !targetId.isBlank() && exist.contains(targetId)) return true;
        String existId = extractTikTokVideoId(exist);
        if (existId != null && targetId != null && existId.equals(targetId)) return true;
        return false;
    }
}

