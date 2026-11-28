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

    /**
     * Nhóm được miễn trừ kiểm tra trùng lặp (cho phép đăng lại thoải mái theo yêu cầu):
     * - Nhóm Đảo (Đảo Mèo 1 - ID 263510030791508 hoặc tên chứa 'đảo' / 'dao')
     * - Nhóm Tinder Pets (Tinder Pets Việt Nam - ID 1195776878326307 hoặc tên chứa 'tinder pet')
     */
    public static boolean isDuplicateExemptGroup(String groupTarget) {
        if (groupTarget == null || groupTarget.isBlank()) return false;
        String lower = groupTarget.toLowerCase();
        return lower.contains("263510030791508")
                || lower.contains("1195776878326307")
                || lower.contains("đảo")
                || lower.contains("dao")
                || lower.contains("tinder pet")
                || lower.contains("tinder pets");
    }

    private static final Pattern BARE_GROUP_URL = Pattern.compile("^https?://(www\\.|m\\.|mobile\\.)?facebook\\.com/groups/[^/?#]+/?(?:[?#].*)?$", Pattern.CASE_INSENSITIVE);
    private static final Pattern TIKTOK_VIDEO_ID = Pattern.compile("(?:video|v)/(\\d{15,25})");

    /** Link Facebook không chứa ID bài (Group/Page/trang cá nhân). */
    public static boolean isFacebookNonPostUrl(String url) {
        if (url == null) return false;
        String l = url.toLowerCase();
        return (l.contains("facebook.com") || l.contains("fb.com")) && extractPostId(url) == null;
    }

    /** Link Group/Page trống (không trỏ tới bài cụ thể) — không dùng để so trùng. */
    public static boolean isBareGroupUrl(String url) {
        return url != null && BARE_GROUP_URL.matcher(url.trim()).matches();
    }

    /** Cùng 1 bài Facebook: khớp nguyên chuỗi, khớp link đã chuẩn hóa, hoặc khớp ID bài. */
    public static boolean isSameFacebookPostUrl(String url1, String url2) {
        if (url1 == null || url2 == null) return false;
        String u1 = url1.trim();
        String u2 = url2.trim();
        if (u1.isBlank() || u2.isBlank()) return false;
        if (u1.equalsIgnoreCase(u2)) return true;
        if (isBareGroupUrl(u1) || isBareGroupUrl(u2)) return false;
        String norm1 = normalizeFacebookUrl(u1);
        String norm2 = normalizeFacebookUrl(u2);
        if (!norm1.isBlank() && norm1.equalsIgnoreCase(norm2)) return true;
        String id1 = extractPostId(u1);
        String id2 = extractPostId(u2);
        return id1 != null && !id1.isBlank() && id1.equalsIgnoreCase(id2);
    }

    public static String extractTikTokVideoId(String url) {
        if (url == null || url.isBlank()) return null;
        Matcher m = TIKTOK_VIDEO_ID.matcher(url);
        if (m.find()) return m.group(1);
        if (url.matches("^\\d{15,25}$")) return url;
        return null;
    }

    public static boolean isSameTikTokVideo(String targetId, String targetUrl, String existingUrl) {
        if (existingUrl == null || existingUrl.isBlank()) return false;
        String exist = existingUrl.trim();
        if (targetUrl != null && targetUrl.equalsIgnoreCase(exist)) return true;
        if (targetId != null && !targetId.isBlank() && exist.contains(targetId)) return true;
        String existId = extractTikTokVideoId(exist);
        return existId != null && existId.equals(targetId);
    }

    public static boolean isTikTokUrl(String url) {
        return url != null && url.toLowerCase().contains("tiktok.com");
    }

    /** Chuẩn hóa link bất kỳ (không phải FB): bỏ protocol/www, query tracking utm_*, trailing slash. */
    public static String normalizeGenericUrl(String url) {
        if (url == null || url.isBlank()) return "";
        String u = url.trim().replaceFirst("^https?://", "").replaceFirst("^www\\.", "");
        int hash = u.indexOf('#');
        if (hash != -1) u = u.substring(0, hash);
        int q = u.indexOf('?');
        if (q != -1) {
            String path = u.substring(0, q);
            java.util.List<String> kept = new java.util.ArrayList<>();
            for (String p : u.substring(q + 1).split("&")) {
                String k = p.split("=")[0].toLowerCase();
                if (k.isEmpty() || k.startsWith("utm_") || k.equals("fbclid") || k.equals("igsh") || k.equals("si")
                        || k.equals("is_from_webapp") || k.equals("sender_device") || k.equals("_r") || k.equals("_t")) continue;
                kept.add(p);
            }
            u = kept.isEmpty() ? path : path + "?" + String.join("&", kept);
        }
        if (u.endsWith("/")) u = u.substring(0, u.length() - 1);
        return u.toLowerCase();
    }

    /** Cùng 1 link (mọi nền tảng): FB theo ID bài, TikTok theo ID video, còn lại theo link chuẩn hóa. */
    public static boolean isSameLink(String query, String existing) {
        if (query == null || existing == null || query.isBlank() || existing.isBlank()) return false;
        if (isTikTokUrl(query)) {
            String id = extractTikTokVideoId(query);
            return id != null ? isSameTikTokVideo(id, query, existing) : normalizeGenericUrl(query).equals(normalizeGenericUrl(existing));
        }
        if (query.toLowerCase().contains("facebook.com") || query.toLowerCase().contains("fb.watch")) {
            return isSameFacebookPostUrl(query, existing);
        }
        String nq = normalizeGenericUrl(query);
        return !nq.isEmpty() && nq.equals(normalizeGenericUrl(existing));
    }

    /** Chuỗi ngắn để LIKE trong DB: ID bài/ID video nếu có, không thì link đã chuẩn hóa. */
    public static String searchNeedle(String url) {
        if (url == null || url.isBlank()) return null;
        if (isTikTokUrl(url)) {
            String id = extractTikTokVideoId(url);
            if (id != null) return id;
        } else if (url.toLowerCase().contains("facebook.com")) {
            // Link Group/Page/trang cá nhân không trỏ tới bài cụ thể → không tra (tool hay lưu chúng làm link dự phòng).
            String id = extractPostId(url);
            return id != null && id.length() >= 5 ? id : null;
        }
        String n = normalizeGenericUrl(url);
        return n.isEmpty() ? null : n;
    }
}
