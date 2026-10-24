package com.autopost.saas.service;

import com.autopost.saas.util.PooledRestTemplateFactory;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.List;
import java.util.Map;
import java.util.ArrayList;
import java.util.HashMap;

/**
 * Dùng Google Gemini API để tự động dịch thuật, tạo phụ đề SRT và lồng tiếng AI.
 * Tích hợp cơ chế tự động chuyển đổi Model Fallback (gemini-3.5-flash, flash-latest, 3.5-flash-lite, 3.1-flash-lite...)
 * khi gặp lỗi 429 TOO_MANY_REQUESTS do hết Quota của 1 model cụ thể.
 */
@Service
@Slf4j
public class GeminiService {

    @Value("${gemini.api-key:}")
    private String apiKey;

    @Value("${gemini.model:gemini-3.5-flash}")
    private String model;

    private final RestTemplate restTemplate = PooledRestTemplateFactory.create(15000, 180000);
    // Gọi generateContent (chỉ văn bản, model trả lời bình thường 2-20s): model bị treo lúc quá tải thì bỏ sau 45s
    // để chuyển sang model dự phòng, thay vì chờ tới 3 phút.
    private final RestTemplate generateRestTemplate = PooledRestTemplateFactory.create(10000, 45000);
    private final ObjectMapper objectMapper = new ObjectMapper();

    // Theo dõi số lượt gọi API của từng key trong ngày (tự reset vào ngày mới)
    private final java.util.Map<String, java.util.concurrent.atomic.AtomicInteger> dailyUsage = new java.util.concurrent.ConcurrentHashMap<>();
    private volatile String currentTrackingDate = java.time.LocalDate.now().toString();

    private void recordKeyUsage(String key) {
        if (key == null || key.isBlank()) return;
        String today = java.time.LocalDate.now().toString();
        if (!today.equals(currentTrackingDate)) {
            dailyUsage.clear();
            currentTrackingDate = today;
        }
        dailyUsage.computeIfAbsent(key.trim(), k -> new java.util.concurrent.atomic.AtomicInteger(0)).incrementAndGet();
    }

    public int getKeyUsageToday(String key) {
        if (key == null || key.isBlank()) return 0;
        String today = java.time.LocalDate.now().toString();
        if (!today.equals(currentTrackingDate)) {
            return 0;
        }
        java.util.concurrent.atomic.AtomicInteger count = dailyUsage.get(key.trim());
        return count != null ? count.get() : 0;
    }

    public boolean isConfigured() {
        return !parseKeys(null).isEmpty();
    }

    private java.util.List<String> parseKeys(String apiKeyOverride) {
        String source = (apiKeyOverride != null && !apiKeyOverride.isBlank()) ? apiKeyOverride : this.apiKey;
        if (source == null || source.isBlank()) {
            return java.util.Collections.emptyList();
        }
        return java.util.Arrays.stream(source.split("[,\n\r;]+"))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .distinct()
                .collect(java.util.stream.Collectors.toList());
    }

    private String maskKey(String key) {
        if (key == null || key.length() <= 8) return "***";
        return key.substring(0, 4) + "..." + key.substring(key.length() - 4);
    }

    /**
     * Gọi Gemini API với cơ chế tự động xoay vòng danh sách API Key và tự động chuyển Model Fallback
     * khi gặp lỗi 429 TOO_MANY_REQUESTS / Quota Exceeded.
     */
    private String postWithModelFallback(Map<String, Object> body) {
        return postWithModelFallback(body, null);
    }

    // Model vừa báo quá tải (503) / hết quota (429) / không tồn tại (404) → tạm xếp xuống cuối danh sách một thời gian,
    // để các lần gọi sau đi thẳng vào model đang chạy được thay vì lần nào cũng chờ model lỗi trả về.
    private static final long MODEL_COOLDOWN_MS = 10 * 60 * 1000L;
    private static final long MODEL_GONE_COOLDOWN_MS = 6 * 60 * 60 * 1000L;
    private final java.util.Map<String, Long> modelCooldownUntil = new java.util.concurrent.ConcurrentHashMap<>();

    private String cooldownKey(String apiKey, String targetModel) {
        return Integer.toHexString(apiKey.hashCode()) + "|" + targetModel;
    }

    private boolean isCoolingDown(String apiKey, String targetModel) {
        Long until = modelCooldownUntil.get(cooldownKey(apiKey, targetModel));
        if (until == null) return false;
        if (until < System.currentTimeMillis()) {
            modelCooldownUntil.remove(cooldownKey(apiKey, targetModel));
            return false;
        }
        return true;
    }

    public String postWithModelFallback(Map<String, Object> body, String apiKeyOverride) {
        java.util.List<String> keyPool = parseKeys(apiKeyOverride);
        if (keyPool.isEmpty()) {
            throw new IllegalStateException("Chưa cấu hình GEMINI_API_KEY — nhập key ở nút 'Cài đặt AI' trong Studio Ảnh Tin.");
        }

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        HttpEntity<Map<String, Object>> request = new HttpEntity<>(body, headers);

        List<String> modelsToTry = new java.util.ArrayList<>();
        if (model != null && !model.isBlank()) {
            modelsToTry.add(model.trim());
        }
        // Cập nhật 2026-10-06: gemini-1.5-*, 2.0-* và 2.5-flash-lite đã bị Google khai tử (404); 2.5-flash hay hết quota.
        for (String m : List.of("gemini-3.5-flash", "gemini-flash-latest", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite",
                "gemini-flash-lite-latest", "gemini-2.5-flash")) {
            if (!modelsToTry.contains(m)) {
                modelsToTry.add(m);
            }
        }

        Exception lastException = null;
        List<String> failures = new java.util.ArrayList<>();

        // Thử lần lượt từng API Key trong danh sách (Key Pool)
        for (int i = 0; i < keyPool.size(); i++) {
            String currentKey = keyPool.get(i);
            String masked = maskKey(currentKey);
            log.info("[Gemini] Sử dụng API Key #{}/{} ({})", i + 1, keyPool.size(), masked);

            boolean keyExhausted = false;
            // Model đang tạm nghỉ vẫn được thử, nhưng sau cùng (phòng khi mọi model khác cũng lỗi)
            List<String> ordered = new java.util.ArrayList<>();
            List<String> cooling = new java.util.ArrayList<>();
            for (String m : modelsToTry) {
                (isCoolingDown(currentKey, m) ? cooling : ordered).add(m);
            }
            if (!cooling.isEmpty()) {
                log.info("[Gemini] Tạm bỏ qua model vừa lỗi: {}", cooling);
            }
            ordered.addAll(cooling);
            for (String targetModel : ordered) {
                String url = "https://generativelanguage.googleapis.com/v1beta/models/" + targetModel + ":generateContent?key=" + currentKey;
                try {
                    log.info("[Gemini] Gửi request tới model: {} (Key #{})", targetModel, i + 1);
                    String responseJson = generateRestTemplate.postForObject(url, request, String.class);
                    JsonNode root = objectMapper.readTree(responseJson);
                    JsonNode textNode = root.path("candidates").path(0).path("content").path("parts").path(0).path("text");
                    if (!textNode.isMissingNode() && !textNode.asText().trim().isEmpty()) {
                        log.info("✅ [Gemini] Thành công với Key #{} ({}) trên model {}", i + 1, masked, targetModel);
                        recordKeyUsage(currentKey);
                        return textNode.asText().trim();
                    }
                } catch (org.springframework.web.client.HttpStatusCodeException e) {
                    lastException = e;
                    int status = e.getStatusCode().value();
                    failures.add("Key #" + (i + 1) + " [" + masked + "] model " + targetModel + " (HTTP " + status + ")");
                    log.warn("⚠️ [Gemini] Key #{} ({}) model {} gặp HTTP {}: {}", i + 1, masked, targetModel, status, e.getResponseBodyAsString());
                    if (status == 429 || status == 503 || status == 404) {
                        modelCooldownUntil.put(cooldownKey(currentKey, targetModel),
                                System.currentTimeMillis() + (status == 404 ? MODEL_GONE_COOLDOWN_MS : MODEL_COOLDOWN_MS));
                    }
                    if (status == 403) {
                        // Key không hợp lệ hoặc bị khoá -> nhảy sang key tiếp theo
                        keyExhausted = true;
                        break;
                    }
                    // Nếu gặp 429 (hết quota model này), 404 (model không tồn tại) hoặc 400 -> tiếp tục thử model tiếp theo trong danh sách fallback
                } catch (Exception e) {
                    lastException = e;
                    if (e instanceof org.springframework.web.client.ResourceAccessException) {
                        // Hết thời gian chờ / mất kết nối: model đang treo → tạm bỏ qua như lỗi quá tải
                        modelCooldownUntil.put(cooldownKey(currentKey, targetModel), System.currentTimeMillis() + MODEL_COOLDOWN_MS);
                    }
                    failures.add("Key #" + (i + 1) + " [" + masked + "] (" + targetModel + ": " + e.getClass().getSimpleName() + ")");
                    log.warn("⚠️ [Gemini] Key #{} ({}) model {} gặp lỗi: {}", i + 1, masked, targetModel, e.getMessage());
                }
            }

            if (keyExhausted && i < keyPool.size() - 1) {
                log.warn("🔄 [Gemini] Key #{} ({}) không hợp lệ (HTTP 403) -> Chuyển sang Key tiếp theo #{}/{}", i + 1, masked, i + 2, keyPool.size());
            }
        }

        throw new IllegalStateException("Tất cả " + keyPool.size() + " Gemini API key đều đã hết Quota (429) hoặc bị lỗi. Vui lòng thêm key mới tại nút 'Cài đặt AI'. Chi tiết: " + String.join("; ", failures), lastException);
    }

    // Model đọc giọng (TTS) — thử lần lượt, model nào 404/429 thì tạm nghỉ như model văn bản
    private static final List<String> TTS_MODELS = List.of(
            "gemini-2.5-flash-preview-tts", "gemini-2.5-pro-preview-tts");
    private static final java.util.Set<String> WARM_TTS_VOICES = java.util.Set.of(
            "Sulafat", "Achernar", "Vindemiatrix", "Leda", "Aoede", "Despina");

    /**
     * Đọc văn bản thành giọng nói bằng Gemini TTS (Studio Video Tin).
     * Trả về PCM thô 16-bit, mono, 24kHz (định dạng Gemini trả) — bên gọi tự đổi sang m4a bằng FFmpeg.
     */
    public byte[] generateSpeech(String text, String voiceName, String apiKeyOverride) {
        java.util.List<String> keyPool = parseKeys(apiKeyOverride);
        if (keyPool.isEmpty()) {
            throw new IllegalStateException("Chưa cấu hình GEMINI_API_KEY — nhập key ở nút 'Cài đặt AI'.");
        }
        String voice = (voiceName == null || voiceName.isBlank()) ? "Kore" : voiceName.trim();
        // Giọng nữ ấm (Sulafat "warm", Achernar "soft", Vindemiatrix "gentle"...) → đọc kiểu kể chuyện thân thiện thay vì bản tin
        String style = WARM_TTS_VOICES.contains(voice)
                ? "Đọc bằng tiếng Việt, giọng nữ trẻ trong trẻo, ấm áp, thân thiện như đang kể chuyện cho bạn bè, nhịp vừa phải: "
                : "Đọc bằng tiếng Việt, giọng phát thanh viên tin tức, rõ ràng, nhịp nhanh vừa phải: ";
        Map<String, Object> body = Map.of(
                "contents", List.of(Map.of("parts", List.of(Map.of("text", style + text)))),
                "generationConfig", Map.of(
                        "responseModalities", List.of("AUDIO"),
                        "speechConfig", Map.of("voiceConfig", Map.of("prebuiltVoiceConfig", Map.of("voiceName", voice)))));
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        HttpEntity<Map<String, Object>> request = new HttpEntity<>(body, headers);

        List<String> failures = new ArrayList<>();
        for (int i = 0; i < keyPool.size(); i++) {
            String currentKey = keyPool.get(i);
            String masked = maskKey(currentKey);
            List<String> ordered = new ArrayList<>();
            List<String> cooling = new ArrayList<>();
            for (String m : TTS_MODELS) (isCoolingDown(currentKey, m) ? cooling : ordered).add(m);
            ordered.addAll(cooling);
            for (String targetModel : ordered) {
                String url = "https://generativelanguage.googleapis.com/v1beta/models/" + targetModel + ":generateContent?key=" + currentKey;
                try {
                    String responseJson = restTemplate.postForObject(url, request, String.class);
                    JsonNode parts = objectMapper.readTree(responseJson).path("candidates").path(0).path("content").path("parts");
                    for (JsonNode part : parts) {
                        String data = part.path("inlineData").path("data").asText("");
                        if (!data.isEmpty()) {
                            log.info("✅ [Gemini TTS] Thành công với Key #{} ({}) model {}, giọng {}", i + 1, masked, targetModel, voice);
                            recordKeyUsage(currentKey);
                            return java.util.Base64.getDecoder().decode(data);
                        }
                    }
                    failures.add("Key #" + (i + 1) + " model " + targetModel + " (không có audio)");
                } catch (org.springframework.web.client.HttpStatusCodeException e) {
                    int status = e.getStatusCode().value();
                    failures.add("Key #" + (i + 1) + " [" + masked + "] model " + targetModel + " (HTTP " + status + ")");
                    log.warn("⚠️ [Gemini TTS] Key #{} model {} gặp HTTP {}: {}", i + 1, targetModel, status, e.getResponseBodyAsString());
                    if (status == 429 || status == 503 || status == 404) {
                        modelCooldownUntil.put(cooldownKey(currentKey, targetModel),
                                System.currentTimeMillis() + (status == 404 ? MODEL_GONE_COOLDOWN_MS : MODEL_COOLDOWN_MS));
                    }
                    if (status == 403) break;
                } catch (Exception e) {
                    failures.add("Key #" + (i + 1) + " [" + masked + "] (" + targetModel + ": " + e.getClass().getSimpleName() + ")");
                    log.warn("⚠️ [Gemini TTS] Key #{} model {} lỗi: {}", i + 1, targetModel, e.getMessage());
                }
            }
        }
        throw new IllegalStateException("Gemini TTS lỗi với mọi key: " + String.join("; ", failures));
    }

    /**
     * Viết tiêu đề cho ảnh "thẻ tin tức" kiểu page tin giật tít: IN HOA, 15-35 từ, 2-4 cụm quan trọng
     * bọc trong [[...]] để tô đỏ khi dựng ảnh (xem worker/news-card.js).
     */
    /**
     * Studio Video Tin: xem vài khung hình của clip + caption gốc → viết chữ cho thẻ/bảng trên khung video,
     * câu cho giọng đọc mở đầu và caption khi đăng bài.
     * Trả JSON {"headline": "...[[cụm nhấn]]...", "voice": "câu đọc", "caption": "caption đăng bài"}.
     */
    public String generateClipPanel(String caption, String sourceName, List<byte[]> frames, String apiKeyOverride) {
        if (parseKeys(apiKeyOverride).isEmpty()) {
            throw new IllegalStateException("Chưa cấu hình GEMINI_API_KEY — nhập key ở nút 'Cài đặt AI'.");
        }
        String prompt = "Bạn là admin một Fanpage video giải trí/đời sống triệu follow tại Việt Nam (kiểu nexa24h, Theanh28). "
                + (frames != null && !frames.isEmpty()
                    ? "Dưới đây là " + frames.size() + " khung hình cắt đều từ đầu đến cuối 1 clip, kèm caption gốc (có thể rất ngắn hoặc trống). Hãy XEM KỸ các khung hình để hiểu chuyện gì xảy ra trong clip.\n"
                    : "Dưới đây là caption gốc của 1 clip.\n")
                + "Viết 3 thứ:\n"
                + "1) \"headline\": chữ in lên thẻ trên video. Tiếng Việt, 12 đến 25 từ, giọng hài hước/bình luận duyên dáng kiểu page giải trí, "
                + "có thể mở đầu bằng 1 cụm cảm thán ngắn kết thúc bằng dấu hai chấm (vd \"THẾ MÀ LẠI HAY:\", \"CĂNG THẬT SỰ:\"). "
                + "Bọc 2 đến 4 cụm đắt giá trong [[ và ]] để tô màu. Không hashtag, không emoji.\n"
                + "2) \"voice\": 1 câu nói tự nhiên, thân thiện như kể cho bạn bè, 8 đến 20 từ, viết thường, không [[ ]], không emoji, đọc khoảng 3 đến 5 giây.\n"
                + "3) \"caption\": caption đăng kèm video: dòng đầu là câu hook gây tò mò, rồi 1 đến 2 câu kể ngắn nội dung clip, "
                + "1 câu hỏi kéo bình luận, dòng cuối 3 đến 5 hashtag tiếng Việt không dấu liên quan. Có thể dùng 1 đến 3 emoji hợp ngữ cảnh.\n"
                + "Quy tắc chung: chỉ kể những gì thấy trong khung hình/caption, không bịa tên người, địa danh, con số. "
                + "Từ nhạy cảm dễ bị Facebook hạn chế (bia, rượu, ma túy, súng, giết, chết, tự tử, cờ bạc, sex...) thì viết né bằng dấu chấm, ví dụ C.H.Ế.T.\n"
                + "CHỈ trả về JSON đúng dạng {\"headline\": \"...\", \"voice\": \"...\", \"caption\": \"...\"}, không giải thích.\n\n"
                + "Nguồn/nhóm: " + (sourceName == null ? "" : sourceName) + "\n"
                + "Caption gốc: " + (caption == null || caption.isBlank() ? "(trống)" : caption.length() > 1500 ? caption.substring(0, 1500) : caption);
        List<Map<String, Object>> parts = new ArrayList<>();
        parts.add(Map.of("text", prompt));
        if (frames != null) {
            for (byte[] f : frames) {
                parts.add(Map.of("inlineData", Map.of("mimeType", "image/jpeg", "data", java.util.Base64.getEncoder().encodeToString(f))));
            }
        }
        Map<String, Object> body = Map.of(
                "contents", List.of(Map.of("parts", parts)),
                "generationConfig", Map.of("responseMimeType", "application/json"));
        String result = postWithModelFallback(body, apiKeyOverride).trim();
        return result.replaceAll("^```(json)?\\s*|\\s*```$", "");
    }

    public String generateNewsCardHeadline(String title, String sapo, String content, String apiKeyOverride) {
        if (parseKeys(apiKeyOverride).isEmpty()) {
            throw new IllegalStateException("Chưa cấu hình GEMINI_API_KEY — nhập key ở nút 'Cài đặt AI' trong Studio Ảnh Tin.");
        }
        String source = "Tiêu đề: " + (title == null ? "" : title)
                + "\nTóm tắt: " + (sapo == null ? "" : sapo)
                + "\nNội dung: " + (content == null ? "" : content.length() > 3000 ? content.substring(0, 3000) : content);
        String prompt = "Bạn là biên tập viên của một Fanpage tin tức giật tít triệu follow tại Việt Nam. "
                + "Viết 1 TIÊU ĐỀ để in lên ảnh bài đăng, dựa trên bài báo dưới đây.\n"
                + "Yêu cầu:\n"
                + "- Tiếng Việt, 15 đến 35 từ, một câu kể liền mạch (không dùng dấu hai chấm mở đầu, không hashtag, không emoji).\n"
                + "- Gây tò mò mạnh: nêu nhân vật + con số/chi tiết gây sốc + bước ngoặt hoặc hệ quả. Đúng sự thật trong bài, không bịa.\n"
                + "- Chọn 2 đến 4 cụm quan trọng nhất (con số, số tiền, nhân vật, chi tiết bất ngờ) và bọc mỗi cụm trong [[ và ]]. "
                + "Ví dụ: Từng kiếm [[45.000 NDT/tháng]] trong ngành bất động sản, [[nữ giám đốc 45 tuổi]] giờ dậy từ [[5h sáng]] đi bán hoa quả để [[trả khoản vay mua nhà]]\n"
                + "- Từ nhạy cảm dễ bị Facebook hạn chế (bia, rượu, ma túy, súng, giết, chết, tự tử, cờ bạc, sex...) thì viết né bằng dấu chấm, ví dụ B.I.A, R.Ư.Ợ.U, C.H.Ế.T.\n"
                + "- CHỈ trả về đúng 1 dòng tiêu đề, không giải thích, không bọc trong ngoặc kép.\n\n"
                + source;
        Map<String, Object> body = Map.of(
                "contents", List.of(Map.of("parts", List.of(Map.of("text", prompt))))
        );
        String result = postWithModelFallback(body, apiKeyOverride).trim();
        // Bỏ ngoặc kép/xuống dòng thừa nếu model vẫn thêm vào
        result = result.replaceAll("^[\"“”']+|[\"“”']+$", "").replaceAll("\\s*\\n+\\s*", " ").trim();
        result = result.replaceAll("([^\\s(\\[{])(\\[\\[)", "$1 $2")
                       .replaceAll("(\\]\\])([^\\s)\\]}.,;:!?])", "$1 $2");
        return result;
    }

    public static String cleanSourceName(String source) {
        if (source == null || source.isBlank()) return "Báo điện tử";
        String s = source.trim();
        String lower = s.toLowerCase();
        if (lower.contains("reddit")) return "Reddit";
        if (lower.contains("threads")) return "Threads";
        if (lower.contains("tiktok")) return "TikTok";
        if (lower.contains("facebook") || lower.equals("fb.com")) return "Facebook";
        if (lower.contains("youtube") || lower.equals("youtu.be")) return "YouTube";
        if (lower.endsWith(".com")) return s.substring(0, s.length() - 4);
        return s;
    }

    /**
     * "Soạn bài" cho Studio Ảnh Tin trong 1 lần gọi: tiêu đề in lên ảnh (cụm [[...]] tô màu), caption hook
     * ngắn, bản tóm tắt chia đoạn (đặt ở caption hoặc bình luận đầu) và nhãn góc ảnh (con số/chi tiết đắt nhất).
     * Trả về JSON string: {"headline","hook","summary","badge"}.
     */
    public String generateNewsPostPackage(String title, String sapo, String content, String sourceName, String apiKeyOverride) {
        if (parseKeys(apiKeyOverride).isEmpty()) {
            throw new IllegalStateException("Chưa có Gemini API key — nhập key ở nút Cài đặt AI trong Studio Ảnh Tin.");
        }
        String cleanSource = cleanSourceName(sourceName);
        String body = "Tiêu đề: " + (title == null ? "" : title)
                + "\nTóm tắt: " + (sapo == null ? "" : sapo)
                + "\nNội dung: " + (content == null ? "" : content.length() > 6000 ? content.substring(0, 6000) : content);
        String prompt = "Bạn là chuyên gia sáng tạo nội dung khoa học, đời sống, lịch sử và tri thức mạng xã hội hàng đầu tại Việt Nam, bậc thầy nghệ thuật Storytelling triệu view. "
                + "Dựa trên bài viết/tiêu đề dưới đây (thường từ Reddit, mạng xã hội hoặc báo chí quốc tế), hãy biên tập lại thành nội dung CỰC KỲ CUỐN HÚT, GIÀU KIẾN THỨC, HỌC HỎI ĐƯỢC NHIỀU THÔNG TIN MỚI MẺ và trả về JSON với đúng 4 trường:\n"
                + "1. \"headline\": Tiêu đề in lên ảnh (15-35 từ), một câu kể liền mạch gây tò mò cực mạnh (nhân vật/sự kiện + phát hiện/kết quả bất ngờ nhất). "
                + "Bọc 2-4 cụm từ khóa đắt giá nhất trong [[ và ]]. Tuyệt đối không emoji, không hashtag, không dấu chấm cuối câu.\n"
                + "2. \"hook\": Caption mở đầu ngắn 2-3 câu (tối đa 280 ký tự), giật hook khơi gợi sự tò mò cao độ, nêu bật kết quả gây bất ngờ hoặc bài học đắt giá, kích thích người đọc phải xem chi tiết. Có thể dùng 1-2 emoji phù hợp.\n"
                + "3. \"summary\": BẢN CAPTION CHI TIẾT, GIÀU KIẾN THỨC & CỰC KỲ CUỐN HÚT (Đọc là học hỏi thêm được nhiều thông tin giá trị):\n"
                + "   - Dòng đầu tiên: Tiêu đề in hoa nổi bật, tóm lược trọn vẹn thông điệp hoặc phát hiện chính.\n"
                + "   - Thân bài gồm 3 đến 5 đoạn văn mạch lạc, thoáng đãng (mỗi đoạn 2-3 câu, cách nhau 1 dòng trống). Hãy khai thác sâu tri thức thực tế về chủ đề/sự kiện này để cung cấp thông tin hữu ích:\n"
                + "     + Bối cảnh & Sự việc: Ai thực hiện? Chuyện gì đã xảy ra? Hoàn cảnh đặc biệt ra sao?\n"
                + "     + Diễn biến & KẾT QUẢ THỰC TẾ CỤ THỂ: Trình bày chi tiết các số liệu, dẫn chứng, kết quả thực nghiệm hoặc tình huống bước ngoặt (ví dụ: con số đo lường cụ thể, sự khác biệt rõ rệt giữa các trường hợp, lý do khoa học/nguyên nhân đằng sau). TUYỆT ĐỐI KHÔNG NÓI CHUNG CHUNG SÁO RỖNG.\n"
                + "     + Ý nghĩa & Bài học đọng lại: Người đọc học hỏi thêm được kiến thức gì mới, ứng dụng vào thực tế cuộc sống ra sao hoặc bài học nhân văn sâu sắc nào.\n"
                + "   - Văn phong tự nhiên, truyền cảm, cuốn hút, giàu hình ảnh và thông tin, không cứng nhắc như dịch máy.\n"
                + "   - TUYỆT ĐỐI KHÔNG dùng dấu sao markdown (*, **). Dùng chữ IN HOA nếu muốn nhấn mạnh.\n"
                + "   - Dòng cuối cùng của summary ghi đúng: Nguồn: " + cleanSource + "\n"
                + "4. \"badge\": Nhãn dán góc ảnh tối đa 3 từ, IN HOA, là con số hoặc chi tiết đắt giá nhất (ví dụ \"SỐC\", \"BẤT NGỜ\", \"KIẾN THỨC\", \"HỮU ÍCH\").\n"
                + "Nếu tiêu đề gốc bằng tiếng Anh hoặc ngắn gọn, hãy dựa vào kiến thức thực tế về sự kiện/nghiên cứu đó để viết thật đầy đủ và chính xác. Từ nhạy cảm dễ bị Facebook hạn chế viết né bằng dấu chấm như B.I.A, C.H.Ế.T.\n\n"
                + body;
        Map<String, Object> req = Map.of(
                "contents", List.of(Map.of("parts", List.of(Map.of("text", prompt)))),
                "generationConfig", Map.of("responseMimeType", "application/json")
        );
        String raw = postWithModelFallback(req, apiKeyOverride).trim();
        // Phòng khi model vẫn bọc ```json ... ```
        raw = raw.replaceAll("^```(?:json)?\\s*", "").replaceAll("\\s*```$", "");
        try {
            JsonNode node = objectMapper.readTree(raw);
            if (node.isArray() && node.size() > 0) node = node.get(0);
            if (!node.has("headline")) throw new IllegalStateException("thiếu trường headline");
            String hl = node.path("headline").asText("");
            hl = hl.replaceAll("([^\\s(\\[{])(\\[\\[)", "$1 $2")
                   .replaceAll("(\\]\\])([^\\s)\\]}.,;:!?])", "$1 $2");
            ((com.fasterxml.jackson.databind.node.ObjectNode) node).put("headline", hl);
            return objectMapper.writeValueAsString(node);
        } catch (Exception e) {
            throw new IllegalStateException("AI trả về sai định dạng, thử lại: " + e.getMessage());
        }
    }

    /** Viết lại caption bằng Gemini, giữ nguyên ý nghĩa nhưng đổi cách diễn đạt hoàn toàn. */
    public String rewriteCaption(String originalCaption) {
        if (!isConfigured()) {
            throw new IllegalStateException("Chưa cấu hình GEMINI_API_KEY — không thể xào lại caption bằng AI.");
        }

        String prompt = "Bạn là chuyên gia sáng tạo nội dung mạng xã hội triệu follow. Hãy viết lại đoạn caption tiếng Việt dưới đây thành một bản MỚI TOANH CỰC KỲ CUỐN HÚT, RÕ Ý & CHẠM CẢM XÚC: "
                + "Diễn đạt bằng ngôn từ tự nhiên, mạch lạc, giàu hình ảnh, giữ nguyên sự thật và các chi tiết cốt lõi nhưng cách kể hấp dẫn hơn gấp bội. "
                + "Có thể thêm 1-2 emoji phù hợp để bài sinh động. Không dùng dấu sao markdown (*, **). Không thêm hashtag, không thêm lời dẫn giải thích, không bọc trong ngoặc kép. "
                + "CHỈ trả về đúng đoạn caption đã hoàn thiện.\n\n"
                + "Caption gốc:\n" + originalCaption;

        Map<String, Object> body = Map.of(
                "contents", List.of(Map.of("parts", List.of(Map.of("text", prompt))))
        );

        return stripMarkdownAsterisks(postWithModelFallback(body));
    }

    /**
     * Viết lại nội dung cho Threads theo từng chế độ của Threads Studio.
     * mode: REWRITE (diễn đạt lại), SHORTEN (gọn dưới 500 ký tự), HOOK (thêm câu mở đầu gây tò mò),
     * HASHTAG (thêm 1 chủ đề/hashtag phù hợp), THREAD (chia thành chuỗi nhiều phần ngăn bởi dòng ---).
     */
    public String rewriteForThreads(String text, String mode) {
        if (!isConfigured()) {
            throw new IllegalStateException("Chưa cấu hình GEMINI_API_KEY — không thể dùng AI viết lại.");
        }
        String instruction = switch (mode == null ? "REWRITE" : mode.toUpperCase()) {
            case "SHORTEN" -> "Rút gọn đoạn bài đăng dưới đây còn TỐI ĐA 450 ký tự, giữ ý chính và giọng văn tự nhiên, gần gũi.";
            case "HOOK" -> "Thêm 1 câu mở đầu thật cuốn hút, gây tò mò (hook) lên đầu đoạn bài đăng dưới đây, giữ nguyên phần nội dung còn lại. Tổng độ dài không quá 500 ký tự.";
            case "HASHTAG" -> "Giữ nguyên đoạn bài đăng dưới đây và thêm ở cuối 1 đến 2 hashtag tiếng Việt ngắn gọn, phù hợp nhất với nội dung (Threads chỉ gắn 1 chủ đề chính nên đừng thêm nhiều).";
            case "THREAD" -> "Biến đoạn nội dung dưới đây thành 1 CHUỖI THREAD gồm 2-5 phần hấp dẫn, mỗi phần TỐI ĐA 450 ký tự, phần đầu phải là câu hook gây tò mò. Ngăn cách các phần bằng 1 dòng chỉ chứa ba dấu gạch ngang: ---";
            default -> "Viết lại đoạn bài đăng Threads dưới đây theo cách diễn đạt HOÀN TOÀN KHÁC (đổi từ ngữ, cấu trúc câu, emoji tự nhiên) nhưng GIỮ NGUYÊN ý nghĩa và sắc thái. Tối đa 500 ký tự.";
        };
        String prompt = instruction
                + " Viết bằng tiếng Việt tự nhiên kiểu mạng xã hội. Không thêm ghi chú giải thích, không bọc kết quả trong dấu ngoặc kép. "
                + "CHỈ trả về đúng nội dung bài đăng.\n\nNội dung gốc:\n" + text;
        Map<String, Object> body = Map.of(
                "contents", List.of(Map.of("parts", List.of(Map.of("text", prompt))))
        );
        return postWithModelFallback(body);
    }

    /**
     * Viết lại bài viết Viral (từ Facebook Group hoặc Threads) theo phong cách & nền tảng mục tiêu
     */
    public String rewriteViralPost(String content, String platform, String mode, String apiKeyOverride) {
        if (parseKeys(apiKeyOverride).isEmpty()) {
            throw new IllegalStateException("Chưa cấu hình GEMINI_API_KEY — vui lòng nhập key tại Cài đặt AI.");
        }

        String platformInstruction = "FACEBOOK".equalsIgnoreCase(platform)
                ? "Nội dung này dùng để đăng lên Facebook Group hoặc Fanpage: tạo cảm giác gần gũi, khơi gợi bình luận, dùng 2-4 emoji tự nhiên, ngắt dòng dễ đọc."
                : "Nội dung này dùng để đăng lên mạng xã hội Threads: giọng điệu tự sự, súc tích, ngắt đoạn ngắn thoáng mắt, có chiều sâu, giữ dưới 500 ký tự.";

        String modeInstruction = switch (mode == null ? "REWRITE" : mode.toUpperCase()) {
            case "HOOK" -> "Tạo 1-2 câu mở đầu (Hook) cực kỳ cuốn hút, gây tò mò, giật gân hoặc đặt một câu hỏi đánh trúng tâm lý người đọc, sau đó giữ nguyên phần nội dung còn lại.";
            case "STORYTELLING" -> "Biến đổi nội dung thành một câu chuyện kể lôi cuốn, có mở đầu - diễn biến - bài học hoặc kết luận thú vị.";
            case "SHORTEN" -> "Rút gọn nội dung thật súc tích, giữ lại các ý đắt giá và cảm xúc mạnh nhất, loại bỏ chi tiết rườm rà.";
            case "TRANSLATE" -> "Bài gốc là tiếng nước ngoài (thường lấy từ Reddit): dịch sang tiếng Việt tự nhiên như người Việt tự viết, giữ đúng ý và cảm xúc, chuyển đơn vị/tiền tệ/thành ngữ sang cách nói quen thuộc với người Việt. Không thêm sự việc, nhân vật hay chi tiết nào bài gốc không có. Không nhắc tới Reddit, subreddit, upvote, OP hay tên tài khoản người đăng gốc.";
            case "ENGAGEMENT" ->"Giữ nguyên ý chính nhưng ở cuối bài đặt một câu hỏi mở thật kích thích người đọc tranh luận, bình luận và chia sẻ quan điểm.";
            default -> "Viết lại hoàn toàn bài viết bằng từ ngữ và cấu trúc câu mới (paraphrase), giữ nguyên ý nghĩa cốt lõi, loại bỏ nguy cơ trùng lặp bản quyền.";
        };

        String prompt = "Bạn là chuyên gia sáng tạo nội dung mạng xã hội hàng đầu tại Việt Nam.\n"
                + "Nhiệm vụ: Viết lại bài đăng viral dưới đây theo yêu cầu:\n"
                + "- " + platformInstruction + "\n"
                + "- " + modeInstruction + "\n"
                + "- Viết bằng tiếng Việt tự nhiên, hấp dẫn, không sáo rỗng, không máy móc.\n"
                + "- TUYỆT ĐỐI KHÔNG dùng định dạng markdown như dấu sao (*, **, ***, ****) để in đậm hay tạo đề mục. Facebook không hỗ trợ markdown, người đọc sẽ nhìn thấy toàn dấu hoa thị xấu xí. Hãy dùng chữ IN HOA nếu muốn nhấn mạnh tiêu đề/từ ngữ.\n"
                + "- KHÔNG thêm lời giải thích của AI, KHÔNG bọc bài trong dấu ngoặc kép.\n"
                + "- CHỈ trả về duy nhất nội dung bài viết hoàn chỉnh.\n\n"
                + "Nội dung bài viết gốc:\n" + content;

        Map<String, Object> body = Map.of(
                "contents", List.of(Map.of("parts", List.of(Map.of("text", prompt))))
        );

        String result = postWithModelFallback(body, apiKeyOverride).trim();
        result = result.replaceAll("^[\"“”']+|[\"“”']+$", "").trim();
        return stripMarkdownAsterisks(result);
    }

    /** Dịch caption tiếng Trung (từ Douyin) sang tiếng Việt tự nhiên, dí dỏm, phong cách mạng xã hội Việt Nam. */
    public String translateAndAdaptChineseCaption(String chineseCaption) {
        if (chineseCaption == null || chineseCaption.trim().isEmpty()) {
            return "";
        }

        if (isConfigured()) {
            try {
                String prompt = "Bạn là chuyên gia sáng tạo nội dung mạng xã hội (Facebook Group/Fanpage). "
                        + "Hãy dịch và chuyển thể đoạn caption tiếng Trung (từ Douyin) dưới đây sang tiếng Việt. "
                        + "YÊU CẦU QUAN TRỌNG: "
                        + "1. Dịch chuẩn nghĩa nhưng diễn đạt cực kỳ tự nhiên, dí dỏm, đáng yêu, gần gũi với giới trẻ Việt Nam (GenZ/Facebook). "
                        + "2. Giữ nguyên hoặc bổ sung emoji phù hợp, biến đổi các hashtag tiếng Trung thành hashtag tiếng Việt tương ứng. "
                        + "3. Không thêm giải thích, không bọc dấu ngoặc kép, CHỈ trả về đúng đoạn caption tiếng Việt hoàn chỉnh.\n\n"
                        + "Caption tiếng Trung:\n" + chineseCaption;

                Map<String, Object> body = Map.of(
                        "contents", List.of(Map.of("parts", List.of(Map.of("text", prompt))))
                );

                return postWithModelFallback(body);
            } catch (Exception e) {
                log.warn("[Gemini] Lỗi gọi Gemini AI: {}, chuyển qua fallback Google Translate", e.getMessage());
            }
        }

        // Fallback miễn phí: Google Translate gtx (cực nhanh, không cần API key)
        try {
            String gtxUrl = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=vi&dt=t&q="
                    + java.net.URLEncoder.encode(chineseCaption, java.nio.charset.StandardCharsets.UTF_8);
            String gtxResp = restTemplate.getForObject(java.net.URI.create(gtxUrl), String.class);
            JsonNode root = objectMapper.readTree(gtxResp);
            JsonNode sentences = root.path(0);
            if (sentences.isArray()) {
                StringBuilder sb = new StringBuilder();
                for (JsonNode sentence : sentences) {
                    JsonNode seg = sentence.path(0);
                    if (!seg.isMissingNode()) {
                        sb.append(seg.asText());
                    }
                }
                String translated = sb.toString().trim();
                if (!translated.isEmpty()) {
                    return translated;
                }
            }
        } catch (Exception ex) {
            log.warn("[Gemini] Fallback Google Translate lỗi: {}", ex.getMessage());
        }

        return chineseCaption;
    }

    /**
     * Viết lại bài báo/tin tức (BĐS, Pickleball, Tài chính, Thời sự) thành bài đăng Facebook/Group/Fanpage/TikTok chuyên nghiệp & thu hút.
     * Phong cách style: 
     * - Group Pickleball: 'PICKLEBALL_GROUP_DEBATE', 'PICKLEBALL_TIPS_TECH', 'PICKLEBALL_GEAR_REVIEW', 'PICKLEBALL_TOURNAMENT', 'PICKLEBALL_FIND_MATCH'
     * - BĐS & Tài Chính: 'FANPAGE_POST', 'GROUP_SALE', 'EXPERT_ANALYSIS', 'NEWS_SUMMARY', 'TIKTOK_SCRIPT', 'ZALO_TELEGRAM'
     */
    public String rewriteRealEstateArticle(String title, String sapo, String content, String style, String apiKeyOverride) {
        String effectiveKey = (apiKeyOverride != null && !apiKeyOverride.trim().isEmpty()) ? apiKeyOverride.trim() : this.apiKey;
        if (effectiveKey == null || effectiveKey.trim().isEmpty()) {
            throw new IllegalStateException("Chưa cấu hình GEMINI_API_KEY. Vui lòng nhập Gemini API Key trong ô Cấu Hình trên giao diện Web hoặc file .env!");
        }

        String styleInstructions;
        String styleKey = style != null ? style.toUpperCase() : "FANPAGE_POST";
        String roleExpertise = "Chuyên gia Biên tập Nội dung Mạng Xã hội & Quản trị Cộng đồng Facebook hàng đầu tại Việt Nam";

        if ("PICKLEBALL_GROUP_DEBATE".equals(styleKey)) {
            roleExpertise = "Admin Group Pickleball triệu thành viên và Chuyên gia Kéo Tương Tác Thảo Luận Mạng Xã Hội";
            styleInstructions = "Viết theo phong cách BÀI THẢO LUẬN / TRANH LUẬN CỰC CUỐN CHO GROUP PICKLEBALL: "
                    + "Đưa ra quan điểm cá nhân dí dỏm, bộc trực về tình huống trong bài (về luật chơi Kitchen/Foot fault, văn hóa ứng xử sân bãi, outfit trang phục thể thao, trình độ DUPR, văn hóa nhường sân). "
                    + "Bố cục thoáng, xưng hô 'anh em / các bác / hội mê pickleball' gần gũi. "
                    + "KẾT BÀI BẮT BUỘC có 1 câu hỏi mở sắc sảo để kích thích 50 - 200+ bình luận tranh luận từ các thành viên trong nhóm.";
        } else if ("PICKLEBALL_TIPS_TECH".equals(styleKey)) {
            roleExpertise = "Huấn Luyện Viên & Trưởng Ban Chuyên Môn Cộng Đồng Pickleball Việt Nam";
            styleInstructions = "Viết theo phong cách CHIA SẺ KỸ THUẬT & MẸO CHƠI PICKLEBALL: "
                    + "Đúc kết kinh nghiệm thực chiến (cách thực hiện cú Dink bóng chuẩn xác, Third Shot Drop êm ái, cách giao bóng xoáy khó chịu, tư thế chuẩn bị chân, kỹ thuật di chuyển bọc lót khi đánh đôi). "
                    + "Trình bày theo các gạch đầu dòng (bullet points) cực kỳ rõ ràng, dễ áp dụng ngay trên sân.";
        } else if ("PICKLEBALL_GEAR_REVIEW".equals(styleKey)) {
            roleExpertise = "Chuyên gia Thẩm Định Vợt & Dụng Cụ Thể Thao Pickleball";
            styleInstructions = "Viết theo phong cách REVIEW VỢT & TRANG THIẾT BỊ PICKLEBALL: "
                    + "Đánh giá chi tiết về cảm giác bóng, độ nảy, mặt carbon T700 thô nhám (spin), điểm ngọt (sweet spot), trọng lượng, độ bền. "
                    + "So sánh các dòng vợt hot (Joola, Selkirk, CRBN, Beesoul, Passion...) và tư vấn anh em chọn vợt theo lối chơi công/thủ hoặc tầm giá.";
        } else if ("PICKLEBALL_TOURNAMENT".equals(styleKey)) {
            roleExpertise = "Bình Luận Viên & Phóng Viên Thể Thao Pickleball Nóng 24h";
            styleInstructions = "Viết theo phong cách ĐIỂM TIN GIẢI ĐẤU & THẦN TƯỢNG PICKLEBALL: "
                    + "Cập nhật kết quả các giải PPA, World Cup, Giải VĐQG, chiến tích các tay vợt hàng đầu (Quang Dương, Trịnh Linh Giang, Sophia Phương Anh, Ben Johns...). "
                    + "Giọng văn hào hứng, kịch tính, khơi dậy niềm đam mê thể thao.";
        } else if ("PICKLEBALL_FIND_MATCH".equals(styleKey)) {
            roleExpertise = "Quản trị viên Kết Nối Giao Lưu Sân Bãi Pickleball";
            styleInstructions = "Viết thành MẪU BÀI TÌM KÈO & GHÉP SÂN GIAO LƯU PICKLEBALL: "
                    + "Đầy đủ thông tin: Trình độ (DUPR 2.0 - 4.5+), Cụm sân & Khu vực, Khung giờ, Chi phí chia sẻ vui vẻ, tạo không khí nhiệt tình gắn kết anh em đồng banh.";
        } else if ("GROUP_SALE".equals(styleKey)) {
            styleInstructions = "Viết theo phong cách ĐĂNG BÀI NHÓM FB / RAO BÁN THƯƠNG MẠI: nhấn mạnh điểm nổi bật, cơ hội, giá trị thực tế, có Kêu gọi hành động (CTA) tương tác/liên hệ.";
        } else if ("EXPERT_ANALYSIS".equals(styleKey)) {
            styleInstructions = "Viết theo phong cách PHÂN TÍCH CHUYÊN GIA / GÓC NHÌN ĐẦU TƯ: nhận định thị trường ngắn gọn, súc tích, chuyên nghiệp, đưa ra góc nhìn đắt giá.";
        } else if ("NEWS_SUMMARY".equals(styleKey)) {
            styleInstructions = "Viết theo phong cách ĐIỂM TIN HÀNG NGÀY: tóm tắt 3-5 điểm chính nổi bật nhất, dùng dấu gạch đầu dòng (bullet points) dễ đọc, cô đọng.";
        } else if ("TIKTOK_SCRIPT".equals(styleKey)) {
            styleInstructions = "Viết thành KỊCH BẢN VIDEO SHORT/TIKTOK 45 GIÂY: gồm 3 phần 1. HOOK 3 giây giật gân ➔ 2. Lời thoại MC dẫn dắt + Gợi ý quay hình ảnh ➔ 3. Kêu gọi Follow/Comment.";
        } else if ("ZALO_TELEGRAM".equals(styleKey)) {
            styleInstructions = "Viết thành BẢN TIN NHANH CHO ZALO / TELEGRAM GROUP: siêu ngắn gọn, 4-6 câu cô đọng nhất, trình bày đẹp mắt.";
        } else {
            styleInstructions = "Viết theo phong cách BÀI ĐĂNG FANPAGE TRIỆU VIEW CỰC KỲ CUỐN HÚT, RÕ Ý & GIÀU KIẾN THỨC:\n"
                    + "- Dòng đầu: Tiêu đề IN HOA nổi bật, tóm lược nội dung cốt lõi hoặc câu hỏi lớn gây tò mò.\n"
                    + "- Thân bài: Gồm 3 đến 5 đoạn văn thoáng đãng (mỗi đoạn 2-3 câu, cách nhau 1 dòng trống). NẾU BÀI GỐC LÀ TIÊU ĐỀ TIẾNG ANH HOẶC NỘI DUNG NGẮN (từ Reddit/mạng xã hội), BẮT BUỘC bạn phải dùng kho kiến thức bách khoa thực tế để giải thích chi tiết: Ai là người thực hiện? Hoàn cảnh lịch sử/khoa học ra sao? Diễn biến thử nghiệm/sự kiện thế nào? Kết quả đo lường và số liệu thực tế cụ thể là gì? Cơ chế hoặc nguyên nhân đằng sau? Đúc kết bài học hữu ích hoặc ý nghĩa nhân văn cho người đọc.\n"
                    + "- TUYỆT ĐỐI KHÔNG tóm tắt hời hợt, vô thưởng vô phạt hay dùng các câu sáo rỗng chung chung. Phải đem lại giá trị học hỏi thực sự cho người đọc.\n"
                    + "- Văn phong tự nhiên, truyền cảm, cuốn hút như một chuyên gia kể chuyện, không dùng từ ngữ dịch máy.\n"
                    + "- TUYỆT ĐỐI KHÔNG dùng dấu sao markdown (*, **). Dùng chữ IN HOA nếu muốn nhấn mạnh.\n"
                    + "- Dòng cuối cùng ghi đúng: Nguồn: Reddit (hoặc nguồn bài viết tương ứng).";
        }

        String prompt = "Bạn là " + roleExpertise + ".\n"
                + "Nhiệm vụ của bạn: Hãy đọc bài báo/nội dung dưới đây và VIẾT LẠI THÀNH BÀI ĐĂNG HOÀN CHỈNH BẰNG TIẾNG VIỆT.\n\n"
                + "YÊU CẦU BIÊN TẬP:\n"
                + "- " + styleInstructions + "\n"
                + "- Nếu nội dung gốc ngắn hoặc là bài quốc tế/tiếng Anh, hãy khai thác tri thức thực tế về sự kiện/nghiên cứu/nhân vật đó để viết chi tiết, có số liệu và bài học cụ thể.\n"
                + "- Giữ nguyên các thông số quan trọng (tên người, số liệu, mốc thời gian nếu có).\n"
                + "- TUYỆT ĐỐI KHÔNG dùng dấu sao markdown (*, **, ***) để in đậm hay gạch đầu dòng. Facebook không hiển thị được markdown. Dùng chữ IN HOA nếu muốn nhấn mạnh.\n"
                + "- Tuyệt đối không thêm lời dẫn kiểu \"Dưới đây là bài đăng...\", hãy trả về thẳng nội dung bài đăng đã hoàn thiện.\n\n"
                + "NỘI DUNG GỐC:\n"
                + "Tiêu đề: " + (title != null ? title : "") + "\n"
                + (sapo != null && !sapo.isBlank() ? "Sapo: " + sapo + "\n" : "")
                + "Chi tiết:\n" + (content != null ? content : "");

        Map<String, Object> body = Map.of("contents", List.of(Map.of("parts", List.of(Map.of("text", prompt)))));
        String origKey = this.apiKey;
        try {
            this.apiKey = effectiveKey;
            String rewritten = postWithModelFallback(body, effectiveKey);
            if (rewritten.startsWith("```")) {
                rewritten = rewritten.replaceAll("^```(?:markdown|text)?\\n?", "").replaceAll("\\n?```$", "").trim();
            }
            return stripMarkdownAsterisks(rewritten);
        } finally {
            this.apiKey = origKey;
        }
    }

    /**
     * Kiểm tra trạng thái sức khoẻ, kết nối và số lượt đã dùng hôm nay của một Gemini API Key.
     */
    public Map<String, Object> checkKeyHealth(String key) {
        String cleanKey = key != null ? key.trim() : "";
        String masked = maskKey(cleanKey);
        int callsToday = getKeyUsageToday(cleanKey);
        Map<String, Object> result = new HashMap<>();
        result.put("key", cleanKey);
        result.put("masked", masked);
        result.put("callsToday", callsToday);
        result.put("dailyLimitEstimate", 1500);

        if (cleanKey.isEmpty()) {
            result.put("status", "EMPTY");
            result.put("message", "Chưa nhập key");
            return result;
        }

        try {
            // Ping Google Generative Language API
            String url = "https://generativelanguage.googleapis.com/v1beta/models?key=" + cleanKey;
            ResponseEntity<String> resp = restTemplate.getForEntity(url, String.class);
            if (resp.getStatusCode().is2xxSuccessful()) {
                result.put("status", "HEALTHY");
                result.put("message", "Hoạt động tốt (200 OK)");
            } else {
                result.put("status", "WARN");
                result.put("message", "Mã phản hồi: " + resp.getStatusCode());
            }
        } catch (org.springframework.web.client.HttpStatusCodeException e) {
            int code = e.getStatusCode().value();
            if (code == 429) {
                result.put("status", "RATE_LIMITED");
                result.put("message", "Đã hết hạn ngạch hôm nay (429 Quota Exceeded) - Chờ reset lúc 07:00 sáng mai");
            } else if (code == 400 || code == 403) {
                result.put("status", "INVALID");
                result.put("message", "API Key không hợp lệ hoặc không có quyền (HTTP " + code + ")");
            } else {
                result.put("status", "ERROR");
                result.put("message", "Lỗi HTTP " + code);
            }
        } catch (Exception e) {
            result.put("status", "ERROR");
            result.put("message", "Lỗi kết nối: " + e.getMessage());
        }
        return result;
    }

    /**
     * Kiểm tra danh sách tất cả các key được cung cấp hoặc key mặc định của hệ thống.
     */
    public List<Map<String, Object>> checkAllKeys(String keysInput) {
        List<String> keys = parseKeys(keysInput);
        List<Map<String, Object>> list = new ArrayList<>();
        for (String k : keys) {
            list.add(checkKeyHealth(k));
        }
        return list;
    }

    /**
     * Dùng Gemini AI để đọc danh sách các bài viết đã cào, chấm điểm chất lượng nội dung (1-100),
     * bóc tách lý do viral (viralAngle), gợi ý Hook remake, và lọc sạch các bài spam/rác.
     */
    public List<Map<String, Object>> curateAndScoreViralPosts(List<Map<String, Object>> posts, String topic, String apiKeyOverride) {
        if (posts == null || posts.isEmpty()) {
            return java.util.Collections.emptyList();
        }

        StringBuilder sb = new StringBuilder();
        int count = 0;
        for (Map<String, Object> p : posts) {
            if (count >= 15) break;
            count++;
            String id = String.valueOf(p.get("id"));
            String caption = String.valueOf(p.getOrDefault("caption", ""));
            int reactions = p.get("reactions") instanceof Number ? ((Number) p.get("reactions")).intValue() : 0;
            int comments = p.get("comments") instanceof Number ? ((Number) p.get("comments")).intValue() : 0;

            sb.append("--- BÀI [").append(id).append("] ---\n");
            sb.append("Tương tác: ").append(reactions).append(" Like, ").append(comments).append(" Cmt\n");
            sb.append("Nội dung: ").append(caption.length() > 300 ? caption.substring(0, 300) + "..." : caption).append("\n\n");
        }

        String prompt = "Bạn là Chuyên gia Nội dung Mạng Xã Hội (Facebook & Threads) hàng đầu.\n"
                + "Nhiệm vụ: Đọc và thẩm định danh sách các bài viết cào được dưới đây theo chủ đề \"" + (topic != null ? topic : "Nội dung chất lượng") + "\".\n"
                + "Hãy lọc ra các bài THẬT SỰ HAY, CÓ GIÁ TRỊ ĐỌC, CÓ CHIỀU SÂU VÀ DỄ VIRAL LẠI (bỏ các bài spam bán hàng, tuyển dụng, chèo kéo, tìm đồ lạc, cụt lủn).\n\n"
                + "TRẢ VỀ ĐÚNG ĐỊNH DẠNG JSON MẢNG (Array of JSON Objects), không bọc thêm bất kỳ chữ nào ngoài JSON:\n"
                + "[\n"
                + "  {\n"
                + "    \"id\": \"id_bài\",\n"
                + "    \"aiScore\": 92, // Điểm từ 0 đến 100 về độ hay và giá trị\n"
                + "    \"qualityVerdict\": \"CỰC PHẨM / REVIEW CÓ TÂM / TÂM SỰ SÂU SẮC / BÌNH THƯỜNG / SPAM\",\n"
                + "    \"viralAngle\": \"1 câu ngắn giải mã vì sao bài này viral (vd: Đánh vào tâm lý tò mò, kể chuyện chân thật...)\",\n"
                + "    \"suggestedHook\": \"1 câu mở đầu giật tít cực cuốn nếu đăng lại bài này\",\n"
                + "    \"isSpam\": false\n"
                + "  }\n"
                + "]\n\n"
                + "DANH SÁCH BÀI VIẾT:\n" + sb.toString();

        Map<String, Object> body = Map.of("contents", List.of(Map.of("parts", List.of(Map.of("text", prompt)))));
        String effectiveKey = (apiKeyOverride != null && !apiKeyOverride.isBlank()) ? apiKeyOverride : this.apiKey;
        String origKey = this.apiKey;
        try {
            this.apiKey = effectiveKey;
            String rawJson = postWithModelFallback(body);
            if (rawJson.startsWith("```")) {
                rawJson = rawJson.replaceAll("^```(?:json)?\\n?", "").replaceAll("\\n?```$", "").trim();
            }
            JsonNode root = objectMapper.readTree(rawJson);
            if (root.isArray()) {
                Map<String, JsonNode> map = new HashMap<>();
                for (JsonNode node : root) {
                    if (node.has("id")) {
                        map.put(node.get("id").asText(), node);
                    }
                }

                List<Map<String, Object>> enriched = new ArrayList<>();
                for (Map<String, Object> p : posts) {
                    String id = String.valueOf(p.get("id"));
                    Map<String, Object> copy = new HashMap<>(p);
                    if (map.containsKey(id)) {
                        JsonNode n = map.get(id);
                        int aiScore = n.has("aiScore") ? n.get("aiScore").asInt() : 50;
                        boolean isSpam = n.has("isSpam") && n.get("isSpam").asBoolean();
                        String verdict = n.has("qualityVerdict") ? n.get("qualityVerdict").asText() : "";
                        String viralAngle = n.has("viralAngle") ? n.get("viralAngle").asText() : "";
                        String suggestedHook = n.has("suggestedHook") ? stripMarkdownAsterisks(n.get("suggestedHook").asText()) : "";

                        copy.put("aiScore", aiScore);
                        copy.put("isSpam", isSpam);
                        copy.put("qualityVerdict", verdict);
                        copy.put("viralAngle", viralAngle);
                        copy.put("suggestedHook", suggestedHook);
                        copy.put("aiCurated", true);
                    } else {
                        copy.put("aiScore", 50);
                    }
                    enriched.add(copy);
                }

                enriched.sort((a, b) -> {
                    int sA = a.get("aiScore") instanceof Number ? ((Number) a.get("aiScore")).intValue() : 0;
                    int sB = b.get("aiScore") instanceof Number ? ((Number) b.get("aiScore")).intValue() : 0;
                    return sB - sA;
                });
                return enriched;
            }
            return posts;
        } catch (Exception e) {
            log.warn("Gemini curate error: {}", e.getMessage());
            return posts;
        } finally {
            this.apiKey = origKey;
        }
    }

    /** Xóa bỏ các ký tự markdown in đậm/nghiêng thô (dấu sao *, **, ***, ...) vì Facebook không hỗ trợ markdown */
    public static String stripMarkdownAsterisks(String text) {
        if (text == null) return "";
        return text.replaceAll("\\*{2,}", "")
                .replaceAll("(?m)^[ \\t]*\\*+[ \\t]*", "")
                .replaceAll("(?m)[ \\t]*\\*+[ \\t]*$", "")
                .replaceAll("(?<=[^\\*]|^)\\*([^\\*\\r\\n]+)\\*(?=[^\\*]|$)", "$1")
                .trim();
    }
}

