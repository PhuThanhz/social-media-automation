package com.autopost.saas.service.telegram;

import java.util.*;
import java.util.function.Function;

/**
 * Bài nháp đang soạn trong 1 chat Telegram: các bài (link / chữ / ảnh-video tự gửi) × các Trang đích (+ nhóm).
 * Hàm buildPayload thuần (không Spring) để unit test được — nhân bản mỗi bài theo từng Trang giống trang web.
 */
final class TelegramDraft {

    static final int MAX_ITEMS = 10;
    static final int MAX_POSTS = 60;
    /** Facebook chỉ cho nền màu với status ngắn. */
    static final int COLOR_BG_MAX_CHARS = 130;
    private static final long TTL_MS = 30 * 60_000;

    static final class Item {
        final int id;                     // ổn định khi bỏ bớt bài (nút bấm trỏ theo id, không theo vị trí)
        final String url;                 // null = bài tự soạn (chữ/ảnh/video gửi thẳng)
        final List<String> media = new ArrayList<>(); // file đã tải về /uploads (bài tự soạn)
        final List<String> mediaKinds = new ArrayList<>(); // "image" | "video" cho media tự gửi
        String scrapedCaption;            // caption cào được khi xem trước
        List<String> scrapedMedia = List.of();
        List<String> scrapedKinds = List.of(); // mediaKinds server trả về khi xem trước (link FB video không có đuôi .mp4)
        String customCaption;             // caption người dùng sửa / AI viết lại; null = giữ nội dung gốc
        final TreeSet<Integer> removedMedia = new TreeSet<>(); // vị trí (0-based) ảnh/video người dùng bỏ
        String mediaNote;                 // ghi chú khi gửi xem trước ảnh/video (lỗi tải, quá lớn…)
        boolean mediaShown;
        boolean previewLoading;
        String previewError;
        Long previewMessageId;

        Item(int id, String url) {
            this.id = id;
            this.url = url;
        }

        boolean manual() {
            return url == null;
        }

        List<String> allMedia() {
            return manual() ? media : scrapedMedia;
        }

        /** Loại file thứ i: ưu tiên mediaKinds của server, thiếu thì đoán theo URL. */
        boolean isVideo(int i) {
            List<String> kinds = manual() ? mediaKinds : scrapedKinds;
            if (i < kinds.size() && kinds.get(i) != null) return "video".equalsIgnoreCase(kinds.get(i));
            List<String> all = allMedia();
            return i < all.size() && looksLikeVideoUrl(all.get(i));
        }

        List<String> keptMedia() {
            List<String> all = allMedia();
            List<String> kept = new ArrayList<>();
            for (int i = 0; i < all.size(); i++) if (!removedMedia.contains(i)) kept.add(all.get(i));
            return kept;
        }

        /** Bật/tắt bỏ 1 ảnh/video; trả false nếu đó là cái cuối cùng còn giữ (không cho bỏ hết). */
        boolean toggleMedia(int idx) {
            if (idx < 0 || idx >= allMedia().size()) return true;
            if (removedMedia.remove(idx)) return true;
            if (keptMedia().size() <= 1) return false;
            removedMedia.add(idx);
            return true;
        }

        String caption() {
            return customCaption != null ? customCaption : (scrapedCaption != null ? scrapedCaption : "");
        }
    }

    static boolean looksLikeVideoUrl(String u) {
        String l = u.toLowerCase(Locale.ROOT);
        return l.matches(".*\\.(mp4|mov|webm|mkv|avi|m3u8)(\\?.*)?$") || l.contains("video");
    }

    final List<Item> items = new ArrayList<>();
    private int nextItemId = 1;
    final LinkedHashSet<Long> pageIds = new LinkedHashSet<>();
    final LinkedHashSet<Long> groupIds = new LinkedHashSet<>();
    boolean includeCredit = true;
    boolean colorBackground;
    Long panelMessageId;
    Integer awaitingCaptionFor;
    long awaitingSinceMs;
    boolean submitted;
    private long touchedMs = System.currentTimeMillis();

    Item addItem(String url) {
        Item it = new Item(nextItemId++, url);
        items.add(it);
        return it;
    }

    Item item(int id) {
        return items.stream().filter(i -> i.id == id).findFirst().orElse(null);
    }

    int indexOf(Item it) {
        return items.indexOf(it) + 1;
    }

    void touch() {
        touchedMs = System.currentTimeMillis();
    }

    boolean expired() {
        return System.currentTimeMillis() - touchedMs > TTL_MS;
    }

    boolean hasLinks() {
        return items.stream().anyMatch(i -> !i.manual());
    }

    /** Toàn bài chữ ngắn, không ảnh → mới cho bật nền màu. */
    boolean colorBackgroundAllowed() {
        return !items.isEmpty() && items.stream().allMatch(i -> i.manual() && i.keptMedia().isEmpty()
                && !i.caption().isBlank() && i.caption().length() <= COLOR_BG_MAX_CHARS);
    }

    int postCount() {
        return items.size() * Math.max(1, pageIds.size());
    }

    /** Lỗi chặn đăng (null = hợp lệ). */
    String validate() {
        if (items.isEmpty()) return "Bài nháp trống";
        if (pageIds.isEmpty()) return "Chưa chọn Trang nào";
        if (postCount() > MAX_POSTS) return "Tối đa " + MAX_POSTS + " lượt đăng mỗi lần (" + items.size() + " bài × " + pageIds.size() + " Trang)";
        for (int i = 0; i < items.size(); i++) {
            Item it = items.get(i);
            if (it.manual() && it.caption().isBlank() && it.keptMedia().isEmpty()) return "Bài " + (i + 1) + " chưa có nội dung";
        }
        return null;
    }

    /**
     * Payload cho POST /api/queue/add-from-urls. Mỗi bài × mỗi Trang = 1 mục; nhóm chỉ gắn vào mục của Trang ĐẦU
     * để mỗi nhóm nhận đúng 1 bài (đăng dưới danh nghĩa Trang đó).
     */
    Map<String, Object> buildPayload(Function<Long, String> pageTarget, Function<Long, String> groupPlatformId, String mode) {
        List<Object> urls = new ArrayList<>();
        List<Object> captions = new ArrayList<>();
        List<Object> media = new ArrayList<>();
        List<Object> targets = new ArrayList<>();
        List<Object> groupLists = new ArrayList<>();
        List<Object> credits = new ArrayList<>();
        List<Object> colorBgs = new ArrayList<>();
        String groups = groupIds.stream().map(groupPlatformId).filter(Objects::nonNull).reduce((a, b) -> a + "," + b).orElse(null);
        boolean useColor = colorBackground && colorBackgroundAllowed();
        for (Item it : items) {
            int pageIdx = 0;
            for (Long pageId : pageIds) {
                urls.add(it.manual() ? "" : it.url);
                captions.add(it.manual() ? it.caption() : it.customCaption);
                List<String> kept = it.keptMedia();
                // link chưa bỏ ảnh nào → null để server tự lấy media gốc; đã bỏ bớt → gửi danh sách còn giữ
                boolean sendMedia = it.manual() ? !kept.isEmpty() : !it.removedMedia.isEmpty() && !kept.isEmpty();
                media.add(sendMedia ? String.join(",", kept) : null);
                targets.add(pageTarget.apply(pageId));
                groupLists.add(pageIdx == 0 ? groups : null);
                credits.add(includeCredit);
                colorBgs.add(useColor);
                pageIdx++;
            }
        }
        Map<String, Object> body = new HashMap<>();
        body.put("urls", urls);
        body.put("customCaptions", captions);
        body.put("customMediaUrls", media);
        body.put("targetFanpageIds", targets);
        body.put("targetFanpageId", targets.isEmpty() ? null : targets.get(0));
        body.put("targetGroupNamesList", groupLists);
        body.put("includeCredits", credits);
        body.put("colorBackgrounds", colorBgs);
        body.put("scheduleMode", mode);
        return body;
    }
}
