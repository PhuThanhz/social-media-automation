package com.autopost.saas.service;

import com.autopost.saas.entity.AppSetting;
import com.autopost.saas.repository.AppSettingRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Lấy bài từ subreddit qua Reddit API chính thức (OAuth "application only", client_credentials).
 * Cào ẩn danh không dùng được: DNS nhà mạng trả reddit.com/www.reddit.com về 127.0.0.1, còn
 * old.reddit.com/api.reddit.com bắt đăng nhập hoặc trả 403 "blocked due to a network policy".
 * oauth.reddit.com và i.redd.it vẫn vào được nên mọi request đều đi qua đó.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class RedditService {

    public static final String KEY_CLIENT_ID = "reddit_client_id";
    public static final String KEY_CLIENT_SECRET = "reddit_client_secret";
    public static final String KEY_USERNAME = "reddit_username";
    public static final String KEY_INCLUDE_VIDEO = "reddit_include_video";
    public static final String KEY_COOKIE = "reddit_cookie";
    private static final String BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

    // www.reddit.com là endpoint lấy token chính thức nhưng đang bị chặn DNS ở mạng này → thử rồi rơi
    // sang oauth.reddit.com (cùng hạ tầng, không bị chặn).
    private static final List<String> TOKEN_URLS = List.of(
            "https://www.reddit.com/api/v1/access_token",
            "https://oauth.reddit.com/api/v1/access_token");
    private static final Pattern SUBREDDIT = Pattern.compile("(?:^|/)r/([A-Za-z0-9_]{2,21})(?:/(hot|new|top|rising))?", Pattern.CASE_INSENSITIVE);
    private static final Pattern DIRECT_IMAGE = Pattern.compile("(?i)^https://(i\\.redd\\.it|i\\.imgur\\.com)/[^?#]+\\.(jpe?g|png|gif|webp)$");

    private final AppSettingRepository appSettingRepository;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();

    private volatile String cachedToken;
    private volatile long cachedTokenExpiresAt;
    private volatile String cachedTokenClientId;

    // ── Cấu hình ──

    public boolean isConfigured() {
        return get(KEY_COOKIE) != null || hasOAuthKeys();
    }

    private boolean hasOAuthKeys() {
        return get(KEY_CLIENT_ID) != null && get(KEY_CLIENT_SECRET) != null;
    }

    public Map<String, Object> getConfig() {
        String id = get(KEY_CLIENT_ID);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("configured", isConfigured());
        m.put("clientId", id == null ? "" : (id.length() <= 6 ? id : id.substring(0, 4) + "…" + id.substring(id.length() - 2)));
        m.put("username", Optional.ofNullable(get(KEY_USERNAME)).orElse(""));
        m.put("includeVideo", isIncludeVideo());
        m.put("hasCookie", get(KEY_COOKIE) != null);
        m.put("mode", get(KEY_COOKIE) != null ? "COOKIE" : hasOAuthKeys() ? "OAUTH" : "NONE");
        return m;
    }

    /** Lưu key; chuỗi rỗng ở secret nghĩa là giữ secret cũ (frontend không bao giờ nhận lại secret). */
    public boolean isIncludeVideo() {
        return !"false".equals(get(KEY_INCLUDE_VIDEO));
    }

    public void setIncludeVideo(boolean include) {
        put(KEY_INCLUDE_VIDEO, String.valueOf(include));
    }

    /** Lưu cookie đăng nhập Reddit (chuỗi "a=b; c=d" chép từ trình duyệt); chuỗi rỗng = xóa cookie. */
    public void saveCookie(String cookie) {
        String c = cookie == null ? "" : cookie.trim().replaceFirst("(?i)^cookie:\\s*", "");
        put(KEY_COOKIE, c);
    }

    /** Người dùng hay chỉ dán giá trị reddit_session (chuỗi JWT, không có "tên="): tự gắn tên cookie. */
    private String cookieHeader() {
        String c = get(KEY_COOKIE);
        if (c == null) return null;
        c = c.replaceAll("[\\r\\n]", "").trim();
        return c.contains("=") ? c : "reddit_session=" + c.replace(" ", "");
    }

    public void saveConfig(String clientId, String clientSecret, String username) {
        if (clientId != null) put(KEY_CLIENT_ID, clientId.trim());
        if (clientSecret != null && !clientSecret.isBlank()) put(KEY_CLIENT_SECRET, clientSecret.trim());
        if (username != null) put(KEY_USERNAME, username.trim().replaceFirst("^/?u/", ""));
        cachedToken = null;
    }

    // ── Subreddit ──

    private static final Pattern POST_ID = Pattern.compile("(?:/comments/|redd\\.it/)([a-z0-9]{4,10})(?:[/?#]|$)", Pattern.CASE_INSENSITIVE);

    /**
     * Chuẩn hóa nguồn Reddit lưu trong Kho Nguồn. Hai dạng:
     *  - subreddit: "r/cats", "cats", "https://www.reddit.com/r/cats/new/" → "https://www.reddit.com/r/cats/hot/" (giữ kiểu sắp xếp)
     *  - tìm theo từ khóa: "https://www.reddit.com/search/?q=..." hoặc "/r/cats/search/?q=..." (giữ q, sort, t, restrict_sr)
     * Link 1 bài (/comments/...) không phải nguồn → null (dùng fetchSinglePost).
     */
    public static String normalizeSourceUrl(String raw) {
        if (raw == null) return null;
        String s = raw.trim();
        if (s.contains("/s/") || (POST_ID.matcher(s).find() && s.contains("/comments/"))) return null;
        Map<String, String> q = queryParams(s);
        if (s.contains("/search") && q.get("q") != null && !q.get("q").isBlank()) {
            Matcher sm = SUBREDDIT.matcher(s);
            String sub = sm.find() ? sm.group(1) : null;
            String sort = Optional.ofNullable(q.get("sort")).filter(v -> v.matches("relevance|hot|top|new|comments")).orElse("top");
            String t = Optional.ofNullable(q.get("t")).filter(v -> v.matches("hour|day|week|month|year|all")).orElse("week");
            return "https://www.reddit.com/" + (sub != null ? "r/" + sub + "/" : "") + "search/?q="
                    + URLEncoder.encode(q.get("q").trim(), StandardCharsets.UTF_8) + "&sort=" + sort + "&t=" + t
                    + (sub != null ? "&restrict_sr=1" : "");
        }
        Matcher m = SUBREDDIT.matcher(s);
        String name;
        String sort = "hot";
        if (m.find()) {
            name = m.group(1);
            if (m.group(2) != null) sort = m.group(2).toLowerCase();
        } else if (s.matches("[A-Za-z0-9_]{2,21}")) {
            name = s;
        } else {
            return null;
        }
        return "https://www.reddit.com/r/" + name + "/" + sort + "/";
    }

    /** Tên mặc định cho nguồn: "r/cats" hoặc "Reddit: từ khóa (r/cats)". */
    public static String defaultSourceName(String normalizedUrl) {
        Map<String, String> q = queryParams(normalizedUrl);
        Matcher sm = SUBREDDIT.matcher(normalizedUrl);
        String sub = sm.find() ? "r/" + sm.group(1) : null;
        if (q.get("q") != null) return "Reddit: " + q.get("q") + (sub != null ? " (" + sub + ")" : "");
        return sub != null ? sub : "Reddit";
    }

    private static Map<String, String> queryParams(String url) {
        Map<String, String> out = new HashMap<>();
        int i = url.indexOf('?');
        if (i < 0) return out;
        for (String kv : url.substring(i + 1).split("[&#]")) {
            int e = kv.indexOf('=');
            if (e <= 0) continue;
            out.put(kv.substring(0, e), java.net.URLDecoder.decode(kv.substring(e + 1), StandardCharsets.UTF_8));
        }
        return out;
    }

    public static boolean isRedditSource(String raw) {
        if (raw == null) return false;
        String s = raw.trim().toLowerCase();
        return s.contains("reddit.com/r/") || s.contains("reddit.com/search") || s.startsWith("r/") || s.startsWith("/r/");
    }

    public static boolean isRedditPostUrl(String url) {
        return url != null && url.toLowerCase().matches("^https?://([a-z]+\\.)?reddit\\.com/r/.*");
    }

    /**
     * Lấy bài của 1 nguồn (subreddit hoặc tìm theo từ khóa) theo đúng shape bài trong hộp duyệt (HuntedPost ở ViralHunter.tsx).
     * Bỏ bài ghim, bài 18+; bài video chỉ lấy khi bật "Lấy bài video Reddit" (tiếng được ghép lúc đưa vào Hàng đợi).
     */
    public List<Map<String, Object>> fetchPosts(String sourceUrl, int limit) throws Exception {
        String normalized = normalizeSourceUrl(sourceUrl);
        if (normalized == null) throw new IllegalArgumentException("Nguồn Reddit không hợp lệ: " + sourceUrl);
        int lim = Math.min(Math.max(limit, 1), 100);
        String path;
        Map<String, String> q = queryParams(normalized);
        Matcher m = SUBREDDIT.matcher(normalized);
        String sub = m.find() ? m.group(1) : null;
        if (q.get("q") != null) {
            path = (sub != null ? "/r/" + sub : "") + "/search?q=" + URLEncoder.encode(q.get("q"), StandardCharsets.UTF_8)
                    + "&sort=" + q.get("sort") + "&t=" + q.get("t") + "&type=link" + (sub != null ? "&restrict_sr=1" : "")
                    + "&limit=" + lim + "&raw_json=1";
        } else {
            String sort = m.group(2) == null ? "hot" : m.group(2);
            path = "/r/" + sub + "/" + sort + "?limit=" + lim + "&raw_json=1" + ("top".equals(sort) ? "&t=day" : "");
        }
        JsonNode listing = getJson(path, defaultSourceName(normalized));

        boolean includeVideo = isIncludeVideo();
        List<Map<String, Object>> out = new ArrayList<>();
        for (JsonNode child : listing.path("data").path("children")) {
            JsonNode d = child.path("data");
            if (d.path("stickied").asBoolean() || d.path("over_18").asBoolean()) continue;
            Map<String, Object> item = toItem(d, includeVideo);
            if (item != null) out.add(item);
        }
        return out;
    }

    /** Giải quyết link rút gọn chia sẻ /s/ của Reddit (vd: https://www.reddit.com/r/sub/s/xxx) */
    public String resolveRedditUrl(String url) {
        if (url == null) return "";
        url = url.trim();
        if (url.contains("/s/")) {
            try {
                HttpResponse<Void> resp = http.send(HttpRequest.newBuilder(URI.create(url))
                        .timeout(Duration.ofSeconds(10))
                        .header("User-Agent", BROWSER_UA)
                        .method("HEAD", HttpRequest.BodyPublishers.noBody())
                        .build(), HttpResponse.BodyHandlers.discarding());
                if (resp.statusCode() >= 300 && resp.statusCode() < 400) {
                    String loc = resp.headers().firstValue("location").orElse(null);
                    if (loc != null && !loc.isBlank()) {
                        return loc.startsWith("http") ? loc : "https://www.reddit.com" + loc;
                    }
                }
            } catch (Exception e) {
                log.warn("Không resolve được redirect /s/: {}", e.getMessage());
            }
        }
        return url;
    }

    /** Lấy 1 bài theo link (https://www.reddit.com/r/x/comments/abc123/..., redd.it/abc123, hoặc link /s/...). Luôn lấy cả bài video. */
    public Map<String, Object> fetchSinglePost(String postUrl) throws Exception {
        String resolvedUrl = resolveRedditUrl(postUrl);
        Matcher m = POST_ID.matcher(resolvedUrl == null ? "" : resolvedUrl.trim());
        if (!m.find()) throw new IllegalArgumentException("Không nhận ra link bài Reddit: " + postUrl);
        JsonNode arr = getJson("/comments/" + m.group(1) + "?limit=1&raw_json=1", "bài " + m.group(1));
        JsonNode d = arr.path(0).path("data").path("children").path(0).path("data");
        if (d.isMissingNode()) throw new IllegalStateException("Reddit không trả nội dung bài " + m.group(1));
        Map<String, Object> item = toItem(d, true);
        if (item == null) throw new IllegalStateException("Bài này là video nhúng từ trang khác (YouTube...) — không đăng lại được.");
        return item;
    }

    /** GET JSON Reddit: dùng cookie qua old.reddit.com nếu có, không thì OAuth qua oauth.reddit.com. */
    private JsonNode getJson(String pathAndQuery, String label) throws Exception {
        String cookie = cookieHeader();
        HttpResponse<String> resp;
        if (cookie != null) {
            // Cookie đăng nhập: đọc JSON của old.reddit.com (tên miền này không bị chặn DNS)
            int qi = pathAndQuery.indexOf('?');
            String withJson = qi < 0 ? pathAndQuery + ".json" : pathAndQuery.substring(0, qi) + ".json" + pathAndQuery.substring(qi);
            resp = http.send(HttpRequest.newBuilder(URI.create("https://old.reddit.com" + withJson))
                    .timeout(Duration.ofSeconds(20))
                    .header("Cookie", cookie)
                    .header("User-Agent", BROWSER_UA)
                    .header("Accept", "application/json")
                    .GET().build(), HttpResponse.BodyHandlers.ofString());
            String location = resp.headers().firstValue("location").orElse("");
            if ((resp.statusCode() == 302 || resp.statusCode() == 301) && location.contains("/login")) {
                throw new IllegalStateException("Cookie Reddit hết hạn hoặc chưa đăng nhập — chép lại cookie mới (nút \"Kết nối Reddit\").");
            }
            if (resp.statusCode() == 403 && resp.body().contains("network policy")) {
                throw new IllegalStateException("Reddit chặn request dù có cookie (403 network policy) — cookie có thể thiếu reddit_session/token_v2.");
            }
        } else {
            resp = http.send(HttpRequest.newBuilder(URI.create("https://oauth.reddit.com" + pathAndQuery))
                    .timeout(Duration.ofSeconds(20))
                    .header("Authorization", "Bearer " + getToken())
                    .header("User-Agent", userAgent())
                    .GET().build(), HttpResponse.BodyHandlers.ofString());
        }
        if (resp.statusCode() == 401) {
            cachedToken = null;
            throw new IllegalStateException("Reddit từ chối token (401) — kiểm tra lại Client ID/Secret.");
        }
        if (resp.statusCode() == 403 || resp.statusCode() == 404) {
            throw new IllegalStateException("Không đọc được " + label + " (HTTP " + resp.statusCode() + ") — riêng tư, bị cấm hoặc không tồn tại.");
        }
        if (resp.statusCode() == 429) {
            throw new IllegalStateException("Reddit báo gọi quá nhiều (429), thử lại sau.");
        }
        if (resp.statusCode() != 200) {
            throw new IllegalStateException("Reddit trả HTTP " + resp.statusCode());
        }
        return objectMapper.readTree(resp.body());
    }

    private Map<String, Object> toItem(JsonNode d, boolean includeVideo) {
        String sub = d.path("subreddit").asText("");
        String permalink = d.path("permalink").asText("");
        if (permalink.isEmpty()) return null;
        String video = extractVideo(d);
        List<String> media;
        if (video != null) {
            if (!includeVideo) return null;
            media = List.of(video);
        } else {
            media = extractImages(d);
            if (media == null) return null; // video nhúng ngoài (YouTube...), gifv — không đăng lại được
        }

        String title = d.path("title").asText("").trim();
        String body = d.path("selftext").asText("").trim();
        if (body.length() > 2000) body = body.substring(0, 2000) + "…";
        String caption = body.isEmpty() ? title : title + "\n\n" + body;
        long createdUtc = d.path("created_utc").asLong(0);
        int score = d.path("score").asInt(0);

        Map<String, Object> m = new LinkedHashMap<>();
        m.put("url", "https://www.reddit.com" + permalink);
        m.put("caption", caption);
        m.put("originalCaption", caption);
        m.put("mediaUrls", media);
        if (video != null) {
            m.put("videoUrl", video);
            m.put("hasVideo", true);
            String thumb = d.path("preview").path("images").path(0).path("source").path("url").asText("");
            if (!thumb.isEmpty()) m.put("previewCover", thumb);
        } else if (!media.isEmpty()) {
            m.put("previewCover", media.get(0));
        }
        m.put("mediaType", video != null ? "VIDEO" : media.isEmpty() ? "TEXT" : "IMAGE");
        m.put("mediaCount", media.size());
        m.put("author", "u/" + d.path("author").asText(""));
        m.put("postedUtime", createdUtc);
        if (createdUtc > 0) m.put("publishedAt", Instant.ofEpochSecond(createdUtc).atZone(ZoneId.systemDefault()).toLocalDateTime().toString());
        m.put("reactions", score);
        m.put("comments", d.path("num_comments").asInt(0));
        m.put("shares", 0);
        m.put("viralScore", score);
        m.put("isViral", score >= 1000);
        m.put("sourcePlatform", "REDDIT");
        m.put("subreddit", "r/" + sub);
        return m;
    }

    /** Link video v.redd.it (chỉ có hình, chưa có tiếng) hoặc null nếu không phải bài video Reddit. */
    private String extractVideo(JsonNode d) {
        JsonNode rv = d.path("secure_media").path("reddit_video");
        if (rv.isMissingNode() || rv.isNull()) rv = d.path("media").path("reddit_video");
        if (rv.isMissingNode() || rv.isNull() || rv.path("is_gif").asBoolean()) return null;
        String url = rv.path("fallback_url").asText("");
        return url.startsWith("https://v.redd.it/") ? url : null;
    }

    /**
     * v.redd.it lưu hình và tiếng thành 2 file riêng: tải cả hai rồi ghép bằng ffmpeg thành 1 mp4 trong
     * thư mục uploads (phục vụ ở /uploads/**). Trả đường dẫn tương đối "/uploads/xxx.mp4".
     */
    public String downloadVideoWithAudio(String fallbackUrl) throws Exception {
        Matcher m = Pattern.compile("^https://v\\.redd\\.it/([A-Za-z0-9]+)/").matcher(fallbackUrl);
        if (!m.find()) throw new IllegalArgumentException("Không phải link video Reddit: " + fallbackUrl);
        String id = m.group(1);
        java.nio.file.Path dir = java.nio.file.Paths.get("uploads").toAbsolutePath().normalize();
        java.nio.file.Files.createDirectories(dir);
        String name = "reddit_" + id + ".mp4";
        java.nio.file.Path out = dir.resolve(name);
        if (java.nio.file.Files.exists(out) && java.nio.file.Files.size(out) > 0) return "/uploads/" + name;

        java.nio.file.Path videoTmp = java.nio.file.Files.createTempFile("rv_", ".mp4");
        java.nio.file.Path audioTmp = java.nio.file.Files.createTempFile("ra_", ".mp4");
        try {
            if (!download(fallbackUrl, videoTmp)) throw new IllegalStateException("Không tải được video Reddit");
            boolean hasAudio = false;
            for (String a : List.of("CMAF_AUDIO_128.mp4", "CMAF_AUDIO_64.mp4", "DASH_AUDIO_128.mp4", "DASH_AUDIO_64.mp4", "DASH_audio.mp4")) {
                if (download("https://v.redd.it/" + id + "/" + a, audioTmp)) { hasAudio = true; break; }
            }
            if (!hasAudio) {
                java.nio.file.Files.move(videoTmp, out, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
                return "/uploads/" + name;
            }
            java.nio.file.Path part = dir.resolve(name + ".part.mp4");
            Process p = new ProcessBuilder(ffmpegPath(), "-y", "-loglevel", "error",
                    "-i", videoTmp.toString(), "-i", audioTmp.toString(),
                    "-c", "copy", "-map", "0:v:0", "-map", "1:a:0", "-shortest", part.toString())
                    .redirectErrorStream(true).start();
            String log = new String(p.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            if (!p.waitFor(120, java.util.concurrent.TimeUnit.SECONDS) || p.exitValue() != 0) {
                p.destroyForcibly();
                throw new IllegalStateException("ffmpeg ghép tiếng lỗi: " + log);
            }
            java.nio.file.Files.move(part, out, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            return "/uploads/" + name;
        } finally {
            java.nio.file.Files.deleteIfExists(videoTmp);
            java.nio.file.Files.deleteIfExists(audioTmp);
        }
    }

    private boolean download(String url, java.nio.file.Path target) throws Exception {
        HttpResponse<java.nio.file.Path> resp = http.send(HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(120))
                .header("User-Agent", userAgent())
                .GET().build(), HttpResponse.BodyHandlers.ofFile(target));
        return resp.statusCode() == 200 && java.nio.file.Files.size(target) > 0;
    }

    public static String ffmpegPath() {
        for (String c : List.of("/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg")) {
            if (new java.io.File(c).canExecute()) return c;
        }
        try {
            java.io.File workerFfmpeg = new java.io.File("../worker/node_modules/ffmpeg-static/ffmpeg");
            if (workerFfmpeg.canExecute()) return workerFfmpeg.getAbsolutePath();
            workerFfmpeg = new java.io.File("worker/node_modules/ffmpeg-static/ffmpeg");
            if (workerFfmpeg.canExecute()) return workerFfmpeg.getAbsolutePath();
        } catch (Exception ignored) {}
        return "ffmpeg";
    }

    /** Danh sách ảnh full size; list rỗng = bài chữ; null = bài video/gif động (bỏ qua). */
    private List<String> extractImages(JsonNode d) {
        List<String> urls = new ArrayList<>();
        if (d.path("is_gallery").asBoolean()) {
            JsonNode meta = d.path("media_metadata");
            for (JsonNode it : d.path("gallery_data").path("items")) {
                JsonNode mm = meta.path(it.path("media_id").asText());
                if (!"valid".equals(mm.path("status").asText()) || !"Image".equals(mm.path("e").asText())) continue;
                String mime = mm.path("m").asText("image/jpg");
                String ext = mime.substring(mime.indexOf('/') + 1).replace("jpeg", "jpg");
                urls.add("https://i.redd.it/" + it.path("media_id").asText() + "." + ext);
            }
            return urls.isEmpty() ? null : urls;
        }
        String direct = d.path("url_overridden_by_dest").asText(d.path("url").asText(""));
        String hint = d.path("post_hint").asText("");
        if ("hosted:video".equals(hint) || "rich:video".equals(hint) || direct.endsWith(".gifv")) return null;
        if (DIRECT_IMAGE.matcher(direct).matches()) {
            urls.add(direct);
            return urls;
        }
        // Bài link ra ngoài (báo, blog...): dùng ảnh preview Reddit đã lưu
        String preview = d.path("preview").path("images").path(0).path("source").path("url").asText("");
        if (!preview.isEmpty()) urls.add(preview);
        return urls;
    }

    // ── OAuth ──

    /** Thử lấy token + đọc 1 bài để kiểm tra key; trả thông báo lỗi dễ hiểu. */
    public Map<String, Object> testConnection(String subreddit) {
        Map<String, Object> m = new LinkedHashMap<>();
        try {
            cachedToken = null;
            List<Map<String, Object>> items = fetchPosts(subreddit == null || subreddit.isBlank() ? "r/cats" : subreddit, 5);
            m.put("success", true);
            m.put("count", items.size());
            if (!items.isEmpty()) m.put("sample", items.get(0).get("caption"));
        } catch (Exception e) {
            m.put("success", false);
            m.put("error", e.getMessage());
        }
        return m;
    }

    private synchronized String getToken() throws Exception {
        String clientId = get(KEY_CLIENT_ID);
        String secret = get(KEY_CLIENT_SECRET);
        if (clientId == null || secret == null) {
            throw new IllegalStateException("Chưa nhập cookie Reddit (nút \"Kết nối Reddit\" trong Kho Nguồn).");
        }
        if (cachedToken != null && clientId.equals(cachedTokenClientId) && System.currentTimeMillis() < cachedTokenExpiresAt) {
            return cachedToken;
        }
        String basic = Base64.getEncoder().encodeToString((clientId + ":" + secret).getBytes(StandardCharsets.UTF_8));
        String form = "grant_type=" + URLEncoder.encode("client_credentials", StandardCharsets.UTF_8);
        List<String> errors = new ArrayList<>();
        for (String tokenUrl : TOKEN_URLS) {
            try {
                HttpResponse<String> resp = http.send(HttpRequest.newBuilder(URI.create(tokenUrl))
                        .timeout(Duration.ofSeconds(15))
                        .header("Authorization", "Basic " + basic)
                        .header("User-Agent", userAgent())
                        .header("Content-Type", "application/x-www-form-urlencoded")
                        .POST(HttpRequest.BodyPublishers.ofString(form)).build(), HttpResponse.BodyHandlers.ofString());
                if (resp.statusCode() == 401) {
                    throw new IllegalStateException("Reddit báo sai Client ID/Secret (401).");
                }
                JsonNode body = resp.statusCode() == 200 ? objectMapper.readTree(resp.body()) : null;
                String token = body != null ? body.path("access_token").asText("") : "";
                if (!token.isEmpty()) {
                    cachedToken = token;
                    cachedTokenClientId = clientId;
                    cachedTokenExpiresAt = System.currentTimeMillis() + Math.max(60, body.path("expires_in").asLong(3600) - 120) * 1000L;
                    return token;
                }
                String err = body != null ? body.path("error").asText("") : "";
                errors.add(tokenUrl.replaceFirst("https://([^/]+).*", "$1") + ": HTTP " + resp.statusCode() + (err.isEmpty() ? "" : " " + err));
            } catch (IllegalStateException e) {
                throw e;
            } catch (Exception e) {
                errors.add(tokenUrl.replaceFirst("https://([^/]+).*", "$1") + ": " + e.getClass().getSimpleName());
            }
        }
        throw new IllegalStateException("Không lấy được token Reddit (" + String.join("; ", errors) + ")");
    }

    private String userAgent() {
        String user = get(KEY_USERNAME);
        return "macos:phusocial-autopost:v1.0" + (user != null ? " (by /u/" + user + ")" : "");
    }

    private String get(String key) {
        return appSettingRepository.findById(key).map(AppSetting::getValue).filter(v -> !v.isBlank()).orElse(null);
    }

    private void put(String key, String value) {
        appSettingRepository.save(new AppSetting(key, value));
    }
}
