package com.autopost.saas.controller;

import com.autopost.saas.service.GeminiService;
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
import org.springframework.web.servlet.support.ServletUriComponentsBuilder;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import com.autopost.saas.service.RedditService;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

/**
 * Ảnh "thẻ tin tức" (ảnh gốc + dải tiêu đề in hoa, cụm [[...]] tô đỏ):
 * - /headline: Gemini viết tiêu đề từ bài báo
 * - /render: worker dựng ảnh PNG, lưu vào uploads/ (giống MediaUploadController) để dùng làm mediaUrls
 * - /render-video: ghép video clip phía trên + khung tiêu đề phía dưới thành video tin tức .mp4
 */
@RestController
@RequestMapping("/api/news-card")
@CrossOrigin(originPatterns = "*")
@Slf4j
public class NewsCardController {

    private final RestTemplate restTemplate;
    private final GeminiService geminiService;
    private final RedditService redditService;
    private final Path uploadDir;

    public NewsCardController(GeminiService geminiService, RedditService redditService) {
        this.geminiService = geminiService;
        this.redditService = redditService;
        this.restTemplate = PooledRestTemplateFactory.create(10000, 120000);
        this.uploadDir = Paths.get("uploads").toAbsolutePath().normalize();
    }

    @PostMapping("/headline")
    public ResponseEntity<Map<String, Object>> headline(@RequestBody Map<String, String> body) {
        String title = body.get("title");
        String content = body.get("content");
        if ((title == null || title.isBlank()) && (content == null || content.isBlank())) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", "Thiếu tiêu đề hoặc nội dung bài để AI viết tiêu đề ảnh"));
        }
        try {
            String headline = geminiService.generateNewsCardHeadline(title, body.get("sapo"), content, body.get("apiKey"));
            return ResponseEntity.ok(Map.of("success", true, "headline", headline));
        } catch (Exception e) {
            log.error("[NewsCard] Lỗi Gemini viết tiêu đề: {}", e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("success", false, "error", e.getMessage()));
        }
    }

    /** Kiểm tra sức khỏe, kết nối và số lượt đã dùng hôm nay của các API Key */
    @PostMapping("/check-keys")
    public ResponseEntity<Map<String, Object>> checkKeys(@RequestBody(required = false) Map<String, String> body) {
        try {
            String apiKey = body != null ? body.get("apiKey") : null;
            java.util.List<Map<String, Object>> results = geminiService.checkAllKeys(apiKey);
            Map<String, Object> resp = new HashMap<>();
            resp.put("success", true);
            resp.put("results", results);
            return ResponseEntity.ok(resp);
        } catch (Exception e) {
            log.error("[NewsCard] Lỗi checkKeys: ", e);
            Map<String, Object> errResp = new HashMap<>();
            errResp.put("success", false);
            errResp.put("error", e.getMessage());
            errResp.put("results", java.util.Collections.emptyList());
            return ResponseEntity.ok(errResp);
        }
    }

    /** Soạn trọn gói cho Studio: tiêu đề ảnh + caption hook + tóm tắt chia đoạn có nguồn + nhãn góc */
    @PostMapping("/package")
    public ResponseEntity<Map<String, Object>> buildPackage(@RequestBody Map<String, String> body) {
        String title = body.get("title");
        String content = body.get("content");
        if ((title == null || title.isBlank()) && (content == null || content.isBlank())) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", "Thiếu tiêu đề hoặc nội dung bài"));
        }
        try {
            String json = geminiService.generateNewsPostPackage(title, body.get("sapo"), content, body.get("source"), body.get("apiKey"));
            @SuppressWarnings("unchecked")
            Map<String, Object> pkg = new com.fasterxml.jackson.databind.ObjectMapper().readValue(json, Map.class);
            Map<String, Object> resp = new HashMap<>(pkg);
            resp.put("success", true);
            return ResponseEntity.ok(resp);
        } catch (Exception e) {
            log.error("[NewsCard] Lỗi Gemini soạn bài: {}", e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("success", false, "error", e.getMessage()));
        }
    }

    @PostMapping("/render")
    public ResponseEntity<Map<String, Object>> render(@RequestBody Map<String, String> body) {
        String imageUrl = body.get("imageUrl");
        String headline = body.get("headline");
        // html: mẫu do Studio Ảnh Tin tạo sẵn (frontend/src/utils/newsCardTemplate.ts), khớp preview
        String html = body.get("html");
        boolean hasHtml = html != null && !html.isBlank();
        if (!hasHtml && (imageUrl == null || imageUrl.isBlank() || headline == null || headline.isBlank())) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", "Cần ảnh chính và tiêu đề để tạo ảnh"));
        }
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            Map<String, Object> payload = new HashMap<>();
            if (hasHtml) {
                payload.put("html", html);
            } else {
                payload.put("imageUrl", imageUrl.trim());
                payload.put("headline", headline);
            }
            String inset = body.get("insetImageUrl");
            if (inset != null && !inset.isBlank()) payload.put("insetImageUrl", inset.trim());

            @SuppressWarnings("unchecked")
            Map<String, Object> resp = restTemplate.postForObject(
                    "http://localhost:3001/api/render-news-card", new HttpEntity<>(payload, headers), Map.class);
            if (resp == null || !Boolean.TRUE.equals(resp.get("success")) || resp.get("pngBase64") == null) {
                String err = resp != null && resp.get("error") != null ? resp.get("error").toString() : "Worker không trả về ảnh";
                return ResponseEntity.status(502).body(Map.of("success", false, "error", err));
            }

            byte[] png = Base64.getDecoder().decode(resp.get("pngBase64").toString());
            Files.createDirectories(uploadDir);
            String filename = "newscard-" + UUID.randomUUID() + ".png";
            Files.write(uploadDir.resolve(filename), png);
            String fileUrl = ServletUriComponentsBuilder.fromCurrentContextPath()
                    .path("/uploads/")
                    .path(filename)
                    .toUriString();
            return ResponseEntity.ok(Map.of("success", true, "url", fileUrl));
        } catch (HttpStatusCodeException e) {
            log.error("[NewsCard] Worker lỗi khi tạo ảnh: {}", e.getResponseBodyAsString());
            return ResponseEntity.status(502).body(Map.of("success", false, "error", "Worker lỗi khi tạo ảnh: " + e.getResponseBodyAsString()));
        } catch (Exception e) {
            log.error("[NewsCard] Lỗi tạo ảnh: {}", e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("success", false, "error", e.getMessage()));
        }
    }

    /** Tự động kiểm tra bài viết (Reddit/...) có video không để chuyển sang chế độ Video News Card */
    @PostMapping("/resolve-media")
    public ResponseEntity<Map<String, Object>> resolveMedia(@RequestBody Map<String, String> body) {
        String url = body != null ? body.get("url") : null;
        if (url == null || url.isBlank()) return ResponseEntity.badRequest().body(Map.of("success", false));
        try {
            if (RedditService.isRedditPostUrl(url)) {
                Map<String, Object> item = redditService.fetchSinglePost(url);
                if (item != null) {
                    Map<String, Object> resp = new HashMap<>();
                    resp.put("success", true);
                    resp.put("hasVideo", Boolean.TRUE.equals(item.get("hasVideo")));
                    resp.put("videoUrl", item.getOrDefault("videoUrl", ""));
                    resp.put("previewCover", item.getOrDefault("previewCover", ""));
                    resp.put("mediaUrls", item.getOrDefault("mediaUrls", java.util.Collections.emptyList()));
                    return ResponseEntity.ok(resp);
                }
            }
        } catch (Exception e) {
            log.warn("[NewsCard] Không resolve được media cho {}: {}", url, e.getMessage());
        }
        return ResponseEntity.ok(Map.of("success", false));
    }

    /** Ghép Video gốc + Khung tiêu đề tin tức (Overlay PNG) thành file Video MP4 chuẩn */
    @PostMapping("/render-video")
    public ResponseEntity<Map<String, Object>> renderVideo(@RequestBody Map<String, Object> body) {
        String videoUrl = body.get("videoUrl") != null ? body.get("videoUrl").toString() : null;
        String html = body.get("html") != null ? body.get("html").toString() : null;
        if (videoUrl == null || videoUrl.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", "Thiếu link video (videoUrl)"));
        }
        if (html == null || html.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", "Thiếu HTML mẫu khung tin tức"));
        }
        Path tempVideoToClean = null;
        Path overlayPng = null;
        try {
            // 1. Chuẩn bị file video mp4 gốc
            Path localVideo;
            if (videoUrl.startsWith("/uploads/")) {
                localVideo = uploadDir.resolve(videoUrl.replace("/uploads/", "")).normalize();
            } else if (videoUrl.contains("v.redd.it/")) {
                String relPath = redditService.downloadVideoWithAudio(videoUrl);
                localVideo = uploadDir.resolve(relPath.replace("/uploads/", "")).normalize();
            } else if (videoUrl.startsWith("http://") || videoUrl.startsWith("https://")) {
                tempVideoToClean = Files.createTempFile("nc_vid_in_", ".mp4");
                localVideo = tempVideoToClean;
                HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(30)).build();
                HttpRequest req = HttpRequest.newBuilder(URI.create(videoUrl)).timeout(Duration.ofSeconds(120)).build();
                HttpResponse<Path> resp = client.send(req, HttpResponse.BodyHandlers.ofFile(localVideo, java.nio.file.StandardOpenOption.CREATE, java.nio.file.StandardOpenOption.WRITE));
                if (resp.statusCode() != 200 || Files.size(localVideo) == 0) {
                    throw new IllegalStateException("Không tải được file video (HTTP " + resp.statusCode() + "): " + videoUrl);
                }
            } else {
                localVideo = Paths.get(videoUrl).toAbsolutePath().normalize();
            }
            if (!Files.exists(localVideo) || Files.size(localVideo) == 0) {
                throw new IllegalStateException("File video không tồn tại hoặc rỗng: " + localVideo);
            }

            // 2. Gọi Worker Playwright để chụp khung ảnh Overlay trong suốt (PNG)
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            Map<String, Object> payload = Map.of("html", html);
            @SuppressWarnings("unchecked")
            Map<String, Object> resp = restTemplate.postForObject(
                    "http://localhost:3001/api/render-news-card", new HttpEntity<>(payload, headers), Map.class);
            if (resp == null || !Boolean.TRUE.equals(resp.get("success")) || resp.get("pngBase64") == null) {
                String err = resp != null && resp.get("error") != null ? resp.get("error").toString() : "Worker không tạo được khung ảnh";
                throw new IllegalStateException(err);
            }
            byte[] overlayBytes = Base64.getDecoder().decode(resp.get("pngBase64").toString());
            overlayPng = Files.createTempFile("nc_overlay_", ".png");
            Files.write(overlayPng, overlayBytes);

            // 3. Đo kích thước canvas từ ratio hoặc thông số (mặc định 1080x1080 vuông hoặc 1080x1350 dọc 4:5)
            int canvasW = 1080;
            int canvasH = "4:5".equals(body.get("ratio")) ? 1350 : 1080;
            double photoHeightPct = body.get("photoHeightPct") instanceof Number n ? n.doubleValue() : 68.0;
            double photoTopPct = body.get("photoTopPct") instanceof Number n ? n.doubleValue() : 0.0;
            int photoH = Math.max(200, (int) Math.round(canvasH * (photoHeightPct / 100.0)));
            int photoTop = Math.max(0, (int) Math.round(canvasH * (photoTopPct / 100.0)));

            // 4. Ghép Video + Khung Overlay bằng FFmpeg
            Files.createDirectories(uploadDir);
            String outFilename = "newscard-video-" + UUID.randomUUID() + ".mp4";
            Path outFile = uploadDir.resolve(outFilename);

            String filterComplex = String.format(
                    "[0:v]scale=%d:%d:force_original_aspect_ratio=increase,crop=%d:%d,boxblur=25:5,setsar=1[vbg];" +
                    "[0:v]scale=%d:%d:force_original_aspect_ratio=decrease,setsar=1[vfg];" +
                    "[vbg][vfg]overlay=(W-w)/2:(H-h)/2[vphoto];" +
                    "color=c=black:s=%dx%d:r=30[canvas];" +
                    "[canvas][vphoto]overlay=0:%d[base];" +
                    "[1:v]scale=%d:%d[overlay_sc];" +
                    "[base][overlay_sc]overlay=0:0:format=auto[vout]",
                    canvasW, photoH, canvasW, photoH,
                    canvasW, photoH,
                    canvasW, canvasH,
                    photoTop,
                    canvasW, canvasH
            );

            ProcessBuilder pb = new ProcessBuilder(
                    RedditService.ffmpegPath(), "-y",
                    "-i", localVideo.toString(),
                    "-loop", "1", "-i", overlayPng.toString(),
                    "-filter_complex", filterComplex,
                    "-map", "[vout]", "-map", "0:a?",
                    "-c:v", "libx264", "-preset", "fast", "-crf", "22", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", "-b:a", "192k",
                    "-shortest",
                    outFile.toString()
            );
            pb.redirectErrorStream(true);
            Process p = pb.start();
            String logOutput = new String(p.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            boolean finished = p.waitFor(180, java.util.concurrent.TimeUnit.SECONDS);
            if (!finished || p.exitValue() != 0) {
                p.destroyForcibly();
                log.error("[NewsCard] FFmpeg composite lỗi: {}", logOutput);
                throw new IllegalStateException("FFmpeg lỗi khi tạo video: " + logOutput);
            }

            String fileUrl = ServletUriComponentsBuilder.fromCurrentContextPath()
                    .path("/uploads/")
                    .path(outFilename)
                    .toUriString();

            return ResponseEntity.ok(Map.of("success", true, "url", fileUrl));
        } catch (Exception e) {
            log.error("[NewsCard] Lỗi render-video: ", e);
            return ResponseEntity.internalServerError().body(Map.of("success", false, "error", e.getMessage()));
        } finally {
            if (overlayPng != null) {
                try { Files.deleteIfExists(overlayPng); } catch (Exception ignored) {}
            }
            if (tempVideoToClean != null) {
                try { Files.deleteIfExists(tempVideoToClean); } catch (Exception ignored) {}
            }
        }
    }
}
