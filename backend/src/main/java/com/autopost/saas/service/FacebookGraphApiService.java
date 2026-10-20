package com.autopost.saas.service;

import com.autopost.saas.exception.GraphApiException;
import com.autopost.saas.util.PooledRestTemplateFactory;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestTemplate;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.RequestEntity;
import java.net.URI;

/**
 * Đăng bài lên Fanpage Facebook qua Graph API chính thức (dùng Page Access Token),
 * dùng song song với cách đăng bằng cookie/Playwright ở worker cho các fanpage accountType=PERSONAL_COOKIE.
 */
@Service
@Slf4j
public class FacebookGraphApiService {

    @Value("${facebook.graph-api.version:v20.0}")
    private String graphApiVersion;

    private static final int MAX_RETRIES = 2;
    private static final List<Integer> RETRYABLE_ERROR_CODES = List.of(4, 17, 32); // rate-limit codes của Facebook

    // Feed cần chờ lâu hơn Story vì validation encoding trên Feed thường khắt khe/chậm hơn.
    private static final int FEED_VIDEO_POLL_MAX_ATTEMPTS = 25; // ~50s
    private static final int STORY_VIDEO_POLL_MAX_ATTEMPTS = 15; // ~30s
    private static final long VIDEO_POLL_SLEEP_MS = 2000L;
    private static final String PENDING_VIDEO_WARNING =
            "Video đã upload lên Facebook nhưng chưa xác nhận mã hóa xong trong thời gian chờ. " +
            "Bài có thể đã lên Trang, vui lòng kiểm tra lại thủ công trên Fanpage.";

    // readTimeout dài vì có tải byte[] video Facebook (getForObject) và polling trạng thái mã hóa video.
    private final RestTemplate restTemplate = PooledRestTemplateFactory.create(10000, 180000);
    private final ObjectMapper objectMapper = new ObjectMapper();

    private String base() {
        return "https://graph.facebook.com/" + graphApiVersion;
    }

    public Map<String, Object> publishText(String pageId, String pageAccessToken, String message) {
        return publishText(pageId, pageAccessToken, message, null);
    }

    public Map<String, Object> publishText(String pageId, String pageAccessToken, String message, Long scheduledPublishTime) {
        Map<String, String> body = new HashMap<>();
        body.put("message", message);
        body.put("access_token", pageAccessToken);
        if (scheduledPublishTime != null && scheduledPublishTime > 0) {
            body.put("published", "false");
            body.put("scheduled_publish_time", String.valueOf(scheduledPublishTime));
        }
        return post(base() + "/" + pageId + "/feed", body);
    }

    /**
     * Tự động comment vào 1 bài đăng (feed post, ảnh, hoặc video) vừa đăng thành công.
     * Dùng cho tính năng gắn link affiliate cố định dưới mỗi bài — bài trên tường vẫn giữ nguyên,
     * comment thất bại không ảnh hưởng đến việc bài đã đăng thành công.
     * @param postId ID bài đăng/ảnh/video (field "id" Facebook trả về khi đăng)
     */
    public Map<String, Object> commentOnPost(String postId, String pageAccessToken, String message) {
        Map<String, String> body = new HashMap<>();
        body.put("message", message);
        body.put("access_token", pageAccessToken);
        return post(base() + "/" + postId + "/comments", body);
    }

    public Map<String, Object> publishPhoto(String pageId, String pageAccessToken, String message, String imageUrl) {
        return publishPhoto(pageId, pageAccessToken, message, imageUrl, null);
    }

    public Map<String, Object> publishPhoto(String pageId, String pageAccessToken, String message, String imageUrl, Long scheduledPublishTime) {
        Map<String, String> body = new HashMap<>();
        body.put("url", imageUrl);
        body.put("caption", message);
        body.put("access_token", pageAccessToken);
        if (scheduledPublishTime != null && scheduledPublishTime > 0) {
            body.put("published", "false");
            body.put("scheduled_publish_time", String.valueOf(scheduledPublishTime));
        }
        return post(base() + "/" + pageId + "/photos", body);
    }


    /**
     * Bật quyền đăng chéo (Crossposting) cho Video đến các Trang phụ:
     * Bước 1: POST /{video_id}?allow_crossposting_for_pages=[{page_id: ..., allow: true}]
     */
    public Map<String, Object> allowVideoCrossposting(String videoId, String originalPageAccessToken, List<String> targetPageIds) {
        try {
            StringBuilder pagesJson = new StringBuilder("[");
            for (int i = 0; i < targetPageIds.size(); i++) {
                pagesJson.append("{\"page_id\":\"").append(targetPageIds.get(i)).append("\",\"allow\":true}");
                if (i < targetPageIds.size() - 1) pagesJson.append(",");
            }
            pagesJson.append("]");

            Map<String, String> body = new HashMap<>();
            body.put("allow_crossposting_for_pages", pagesJson.toString());
            body.put("access_token", originalPageAccessToken);
            log.info("🌐 Đang bật quyền Đăng Chéo (Crossposting) cho Video ID {} tới {} Trang phụ...", videoId, targetPageIds.size());
            return post(base() + "/" + videoId, body);
        } catch (Exception e) {
            log.error("Lỗi khi mở quyền Đăng Chéo Video: {}", e.getMessage());
        }
        return Map.of("success", false);
    }

    /**
     * Đăng chéo Video lên Trang phụ không cần tải lại file (Crosspost Video):
     * Bước 2: POST /{target_page_id}/videos?crossposted_video_id={video_id}
     */
    public Map<String, Object> crosspostVideo(String targetPageId, String targetPageAccessToken, String crosspostedVideoId, String title, String description) {
        try {
            Map<String, String> body = new HashMap<>();
            body.put("crossposted_video_id", crosspostedVideoId);
            if (title != null) body.put("title", title);
            if (description != null) body.put("description", description);
            body.put("access_token", targetPageAccessToken);
            log.info("🚀 Đang Đăng Chéo (Crosspost) Video ID {} sang Fanpage ID {}...", crosspostedVideoId, targetPageId);
            return post(base() + "/" + targetPageId + "/videos", body);
        } catch (Exception e) {
            log.error("Lỗi khi Đăng Chéo Video sang Trang {}: {}", targetPageId, e.getMessage());
        }
        return Map.of("success", false);
    }

    /**
     * Lấy danh sách tất cả Video đã đăng trên Trang Facebook qua Official Graph API:
     * GET /{page_id}/videos?fields=id,description,source,updated_time
     */
    public Map<String, Object> getPageVideos(String pageId, String pageAccessToken) {
        try {
            String url = base() + "/" + pageId + "/videos?fields=id,description,source,updated_time&access_token=" + pageAccessToken;
            log.info("🔍 Đang lấy danh sách Video trên Fanpage ID {} via Graph API...", pageId);
            return restTemplate.getForObject(url, Map.class);
        } catch (Exception e) {
            log.error("Lỗi khi lấy video trên Trang {}: {}", pageId, e.getMessage());
        }
        return Map.of("data", List.of());
    }

    /**
     * Lấy tất cả video mà một Người dùng Facebook tải lên:
     * GET /{user_id}/videos?type=uploaded
     */
    public Map<String, Object> getUserUploadedVideos(String userId, String userAccessToken) {
        try {
            String url = base() + "/" + userId + "/videos?type=uploaded&fields=id,description,source,updated_time&access_token=" + userAccessToken;
            log.info("🔍 Đang lấy danh sách Video đã tải lên của User ID {} via Graph API...", userId);
            return restTemplate.getForObject(url, Map.class);
        } catch (Exception e) {
            log.error("Lỗi khi lấy video của User {}: {}", userId, e.getMessage());
        }
        return Map.of("data", List.of());
    }

    public Map<String, Object> publishTextToGroup(String groupId, String pageAccessToken, String message) {
        Map<String, String> body = new HashMap<>();
        body.put("message", message);
        body.put("access_token", pageAccessToken);
        return post(base() + "/" + groupId + "/feed", body);
    }

    public Map<String, Object> publishPhotoToGroup(String groupId, String pageAccessToken, String message, String imageUrl) {
        Map<String, String> body = new HashMap<>();
        body.put("url", imageUrl);
        body.put("caption", message);
        body.put("access_token", pageAccessToken);
        return post(base() + "/" + groupId + "/photos", body);
    }

    public Map<String, Object> publishVideoToGroup(String groupId, String pageAccessToken, String message, String videoUrl) {
        if (videoUrl != null && (videoUrl.contains("localhost") || videoUrl.startsWith("/") || videoUrl.contains("127.0.0.1"))) {
            return uploadVideoBinary(groupId, pageAccessToken, message, videoUrl, null);
        }
        MultiValueMap<String, String> body = new LinkedMultiValueMap<>();
        body.add("file_url", videoUrl);
        body.add("description", message);
        body.add("access_token", pageAccessToken);
        return postForm("https://graph-video.facebook.com/" + graphApiVersion + "/" + groupId + "/videos", body);
    }

    public Map<String, Object> publishVideo(String pageId, String pageAccessToken, String message, String videoUrl) {
        return publishVideo(pageId, pageAccessToken, message, videoUrl, null);
    }

    public Map<String, Object> publishVideo(String pageId, String pageAccessToken, String message, String videoUrl, Long scheduledPublishTime) {
        if (videoUrl != null && (videoUrl.contains("localhost") || videoUrl.startsWith("/") || videoUrl.contains("127.0.0.1"))) {
            return uploadVideoBinary(pageId, pageAccessToken, message, videoUrl, scheduledPublishTime);
        }
        MultiValueMap<String, String> body = new LinkedMultiValueMap<>();
        body.add("file_url", videoUrl);
        body.add("description", message);
        body.add("access_token", pageAccessToken);
        if (scheduledPublishTime != null && scheduledPublishTime > 0) {
            body.add("published", "false");
            body.add("scheduled_publish_time", String.valueOf(scheduledPublishTime));
        }
        Map<String, Object> resp = postForm("https://graph-video.facebook.com/" + graphApiVersion + "/" + pageId + "/videos", body);
        confirmVideoEncodedOrThrow(resp, pageAccessToken);
        return resp;
    }

    /**
     * Chờ Meta xác nhận trạng thái mã hóa video (video_status) trước khi coi là đăng thật sự thành công.
     * Nếu Meta báo "error" (vd sai tỷ lệ khung hình, độ phân giải quá thấp...), ném GraphApiException với
     * lỗi thật thay vì để caller báo "đăng thành công" giả trong khi video thực chất bị từ chối.
     */
    private void confirmVideoEncodedOrThrow(Map<String, Object> resp, String pageAccessToken) {
        if (resp == null || resp.get("id") == null) return;
        String videoId = String.valueOf(resp.get("id"));
        String[] statusResult = waitForVideoStatus(videoId, pageAccessToken, FEED_VIDEO_POLL_MAX_ATTEMPTS, VIDEO_POLL_SLEEP_MS);
        if ("error".equals(statusResult[0])) {
            log.error("❌ Meta từ chối Video vừa đăng lên Fanpage trong quá trình mã hóa: {}", statusResult[1]);
            throw new GraphApiException(statusResult[1], -1, -1, null);
        } else if ("pending".equals(statusResult[0])) {
            log.warn("⚠️ Video ID {} chưa xác nhận mã hóa xong trong thời gian chờ (Facebook đã tạo bài viết, vẫn đang xử lý ngầm)", videoId);
            resp.put("pending", Boolean.TRUE);
            resp.put("warning", PENDING_VIDEO_WARNING);
        } else {
            log.info("✅ Video ID {} đã mã hóa xong (ready), xác nhận đăng thành công thật sự.", videoId);
        }
    }

    /**
     * Poll trạng thái mã hóa video (video_status) tối đa maxAttempts*sleepMs ms.
     * Trả về {status, errorMessage} với status là "ready", "error", hoặc "pending" nếu hết thời gian chờ mà chưa rõ.
     */
    @SuppressWarnings("unchecked")
    private String[] waitForVideoStatus(String videoId, String pageAccessToken, int maxAttempts, long sleepMs) {
        try {
            for (int i = 0; i < maxAttempts; i++) {
                Thread.sleep(sleepMs);
                String statusUrl = base() + "/" + videoId + "?fields=status&access_token=" + pageAccessToken;
                Map<String, Object> statusResp = restTemplate.getForObject(statusUrl, Map.class);
                if (statusResp != null && statusResp.get("status") instanceof Map statusMap) {
                    String videoStatus = String.valueOf(statusMap.get("video_status"));
                    if ("error".equalsIgnoreCase(videoStatus)) {
                        String errorMsg = "Meta từ chối video trong quá trình mã hóa (vd: tỷ lệ khung hình, độ phân giải quá thấp...)";
                        if (statusMap.get("processing_phase") instanceof Map procMap && procMap.get("errors") instanceof List errList && !errList.isEmpty()) {
                            Object firstErr = errList.get(0);
                            if (firstErr instanceof Map errObj && errObj.containsKey("message")) {
                                errorMsg = String.valueOf(errObj.get("message"));
                            }
                        }
                        return new String[]{"error", errorMsg};
                    } else if ("ready".equalsIgnoreCase(videoStatus)) {
                        return new String[]{"ready", null};
                    }
                }
            }
        } catch (Exception pollEx) {
            log.warn("⚠️ Không thể kiểm tra status video {}: {}", videoId, pollEx.getMessage());
        }
        return new String[]{"pending", null};
    }

    private Map<String, Object> uploadVideoBinary(String pageId, String pageAccessToken, String message, String videoUrlOrPath, Long scheduledPublishTime) {
        try {
            log.info("📤 Đang upload file binary Video MP4 trực tiếp lên Facebook Graph Video API...");
            byte[] bytes;
            if (videoUrlOrPath.startsWith("http")) {
                bytes = restTemplate.getForObject(videoUrlOrPath, byte[].class);
            } else {
                bytes = java.nio.file.Files.readAllBytes(java.nio.file.Paths.get(videoUrlOrPath));
            }
            if (bytes == null || bytes.length == 0) throw new RuntimeException("File video rỗng");

            org.springframework.core.io.ByteArrayResource contentsAsResource = new org.springframework.core.io.ByteArrayResource(bytes) {
                @Override
                public String getFilename() {
                    return "video.mp4";
                }
            };

            MultiValueMap<String, Object> body = new LinkedMultiValueMap<>();
            body.add("source", contentsAsResource);
            body.add("description", message);
            body.add("access_token", pageAccessToken);
            if (scheduledPublishTime != null && scheduledPublishTime > 0) {
                body.add("published", "false");
                body.add("scheduled_publish_time", String.valueOf(scheduledPublishTime));
            }

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.MULTIPART_FORM_DATA);
            HttpEntity<MultiValueMap<String, Object>> requestEntity = new HttpEntity<>(body, headers);

            String url = "https://graph-video.facebook.com/" + graphApiVersion + "/" + pageId + "/videos";
            Map<String, Object> response = restTemplate.postForObject(url, requestEntity, Map.class);
            log.info("📤 Đã upload xong file video lên Facebook, đang chờ Meta mã hóa: {}", response);
            confirmVideoEncodedOrThrow(response, pageAccessToken);
            return response;
        } catch (GraphApiException ge) {
            throw ge;
        } catch (Exception e) {
            log.error("❌ Lỗi upload file binary video lên Facebook Graph API: {}", e.getMessage());
            throw new GraphApiException("Lỗi upload video: " + e.getMessage(), -1, -1, e);
        }
    }

    /** Upload 1 ảnh ở trạng thái chưa publish (published=false), dùng làm nguyên liệu cho đăng album nhiều ảnh. Trả về photo_id, null nếu upload lỗi. */
    public String uploadUnpublishedPhoto(String pageId, String pageAccessToken, String imageUrl) {
        Map<String, String> body = new HashMap<>();
        body.put("url", imageUrl);
        body.put("published", "false");
        body.put("access_token", pageAccessToken);
        Map<String, Object> response = post(base() + "/" + pageId + "/photos", body);
        return response != null && response.get("id") != null ? response.get("id").toString() : null;
    }

    /** Đăng 1 bài feed đính kèm nhiều ảnh đã upload unpublished trước đó (flow album chính thức của Graph API). */
    public Map<String, Object> publishAlbum(String pageId, String pageAccessToken, String message, List<String> photoIds) {
        MultiValueMap<String, String> formBody = new LinkedMultiValueMap<>();
        formBody.add("message", message);
        formBody.add("access_token", pageAccessToken);
        for (int i = 0; i < photoIds.size(); i++) {
            formBody.add("attached_media[" + i + "]", "{\"media_fbid\":\"" + photoIds.get(i) + "\"}");
        }
        return postForm(base() + "/" + pageId + "/feed", formBody);
    }

    public Map<String, Object> getPageName(String pageId, String pageAccessToken) {
        String url = base() + "/" + pageId + "?fields=name&access_token=" + pageAccessToken;
        return restTemplate.getForObject(url, Map.class);
    }

    /**
     * Kiểm tra trạng thái/hạn dùng của 1 Access Token qua Graph API Debug Token.
     * Dùng chính token đó làm access_token kiểm tra (tự soi chính nó) để không cần App Token riêng.
     * Trả về Map rỗng nếu gọi lỗi (token đã chết hẳn, hoặc lỗi mạng).
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> debugToken(String tokenToInspect) {
        try {
            String url = base() + "/debug_token?input_token=" + tokenToInspect + "&access_token=" + tokenToInspect;
            Map<String, Object> resp = restTemplate.getForObject(url, Map.class);
            if (resp != null && resp.get("data") instanceof Map) {
                return (Map<String, Object>) resp.get("data");
            }
        } catch (Exception e) {
            log.warn("⚠️ Không kiểm tra được trạng thái token (có thể đã hết hạn/thu hồi): {}", e.getMessage());
        }
        return Map.of();
    }

    /**
     * Lấy chỉ số hiệu suất (reach, impressions, engagement) + like/comment/share count của 1 bài đã
     * đăng qua Graph API. Chỉ hoạt động với bài đăng bằng PAGE_TOKEN (account dùng cookie Playwright
     * không có post_id thật từ Graph API nên không tra insights được).
     * @param fbPostId dạng "{page-id}_{post-id}", lấy từ PostQueue.fbPostId sau khi đăng thành công.
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> getPostInsights(String fbPostId, String pageAccessToken) {
        Map<String, Object> result = new HashMap<>();
        try {
            String metrics = "post_impressions,post_impressions_unique,post_engaged_users";
            String insightsUrl = base() + "/" + fbPostId + "/insights?metric=" + metrics + "&access_token=" + pageAccessToken;
            Map<String, Object> insightsResp = restTemplate.getForObject(insightsUrl, Map.class);
            if (insightsResp != null && insightsResp.get("data") instanceof List) {
                for (Object entry : (List<Object>) insightsResp.get("data")) {
                    if (!(entry instanceof Map)) continue;
                    Map<String, Object> metricMap = (Map<String, Object>) entry;
                    String name = String.valueOf(metricMap.get("name"));
                    List<Object> values = (List<Object>) metricMap.get("values");
                    if (values != null && !values.isEmpty() && values.get(0) instanceof Map) {
                        result.put(name, ((Map<String, Object>) values.get(0)).get("value"));
                    }
                }
            }
        } catch (Exception e) {
            log.warn("⚠️ Không lấy được insights cho bài {}: {}", fbPostId, e.getMessage());
        }
        try {
            String fieldsUrl = base() + "/" + fbPostId + "?fields=likes.summary(true),comments.summary(true),shares&access_token=" + pageAccessToken;
            Map<String, Object> fieldsResp = restTemplate.getForObject(fieldsUrl, Map.class);
            if (fieldsResp != null) {
                result.put("likeCount", extractSummaryCount(fieldsResp.get("likes")));
                result.put("commentCount", extractSummaryCount(fieldsResp.get("comments")));
                Object shares = fieldsResp.get("shares");
                result.put("shareCount", (shares instanceof Map) ? ((Map<String, Object>) shares).get("count") : 0);
            }
        } catch (Exception e) {
            log.warn("⚠️ Không lấy được like/comment/share cho bài {}: {}", fbPostId, e.getMessage());
        }
        return result;
    }

    @SuppressWarnings("unchecked")
    private Object extractSummaryCount(Object field) {
        if (field instanceof Map summaryHolder && summaryHolder.get("summary") instanceof Map summary) {
            return summary.get("total_count");
        }
        return 0;
    }

    /**
     * Đăng Video Story lên Fanpage theo chuẩn Meta Graph API (Facebook Stories API).
     * Flow 3 bước:
     *   1. POST /{page_id}/video_stories?upload_phase=start → nhận video_id + upload_url
     *   2. POST {upload_url} với binary video + OAuth header → upload video
     *   3. POST /{page_id}/video_stories?upload_phase=finish&published=true → Story live!
     * @param pageId          ID của Fanpage
     * @param pageAccessToken Page Access Token (phải có quyền pages_manage_posts)
     * @param videoUrl        URL hoặc đường dẫn file video (.mp4)
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> publishVideoStory(String pageId, String pageAccessToken, String videoUrl) {
        try {
            // === Bước 1: Khởi tạo upload session ===
            MultiValueMap<String, String> startBody = new LinkedMultiValueMap<>();
            startBody.add("upload_phase", "start");
            startBody.add("access_token", pageAccessToken);
            Map<String, Object> startResp = postForm(base() + "/" + pageId + "/video_stories", startBody);

            String videoId = startResp != null ? String.valueOf(startResp.get("video_id")) : null;
            String uploadUrl = startResp != null ? String.valueOf(startResp.get("upload_url")) : null;

            if (videoId == null || uploadUrl == null || videoId.equals("null")) {
                log.error("❌ Không lấy được video_id từ video_stories start. Response: {}", startResp);
                return Map.of("success", false, "error", "Không khởi tạo được upload session Story");
            }
            log.info("🎥 Story Upload Session: video_id={}, upload_url={}", videoId, uploadUrl);

            // === Bước 2: Download video về máy rồi upload binary lên Facebook ===
            // ⚠️ QUAN TRỌNG: Meta CDN (fbcdn.net / instagram.fsgn*) TỪ CHỐI nếu dùng file_url trực tiếp
            // → Phải download về bytes trước rồi upload binary mới hoạt động!
            byte[] videoBytes;
            if (videoUrl.startsWith("http")) {
                try {
                    // Download với headers giống browser để vượt qua CDN protection
                    HttpHeaders dlHeaders = new HttpHeaders();
                    dlHeaders.set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36");
                    dlHeaders.set("Accept", "*/*");
                    dlHeaders.set("Referer", "https://www.instagram.com/");
                    org.springframework.http.ResponseEntity<byte[]> dlResp = restTemplate.exchange(
                        videoUrl,
                        org.springframework.http.HttpMethod.GET,
                        new HttpEntity<>(dlHeaders),
                        byte[].class
                    );
                    videoBytes = dlResp.getBody();
                    log.info("📥 Đã download video: {} bytes", videoBytes != null ? videoBytes.length : 0);
                } catch (Exception dlEx) {
                    log.error("❌ Lỗi download video từ URL: {}", dlEx.getMessage());
                    return Map.of("success", false, "error", "Không tải được video từ URL: " + dlEx.getMessage());
                }
            } else {
                videoBytes = java.nio.file.Files.readAllBytes(java.nio.file.Paths.get(videoUrl));
            }
            if (videoBytes == null || videoBytes.length == 0) {
                return Map.of("success", false, "error", "File video rỗng hoặc không tải được");
            }

            HttpHeaders uploadHeaders = new HttpHeaders();
            uploadHeaders.setContentType(MediaType.parseMediaType("video/mp4"));
            uploadHeaders.set("Authorization", "OAuth " + pageAccessToken);
            uploadHeaders.set("offset", "0");
            uploadHeaders.set("file_size", String.valueOf(videoBytes.length));

            HttpEntity<byte[]> uploadEntity = new HttpEntity<>(videoBytes, uploadHeaders);
            Map<String, Object> uploadResp = restTemplate.postForObject(uploadUrl, uploadEntity, Map.class);
            log.info("📤 Story video upload response: {}", uploadResp);

            if (uploadResp == null || !Boolean.TRUE.equals(uploadResp.get("success"))) {
                log.error("❌ Upload video Story thất bại: {}", uploadResp);
                return Map.of("success", false, "error", "Upload video Story thất bại: " + uploadResp);
            }

            // === Bước 3: Publish Story theo chuẩn Meta API ===
            MultiValueMap<String, String> finishBody = new LinkedMultiValueMap<>();
            finishBody.add("video_id", videoId);
            finishBody.add("upload_phase", "finish");
            finishBody.add("access_token", pageAccessToken);
            Map<String, Object> publishResp = postForm(base() + "/" + pageId + "/video_stories", finishBody);

            // === Bước 4: Kiểm tra trạng thái mã hóa video từ Meta (bắt lỗi 9:16 Aspect Ratio, độ phân giải...) ===
            // Facebook thường mất 10-20s để mã hóa xong nên cần poll đủ lâu, nếu không sẽ báo "thành công" giả
            // trong khi video thực chất bị Meta từ chối sau đó (video_status chuyển sang "error" muộn hơn).
            String[] statusResult = waitForVideoStatus(videoId, pageAccessToken, STORY_VIDEO_POLL_MAX_ATTEMPTS, VIDEO_POLL_SLEEP_MS);
            if ("error".equals(statusResult[0])) {
                log.error("❌ Meta từ chối video Story trong quá trình mã hóa ngầm: {}", statusResult[1]);
                return Map.of("success", false, "error", statusResult[1]);
            }
            if ("pending".equals(statusResult[0])) {
                // KHÔNG được báo thành công khi chưa xác nhận Meta mã hóa xong (tránh báo "thành công" giả).
                log.warn("⚠️ Hết thời gian chờ mà video vẫn chưa xác nhận 'ready' (có thể vẫn đang xử lý). post_id={}", publishResp != null ? publishResp.get("post_id") : "?");
                return Map.of(
                    "success", false,
                    "pending", true,
                    "error", "Video đã upload lên Meta nhưng chưa xác nhận mã hóa xong trong thời gian chờ. Chưa chắc chắn Story đã lên Fanpage, vui lòng kiểm tra lại thủ công."
                );
            }
            log.info("✅ Facebook Page Story đã đăng thành công (đã xác nhận mã hóa xong)! post_id={}", publishResp != null ? publishResp.get("post_id") : "?");
            return publishResp != null ? publishResp : Map.of("success", true);

        } catch (Exception e) {
            log.error("❌ Lỗi khi đăng Video Story lên Fanpage {}: {}", pageId, e.getMessage());
            return Map.of("success", false, "error", e.getMessage());
        }
    }

    /**
     * Đăng Photo Story lên Fanpage theo chuẩn Meta Graph API.
     * POST /{page_id}/photo_stories với file_url hoặc binary upload.
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> publishPhotoStory(String pageId, String pageAccessToken, String photoUrl) {
        try {
            // Cách 1: Thử POST trực tiếp URL ảnh lên /{page_id}/photo_stories
            MultiValueMap<String, String> body = new LinkedMultiValueMap<>();
            body.add("url", photoUrl);
            body.add("access_token", pageAccessToken);
            Map<String, Object> resp = postForm(base() + "/" + pageId + "/photo_stories", body);
            log.info("✅ Photo Story đã đăng trực tiếp bằng URL: {}", resp);
            if (resp != null && (resp.containsKey("id") || resp.containsKey("post_id") || Boolean.TRUE.equals(resp.get("success")))) {
                return resp;
            }
        } catch (Exception e1) {
            log.warn("⚠️ Đăng Photo Story qua URL trực tiếp thất bại ({}), thử Cách 2 (upload photo trước)...", e1.getMessage());
        }

        try {
            // Cách 2: Upload photo dưới dạng unpublished trước -> lấy photo_id -> POST /{page_id}/photo_stories
            MultiValueMap<String, String> photoBody = new LinkedMultiValueMap<>();
            photoBody.add("url", photoUrl);
            photoBody.add("published", "false");
            photoBody.add("access_token", pageAccessToken);
            Map<String, Object> photoResp = postForm(base() + "/" + pageId + "/photos", photoBody);

            if (photoResp != null && photoResp.containsKey("id")) {
                String photoId = photoResp.get("id").toString();
                MultiValueMap<String, String> storyBody = new LinkedMultiValueMap<>();
                storyBody.add("photo_id", photoId);
                storyBody.add("access_token", pageAccessToken);
                log.info("📖 Đang xuất bản Photo Story cho Photo ID: {} qua Graph API...", photoId);
                Map<String, Object> storyResp = postForm(base() + "/" + pageId + "/photo_stories", storyBody);
                if (storyResp != null) {
                    return storyResp;
                }
            }
            return Map.of("success", false, "error", "Không thể upload ảnh unpublished lên Fanpage");
        } catch (Exception e2) {
            log.error("❌ Lỗi khi đăng Photo Story lên Fanpage {}: {}", pageId, e2.getMessage());
            return Map.of("success", false, "error", e2.getMessage());
        }
    }



    private Map<String, Object> post(String url, Map<String, String> body) {
        MultiValueMap<String, String> formBody = new LinkedMultiValueMap<>();
        body.forEach(formBody::add);
        return postForm(url, formBody);
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> postForm(String url, MultiValueMap<String, String> formBody) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);
        HttpEntity<MultiValueMap<String, String>> request = new HttpEntity<>(formBody, headers);

        int attempt = 0;
        while (true) {
            try {
                Map<String, Object> response = restTemplate.postForObject(url, request, Map.class);
                log.info("[GraphAPI] Response: {}", response);
                return response;
            } catch (HttpStatusCodeException e) {
                GraphApiException graphError = parseGraphError(e);
                boolean retryable = e.getStatusCode().is5xxServerError()
                        || RETRYABLE_ERROR_CODES.contains(graphError.getCode());
                if (retryable && attempt < MAX_RETRIES) {
                    attempt++;
                    log.warn("[GraphAPI] Lỗi tạm thời ({}), thử lại lần {}/{}...", graphError.getMessage(), attempt, MAX_RETRIES);
                    sleepBackoff(attempt);
                    continue;
                }
                throw graphError;
            }
        }
    }

    private GraphApiException parseGraphError(HttpStatusCodeException e) {
        try {
            JsonNode root = objectMapper.readTree(e.getResponseBodyAsString());
            JsonNode error = root.path("error");
            String message = error.path("message").asText(e.getMessage());
            int code = error.path("code").asInt(-1);
            int subcode = error.path("error_subcode").asInt(-1);
            return new GraphApiException(message, code, subcode, e);
        } catch (Exception parseFailure) {
            return new GraphApiException(e.getMessage(), -1, -1, e);
        }
    }

    private void sleepBackoff(int attempt) {
        try {
            Thread.sleep(500L * attempt);
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
        }
    }
}
