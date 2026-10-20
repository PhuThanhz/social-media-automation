package com.autopost.saas.controller;

import com.autopost.saas.service.GeminiService;
import com.autopost.saas.service.RedditService;
import com.autopost.saas.util.PooledRestTemplateFactory;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestTemplate;

import java.util.*;

@RestController
@RequestMapping("/api/news-radar")
@CrossOrigin(originPatterns = "*")
@Slf4j
public class NewsRadarController {

    private final RestTemplate restTemplate;
    private final RedditService redditService;
    private final GeminiService geminiService;

    public NewsRadarController(RedditService redditService, GeminiService geminiService) {
        this.redditService = redditService;
        this.geminiService = geminiService;
        this.restTemplate = PooledRestTemplateFactory.create(10000, 120000);
    }

    @PostMapping("/scrape-article")
    public ResponseEntity<Map<String, Object>> scrapeArticle(@RequestBody Map<String, String> body) {
        String url = body.get("url");
        if (url == null || url.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", "Thiếu url bài viết"));
        }
        url = url.trim();

        // 1. Nếu là link Reddit -> sử dụng RedditService để bypass captcha & lấy ảnh/video gốc
        if (url.contains("reddit.com") || url.contains("redd.it")) {
            try {
                Map<String, Object> rPost = redditService.fetchSinglePost(url);
                @SuppressWarnings("unchecked")
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
                log.warn("[NewsRadar] Lỗi cào Reddit bài đơn: {}", re.getMessage());
                return ResponseEntity.ok(Map.of("success", false, "error", "Không thể lấy bài Reddit: " + re.getMessage()));
            }
        }

        // 2. Với các trang báo thông thường -> chuyển worker cào full html/ảnh
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            HttpEntity<Map<String, String>> request = new HttpEntity<>(body, headers);
            @SuppressWarnings("unchecked")
            Map<String, Object> response = restTemplate.postForObject(
                    "http://localhost:3001/api/scrape-article", request, Map.class);
            return ResponseEntity.ok(response != null ? response : Map.of("success", false, "error", "Worker không phản hồi"));
        } catch (HttpStatusCodeException e) {
            log.warn("[NewsRadar] Worker trả lỗi khi cào bài báo: {}", e.getResponseBodyAsString());
            return ResponseEntity.status(e.getStatusCode()).body(Map.of("success", false, "error", e.getResponseBodyAsString()));
        } catch (Exception e) {
            log.error("[NewsRadar] Lỗi cào bài báo: {}", e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("success", false, "error", e.getMessage()));
        }
    }

    @PostMapping("/rewrite")
    public ResponseEntity<Map<String, Object>> rewrite(@RequestBody Map<String, String> body) {
        String title = body.get("title");
        String sapo = body.get("sapo");
        String content = body.get("content");
        String style = body.getOrDefault("style", "FANPAGE_POST");
        String apiKey = body.get("apiKey");

        try {
            String rewritten = geminiService.rewriteRealEstateArticle(title, sapo, content, style, apiKey);
            return ResponseEntity.ok(Map.of("success", true, "rewrittenContent", rewritten));
        } catch (Exception e) {
            log.error("[NewsRadar] Lỗi AI viết lại bài: {}", e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("success", false, "error", e.getMessage()));
        }
    }
}
