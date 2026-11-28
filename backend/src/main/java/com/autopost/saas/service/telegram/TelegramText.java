package com.autopost.saas.service.telegram;

import java.net.URI;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Hàm thuần (không Spring) để tách lệnh / link từ tin nhắn Telegram — có unit test riêng. */
public final class TelegramText {

    private static final Pattern URL = Pattern.compile("https?://[^\\s<>\"']+", Pattern.CASE_INSENSITIVE);

    private TelegramText() {
    }

    public record Command(String name, String arg) {
    }

    /** "/lich@MyBot  abc" → (lich, "abc"); tin không bắt đầu bằng "/" → null. */
    public static Command parseCommand(String text) {
        if (text == null) return null;
        String t = text.trim();
        if (!t.startsWith("/") || t.length() < 2) return null;
        int space = t.indexOf(' ');
        String head = space > 0 ? t.substring(1, space) : t.substring(1);
        String arg = space > 0 ? t.substring(space + 1).trim() : "";
        int at = head.indexOf('@');
        if (at >= 0) head = head.substring(0, at);
        return new Command(head.toLowerCase(Locale.ROOT), arg);
    }

    /** Mọi link http(s) trong tin, bỏ trùng, giữ thứ tự, cắt dấu câu dính cuối. */
    public static List<String> extractUrls(String text) {
        LinkedHashSet<String> out = new LinkedHashSet<>();
        if (text == null) return new ArrayList<>();
        Matcher m = URL.matcher(text);
        while (m.find()) {
            String u = m.group().replaceAll("[).,;!?\\]]+$", "");
            if (u.length() > 10) out.add(u);
        }
        return new ArrayList<>(out);
    }

    /** Tin chỉ có link (và khoảng trắng/dấu phẩy) — không phải một caption có kèm link. */
    public static boolean isOnlyUrls(String text) {
        if (text == null) return false;
        String rest = URL.matcher(text).replaceAll(" ").replaceAll("[\\s,;]+", "");
        return rest.isEmpty() && !extractUrls(text).isEmpty();
    }

    public static boolean isThreadsUrl(String url) {
        try {
            String host = URI.create(url).getHost();
            if (host == null) return false;
            host = host.toLowerCase(Locale.ROOT);
            return host.equals("threads.net") || host.endsWith(".threads.net")
                    || host.equals("threads.com") || host.endsWith(".threads.com");
        } catch (Exception e) {
            return false;
        }
    }

    public static String shorten(String s, int max) {
        if (s == null) return "";
        String one = s.replaceAll("\\s+", " ").trim();
        return one.length() <= max ? one : one.substring(0, Math.max(0, max - 1)) + "…";
    }

    /** "pageId:PERSONAL_COOKIE:123" → 123; không có connectionId → null. */
    public static Long connectionIdOf(String targetFanpageId) {
        if (targetFanpageId == null) return null;
        String[] parts = targetFanpageId.split(":", -1);
        if (parts.length < 3 || parts[2].isBlank()) return null;
        try {
            return Long.valueOf(parts[2].trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
