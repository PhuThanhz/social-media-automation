package com.autopost.saas.service.telegram;

import com.autopost.saas.util.PooledRestTemplateFactory;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestTemplate;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Gọi Telegram Bot API (https://api.telegram.org/bot&lt;token&gt;/...) bằng RestTemplate.
 * Token nằm trong URL nên mọi lỗi ném ra đều đã được che token ({@link #sanitize}).
 */
@Component
@Slf4j
public class TelegramApi {

    private static final String BASE = "https://api.telegram.org/bot";
    /** Long polling giữ kết nối tới 25s → read timeout phải dài hơn. */
    private final RestTemplate http = PooledRestTemplateFactory.create(10_000, 40_000);

    public static class TelegramException extends RuntimeException {
        private final int status;

        TelegramException(int status, String message) {
            super(message);
            this.status = status;
        }

        public int status() {
            return status;
        }
    }

    @SuppressWarnings("unchecked")
    Object call(String token, String method, Map<String, Object> body) {
        if (token == null || token.isBlank()) throw new TelegramException(0, "Chưa có bot token");
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        try {
            Map<String, Object> res = http.exchange(BASE + token + "/" + method, HttpMethod.POST,
                    new HttpEntity<>(body != null ? body : Map.of(), headers),
                    new ParameterizedTypeReference<Map<String, Object>>() {
                    }).getBody();
            if (res == null || !Boolean.TRUE.equals(res.get("ok"))) {
                throw new TelegramException(0, "Telegram từ chối " + method + ": " + (res != null ? res.get("description") : "null"));
            }
            return res.get("result");
        } catch (HttpStatusCodeException e) {
            String desc = e.getResponseBodyAsString();
            throw new TelegramException(e.getStatusCode().value(),
                    "Telegram " + method + " HTTP " + e.getStatusCode().value() + ": " + sanitize(desc, token));
        } catch (TelegramException e) {
            throw e;
        } catch (Exception e) {
            throw new TelegramException(0, "Telegram " + method + " lỗi: " + sanitize(e.getMessage(), token));
        }
    }

    static String sanitize(String text, String token) {
        if (text == null) return "";
        String out = token != null && !token.isBlank() ? text.replace(token, "***") : text;
        return out.replaceAll("bot\\d+:[A-Za-z0-9_-]{20,}", "bot***");
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> getMe(String token) {
        return (Map<String, Object>) call(token, "getMe", Map.of());
    }

    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> getUpdates(String token, Long offset, int timeoutSeconds) {
        Map<String, Object> body = new HashMap<>();
        if (offset != null) body.put("offset", offset);
        body.put("timeout", timeoutSeconds);
        body.put("allowed_updates", List.of("message", "callback_query"));
        Object r = call(token, "getUpdates", body);
        return r instanceof List<?> l ? (List<Map<String, Object>>) l : List.of();
    }

    public void sendMessage(String token, long chatId, String html, Object replyMarkup) {
        sendMessageId(token, chatId, html, replyMarkup);
    }

    /** Gửi tin, trả message_id (để sửa lại sau). */
    @SuppressWarnings("unchecked")
    public Long sendMessageId(String token, long chatId, String html, Object replyMarkup) {
        Map<String, Object> body = new HashMap<>();
        body.put("chat_id", chatId);
        body.put("text", truncate(html));
        body.put("parse_mode", "HTML");
        body.put("disable_web_page_preview", true);
        if (replyMarkup != null) body.put("reply_markup", replyMarkup);
        Object r = call(token, "sendMessage", body);
        return r instanceof Map<?, ?> m && m.get("message_id") instanceof Number n ? n.longValue() : null;
    }

    public void editMessage(String token, long chatId, long messageId, String html, Object replyMarkup) {
        Map<String, Object> body = new HashMap<>();
        body.put("chat_id", chatId);
        body.put("message_id", messageId);
        body.put("text", truncate(html));
        body.put("parse_mode", "HTML");
        body.put("disable_web_page_preview", true);
        if (replyMarkup != null) body.put("reply_markup", replyMarkup);
        try {
            call(token, "editMessageText", body);
        } catch (TelegramException e) {
            // "message is not modified" khi bấm lại cùng nút — không phải lỗi thật
            if (e.getMessage() == null || !e.getMessage().contains("not modified")) throw e;
        }
    }

    public void answerCallback(String token, String callbackId, String text) {
        Map<String, Object> body = new HashMap<>();
        body.put("callback_query_id", callbackId);
        if (text != null) body.put("text", text);
        try {
            call(token, "answerCallbackQuery", body);
        } catch (TelegramException e) {
            log.debug("[Telegram] answerCallbackQuery: {}", e.getMessage());
        }
    }

    public void setMyCommands(String token, List<String[]> commands) {
        List<Map<String, String>> list = new ArrayList<>();
        for (String[] c : commands) list.add(Map.of("command", c[0], "description", c[1]));
        call(token, "setMyCommands", Map.of("commands", list));
    }

    /** Bot API chỉ cho bot tải file ≤ 20MB. */
    public static final long MAX_DOWNLOAD_BYTES = 20L * 1024 * 1024;
    private final RestTemplate fileHttp = PooledRestTemplateFactory.create(10_000, 180_000);

    @SuppressWarnings("unchecked")
    public String getFilePath(String token, String fileId) {
        Map<String, Object> r = (Map<String, Object>) call(token, "getFile", Map.of("file_id", fileId));
        Object path = r != null ? r.get("file_path") : null;
        if (path == null) throw new TelegramException(0, "Telegram không trả đường dẫn file");
        return String.valueOf(path);
    }

    public byte[] downloadFile(String token, String filePath) {
        try {
            byte[] data = fileHttp.getForObject("https://api.telegram.org/file/bot" + token + "/" + filePath, byte[].class);
            if (data == null || data.length == 0) throw new TelegramException(0, "File rỗng");
            return data;
        } catch (TelegramException e) {
            throw e;
        } catch (Exception e) {
            throw new TelegramException(0, "Tải file từ Telegram lỗi: " + sanitize(e.getMessage(), token));
        }
    }

    /** 1 ảnh/video để tải lên Telegram (xem trước). kind = "photo" | "video". */
    public record Upload(String kind, byte[] data, String filename, String caption) {
    }

    /** Gửi 1 ảnh/video hoặc album 2–10 cái bằng multipart (file nằm trên máy, Telegram không tự tải được). */
    public void sendMedia(String token, long chatId, List<Upload> items) {
        if (items == null || items.isEmpty()) return;
        MultiValueMap<String, Object> form = new LinkedMultiValueMap<>();
        form.add("chat_id", String.valueOf(chatId));
        String method;
        if (items.size() == 1) {
            Upload u = items.get(0);
            method = "photo".equals(u.kind()) ? "sendPhoto" : "sendVideo";
            form.add(u.kind(), fileResource(u.data(), u.filename()));
            if (u.caption() != null) form.add("caption", u.caption());
            if ("video".equals(u.kind())) form.add("supports_streaming", "true");
        } else {
            method = "sendMediaGroup";
            List<Map<String, Object>> media = new ArrayList<>();
            for (int i = 0; i < items.size() && i < 10; i++) {
                Upload u = items.get(i);
                Map<String, Object> m = new HashMap<>();
                m.put("type", u.kind());
                m.put("media", "attach://f" + i);
                if (u.caption() != null) m.put("caption", u.caption());
                if ("video".equals(u.kind())) m.put("supports_streaming", true);
                media.add(m);
                form.add("f" + i, fileResource(u.data(), u.filename()));
            }
            try {
                form.add("media", new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(media));
            } catch (Exception e) {
                throw new TelegramException(0, "Không dựng được album: " + e.getMessage());
            }
        }
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.MULTIPART_FORM_DATA);
        try {
            Map<String, Object> res = fileHttp.exchange(BASE + token + "/" + method, HttpMethod.POST, new HttpEntity<>(form, headers),
                    new ParameterizedTypeReference<Map<String, Object>>() {
                    }).getBody();
            if (res == null || !Boolean.TRUE.equals(res.get("ok"))) {
                throw new TelegramException(0, "Telegram từ chối " + method + ": " + (res != null ? res.get("description") : "null"));
            }
        } catch (HttpStatusCodeException e) {
            throw new TelegramException(e.getStatusCode().value(), "Telegram " + method + " HTTP " + e.getStatusCode().value()
                    + ": " + sanitize(e.getResponseBodyAsString(), token));
        } catch (TelegramException e) {
            throw e;
        } catch (Exception e) {
            throw new TelegramException(0, "Telegram " + method + " lỗi: " + sanitize(e.getMessage(), token));
        }
    }

    private static ByteArrayResource fileResource(byte[] data, String filename) {
        return new ByteArrayResource(data) {
            @Override
            public String getFilename() {
                return filename;
            }
        };
    }

    // ---- helpers ----
    public static String esc(String s) {
        if (s == null) return "";
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }

    private static String truncate(String html) {
        return html != null && html.length() > 4000 ? html.substring(0, 3990) + "…" : html;
    }

    public static Map<String, Object> button(String text, String callbackData) {
        return Map.of("text", text, "callback_data", callbackData);
    }

    public static Map<String, Object> keyboard(List<List<Map<String, Object>>> rows) {
        return Map.of("inline_keyboard", rows);
    }
}
