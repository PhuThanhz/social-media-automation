package com.autopost.saas.controller;

import com.autopost.saas.service.GeminiService;
import com.autopost.saas.service.RedditService;
import com.autopost.saas.util.PooledRestTemplateFactory;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.servlet.support.ServletUriComponentsBuilder;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.TimeUnit;

/**
 * Studio Video Tin: dán link video (TikTok/Douyin/mp4...) → vài giây đầu hiện khung tiêu đề + giọng AI đọc
 * (tiếng gốc nhỏ lại), sau đó khung mờ dần và video chạy tiếp full màn hình; trộn thêm nhạc nền tuỳ chọn.
 * - /resolve: lấy video về uploads/ và đo thời lượng
 * - /tts: Edge TTS (Nam Minh / Hoài My, miễn phí) hoặc Gemini TTS, dự phòng giọng Linh của macOS → m4a
 * - /bgm-presets: nhạc nền mẫu (worker/bgm)
 * - /render: ghép video + khung PNG + voice + nhạc bằng FFmpeg
 */
@RestController
@RequestMapping("/api/video-studio")
@CrossOrigin(originPatterns = "*")
@Slf4j
public class VideoStudioController {

    private static final String WORKER = "http://localhost:3001";
    private static final int OUT_W = 1080;

    private final GeminiService geminiService;
    private final RestTemplate restTemplate = PooledRestTemplateFactory.create(10000, 180000);
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(30)).followRedirects(HttpClient.Redirect.NORMAL).build();
    private final Path uploadDir = Paths.get("uploads").toAbsolutePath().normalize();

    private final com.autopost.saas.repository.SocialAccountRepository socialAccountRepository;
    // Đăng TikTok qua Playwright: tải video + chờ TikTok xử lý có thể mất vài phút
    private final RestTemplate tiktokRestTemplate = PooledRestTemplateFactory.create(10000, 600000);

    public VideoStudioController(GeminiService geminiService, com.autopost.saas.repository.SocialAccountRepository socialAccountRepository) {
        this.geminiService = geminiService;
        this.socialAccountRepository = socialAccountRepository;
    }

    // ───────────────────────────── resolve ─────────────────────────────

    @PostMapping("/resolve")
    public ResponseEntity<Map<String, Object>> resolve(@RequestBody Map<String, String> body) {
        String raw = body != null ? body.get("url") : null;
        if (raw == null || raw.isBlank()) return bad("Thiếu link video");
        try {
            String input = raw.trim();
            java.util.regex.Matcher m = java.util.regex.Pattern.compile("https?://[^\\s\"'<>]+").matcher(input);
            if (m.find()) input = m.group();

            String title = "";
            Path local = localUpload(input);
            if (local == null) {
                String directUrl = input;
                if (!input.toLowerCase(Locale.ROOT).matches(".*\\.(mp4|mov|webm|m4v)(\\?.*)?$")) {
                    HttpHeaders headers = new HttpHeaders();
                    headers.setContentType(MediaType.APPLICATION_JSON);
                    @SuppressWarnings("unchecked")
                    Map<String, Object> ex = restTemplate.postForObject(WORKER + "/api/extract-video",
                            new HttpEntity<>(Map.of("url", input), headers), Map.class);
                    if (ex == null || !Boolean.TRUE.equals(ex.get("success")) || ex.get("videoUrl") == null) {
                        String err = ex != null && ex.get("error") != null ? ex.get("error").toString() : "Không lấy được video từ link";
                        return ResponseEntity.status(422).body(Map.of("success", false, "error", err));
                    }
                    directUrl = ex.get("videoUrl").toString();
                    title = Objects.toString(ex.getOrDefault("title", ""), "");
                }
                local = uploadDir.resolve("vs-src-" + UUID.randomUUID() + ".mp4");
                Files.createDirectories(uploadDir);
                // Tải qua worker (có Referer/UA phù hợp từng nền tảng, hiểu cả file cache cục bộ của worker)
                String proxy = WORKER + "/api/download-video?url=" + URLEncoder.encode(directUrl, StandardCharsets.UTF_8) + "&filename=video";
                HttpResponse<Path> resp = httpClient.send(
                        HttpRequest.newBuilder(URI.create(proxy)).timeout(Duration.ofSeconds(180)).build(),
                        HttpResponse.BodyHandlers.ofFile(local));
                if (resp.statusCode() != 200 || Files.size(local) < 1024) {
                    String err = Files.exists(local) && Files.size(local) < 4096 ? Files.readString(local) : "";
                    Files.deleteIfExists(local);
                    return ResponseEntity.status(502).body(Map.of("success", false, "error", "Không tải được video (HTTP " + resp.statusCode() + ") " + err));
                }
            }
            MediaInfo info = probe(local);
            if (!info.hasVideo) return bad("File không phải video hợp lệ");
            Map<String, Object> out = new HashMap<>();
            out.put("success", true);
            out.put("url", publicUrl(local.getFileName().toString()));
            out.put("duration", info.duration);
            out.put("width", info.width);
            out.put("height", info.height);
            out.put("hasAudio", info.hasAudio);
            out.put("title", title);
            return ResponseEntity.ok(out);
        } catch (Exception e) {
            log.error("[VideoStudio] Lỗi lấy video: {}", e.getMessage(), e);
            return ResponseEntity.internalServerError().body(Map.of("success", false, "error", String.valueOf(e.getMessage())));
        }
    }

    // ───────────────────────────── AI chữ cho bảng ─────────────────────────────

    @PostMapping("/panel-text")
    public ResponseEntity<Map<String, Object>> panelText(@RequestBody Map<String, String> body) {
        String caption = body != null ? Objects.toString(body.get("caption"), "") : "";
        Path video = body != null ? localUpload(body.get("videoUrl")) : null;
        List<byte[]> frames = new ArrayList<>();
        try {
            if (video != null && Files.exists(video)) frames = extractFrames(video, 6);
        } catch (Exception e) {
            log.warn("[VideoStudio] Không cắt được khung hình cho AI: {}", e.getMessage());
        }
        if (caption.isBlank() && frames.isEmpty()) return bad("Video không có caption và không đọc được khung hình để AI viết chữ");
        try {
            JsonNode node = objectMapper.readTree(geminiService.generateClipPanel(caption, body.get("source"), frames, body.get("apiKey")));
            String headline = node.path("headline").asText("").trim()
                    .replaceAll("([^\\s(\\[{])(\\[\\[)", "$1 $2").replaceAll("(\\]\\])([^\\s)\\]}.,;:!?])", "$1 $2");
            if (headline.isEmpty()) throw new IllegalStateException("AI không trả về tiêu đề");
            Map<String, Object> out = new HashMap<>();
            out.put("success", true);
            out.put("headline", headline);
            out.put("voice", node.path("voice").asText("").trim());
            out.put("caption", node.path("caption").asText("").trim());
            out.put("framesUsed", frames.size());
            return ResponseEntity.ok(out);
        } catch (Exception e) {
            log.error("[VideoStudio] Lỗi AI viết chữ cho bảng: {}", e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("success", false, "error", String.valueOf(e.getMessage())));
        }
    }

    // ───────────────────────────── AI trợ lý cho Video Editor ─────────────────────────────
    // Người dùng ra lệnh bằng tiếng Việt ("thêm chữ hook ở đầu", "lời đọc kể chuyện dài hơn", "chọn nhạc vui")
    // → Gemini xem vài khung hình + trạng thái dự án → trả JSON gồm câu trả lời và danh sách thao tác để editor áp dụng.

    @PostMapping("/ai-assist")
    public ResponseEntity<Map<String, Object>> aiAssist(@RequestBody Map<String, Object> body) {
        String instruction = str(body.get("instruction"));
        if (instruction.isBlank()) return bad("Nhập yêu cầu cho AI");
        String context;
        try {
            context = objectMapper.writeValueAsString(body.getOrDefault("context", Map.of()));
        } catch (Exception e) {
            context = "{}";
        }
        if (context.length() > 12000) context = context.substring(0, 12000);
        List<byte[]> frames = new ArrayList<>();
        Path video = localUpload(str(body.get("videoUrl")));
        try {
            if (video != null && Files.exists(video)) frames = extractFrames(video, 5);
        } catch (Exception e) {
            log.warn("[VideoEditor] AI không cắt được khung hình: {}", e.getMessage());
        }
        String prompt = "Bạn là trợ lý dựng video ngắn (TikTok/Reels/Facebook) cho một Fanpage giải trí/đời sống tại Việt Nam, làm việc trong 1 trình dựng kiểu CapCut.\n"
                + (frames.isEmpty() ? "" : "Kèm theo là " + frames.size() + " khung hình cắt đều trong clip để bạn hiểu nội dung.\n")
                + "Trạng thái dự án hiện tại (JSON, thời gian tính bằng giây trên timeline):\n" + context + "\n\n"
                + "Yêu cầu của người dùng: \"" + instruction + "\"\n\n"
                + "Hãy trả về JSON {\"reply\": \"câu trả lời ngắn gọn tiếng Việt cho người dùng (1-2 câu)\", \"actions\": [ ... ]}.\n"
                + "Các thao tác được phép (chỉ dùng đúng các type này, bỏ trường không cần):\n"
                + "- {\"type\":\"set_headline\",\"headline\":\"...\"} chữ trên khung tiêu đề, IN HOA, 12-25 từ, bọc 2-4 cụm đắt giá trong [[ ]]\n"
                + "- {\"type\":\"set_voice\",\"text\":\"...\",\"rate\":0} thay toàn bộ lời đọc bằng 1 đoạn mới (rate -30..40 là % tốc độ), viết như nói tự nhiên, không [[ ]], không emoji\n"
                + "- {\"type\":\"add_voice\",\"text\":\"...\",\"start\":0} thêm 1 đoạn đọc tại giây start\n"
                + "- {\"type\":\"captions\",\"enabled\":true,\"preset\":\"classic|yellow|box|red\"} bật/tắt phụ đề chạy theo giọng đọc\n"
                + "- {\"type\":\"add_text\",\"text\":\"...\",\"start\":0,\"end\":3,\"position\":\"top|center|bottom\",\"style\":\"title|yellow|box|red|plain\"} chữ nhấn trên video (ngắn, tối đa 8 từ)\n"
                + "- {\"type\":\"update_text\",\"id\":\"...\",\"text\":\"...\"} / {\"type\":\"remove_text\",\"id\":\"...\"}\n"
                + "- {\"type\":\"set_bgm\",\"name\":\"tên đúng 1 nhạc trong bgmOptions\",\"volume\":0.15} hoặc {\"type\":\"set_bgm\",\"name\":\"\"} để bỏ nhạc\n"
                + "- {\"type\":\"frame_time\",\"start\":0,\"end\":5} thời gian hiện khung tiêu đề\n"
                + "- {\"type\":\"trim\",\"start\":0,\"end\":10} giữ đoạn clip gốc từ giây start đến end (giây của clip gốc)\n"
                + "- {\"type\":\"speed\",\"value\":1.25} tốc độ clip 0.5-2\n"
                + "- {\"type\":\"volume\",\"original\":1,\"duck\":0.2,\"bgm\":0.15}\n"
                + "- {\"type\":\"set_post_caption\",\"caption\":\"...\"} caption đăng bài: dòng hook, 1-2 câu kể, 1 câu hỏi kéo bình luận, 3-5 hashtag\n"
                + "Quy tắc: chỉ làm đúng điều người dùng yêu cầu (\"làm trọn gói\" thì được dùng nhiều thao tác: tiêu đề, lời đọc, phụ đề, 1 chữ hook mở đầu, nhạc hợp không khí, caption đăng bài). "
                + "Không bịa tên người, địa danh, con số không thấy trong clip/caption. Từ nhạy cảm (bia, rượu, chết, súng, cờ bạc...) viết né bằng dấu chấm, ví dụ C.H.Ế.T. "
                + "Lời đọc dài khoảng 2.5-3 từ mỗi giây và không dài hơn clip. CHỈ trả về JSON.";
        List<Map<String, Object>> parts = new ArrayList<>();
        parts.add(Map.of("text", prompt));
        for (byte[] f : frames) parts.add(Map.of("inlineData", Map.of("mimeType", "image/jpeg", "data", Base64.getEncoder().encodeToString(f))));
        try {
            Map<String, Object> req = Map.of("contents", List.of(Map.of("parts", parts)),
                    "generationConfig", Map.of("responseMimeType", "application/json"));
            String res = geminiService.postWithModelFallback(req, str(body.get("apiKey"))).trim().replaceAll("^```(json)?\\s*|\\s*```$", "");
            JsonNode node = objectMapper.readTree(res);
            Map<String, Object> out = new HashMap<>();
            out.put("success", true);
            out.put("reply", node.path("reply").asText(""));
            out.put("actions", objectMapper.convertValue(node.path("actions"), List.class));
            return ResponseEntity.ok(out);
        } catch (Exception e) {
            log.error("[VideoEditor] AI trợ lý lỗi: {}", e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("success", false, "error", String.valueOf(e.getMessage())));
        }
    }

    @PostMapping("/highlight-headline")
    public ResponseEntity<Map<String, Object>> highlightHeadline(@RequestBody Map<String, String> body) {
        String text = body != null ? Objects.toString(body.get("text"), "").trim() : "";
        if (text.isBlank()) return bad("Chưa có tiêu đề để tô màu");
        try {
            String prompt = "Bạn là biên tập viên video. Dưới đây là tiêu đề video: \"" + text + "\".\n"
                    + "Hãy chọn 1 đến 2 cụm từ quan trọng, đắt giá, gây tò mò nhất và bọc mỗi cụm trong [[ và ]].\n"
                    + "QUY TẮC BẮT BUỘC:\n"
                    + "- Giữ NGUYÊN VĂN 100% tất cả các từ ngữ của câu gốc, không thêm/bớt từ nào, không đổi thứ tự từ.\n"
                    + "- Ví dụ: 'Ở SÀI GÒN MÀ BỎ QUA CHỖ NÀY LÀ UỔNG LẮM Á' -> 'Ở SÀI GÒN MÀ [[BỎ QUA CHỖ NÀY]] LÀ [[UỔNG LẮM Á]]'.\n"
                    + "- CHỈ trả về đúng câu tiêu đề đã bọc [[ và ]], không giải thích, không bọc trong ngoặc kép.";
            Map<String, Object> req = Map.of(
                    "contents", List.of(Map.of("parts", List.of(Map.of("text", prompt)))));
            String res = geminiService.postWithModelFallback(req, body.get("apiKey")).trim();
            res = res.replaceAll("^[\"“”']+|[\"“”']+$", "").trim();
            res = res.replaceAll("([^\\s(\\[{])(\\[\\[)", "$1 $2").replaceAll("(\\]\\])([^\\s)\\]}.,;:!?])", "$1 $2");
            return ResponseEntity.ok(Map.of("success", true, "headline", res));
        } catch (Exception e) {
            log.error("[VideoStudio] Highlight lỗi: {}", e.getMessage());
            return bad("Lỗi AI tô màu: " + e.getMessage());
        }
    }

    /** Cắt n khung hình JPEG (rộng 512px) rải đều trong clip để AI "xem" nội dung */
    private List<byte[]> extractFrames(Path video, int n) throws Exception {
        double dur = probe(video).duration;
        List<byte[]> out = new ArrayList<>();
        if (dur <= 0) return out;
        for (int i = 0; i < n; i++) {
            double t = dur * (i + 0.5) / n;
            Path jpg = Files.createTempFile("vs_frame_", ".jpg");
            try {
                runFfmpeg(List.of(RedditService.ffmpegPath(), "-y", "-loglevel", "error",
                        "-ss", String.format(Locale.ROOT, "%.2f", t), "-i", video.toString(),
                        "-frames:v", "1", "-vf", "scale=512:-2", "-q:v", "5", jpg.toString()), 30);
                if (Files.size(jpg) > 0) out.add(Files.readAllBytes(jpg));
            } finally {
                Files.deleteIfExists(jpg);
            }
        }
        return out;
    }

    // ───────────────────────────── tts ─────────────────────────────

    @PostMapping("/tts")
    public ResponseEntity<Map<String, Object>> tts(@RequestBody Map<String, String> body) {
        String text = body != null ? body.get("text") : null;
        if (text == null || text.isBlank()) return bad("Thiếu nội dung cần đọc");
        if (text.length() > 2000) return bad("Nội dung đọc quá dài (tối đa 2000 ký tự)");
        List<Path> temps = new ArrayList<>();
        try {
            Files.createDirectories(uploadDir);
            Path out = uploadDir.resolve("vs-voice-" + UUID.randomUUID() + ".m4a");
            String voice = Objects.toString(body.get("voice"), "vi-VN-NamMinhNeural");
            // Giọng vi-VN-* → Edge TTS (miễn phí); giọng khác → Gemini. Lỗi thì lùi dần: Edge → Gemini (nếu có key) → Linh macOS
            List<String> engines = new ArrayList<>();
            if (voice.startsWith("vi-VN-")) engines.add("edge");
            if (!voice.startsWith("vi-VN-") || !Objects.toString(body.get("apiKey"), "").isBlank()) engines.add("gemini");
            engines.add("macos");

            String engine = null;
            Object words = null; // mốc thời gian từng từ (chỉ Edge có) → frontend làm phụ đề
            List<String> warnings = new ArrayList<>();
            for (String candidate : engines) {
                try {
                    Path src;
                    List<String> inputArgs;
                    if ("edge".equals(candidate)) {
                        HttpHeaders headers = new HttpHeaders();
                        headers.setContentType(MediaType.APPLICATION_JSON);
                        @SuppressWarnings("unchecked")
                        Map<String, Object> r = restTemplate.postForObject(WORKER + "/api/tts-edge",
                                new HttpEntity<>(Map.of("text", text, "voice", voice,
                                        "rate", Objects.toString(body.get("rate"), ""),
                                        "pitch", Objects.toString(body.get("pitch"), "")), headers), Map.class);
                        if (r == null || !Boolean.TRUE.equals(r.get("success")) || r.get("mp3Base64") == null) {
                            throw new IllegalStateException(r != null && r.get("error") != null ? r.get("error").toString() : "Edge TTS không trả audio");
                        }
                        words = r.get("words");
                        src = Files.createTempFile("vs_edge_", ".mp3");
                        Files.write(src, Base64.getDecoder().decode(r.get("mp3Base64").toString()));
                        inputArgs = List.of("-i", src.toString());
                    } else if ("gemini".equals(candidate)) {
                        String geminiVoice = !voice.startsWith("vi-VN-") ? voice
                                : voice.endsWith(":warm") ? "Sulafat" : voice.contains("HoaiMy") ? "Kore" : "Orus";
                        byte[] pcm = geminiService.generateSpeech(text, geminiVoice, body.get("apiKey"));
                        src = Files.createTempFile("vs_tts_", ".pcm");
                        Files.write(src, pcm);
                        inputArgs = List.of("-f", "s16le", "-ar", "24000", "-ac", "1", "-i", src.toString());
                    } else {
                        src = Files.createTempFile("vs_say_", ".aiff");
                        runFfmpeg(List.of("/usr/bin/say", "-v", "Linh", "-r", "190", "-o", src.toString(), text), 60);
                        inputArgs = List.of("-i", src.toString());
                    }
                    temps.add(src);
                    List<String> cmd = new ArrayList<>(List.of(RedditService.ffmpegPath(), "-y", "-loglevel", "error"));
                    cmd.addAll(inputArgs);
                    cmd.addAll(List.of("-c:a", "aac", "-b:a", "160k", out.toString()));
                    runFfmpeg(cmd, 60);
                    engine = candidate;
                    break;
                } catch (Exception err) {
                    log.warn("[VideoStudio] TTS {} lỗi: {}", candidate, err.getMessage());
                    warnings.add(candidate + ": " + err.getMessage());
                }
            }
            if (engine == null) throw new IllegalStateException("Không tạo được giọng đọc: " + String.join("; ", warnings));
            String warning = warnings.isEmpty() ? null : String.join("; ", warnings);
            Map<String, Object> resp = new HashMap<>();
            resp.put("success", true);
            resp.put("url", publicUrl(out.getFileName().toString()));
            resp.put("duration", probe(out).duration);
            resp.put("engine", engine);
            if (words != null) resp.put("words", words);
            if (warning != null) resp.put("warning", warning);
            return ResponseEntity.ok(resp);
        } catch (Exception e) {
            log.error("[VideoStudio] Lỗi tạo giọng đọc: {}", e.getMessage(), e);
            return ResponseEntity.internalServerError().body(Map.of("success", false, "error", String.valueOf(e.getMessage())));
        } finally {
            for (Path t : temps) try { Files.deleteIfExists(t); } catch (Exception ignored) {}
        }
    }

    // ───────────────────────────── bgm presets ─────────────────────────────

    @GetMapping("/bgm-presets")
    public ResponseEntity<Map<String, Object>> bgmPresets() {
        List<Map<String, Object>> list = new ArrayList<>();
        try {
            Path src = Paths.get("../worker/bgm").toAbsolutePath().normalize();
            Path dst = uploadDir.resolve("bgm");
            Files.createDirectories(dst);
            if (Files.isDirectory(src)) {
                try (var stream = Files.list(src)) {
                    for (Path p : stream.filter(f -> f.toString().toLowerCase(Locale.ROOT).matches(".*\\.(mp3|m4a|wav|aac)$")).sorted().toList()) {
                        Path target = dst.resolve(p.getFileName());
                        if (!Files.exists(target)) Files.copy(p, target, StandardCopyOption.REPLACE_EXISTING);
                        String name = p.getFileName().toString().replaceAll("\\.[^.]+$", "").replace('_', ' ');
                        list.add(Map.of("name", name, "url", publicUrl("bgm/" + p.getFileName())));
                    }
                }
            }
        } catch (Exception e) {
            log.warn("[VideoStudio] Không đọc được nhạc mẫu: {}", e.getMessage());
        }
        return ResponseEntity.ok(Map.of("success", true, "items", list));
    }

    // ───────────────────────────── render ─────────────────────────────

    @PostMapping("/render")
    public ResponseEntity<Map<String, Object>> render(@RequestBody Map<String, Object> body) {
        String videoUrl = str(body.get("videoUrl"));
        String html = str(body.get("overlayHtml"));
        if (videoUrl.isBlank()) return bad("Thiếu video");
        if (html.isBlank()) return bad("Thiếu khung tiêu đề");
        Path overlayPng = null;
        Path brandPng = null;
        try {
            Path video = localUpload(videoUrl);
            if (video == null || !Files.exists(video)) return bad("Video phải được lấy về Studio trước (bấm 'Lấy video')");
            Path voice = str(body.get("voiceUrl")).isBlank() ? null : localUpload(str(body.get("voiceUrl")));
            Path music = str(body.get("musicUrl")).isBlank() ? null : localUpload(str(body.get("musicUrl")));
            if (voice != null && !Files.exists(voice)) voice = null;
            if (music != null && !Files.exists(music)) music = null;

            MediaInfo vInfo = probe(video);
            double duration = vInfo.duration > 0 ? vInfo.duration : 60;
            int outH = switch (str(body.get("ratio"))) {
                case "1:1" -> 1080;
                case "4:5" -> 1350;
                default -> 1920;
            };
            double voiceDur = voice != null ? probe(voice).duration : 0;
            double voiceDelay = 0.3;
            // introSeconds <= 0: khung hiện suốt video (mẫu bảng blur); tiếng gốc chỉ nhỏ lại trong lúc đọc
            boolean alwaysOn = num(body.get("introSeconds"), 5) <= 0;
            double intro = alwaysOn
                    ? (voice != null ? voiceDur + voiceDelay + 0.4 : 0)
                    : (voice != null && voiceDur > 0
                        ? Math.round((voiceDur + voiceDelay + 0.4) * 10.0) / 10.0
                        : Math.max(num(body.get("introSeconds"), 5), 5.0));
            intro = Math.min(intro, Math.max(alwaysOn ? 0 : 1, duration - 0.2));
            // Vùng đặt video chính (% chiều cao khung) — mẫu bảng blur chừa chỗ cho bảng chữ phía trên
            double regionTopPct = Math.max(0, Math.min(90, num(body.get("videoTopPct"), 0)));
            double regionHPctReq = Math.max(10, Math.min(100 - regionTopPct, num(body.get("videoHeightPct"), 100)));
            double regionHPct = regionHPctReq;
            double origVol = num(body.get("originalVolume"), 1.0);
            double duckVol = num(body.get("duckVolume"), 0.2);
            double musicVol = num(body.get("musicVolume"), 0.25);

            // 1. Khung tiêu đề nền trong suốt từ worker (cùng HTML với preview)
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            @SuppressWarnings("unchecked")
            Map<String, Object> resp = restTemplate.postForObject(WORKER + "/api/render-news-card",
                    new HttpEntity<>(Map.of("html", html), headers), Map.class);
            if (resp == null || !Boolean.TRUE.equals(resp.get("success")) || resp.get("pngBase64") == null) {
                throw new IllegalStateException(resp != null && resp.get("error") != null ? resp.get("error").toString() : "Worker không tạo được khung");
            }
            overlayPng = Files.createTempFile("vs_overlay_", ".png");
            Files.write(overlayPng, Base64.getDecoder().decode(resp.get("pngBase64").toString()));
            // Mẫu Studio Ảnh Tin: vùng ảnh cao/thấp theo độ dài tiêu đề → lấy đúng số đo worker vừa dựng
            if ("overlay".equals(str(body.get("videoRegionMode"))) && resp.get("photo") instanceof Map<?, ?> ph) {
                regionTopPct = Math.max(0, Math.min(90, num(ph.get("topPct"), regionTopPct)));
                regionHPct = Math.max(10, Math.min(100 - regionTopPct, num(ph.get("heightPct"), regionHPct)));
            }

            // 2. FFmpeg: nền mờ + video giữa, khung mờ dần ở cuối intro; tiếng gốc nhỏ lại khi đọc, voice, nhạc lặp
            List<String> cmd = new ArrayList<>(List.of(RedditService.ffmpegPath(), "-y",
                    "-i", video.toString(),
                    "-loop", "1", "-i", overlayPng.toString()));
            int voiceIdx = -1, musicIdx = -1, next = 2;
            // Lớp nhận diện (Nguồn + logo góc trên) — chỉ hiện sau khi khung ẩn
            int brandIdx = -1;
            String brandHtml = str(body.get("brandHtml"));
            if (!brandHtml.isBlank() && !alwaysOn && intro > 0) {
                @SuppressWarnings("unchecked")
                Map<String, Object> br = restTemplate.postForObject(WORKER + "/api/render-news-card",
                        new HttpEntity<>(Map.of("html", brandHtml), headers), Map.class);
                if (br != null && Boolean.TRUE.equals(br.get("success")) && br.get("pngBase64") != null) {
                    brandPng = Files.createTempFile("vs_brand_", ".png");
                    Files.write(brandPng, Base64.getDecoder().decode(br.get("pngBase64").toString()));
                    cmd.addAll(List.of("-loop", "1", "-i", brandPng.toString()));
                    brandIdx = next++;
                } else {
                    log.warn("[VideoStudio] Không dựng được lớp nguồn/logo: {}", br != null ? br.get("error") : "null");
                }
            }
            if (voice != null) { cmd.addAll(List.of("-i", voice.toString())); voiceIdx = next++; }
            if (music != null) { cmd.addAll(List.of("-stream_loop", "-1", "-i", music.toString())); musicIdx = next++; }

            int regionTop = (int) Math.round(outH * regionTopPct / 100.0);
            int regionH = (int) Math.round(outH * regionHPct / 100.0) / 2 * 2;
            // Chuyển cảnh mềm khi khung ẩn: trong D giây cuối intro, khung mờ đi + bản hiện trọn clip hiện dần lên
            double xD = Math.min(1.0, Math.max(0.6, intro / 3.0));
            double xStart = Math.max(0, intro - xD);
            String trans = str(body.getOrDefault("transitionEffect", "slidedown"));
            String ovOverlayParams;
            if ("slidedown".equals(trans)) {
                ovOverlayParams = String.format(Locale.ROOT,
                    "0:'if(gte(t,%1$.2f),(t-%1$.2f)/%2$.2f*180,0)':enable='lte(t,%3$.2f)':format=auto[vout]",
                    xStart, xD, intro);
            } else if ("slideup".equals(trans)) {
                ovOverlayParams = String.format(Locale.ROOT,
                    "0:'if(gte(t,%1$.2f),-(t-%1$.2f)/%2$.2f*180,0)':enable='lte(t,%3$.2f)':format=auto[vout]",
                    xStart, xD, intro);
            } else if ("wipeleft".equals(trans)) {
                ovOverlayParams = String.format(Locale.ROOT,
                    "'if(gte(t,%1$.2f),-(t-%1$.2f)/%2$.2f*250,0)':0:enable='lte(t,%3$.2f)':format=auto[vout]",
                    xStart, xD, intro);
            } else {
                ovOverlayParams = String.format(Locale.ROOT, "0:0:enable='lte(t,%.2f)':format=auto[vout]", intro);
            }
            String overlayChain = alwaysOn
                    ? String.format(Locale.ROOT, "[1:v]scale=%d:%d,format=yuva420p[ov];[base][ov]overlay=0:0:format=auto[vout]", OUT_W, outH)
                    : String.format(Locale.ROOT,
                        "[1:v]scale=%1$d:%2$d,format=yuva420p,fade=t=out:st=%3$.2f:d=%4$.2f:alpha=1[ov];" +
                        "[base][ov]overlay=%5$s",
                        OUT_W, outH, xStart, xD, ovOverlayParams);
            double focusYPct = Math.max(0.0, Math.min(100.0, num(body.get("videoFocusY"), 50.0))) / 100.0;
            double videoOffsetY = Math.max(-50.0, Math.min(50.0, num(body.get("videoOffsetY"), 0.0)));
            double videoScale = Math.max(0.5, Math.min(3.0, num(body.get("videoScale"), 1.0)));
            int yOffset = (int) Math.round(outH * (videoOffsetY / 100.0));
            int scaledW = (int) Math.round(OUT_W * videoScale) / 2 * 2;
            int scaledRegionH = (int) Math.round(regionH * videoScale) / 2 * 2;
            int scaledOutH = (int) Math.round(outH * videoScale) / 2 * 2;
            boolean isCover = "cover".equals(str(body.get("videoFit")));
            String vfgFilter = isCover
                    ? String.format(Locale.ROOT, "[0:v]scale=%1$d:%2$d:force_original_aspect_ratio=increase:flags=lanczos,crop=%1$d:%2$d:(in_w-out_w)/2:(in_h-out_h)*%3$.2f,setsar=1[vfg];", scaledW, scaledRegionH, focusYPct)
                    : String.format(Locale.ROOT, "[0:v]scale=%1$d:%2$d:force_original_aspect_ratio=decrease:flags=lanczos,setsar=1[vfg];", scaledW, scaledRegionH);

            String baseChain;
            if (!alwaysOn && intro > 0) {
                // Khi hết khung: clip chuyển cảnh mượt mà về dạng hiện trọn chuẩn TikTok (100% scale, ở giữa màn hình)
                String vfullScale = isCover
                        ? String.format(Locale.ROOT, "[0:v]scale=%1$d:%2$d:force_original_aspect_ratio=increase:flags=lanczos,crop=%1$d:%2$d:(in_w-out_w)/2:(in_h-out_h)*%3$.2f,setsar=1[vfull];", OUT_W, outH, focusYPct)
                        : String.format(Locale.ROOT, "[0:v]scale=%1$d:%2$d:force_original_aspect_ratio=decrease:flags=lanczos,setsar=1[vfull];", OUT_W, outH);
                baseChain = String.format(Locale.ROOT,
                        vfullScale +
                        "[vbg]split=2[vbgA][vbgB];" +
                        "[vbgA][vfg]overlay=(W-w)/2:%4$d+(%3$d-h)/2+(%7$d)[vlay];" +
                        "[vbgB][vfull]overlay=(W-w)/2:(H-h)/2,format=yuva420p,fade=t=in:st=%5$.2f:d=%6$.2f:alpha=1[vfullc];" +
                        "[vlay][vfullc]overlay=0:0:enable='gte(t,%5$.2f)':format=auto,fps=30[base];",
                        OUT_W, outH, regionH, regionTop, xStart, xD, yOffset);
            } else {
                baseChain = String.format(Locale.ROOT,
                        "[vbg][vfg]overlay=(W-w)/2:%2$d+(%1$d-h)/2+(%3$d),fps=30[base];",
                        regionH, regionTop, yOffset);
            }
            StringBuilder fc = new StringBuilder();
            fc.append(String.format(Locale.ROOT,
                    "[0:v]scale=%1$d:%2$d:force_original_aspect_ratio=increase,crop=%1$d:%2$d:(in_w-out_w)/2:(in_h-out_h)*%3$.2f,boxblur=30:6,eq=brightness=-0.08:saturation=1.3,setsar=1[vbg];" +
                    "%4$s" +
                    "%5$s",
                    OUT_W, outH, focusYPct,
                    vfgFilter,
                    baseChain));
            if (brandIdx >= 0) {
                fc.append(overlayChain.replace("[vout]", "[vpre]"));
                fc.append(String.format(Locale.ROOT,
                        ";[%d:v]scale=%d:%d,format=yuva420p,fade=t=in:st=%.2f:d=0.5:alpha=1[br];[vpre][br]overlay=0:0:enable='gte(t,%.2f)':format=auto[vout]",
                        brandIdx, OUT_W, outH, xStart + xD * 0.5, xStart + xD * 0.5));
            } else {
                fc.append(overlayChain);
            }

            List<String> mixIn = new ArrayList<>();
            if (vInfo.hasAudio && origVol > 0) {
                if (intro > 0 && duckVol < origVol) {
                    fc.append(String.format(Locale.ROOT,
                            ";[0:a]aresample=48000,volume='if(lt(t,%.2f),%.3f,if(lt(t,%.2f+0.5),%.3f+(%.3f-%.3f)*(t-%.2f)/0.5,%.3f))':eval=frame[a0]",
                            intro, duckVol, intro, duckVol, origVol, duckVol, intro, origVol));
                } else {
                    fc.append(String.format(Locale.ROOT,
                            ";[0:a]aresample=48000,volume=%.3f[a0]", origVol));
                }
                mixIn.add("[a0]");
            }
            if (voiceIdx >= 0) {
                int ms = (int) Math.round(voiceDelay * 1000);
                fc.append(String.format(Locale.ROOT, ";[%d:a]aresample=48000,adelay=%d|%d,volume=1.6[av]", voiceIdx, ms, ms));
                mixIn.add("[av]");
            }
            if (musicIdx >= 0 && musicVol > 0) {
                fc.append(String.format(Locale.ROOT,
                        ";[%d:a]aresample=48000,atrim=0:%.2f,volume=%.3f,afade=t=in:d=0.8,afade=t=out:st=%.2f:d=1.5[am]",
                        musicIdx, duration, musicVol, Math.max(0, duration - 1.5)));
                mixIn.add("[am]");
            }
            boolean hasAudioOut = !mixIn.isEmpty();
            if (mixIn.size() == 1) {
                fc.append(";").append(mixIn.get(0)).append("apad,alimiter=limit=0.95[aout]");
            } else if (mixIn.size() > 1) {
                fc.append(";").append(String.join("", mixIn))
                        .append(String.format("amix=inputs=%d:normalize=0:duration=longest,alimiter=limit=0.95[aout]", mixIn.size()));
            }

            Files.createDirectories(uploadDir);
            String outName = "vs-video-" + UUID.randomUUID() + ".mp4";
            Path outFile = uploadDir.resolve(outName);
            cmd.addAll(List.of("-filter_complex", fc.toString(), "-map", "[vout]"));
            if (hasAudioOut) cmd.addAll(List.of("-map", "[aout]", "-c:a", "aac", "-b:a", "192k", "-ar", "48000"));
            cmd.addAll(List.of("-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
                    "-movflags", "+faststart",
                    "-sws_flags", "lanczos",
                    "-t", String.format(Locale.ROOT, "%.3f", duration), outFile.toString()));
            runFfmpeg(cmd, 300);

            Map<String, Object> out = new HashMap<>();
            out.put("success", true);
            out.put("url", publicUrl(outName));
            out.put("duration", duration);
            out.put("introSeconds", intro);
            return ResponseEntity.ok(out);
        } catch (Exception e) {
            log.error("[VideoStudio] Lỗi xuất video: {}", e.getMessage(), e);
            return ResponseEntity.internalServerError().body(Map.of("success", false, "error", String.valueOf(e.getMessage())));
        } finally {
            if (overlayPng != null) try { Files.deleteIfExists(overlayPng); } catch (Exception ignored) {}
            if (brandPng != null) try { Files.deleteIfExists(brandPng); } catch (Exception ignored) {}
        }
    }

    // ───────────────────────────── render-project (Video Editor) ─────────────────────────────
    // Editor gửi cả dự án: video (cắt/tốc độ/màu/vị trí), các lớp hình theo thời gian (khung, chữ, phụ đề, logo),
    // nhiều đoạn giọng đọc và nhạc nền. Xuất chạy nền, frontend hỏi tiến độ qua GET /render-project/{id}.

    /** Hiệu ứng chuyển cảnh cho phép (tên filter xfade của FFmpeg) — "none" = cắt thẳng */
    private static final Set<String> XFADE_OK = Set.of("none", "fade", "fadeblack", "fadewhite", "dissolve", "wipeleft", "wiperight", "wipeup", "wipedown",
            "slideleft", "slideright", "slideup", "slidedown", "smoothleft", "smoothup", "circleopen", "circleclose", "radial", "zoomin", "hblur", "pixelize", "squeezeh", "vertopen", "horzopen");

    private static final Map<String, Map<String, Object>> JOBS = new java.util.concurrent.ConcurrentHashMap<>();
    private static final java.util.concurrent.ExecutorService RENDER_POOL = java.util.concurrent.Executors.newFixedThreadPool(2);

    @PostMapping("/render-project")
    public ResponseEntity<Map<String, Object>> renderProject(@RequestBody Map<String, Object> body) {
        @SuppressWarnings("unchecked")
        Map<String, Object> video = body.get("video") instanceof Map<?, ?> m ? (Map<String, Object>) m : Map.of();
        Path src = localUpload(str(video.get("url")));
        if (src == null || !Files.exists(src)) return bad("Video phải được lấy về Studio trước (bấm 'Lấy video')");
        String id = UUID.randomUUID().toString();
        Map<String, Object> job = new java.util.concurrent.ConcurrentHashMap<>();
        job.put("status", "running");
        job.put("progress", 0.0);
        job.put("stage", "Đang chuẩn bị");
        job.put("createdAt", System.currentTimeMillis());
        JOBS.put(id, job);
        // Dọn job cũ hơn 2 giờ
        long cutoff = System.currentTimeMillis() - 2 * 3600_000L;
        JOBS.entrySet().removeIf(e -> e.getValue().get("createdAt") instanceof Long t && t < cutoff);
        // Luồng nền không có request → lấy sẵn địa chỉ /uploads/ ở đây
        String uploadsBase = ServletUriComponentsBuilder.fromCurrentContextPath().path("/uploads/").toUriString();
        RENDER_POOL.submit(() -> {
            try {
                String outName = doRenderProject(body, src, job);
                job.put("url", uploadsBase + outName);
                job.put("progress", 1.0);
                job.put("status", "done");
            } catch (Exception e) {
                log.error("[VideoEditor] Lỗi xuất video: {}", e.getMessage(), e);
                job.put("error", String.valueOf(e.getMessage()));
                job.put("status", "error");
            }
        });
        return ResponseEntity.ok(Map.of("success", true, "jobId", id));
    }

    @GetMapping("/render-project/{id}")
    public ResponseEntity<Map<String, Object>> renderProjectStatus(@PathVariable String id) {
        Map<String, Object> job = JOBS.get(id);
        if (job == null) return ResponseEntity.status(404).body(Map.of("success", false, "error", "Không tìm thấy lượt xuất"));
        Map<String, Object> out = new HashMap<>(job);
        out.put("success", true);
        return ResponseEntity.ok(out);
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> listOf(Object o) {
        List<Map<String, Object>> out = new ArrayList<>();
        if (o instanceof List<?> l) for (Object x : l) if (x instanceof Map<?, ?> m) out.add((Map<String, Object>) m);
        return out;
    }

    private static String f(double v) {
        return String.format(Locale.ROOT, "%.3f", v);
    }

    /** Biểu thức dời lớp khi hiệu ứng vào/ra (px trên khung 1080 rộng); khớp với animOffset() ở frontend */
    private static double[] animVec(String anim, boolean in) {
        double d = 180;
        return switch (anim) {
            case "slideup" -> new double[]{0, in ? d : -d};
            case "slidedown" -> new double[]{0, in ? -d : d};
            case "slideleft" -> new double[]{in ? d : -d, 0};
            case "slideright" -> new double[]{in ? -d : d, 0};
            default -> new double[]{0, 0};
        };
    }

    private String doRenderProject(Map<String, Object> body, Path src, Map<String, Object> job) throws Exception {
        @SuppressWarnings("unchecked")
        Map<String, Object> v = (Map<String, Object>) body.get("video");
        int outH = switch (str(body.get("ratio"))) {
            case "1:1" -> 1080;
            case "4:5" -> 1350;
            default -> 1920;
        };
        MediaInfo info = probe(src);
        double srcDur = info.duration > 0 ? info.duration : 60;
        double trimIn = Math.max(0, Math.min(srcDur - 0.2, num(v.get("trimIn"), 0)));
        double trimOut = Math.max(trimIn + 0.2, Math.min(srcDur, num(v.get("trimOut"), srcDur)));
        double speed = Math.max(0.5, Math.min(2.0, num(v.get("speed"), 1)));
        double D = (trimOut - trimIn) / speed;
        List<Path> temps = new ArrayList<>();
        try {
            // 1. Dựng PNG cho mọi lớp hình bằng worker (cùng HTML với preview)
            List<Map<String, Object>> overlays = listOf(body.get("overlays"));
            overlays.removeIf(o -> str(o.get("html")).isBlank() || num(o.get("end"), 0) <= num(o.get("start"), 0) || num(o.get("start"), 0) >= D);
            List<Map<String, Object>> rendered = new ArrayList<>();
            if (!overlays.isEmpty()) {
                job.put("stage", "Đang dựng " + overlays.size() + " lớp chữ/khung");
                HttpHeaders headers = new HttpHeaders();
                headers.setContentType(MediaType.APPLICATION_JSON);
                List<String> htmls = overlays.stream().map(o -> str(o.get("html"))).toList();
                List<?> items = renderLayers(htmls, headers);
                for (int i = 0; i < overlays.size(); i++) {
                    Object it = i < items.size() ? items.get(i) : null;
                    if (!(it instanceof Map<?, ?> im) || im.get("pngBase64") == null) continue;
                    Path png = Files.createTempFile("vs_layer_", ".png");
                    temps.add(png);
                    Files.write(png, Base64.getDecoder().decode(im.get("pngBase64").toString()));
                    Map<String, Object> r = new HashMap<>(overlays.get(i));
                    r.put("png", png);
                    r.put("x", num(im.get("x"), 0));
                    r.put("y", num(im.get("y"), 0));
                    r.put("w", num(im.get("w"), 0));
                    r.put("h", num(im.get("h"), 0));
                    rendered.add(r);
                }
            }
            job.put("progress", 0.08);
            job.put("stage", "Đang ghép video");

            // 2. Input
            List<String> cmd = new ArrayList<>(List.of(RedditService.ffmpegPath(), "-y", "-nostats", "-progress", "pipe:1",
                    "-ss", f(trimIn), "-t", f(trimOut - trimIn), "-i", src.toString()));
            int next = 1;
            List<Integer> ovIdx = new ArrayList<>();
            for (Map<String, Object> r : rendered) {
                double end = Math.min(D, num(r.get("end"), D));
                cmd.addAll(List.of("-loop", "1", "-framerate", "30", "-t", f(end + 0.2), "-i", r.get("png").toString()));
                ovIdx.add(next++);
            }
            List<Map<String, Object>> voices = listOf(body.get("voices"));
            List<int[]> voiceIdx = new ArrayList<>();
            List<double[]> voiceSpans = new ArrayList<>();
            for (int i = 0; i < voices.size(); i++) {
                Map<String, Object> vc = voices.get(i);
                Path p = localUpload(str(vc.get("url")));
                if (p == null || !Files.exists(p)) continue;
                double st = Math.max(0, num(vc.get("start"), 0));
                if (st >= D) continue;
                double dur = num(vc.get("duration"), 0);
                if (dur <= 0) dur = probe(p).duration;
                if (num(vc.get("trimOut"), 0) > 0) dur = num(vc.get("trimOut"), dur) - Math.max(0, num(vc.get("trimIn"), 0));
                cmd.addAll(List.of("-i", p.toString()));
                voiceIdx.add(new int[]{next++, i});
                voiceSpans.add(new double[]{st, Math.min(D, st + dur)});
            }
            @SuppressWarnings("unchecked")
            Map<String, Object> bgm = body.get("bgm") instanceof Map<?, ?> bm ? (Map<String, Object>) bm : null;
            int bgmIdx = -1;
            if (bgm != null) {
                Path p = localUpload(str(bgm.get("url")));
                if (p != null && Files.exists(p) && num(bgm.get("volume"), 0) > 0) {
                    double off = Math.max(0, num(bgm.get("offset"), 0));
                    cmd.addAll(List.of("-stream_loop", "-1", "-ss", f(off), "-i", p.toString()));
                    bgmIdx = next++;
                }
            }

            // 3. Hình: nền mờ + clip trong vùng khung; hết khung thì chuyển dần về clip trọn màn hình
            boolean cover = "cover".equals(str(v.get("fit")));
            double focus = Math.max(0, Math.min(100, num(v.get("focusY"), 50))) / 100.0;
            double vScale = Math.max(0.5, Math.min(3.0, num(v.get("scale"), 1)));
            double regionTopPct = Math.max(0, Math.min(90, num(v.get("regionTopPct"), 0)));
            double regionHPct = Math.max(10, Math.min(100 - regionTopPct, num(v.get("regionHeightPct"), 100)));
            int regionTop = (int) Math.round(outH * regionTopPct / 100.0);
            int regionH = (int) Math.round(outH * regionHPct / 100.0) / 2 * 2;
            int yOff = (int) Math.round(regionH * Math.max(-60, Math.min(60, num(v.get("offsetY"), 0))) / 100.0);
            int sW = (int) Math.round(OUT_W * vScale) / 2 * 2;
            int sH = (int) Math.round(regionH * vScale) / 2 * 2;
            double layoutUntil = Math.max(0, Math.min(D, num(v.get("layoutUntil"), D)));
            double xD = Math.max(0.1, Math.min(2, num(v.get("layoutFade"), 0.8)));
            boolean switchFull = layoutUntil < D - 0.05;
            double xs = Math.max(0, layoutUntil - xD);
            double br = Math.max(-0.5, Math.min(0.5, num(v.get("brightness"), 0)));
            double ct = Math.max(0.5, Math.min(2, num(v.get("contrast"), 1)));
            double sat = Math.max(0, Math.min(3, num(v.get("saturation"), 1)));
            String eq = (br != 0 || ct != 1 || sat != 1) ? String.format(Locale.ROOT, ",eq=brightness=%.3f:contrast=%.3f:saturation=%.3f", br, ct, sat) : "";

            StringBuilder fc = new StringBuilder();
            fc.append(String.format(Locale.ROOT, "[0:v]setpts=(PTS-STARTPTS)/%.4f,fps=30%s,setsar=1,split=%d[s1][s2]%s;",
                    speed, eq, switchFull ? 3 : 2, switchFull ? "[s3]" : ""));
            fc.append(String.format(Locale.ROOT,
                    "[s1]scale=%1$d:%2$d:force_original_aspect_ratio=increase,crop=%1$d:%2$d:(in_w-out_w)/2:(in_h-out_h)*%3$.3f,boxblur=30:6,eq=brightness=-0.08:saturation=1.3,setsar=1%4$s;",
                    OUT_W, outH, focus, switchFull ? ",split=2[vbg][vbg2]" : "[vbg]"));
            fc.append(cover
                    ? String.format(Locale.ROOT, "[s2]scale=%1$d:%2$d:force_original_aspect_ratio=increase:flags=lanczos,crop=%1$d:%2$d:(in_w-out_w)/2:(in_h-out_h)*%3$.3f,setsar=1[vfg];", sW, sH, focus)
                    : String.format(Locale.ROOT, "[s2]scale=%1$d:%2$d:force_original_aspect_ratio=decrease:flags=lanczos,setsar=1[vfg];", sW, sH));
            fc.append(String.format(Locale.ROOT, "[vbg][vfg]overlay=(W-w)/2:%d+(%d-h)/2+(%d)%s",
                    regionTop, regionH, yOff, switchFull ? "[vlay];" : ",format=yuv420p[v0]"));
            // Khung tiêu đề nằm trong cảnh "trước" để hiệu ứng chuyển cảnh (gạt, mở tròn, trượt...) cuốn theo cả khung
            String layLabel = "[vlay]";
            java.util.Set<Integer> underDone = new java.util.HashSet<>();
            if (switchFull) {
                for (int k = 0; k < rendered.size(); k++) {
                    Map<String, Object> r = rendered.get(k);
                    if (!Boolean.TRUE.equals(r.get("under")) || !"canvas".equals(str(r.get("fit")))) continue;
                    double s0 = Math.max(0, num(r.get("start"), 0));
                    String inA = str(r.get("inAnim"));
                    double ad = Math.max(0.05, num(r.get("animDur"), 0.5));
                    String fadeIn = !inA.isBlank() && !"none".equals(inA) ? String.format(Locale.ROOT, ",fade=t=in:st=%.3f:d=%.3f:alpha=1", s0, ad) : "";
                    double[] vin = animVec(inA, true);
                    String xe = String.format(Locale.ROOT, "%.1f+(1-clip((t-%.3f)/%.3f,0,1))*(%.1f)", num(r.get("dx"), 0), s0, ad, vin[0]);
                    String ye = String.format(Locale.ROOT, "%.1f+(1-clip((t-%.3f)/%.3f,0,1))*(%.1f)", num(r.get("dy"), 0), s0, ad, vin[1]);
                    String outL = "[vlayu" + k + "]";
                    fc.append(String.format(Locale.ROOT, "[%d:v]format=rgba,scale=%d:%d%s[ovu%d];%s[ovu%d]overlay=x='%s':y='%s':eval=frame:enable='between(t,%.3f,%.3f)'%s;",
                            ovIdx.get(k), OUT_W, outH, fadeIn, k, layLabel, k, xe, ye, s0, layoutUntil, outL));
                    layLabel = outL;
                    underDone.add(k);
                }
            }
            if (switchFull) {
                // Chuyển cảnh từ bố cục khung → clip trọn màn hình bằng xfade (khớp danh sách TRANSITIONS ở frontend).
                // Nhánh "trọn màn" được cắt bắt đầu từ xs để xfade nối đúng thời điểm, không phát lại từ đầu.
                String trans = str(v.get("transition"));
                if (!XFADE_OK.contains(trans)) trans = "fade";
                fc.append(String.format(Locale.ROOT,
                        "[s3]scale=%1$d:%2$d:force_original_aspect_ratio=decrease:flags=lanczos,setsar=1[vfull];" +
                        "[vbg2][vfull]overlay=(W-w)/2:(H-h)/2,format=yuv420p,settb=AVTB[vfullc];%3$sformat=yuv420p,settb=AVTB[vlayc];",
                        OUT_W, outH, layLabel));
                if ("none".equals(trans)) {
                    fc.append(String.format(Locale.ROOT, "[vlayc][vfullc]overlay=0:0:enable='gte(t,%.3f)',format=yuv420p[v0]", layoutUntil));
                } else {
                    fc.append(String.format(Locale.ROOT,
                            "[vfullc]trim=start=%1$.3f,setpts=PTS-STARTPTS[vfullt];[vlayc][vfullt]xfade=transition=%3$s:duration=%2$.3f:offset=%1$.3f,format=yuv420p[v0]",
                            xs, xD, trans));
                }
            }
            String last = "[v0]";
            for (int k = 0; k < rendered.size(); k++) {
                if (underDone.contains(k)) continue;
                Map<String, Object> r = rendered.get(k);
                int idx = ovIdx.get(k);
                double s0 = Math.max(0, num(r.get("start"), 0));
                double e0 = Math.min(D, num(r.get("end"), D));
                String inA = str(r.get("inAnim"));
                String outA = str(r.get("outAnim"));
                double ad = Math.max(0.05, Math.min((e0 - s0) / 2, num(r.get("animDur"), 0.5)));
                boolean canvas = "canvas".equals(str(r.get("fit")));
                double sc = Math.max(0.1, Math.min(5, num(r.get("scale"), 1)));
                double w = num(r.get("w"), 0), h = num(r.get("h"), 0);
                double x0, y0;
                String scaleF;
                if (canvas) {
                    // Khung full (HTML có thể rộng 1440) → co về đúng cỡ khung xuất rồi dời dx/dy
                    int cw = (int) Math.round(OUT_W * sc) / 2 * 2, ch = (int) Math.round(outH * sc) / 2 * 2;
                    scaleF = String.format(Locale.ROOT, ",scale=%d:%d", cw, ch);
                    x0 = num(r.get("dx"), 0) + (OUT_W - cw) / 2.0;
                    y0 = num(r.get("dy"), 0) + (outH - ch) / 2.0;
                } else {
                    int nw = Math.max(2, (int) Math.round(w * sc)), nh = Math.max(2, (int) Math.round(h * sc));
                    scaleF = sc != 1 ? String.format(Locale.ROOT, ",scale=%d:%d", nw, nh) : "";
                    x0 = num(r.get("x"), 0) + num(r.get("dx"), 0) + (w - nw) / 2.0;
                    y0 = num(r.get("y"), 0) + num(r.get("dy"), 0) + (h - nh) / 2.0;
                }
                StringBuilder ff = new StringBuilder();
                if (!inA.isBlank() && !"none".equals(inA)) ff.append(String.format(Locale.ROOT, ",fade=t=in:st=%.3f:d=%.3f:alpha=1", s0, ad));
                if (!outA.isBlank() && !"none".equals(outA)) ff.append(String.format(Locale.ROOT, ",fade=t=out:st=%.3f:d=%.3f:alpha=1", e0 - ad, ad));
                double opacity = Math.max(0, Math.min(1, num(r.get("opacity"), 1)));
                String alpha = opacity < 1 ? String.format(Locale.ROOT, ",colorchannelmixer=aa=%.3f", opacity) : "";
                double[] vin = animVec(inA, true), vout = animVec(outA, false);
                String xe = String.format(Locale.ROOT, "%.1f+(1-clip((t-%.3f)/%.3f,0,1))*(%.1f)+(1-clip((%.3f-t)/%.3f,0,1))*(%.1f)", x0, s0, ad, vin[0], e0, ad, vout[0]);
                String ye = String.format(Locale.ROOT, "%.1f+(1-clip((t-%.3f)/%.3f,0,1))*(%.1f)+(1-clip((%.3f-t)/%.3f,0,1))*(%.1f)", y0, s0, ad, vin[1], e0, ad, vout[1]);
                String outLabel = "[vo" + k + "]";
                fc.append(String.format(Locale.ROOT, ";[%d:v]format=rgba%s%s%s[ov%d];%s[ov%d]overlay=x='%s':y='%s':eval=frame:enable='between(t,%.3f,%.3f)'%s",
                        idx, scaleF, alpha, ff, k, last, k, xe, ye, s0, e0, outLabel));
                last = outLabel;
            }
            // Mở đầu hiện dần từ đen / kết thúc tối dần (cả hình và tiếng)
            double fadeIn = Math.max(0, Math.min(3, num(body.get("fadeIn"), 0)));
            double fadeOut = Math.max(0, Math.min(3, num(body.get("fadeOut"), 0)));
            StringBuilder endFx = new StringBuilder();
            if (fadeIn > 0) endFx.append(String.format(Locale.ROOT, "fade=t=in:st=0:d=%.3f,", fadeIn));
            if (fadeOut > 0) endFx.append(String.format(Locale.ROOT, "fade=t=out:st=%.3f:d=%.3f,", Math.max(0, D - fadeOut), fadeOut));
            fc.append(";").append(last).append(endFx).append("format=yuv420p[vout]");

            // 4. Âm thanh: tiếng gốc (nhỏ lại khi có giọng đọc), các đoạn giọng đọc, nhạc nền lặp + fade
            List<String> mixIn = new ArrayList<>();
            double origVol = Math.max(0, Math.min(2, num(v.get("volume"), 1)));
            double duckVol = Math.max(0, Math.min(2, num(v.get("duckVolume"), 0.2)));
            if (info.hasAudio && origVol > 0) {
                String tempo = speed != 1 ? String.format(Locale.ROOT, ",atempo=%.4f", speed) : "";
                String active = voiceSpans.isEmpty() ? "0" : String.join("+", voiceSpans.stream()
                        .map(sp -> String.format(Locale.ROOT, "between(t,%.3f,%.3f)", sp[0], sp[1] + 0.2)).toList());
                fc.append(String.format(Locale.ROOT, ";[0:a]asetpts=PTS-STARTPTS%s,aresample=48000,volume='if(gt(%s,0),%.3f,%.3f)':eval=frame[a0]",
                        tempo, active, duckVol, origVol));
                mixIn.add("[a0]");
            }
            for (int[] vi : voiceIdx) {
                Map<String, Object> vc = voices.get(vi[1]);
                int ms = (int) Math.round(Math.max(0, num(vc.get("start"), 0)) * 1000);
                double vol = Math.max(0, Math.min(3, num(vc.get("volume"), 1.6)));
                double tIn = Math.max(0, num(vc.get("trimIn"), 0));
                double tOut = num(vc.get("trimOut"), 0);
                String trim = tOut > tIn + 0.05 ? String.format(Locale.ROOT, "atrim=start=%.3f:end=%.3f,asetpts=PTS-STARTPTS,", tIn, tOut)
                        : tIn > 0 ? String.format(Locale.ROOT, "atrim=start=%.3f,asetpts=PTS-STARTPTS,", tIn) : "";
                fc.append(String.format(Locale.ROOT, ";[%d:a]%saresample=48000,adelay=delays=%d:all=1,volume=%.3f[av%d]", vi[0], trim, ms, vol, vi[0]));
                mixIn.add("[av" + vi[0] + "]");
            }
            if (bgmIdx >= 0) {
                double st = Math.max(0, Math.min(D, num(bgm.get("start"), 0)));
                double en = Math.max(st + 0.2, Math.min(D, num(bgm.get("end"), D)));
                double len = en - st;
                double fi = Math.max(0, Math.min(len / 2, num(bgm.get("fadeIn"), 0.8)));
                double fo = Math.max(0, Math.min(len / 2, num(bgm.get("fadeOut"), 1.5)));
                double vol = Math.max(0, Math.min(2, num(bgm.get("volume"), 0.25)));
                StringBuilder bf = new StringBuilder(String.format(Locale.ROOT, ";[%d:a]aresample=48000,atrim=0:%.3f,asetpts=PTS-STARTPTS,volume=%.3f", bgmIdx, len, vol));
                if (fi > 0) bf.append(String.format(Locale.ROOT, ",afade=t=in:d=%.3f", fi));
                if (fo > 0) bf.append(String.format(Locale.ROOT, ",afade=t=out:st=%.3f:d=%.3f", len - fo, fo));
                int ms = (int) Math.round(st * 1000);
                if (ms > 0) bf.append(String.format(Locale.ROOT, ",adelay=delays=%d:all=1", ms));
                fc.append(bf).append("[am]");
                mixIn.add("[am]");
            }
            boolean hasAudio = !mixIn.isEmpty();
            String aFx = (fadeIn > 0 ? String.format(Locale.ROOT, ",afade=t=in:st=0:d=%.3f", fadeIn) : "")
                    + (fadeOut > 0 ? String.format(Locale.ROOT, ",afade=t=out:st=%.3f:d=%.3f", Math.max(0, D - fadeOut), fadeOut) : "");
            if (mixIn.size() == 1) fc.append(";").append(mixIn.get(0)).append("apad,alimiter=limit=0.95").append(aFx).append("[aout]");
            else if (mixIn.size() > 1) fc.append(";").append(String.join("", mixIn))
                    .append(String.format(Locale.ROOT, "amix=inputs=%d:normalize=0:duration=longest,alimiter=limit=0.95", mixIn.size())).append(aFx).append("[aout]");

            Files.createDirectories(uploadDir);
            String outName = "vs-video-" + UUID.randomUUID() + ".mp4";
            Path outFile = uploadDir.resolve(outName);
            Path script = Files.createTempFile("vs_fc_", ".txt");
            temps.add(script);
            Files.writeString(script, fc.toString());
            cmd.addAll(List.of("-/filter_complex", script.toString(), "-map", "[vout]"));
            if (hasAudio) cmd.addAll(List.of("-map", "[aout]", "-c:a", "aac", "-b:a", "192k", "-ar", "48000"));
            cmd.addAll(List.of("-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
                    "-r", "30", "-movflags", "+faststart", "-t", f(D), outFile.toString()));
            runFfmpegProgress(cmd, D, job, 900);
            return outName;
        } finally {
            for (Path t : temps) try { Files.deleteIfExists(t); } catch (Exception ignored) {}
        }
    }

    /**
     * Dựng PNG cho các lớp. Worker mới có /api/render-html-layers (1 trang, cắt gọn theo #layer);
     * worker chưa khởi động lại thì lùi về /api/render-news-card từng lớp (PNG cả khung, toạ độ 0,0).
     */
    private List<?> renderLayers(List<String> htmls, HttpHeaders headers) {
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> resp = restTemplate.postForObject(WORKER + "/api/render-html-layers",
                    new HttpEntity<>(Map.of("htmls", htmls), headers), Map.class);
            if (resp != null && Boolean.TRUE.equals(resp.get("success")) && resp.get("items") instanceof List<?> items) return items;
            throw new IllegalStateException(resp != null && resp.get("error") != null ? resp.get("error").toString() : "Worker không dựng được lớp hình");
        } catch (org.springframework.web.client.HttpClientErrorException.NotFound e) {
            log.warn("[VideoEditor] Worker chưa có /api/render-html-layers → dựng từng lớp bằng /api/render-news-card");
            List<Object> out = new ArrayList<>();
            for (String html : htmls) {
                @SuppressWarnings("unchecked")
                Map<String, Object> r = restTemplate.postForObject(WORKER + "/api/render-news-card",
                        new HttpEntity<>(Map.of("html", html), headers), Map.class);
                if (r == null || r.get("pngBase64") == null) { out.add(null); continue; }
                Map<String, Object> it = new HashMap<>();
                it.put("pngBase64", r.get("pngBase64"));
                it.put("x", 0);
                it.put("y", 0);
                out.add(it);
            }
            return out;
        }
    }

    /** Chạy FFmpeg với -progress pipe:1, cập nhật job.progress từ 0.08 → 0.99 theo out_time */
    private void runFfmpegProgress(List<String> cmd, double total, Map<String, Object> job, int timeoutSec) throws Exception {
        Path errLog = Files.createTempFile("vs_ff_", ".log");
        try {
            Process p = new ProcessBuilder(cmd).redirectError(errLog.toFile()).start();
            Thread reader = new Thread(() -> {
                try (var br = new java.io.BufferedReader(new java.io.InputStreamReader(p.getInputStream(), StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = br.readLine()) != null) {
                        if (line.startsWith("out_time_us=") || line.startsWith("out_time_ms=")) {
                            try {
                                double sec = Long.parseLong(line.substring(line.indexOf('=') + 1).trim()) / 1_000_000.0;
                                job.put("progress", Math.min(0.99, 0.08 + 0.91 * Math.max(0, sec) / Math.max(0.1, total)));
                            } catch (NumberFormatException ignored) {}
                        }
                    }
                } catch (Exception ignored) {}
            });
            reader.setDaemon(true);
            reader.start();
            if (!p.waitFor(timeoutSec, TimeUnit.SECONDS)) {
                p.destroyForcibly();
                throw new IllegalStateException("FFmpeg chạy quá " + timeoutSec + "s");
            }
            reader.join(2000);
            if (p.exitValue() != 0) {
                String err = Files.readString(errLog);
                log.error("[VideoEditor] Lệnh lỗi: {}\n{}", String.join(" ", cmd), err);
                throw new IllegalStateException("Ghép video lỗi: " + err.substring(Math.max(0, err.length() - 600)));
            }
        } finally {
            Files.deleteIfExists(errLog);
        }
    }

    // ───────────────────────────── đăng TikTok từ Video Editor ─────────────────────────────

    @PostMapping("/post-tiktok")
    public ResponseEntity<Map<String, Object>> postTikTok(@RequestBody Map<String, Object> body) {
        long accountId = (long) num(body.get("accountId"), -1);
        String videoUrl = str(body.get("videoUrl"));
        String caption = str(body.get("caption"));
        Path local = localUpload(videoUrl);
        if (local == null || !Files.exists(local)) return bad("Không tìm thấy file video đã xuất");
        var account = socialAccountRepository.findById(accountId).orElse(null);
        if (account == null) return bad("Không tìm thấy kênh TikTok đã chọn");
        boolean isTikTok = "TIKTOK".equalsIgnoreCase(account.getPlatform()) || "TIKTOK_COOKIE".equalsIgnoreCase(account.getAccountType());
        if (!isTikTok) return bad("Kết nối đã chọn không phải kênh TikTok");
        if (account.getAccessToken() == null || account.getAccessToken().isBlank()) return bad("Kênh TikTok chưa có cookie đăng nhập");
        String id = UUID.randomUUID().toString();
        Map<String, Object> job = new java.util.concurrent.ConcurrentHashMap<>();
        job.put("status", "running");
        job.put("stage", "Đang gửi video sang TikTok");
        job.put("createdAt", System.currentTimeMillis());
        JOBS.put(id, job);
        String cookie = account.getAccessToken();
        String channel = account.getPageName() == null ? "" : account.getPageName();
        RENDER_POOL.submit(() -> {
            try {
                HttpHeaders headers = new HttpHeaders();
                headers.setContentType(MediaType.APPLICATION_JSON);
                Map<String, Object> req = new HashMap<>();
                req.put("videoUrl", videoUrl);
                req.put("caption", caption);
                req.put("cookieString", cookie);
                req.put("socialAccountId", String.valueOf(accountId));
                @SuppressWarnings("unchecked")
                Map<String, Object> r = tiktokRestTemplate.postForObject(WORKER + "/api/post-tiktok", new HttpEntity<>(req, headers), Map.class);
                if (r == null || !Boolean.TRUE.equals(r.get("success"))) throw new IllegalStateException(r != null && r.get("error") != null ? r.get("error").toString() : "Worker không phản hồi");
                job.put("message", Objects.toString(r.get("message"), "Đã đăng lên TikTok"));
                if (r.get("warning") != null) job.put("warning", r.get("warning").toString());
                job.put("status", "done");
                log.info("[VideoEditor] Đăng TikTok xong cho kênh {} ({})", channel, accountId);
            } catch (org.springframework.web.client.HttpStatusCodeException e) {
                String msg = e.getResponseBodyAsString();
                try { msg = objectMapper.readTree(msg).path("error").asText(msg); } catch (Exception ignored) {}
                job.put("error", msg);
                job.put("status", "error");
            } catch (Exception e) {
                job.put("error", String.valueOf(e.getMessage()));
                job.put("status", "error");
            }
        });
        return ResponseEntity.ok(Map.of("success", true, "jobId", id));
    }

    // ───────────────────────────── helpers ─────────────────────────────

    private record MediaInfo(double duration, int width, int height, boolean hasVideo, boolean hasAudio) {}

    private MediaInfo probe(Path file) throws Exception {
        String ffprobe = RedditService.ffmpegPath().replaceAll("ffmpeg$", "ffprobe");
        if (!new java.io.File(ffprobe).canExecute()) ffprobe = "ffprobe";
        Process p = new ProcessBuilder(ffprobe, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", file.toString())
                .redirectErrorStream(true).start();
        String json = new String(p.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        if (!p.waitFor(30, TimeUnit.SECONDS)) { p.destroyForcibly(); throw new IllegalStateException("ffprobe quá thời gian"); }
        JsonNode root = objectMapper.readTree(json);
        double duration = root.path("format").path("duration").asDouble(0);
        int w = 0, h = 0;
        boolean v = false, a = false;
        for (JsonNode s : root.path("streams")) {
            String type = s.path("codec_type").asText();
            if ("video".equals(type) && !v && !"mjpeg".equals(s.path("codec_name").asText())) {
                v = true; w = s.path("width").asInt(); h = s.path("height").asInt();
            }
            if ("audio".equals(type)) a = true;
        }
        return new MediaInfo(duration, w, h, v, a);
    }

    private void runFfmpeg(List<String> cmd, int timeoutSec) throws Exception {
        Process p = new ProcessBuilder(cmd).redirectErrorStream(true).start();
        // Đọc output song song để FFmpeg không bị nghẽn khi in nhiều log
        java.util.concurrent.CompletableFuture<String> output = java.util.concurrent.CompletableFuture.supplyAsync(() -> {
            try { return new String(p.getInputStream().readAllBytes(), StandardCharsets.UTF_8); } catch (Exception e) { return ""; }
        });
        if (!p.waitFor(timeoutSec, TimeUnit.SECONDS)) {
            p.destroyForcibly();
            throw new IllegalStateException(cmd.get(0) + " chạy quá " + timeoutSec + "s");
        }
        if (p.exitValue() != 0) {
            String log = output.get(5, TimeUnit.SECONDS);
            VideoStudioController.log.error("[VideoStudio] Lệnh lỗi: {}\n{}", String.join(" ", cmd), log);
            throw new IllegalStateException("Xử lý lỗi: " + log.substring(Math.max(0, log.length() - 600)));
        }
    }

    /** "/uploads/x", "http://localhost:8081/uploads/x" → file trong uploads/ (chặn ../); link ngoài → null */
    private Path localUpload(String url) {
        if (url == null) return null;
        String path = url;
        if (url.startsWith("http://") || url.startsWith("https://")) {
            try {
                URI u = URI.create(url);
                String host = u.getHost() == null ? "" : u.getHost();
                if (!(host.equals("localhost") || host.equals("127.0.0.1"))) return null;
                path = u.getPath();
            } catch (Exception e) {
                return null;
            }
        }
        if (!path.startsWith("/uploads/")) return null;
        Path p = uploadDir.resolve(java.net.URLDecoder.decode(path.substring("/uploads/".length()), StandardCharsets.UTF_8)).normalize();
        return p.startsWith(uploadDir) ? p : null;
    }

    private String publicUrl(String relative) {
        return ServletUriComponentsBuilder.fromCurrentContextPath().path("/uploads/").path(relative).toUriString();
    }

    private static String str(Object o) {
        return o == null ? "" : o.toString().trim();
    }

    private static double num(Object o, double def) {
        if (o instanceof Number n) return n.doubleValue();
        try { return o == null ? def : Double.parseDouble(o.toString()); } catch (Exception e) { return def; }
    }

    private static ResponseEntity<Map<String, Object>> bad(String msg) {
        return ResponseEntity.badRequest().body(Map.of("success", false, "error", msg));
    }
}
