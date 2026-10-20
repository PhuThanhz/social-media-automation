package com.autopost.saas.util;

import java.util.LinkedHashSet;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Nhận diện "cùng 1 bài gốc" theo ID bài Facebook thay vì so nguyên chuỗi link — cùng 1 bài có thể
 * mang nhiều dạng link (group slug hoặc ID số, /posts/ hay /permalink/, có/không query string).
 */
public final class FacebookPostIds {

    private static final Pattern POSTS_OR_PERMALINK = Pattern.compile("/(?:posts|permalink)/([a-zA-Z0-9_-]+)");
    private static final Pattern SHARE_LINK = Pattern.compile("/share/[prv]/([a-zA-Z0-9_-]+)");
    private static final Pattern MULTI_PERMALINKS = Pattern.compile("multi_permalinks=([a-zA-Z0-9_-]+)");
    private static final Pattern STORY_FBID = Pattern.compile("story_fbid=([a-zA-Z0-9_-]+)");
    private static final Pattern FBID = Pattern.compile("[?&]fbid=([a-zA-Z0-9_-]+)");
    private static final Pattern REEL_OR_VIDEO = Pattern.compile("/(?:reel|reels|videos)/([a-zA-Z0-9_-]+)");
    private static final Pattern WATCH_V = Pattern.compile("[?&]v=([a-zA-Z0-9_-]+)");
    private static final Pattern PHOTO_LINK = Pattern.compile("/photos?/(?:[^/]+/)?([a-zA-Z0-9_-]+)");
    private static final Pattern SET_PARAM = Pattern.compile("set=(?:pcb|gm|g|a)\\.([a-zA-Z0-9_-]+)");

    private FacebookPostIds() {
    }

    /** ID bài trong link Facebook, null nếu không nhận ra (link share rút gọn, link Group/Page trống...). */
    public static String extractPostId(String url) {
        if (url == null || url.isBlank()) return null;
        for (Pattern p : new Pattern[]{
                POSTS_OR_PERMALINK,
                SHARE_LINK,
                MULTI_PERMALINKS,
                STORY_FBID,
                FBID,
                REEL_OR_VIDEO,
                WATCH_V,
                PHOTO_LINK,
                SET_PARAM
        }) {
            Matcher m = p.matcher(url);
            if (m.find()) return m.group(1);
        }
        return null;
    }

    /** Chuẩn hóa link Facebook: loại bỏ tracking query params và trailing slash */
    public static String normalizeFacebookUrl(String url) {
        if (url == null || url.isBlank()) return "";
        String u = url.trim();
        // Bỏ protocol & www / m
        u = u.replaceFirst("^https?://", "");
        u = u.replaceFirst("^(?:www\\.|m\\.|mobile\\.)", "");
        // Tách query string để loại bỏ các param tracking phổ biến của Facebook
        int qIdx = u.indexOf('?');
        if (qIdx != -1) {
            String path = u.substring(0, qIdx);
            String query = u.substring(qIdx + 1);
            String[] params = query.split("&");
            java.util.List<String> kept = new java.util.ArrayList<>();
            for (String p : params) {
                String k = p.split("=")[0].toLowerCase();
                if (k.equals("mibextid") || k.equals("rdid") || k.equals("ref") || k.startsWith("__cft__")
                        || k.startsWith("__tn__") || k.equals("fbclid") || k.equals("sfnsn") || k.equals("locale")
                        || k.equals("paipv") || k.equals("checkpoint_src") || k.equals("notif_t")) {
                    continue; // Skip tracking param
                }
                kept.add(p);
            }
            u = kept.isEmpty() ? path : (path + "?" + String.join("&", kept));
        }
        if (u.endsWith("/")) {
            u = u.substring(0, u.length() - 1);
        }
        return u.toLowerCase();
    }

    /**
     * Chuẩn hóa nội dung văn bản (caption/content) để so trùng:
     * - Bỏ toàn bộ emoji, ký tự đặc biệt, dấu câu
     * - Gộp khoảng trắng liên tiếp
     * - Chuyển chữ thường
     */
    public static String normalizeContentForDedup(String text) {
        if (text == null || text.isBlank()) return "";
        return text.replaceAll("[\\p{Punct}\\p{So}\\p{Cn}\\p{Cs}\\p{Sc}]", " ")
                   .replaceAll("\\s+", " ")
                   .trim()
                   .toLowerCase();
    }

    /**
     * Kiểm tra xem 2 đoạn văn bản caption có cùng là 1 bài viết hay không (fuzzy hoặc prefix match).
     * Yêu cầu độ dài tối thiểu 20 ký tự để tránh false positive với các từ ngắn chung chung.
     */
    public static boolean isSameContent(String content1, String content2) {
        String c1 = normalizeContentForDedup(content1);
        String c2 = normalizeContentForDedup(content2);
        if (c1.length() < 20 || c2.length() < 20) return false;
        if (c1.equals(c2)) return true;
        // Nếu một bên có tiêu đề/cắt ngắn (e.g. crawler chỉ đọc được 120 ký tự đầu của bài)
        int minLen = Math.min(c1.length(), c2.length());
        if (minLen >= 40) {
            String sub1 = c1.substring(0, minLen);
            String sub2 = c2.substring(0, minLen);
            if (sub1.equals(sub2)) return true;
        }
        return false;
    }

    /**
     * Tách danh sách nhóm đích từ cột target_group_names. Các dạng đang có trong DB:
     * "GROUP_ONLY:123", "GROUP_ONLY_ANON:123", "123", "Tên nhóm", có thể nối bằng dấu phẩy.
     */
    public static Set<String> targetGroupKeys(String targetGroupNames) {
        Set<String> keys = new LinkedHashSet<>();
        if (targetGroupNames == null || targetGroupNames.isBlank()) return keys;
        for (String part : targetGroupNames.split(",")) {
            String p = part.trim();
            if (p.startsWith("GROUP_ONLY_ANON:")) p = p.substring("GROUP_ONLY_ANON:".length());
            else if (p.startsWith("GROUP_ONLY:")) p = p.substring("GROUP_ONLY:".length());
            p = p.trim().toLowerCase();
            if (!p.isEmpty()) keys.add(p);
        }
        return keys;
    }
}
