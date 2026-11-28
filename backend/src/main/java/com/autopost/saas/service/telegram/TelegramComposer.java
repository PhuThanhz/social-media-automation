package com.autopost.saas.service.telegram;

import com.autopost.saas.entity.PostQueue;
import com.autopost.saas.entity.SocialAccount;
import com.autopost.saas.entity.User;
import com.autopost.saas.repository.PostQueueRepository;
import com.autopost.saas.service.GeminiService;
import com.autopost.saas.service.telegram.TelegramApi.TelegramException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.ResourceAccessException;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.function.Function;
import java.util.stream.Collectors;

import static com.autopost.saas.service.telegram.TelegramApi.button;
import static com.autopost.saas.service.telegram.TelegramApi.esc;
import static com.autopost.saas.service.telegram.TelegramApi.keyboard;
import static com.autopost.saas.service.telegram.TelegramText.shorten;

/**
 * Soạn bài từ Telegram: link / chữ / ảnh-video gửi thẳng → bài nháp có xem trước, sửa caption, viết lại bằng AI,
 * chọn nhiều Trang + nhóm, ghi nguồn, nền màu → tạo bài qua /api/queue/add-from-urls (giống trang Đăng tự động).
 * Mọi thay đổi bài nháp đi qua các hàm synchronized; việc chậm (cào, AI, tải file) chạy ở support.jobs.
 */
@Component
@Slf4j
public class TelegramComposer {

    static final Set<String> CALLBACKS = Set.of("pp", "tp", "gp", "tg", "gc", "pk", "cr", "cb", "ai", "ed", "og", "rm", "mx", "go", "dx");
    private static final long MAX_PREVIEW_PHOTO_BYTES = 10L * 1024 * 1024;  // giới hạn upload ảnh của Bot API
    private static final long MAX_PREVIEW_VIDEO_BYTES = 49L * 1024 * 1024;  // giới hạn upload file của Bot API (50MB)
    private static final long MAX_PREVIEW_TOTAL_BYTES = 90L * 1024 * 1024;
    private static final int PICKER_PAGE_SIZE = 16;
    private static final long ALBUM_WAIT_MS = 2500;
    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("HH:mm dd/MM");

    private final TelegramApi api;
    private final TelegramConfigService config;
    private final TelegramSupport support;
    private final GeminiService gemini;
    private final PostQueueRepository postQueueRepository;

    private final Map<Long, TelegramDraft> drafts = new ConcurrentHashMap<>();
    private final Map<String, Album> albums = new ConcurrentHashMap<>();

    record FileRef(String fileId, long size, String ext) {
    }

    static final class Album {
        final List<FileRef> refs = new ArrayList<>();
        String caption;
        int skippedTooBig;
    }

    public TelegramComposer(TelegramApi api, TelegramConfigService config, TelegramSupport support,
                            GeminiService gemini, PostQueueRepository postQueueRepository) {
        this.api = api;
        this.config = config;
        this.support = support;
        this.gemini = gemini;
        this.postQueueRepository = postQueueRepository;
    }

    // ====================================================================== vào từ tin nhắn

    synchronized TelegramDraft current(long chatId) {
        TelegramDraft d = drafts.get(chatId);
        if (d != null && (d.expired() || d.submitted)) {
            drafts.remove(chatId);
            return null;
        }
        return d;
    }

    private static final long AWAIT_CAPTION_MS = 10 * 60_000;

    /** Đang chờ caption mới (hết sau 10 phút để tin gửi sau không bị nuốt nhầm làm caption). */
    synchronized boolean awaitingCaption(long chatId) {
        TelegramDraft d = current(chatId);
        if (d == null || d.awaitingCaptionFor == null) return false;
        if (System.currentTimeMillis() - d.awaitingSinceMs > AWAIT_CAPTION_MS) {
            d.awaitingCaptionFor = null;
            return false;
        }
        return true;
    }

    /** Gửi link mới khi đang chờ caption → coi là bài mới, thôi chờ caption. */
    synchronized void stopAwaitingCaption(long chatId) {
        TelegramDraft d = current(chatId);
        if (d != null) d.awaitingCaptionFor = null;
    }

    /** /huy: đang sửa caption thì chỉ thôi sửa; không thì bỏ cả bài nháp. null = không có gì để huỷ. */
    synchronized String cancel(String token, long chatId) {
        TelegramDraft d = current(chatId);
        if (d == null) return null;
        if (d.awaitingCaptionFor != null) {
            d.awaitingCaptionFor = null;
            return "Thôi sửa caption — bài nháp vẫn giữ.";
        }
        drafts.remove(chatId);
        if (d.panelMessageId != null) safeEdit(token, chatId, d.panelMessageId, "Đã huỷ bài nháp.", null);
        return "Đã huỷ bài nháp.";
    }

    synchronized void addLinks(String token, long chatId, List<String> urls) {
        TelegramDraft d = draftFor(chatId);
        if (!roomFor(token, chatId, d, urls.size())) return;
        List<TelegramDraft.Item> added = new ArrayList<>();
        for (String u : urls) {
            TelegramDraft.Item it = d.addItem(u);
            it.previewLoading = true;
            added.add(it);
        }
        showNewItems(token, chatId, d, added);
        for (TelegramDraft.Item it : added) {
            support.jobs.submit(() -> loadPreview(token, chatId, d, it));
        }
    }

    synchronized void addText(String token, long chatId, String text) {
        TelegramDraft d = draftFor(chatId);
        if (!roomFor(token, chatId, d, 1)) return;
        TelegramDraft.Item it = d.addItem(null);
        it.customCaption = text.trim();
        showNewItems(token, chatId, d, List.of(it));
    }

    synchronized void setCaption(String token, long chatId, String text) {
        TelegramDraft d = current(chatId);
        if (d == null || d.awaitingCaptionFor == null) return;
        TelegramDraft.Item it = d.item(d.awaitingCaptionFor);
        d.awaitingCaptionFor = null;
        d.touch();
        if (it == null) return;
        it.customCaption = text.trim();
        editPreview(token, chatId, d, it);
        refreshPanel(token, chatId, d, false);
        api.sendMessage(token, chatId, "Đã cập nhật caption Bài " + d.indexOf(it) + ".", null);
    }

    /** Ảnh / video / file ảnh-video gửi thẳng (kể cả album nhiều tin cùng media_group_id). */
    @SuppressWarnings("unchecked")
    void addMediaMessage(String token, long chatId, Map<String, Object> msg) {
        FileRef ref = fileRefOf(msg);
        String caption = msg.get("caption") instanceof String c ? c : null;
        Object groupId = msg.get("media_group_id");
        if (ref == null) {
            api.sendMessage(token, chatId, "Bot chỉ nhận ảnh hoặc video (gửi dạng ảnh/video hoặc file .jpg/.png/.mp4).", null);
            return;
        }
        boolean tooBig = ref.size() > TelegramApi.MAX_DOWNLOAD_BYTES;
        if (groupId == null) {
            if (tooBig) {
                api.sendMessage(token, chatId, tooBigText(1), null);
                return;
            }
            support.jobs.submit(() -> createMediaItem(token, chatId, List.of(ref), caption, 0));
            return;
        }
        String key = chatId + ":" + groupId;
        Album album = albums.computeIfAbsent(key, k -> {
            support.timers.schedule(() -> {
                Album done = albums.remove(k);
                if (done != null) support.jobs.submit(() -> createMediaItem(token, chatId, done.refs, done.caption, done.skippedTooBig));
            }, ALBUM_WAIT_MS, TimeUnit.MILLISECONDS);
            return new Album();
        });
        synchronized (album) {
            if (tooBig) album.skippedTooBig++;
            else album.refs.add(ref);
            if (caption != null && !caption.isBlank()) album.caption = caption;
        }
    }

    // ====================================================================== nút bấm

    /** Trả toast cho answerCallbackQuery (null = không hiện gì). */
    synchronized String onCallback(String token, long chatId, long messageId, String[] p) {
        TelegramDraft d = current(chatId);
        if (d == null) {
            safeEdit(token, chatId, messageId, "Bài nháp đã hết hạn hoặc đã gửi — gửi lại link/nội dung nhé.", null);
            return null;
        }
        d.touch();
        User user = support.botUser();
        switch (p[0]) {
            case "pp" -> showPagePicker(token, chatId, d, user, intAt(p, 1));
            case "tp" -> {
                long id = Long.parseLong(p[1]);
                if (!d.pageIds.remove(id)) d.pageIds.add(id);
                showPagePicker(token, chatId, d, user, intAt(p, 2));
            }
            case "gp" -> showGroupPicker(token, chatId, d, user, intAt(p, 1));
            case "tg" -> {
                long id = Long.parseLong(p[1]);
                if (!d.groupIds.remove(id)) d.groupIds.add(id);
                showGroupPicker(token, chatId, d, user, intAt(p, 2));
            }
            case "gc" -> {
                d.groupIds.clear();
                showGroupPicker(token, chatId, d, user, intAt(p, 1));
            }
            case "pk" -> refreshPanel(token, chatId, d, false);
            case "cr" -> {
                d.includeCredit = !d.includeCredit;
                refreshPanel(token, chatId, d, false);
            }
            case "cb" -> {
                d.colorBackground = !d.colorBackground;
                refreshPanel(token, chatId, d, false);
            }
            case "ai" -> {
                TelegramDraft.Item it = d.item(Integer.parseInt(p[1]));
                if (it == null) return "Bài này đã bị bỏ";
                if (it.previewLoading) return "Đang lấy nội dung, đợi chút rồi bấm lại";
                if (it.caption().isBlank()) return "Chưa có caption để viết lại";
                support.jobs.submit(() -> rewriteWithAi(token, chatId, d, it));
                return "Đang viết lại bằng AI…";
            }
            case "ed" -> {
                TelegramDraft.Item it = d.item(Integer.parseInt(p[1]));
                if (it == null) return "Bài này đã bị bỏ";
                d.awaitingCaptionFor = it.id;
                d.awaitingSinceMs = System.currentTimeMillis();
                api.sendMessage(token, chatId, "Gửi caption mới cho <b>Bài " + d.indexOf(it) + "</b> (gõ /huy để thôi).", null);
            }
            case "og" -> {
                TelegramDraft.Item it = d.item(Integer.parseInt(p[1]));
                if (it == null) return "Bài này đã bị bỏ";
                it.customCaption = null;
                editPreview(token, chatId, d, it);
            }
            case "mx" -> {
                TelegramDraft.Item it = d.item(Integer.parseInt(p[1]));
                if (it == null) return "Bài này đã bị bỏ";
                int idx = Integer.parseInt(p[2]);
                if (!it.toggleMedia(idx)) return "Phải giữ ít nhất 1 ảnh/video";
                editPreview(token, chatId, d, it);
                refreshPanel(token, chatId, d, false);
                return (it.removedMedia.contains(idx) ? "Đã bỏ " : "Đã lấy lại ") + (idx + 1);
            }
            case "rm" -> {
                TelegramDraft.Item it = d.item(Integer.parseInt(p[1]));
                if (it == null) return null;
                d.items.remove(it);
                if (it.previewMessageId != null) safeEdit(token, chatId, it.previewMessageId, "Đã bỏ bài này khỏi bài nháp.", null);
                if (d.items.isEmpty()) {
                    drafts.remove(chatId);
                    if (d.panelMessageId != null) safeEdit(token, chatId, d.panelMessageId, "Bài nháp trống — đã huỷ.", null);
                } else {
                    d.items.forEach(other -> editPreview(token, chatId, d, other)); // đánh lại số thứ tự
                    refreshPanel(token, chatId, d, false);
                }
            }
            case "go" -> {
                return submit(token, chatId, d, "N".equals(p[1]) ? "NOW" : "QUEUE");
            }
            case "dx" -> {
                drafts.remove(chatId);
                safeEdit(token, chatId, d.panelMessageId != null ? d.panelMessageId : messageId, "Đã huỷ bài nháp.", null);
            }
            default -> {
                return "Nút không còn hiệu lực";
            }
        }
        return null;
    }

    // ====================================================================== bài nháp

    private TelegramDraft draftFor(long chatId) {
        TelegramDraft d = current(chatId);
        if (d != null) {
            d.touch();
            return d;
        }
        d = new TelegramDraft();
        Set<Long> valid = support.postingPages(support.botUser()).stream().map(SocialAccount::getId).collect(Collectors.toSet());
        for (Long id : config.defaultPages()) {
            if (valid.contains(id)) d.pageIds.add(id);
        }
        if (d.pageIds.isEmpty()) {
            Long legacy = TelegramText.connectionIdOf(config.defaultTarget());
            if (legacy != null && valid.contains(legacy)) d.pageIds.add(legacy);
        }
        drafts.put(chatId, d);
        return d;
    }

    private boolean roomFor(String token, long chatId, TelegramDraft d, int more) {
        if (d.items.size() + more <= TelegramDraft.MAX_ITEMS) return true;
        api.sendMessage(token, chatId, "Bài nháp tối đa " + TelegramDraft.MAX_ITEMS + " bài (đang có " + d.items.size()
                + "). Đăng bớt rồi gửi tiếp nhé.", null);
        if (d.items.isEmpty()) drafts.remove(chatId);
        return false;
    }

    private void showNewItems(String token, long chatId, TelegramDraft d, List<TelegramDraft.Item> added) {
        for (TelegramDraft.Item it : added) {
            PreviewView v = previewView(d, it);
            it.previewMessageId = api.sendMessageId(token, chatId, v.text, v.markup);
        }
        refreshPanel(token, chatId, d, true);
    }

    private void loadPreview(String token, long chatId, TelegramDraft d, TelegramDraft.Item it) {
        String caption = null;
        List<String> media = List.of();
        List<String> kinds = List.of();
        String error = null;
        try {
            Map<String, Object> res = support.postLocal("/api/queue/preview-url", Map.of("url", it.url));
            if (res != null && Boolean.TRUE.equals(res.get("success")) && res.get("item") instanceof Map<?, ?> item) {
                Object content = item.get("content") != null ? item.get("content") : item.get("title");
                caption = content != null ? String.valueOf(content) : "";
                if (item.get("mediaUrls") instanceof List<?> l) media = l.stream().map(String::valueOf).toList();
                if (item.get("mediaKinds") instanceof List<?> k) kinds = k.stream().map(x -> x == null ? null : String.valueOf(x)).toList();
            } else {
                error = res != null && res.get("message") != null ? String.valueOf(res.get("message")) : "không cào được";
            }
        } catch (HttpStatusCodeException e) {
            error = TelegramSupport.errorMessageOf(e);
        } catch (Exception e) {
            error = e.getMessage();
        }
        log.info("[Telegram] Xem trước {} → {}", shorten(it.url, 60), error != null ? "lỗi: " + shorten(error, 150)
                : (caption != null ? caption.length() : 0) + " ký tự, " + media.size() + " media");
        applyPreview(token, chatId, d, it, caption, media, kinds, error);
    }

    private synchronized void applyPreview(String token, long chatId, TelegramDraft d, TelegramDraft.Item it,
                                           String caption, List<String> media, List<String> kinds, String error) {
        it.previewLoading = false;
        it.scrapedCaption = caption;
        it.scrapedMedia = media;
        it.scrapedKinds = kinds;
        it.previewError = error;
        if (d.items.contains(it)) editPreview(token, chatId, d, it);
        if (!media.isEmpty() && d.items.contains(it)) support.jobs.submit(() -> sendMediaPreview(token, chatId, d, it));
    }

    /** Gửi ảnh/video thật của bài vào chat (album, đánh số) để kiểm tra trước khi đăng — giống bước xem lại trên web. */
    private void sendMediaPreview(String token, long chatId, TelegramDraft d, TelegramDraft.Item it) {
        List<String> media;
        List<Boolean> videoFlags = new ArrayList<>();
        int number;
        synchronized (this) {
            if (!d.items.contains(it) || d.submitted) return;
            media = new ArrayList<>(it.allMedia());
            for (int i = 0; i < media.size(); i++) videoFlags.add(it.isVideo(i));
            number = d.indexOf(it);
        }
        List<TelegramApi.Upload> uploads = new ArrayList<>();
        List<String> problems = new ArrayList<>();
        long total = 0;
        for (int i = 0; i < media.size() && i < 10; i++) {
            String url = media.get(i);
            boolean video = videoFlags.get(i);
            try {
                TelegramSupport.Fetched f = support.fetchMedia(url, video ? MAX_PREVIEW_VIDEO_BYTES : MAX_PREVIEW_PHOTO_BYTES);
                String ct = f.contentType().toLowerCase(Locale.ROOT);
                if (ct.startsWith("video/")) video = true;
                else if (ct.startsWith("image/")) video = false;
                if (!video && f.data().length > MAX_PREVIEW_PHOTO_BYTES) throw new IllegalStateException("ảnh quá lớn");
                if (total + f.data().length > MAX_PREVIEW_TOTAL_BYTES) {
                    problems.add((i + 1) + ": bỏ qua vì tổng dung lượng lớn");
                    continue;
                }
                total += f.data().length;
                uploads.add(new TelegramApi.Upload(video ? "video" : "photo", f.data(),
                        "m" + (i + 1) + "." + (video ? "mp4" : "jpg"), "Bài " + number + " · " + (i + 1) + "/" + media.size()));
            } catch (Exception e) {
                problems.add((i + 1) + ": " + shorten(e.getMessage(), 60));
            }
        }
        if (media.size() > 10) problems.add("chỉ xem trước 10/" + media.size());
        int sent = 0;
        if (!uploads.isEmpty()) {
            try {
                api.sendMedia(token, chatId, uploads);
                sent = uploads.size();
            } catch (TelegramException e) {
                // album lỗi (thường do 1 file Telegram không nhận) → gửi lẻ từng cái để vẫn xem được phần còn lại
                for (TelegramApi.Upload u : uploads) {
                    try {
                        api.sendMedia(token, chatId, List.of(u));
                        sent++;
                    } catch (TelegramException single) {
                        problems.add(u.caption() + ": Telegram không nhận");
                    }
                }
            }
        }
        log.info("[Telegram] Xem trước media bài {}: gửi {}/{}{}", number, sent, media.size(),
                problems.isEmpty() ? "" : " — " + String.join("; ", problems));
        synchronized (this) {
            it.mediaShown = sent > 0;
            it.mediaNote = problems.isEmpty() ? null : String.join("; ", problems);
            if (!d.items.contains(it) || d.submitted) return;
            editPreview(token, chatId, d, it);
            refreshPanel(token, chatId, d, true); // bảng điều khiển xuống dưới album
        }
    }

    private void rewriteWithAi(String token, long chatId, TelegramDraft d, TelegramDraft.Item it) {
        String source;
        synchronized (this) {
            source = it.caption();
        }
        try {
            String rewritten = gemini.rewriteCaption(source);
            synchronized (this) {
                if (!d.items.contains(it) || d.submitted) return;
                it.customCaption = rewritten.trim();
                editPreview(token, chatId, d, it);
                refreshPanel(token, chatId, d, false);
            }
        } catch (Exception e) {
            log.warn("[Telegram] AI viết lại lỗi: {}", e.getMessage());
            api.sendMessage(token, chatId, "AI không viết lại được: " + esc(shorten(e.getMessage(), 200)), null);
        }
    }

    private void createMediaItem(String token, long chatId, List<FileRef> refs, String caption, int skippedTooBig) {
        if (skippedTooBig > 0) api.sendMessage(token, chatId, tooBigText(skippedTooBig), null);
        if (refs.isEmpty()) return;
        List<String> urls = new ArrayList<>();
        List<String> kinds = new ArrayList<>();
        try {
            Path dir = Paths.get("uploads").toAbsolutePath().normalize();
            Files.createDirectories(dir);
            for (FileRef ref : refs.stream().limit(10).toList()) {
                byte[] data = api.downloadFile(token, api.getFilePath(token, ref.fileId()));
                String name = "tg_" + UUID.randomUUID().toString().replace("-", "") + "." + ref.ext();
                Files.write(dir.resolve(name), data);
                urls.add("http://localhost:" + support.serverPort() + "/uploads/" + name);
                kinds.add(ref.ext().matches("mp4|mov|webm|mkv|avi|m4v") ? "video" : "image");
            }
            log.info("[Telegram] Đã tải {} file từ Telegram vào uploads/", urls.size());
        } catch (Exception e) {
            log.warn("[Telegram] Tải media lỗi: {}", e.getMessage());
            api.sendMessage(token, chatId, "Không tải được ảnh/video từ Telegram: " + esc(shorten(e.getMessage(), 200)), null);
            return;
        }
        synchronized (this) {
            TelegramDraft d = draftFor(chatId);
            if (!roomFor(token, chatId, d, 1)) return;
            TelegramDraft.Item it = d.addItem(null);
            it.media.addAll(urls);
            it.mediaKinds.addAll(kinds);
            it.customCaption = caption != null ? caption.trim() : "";
            showNewItems(token, chatId, d, List.of(it));
        }
    }

    private String submit(String token, long chatId, TelegramDraft d, String mode) {
        String err = d.validate();
        if (err != null) return err;
        User user = support.botUser();
        Map<Long, SocialAccount> pages = support.postingPages(user).stream()
                .collect(Collectors.toMap(SocialAccount::getId, a -> a, (a, b) -> a));
        Map<Long, SocialAccount> groups = support.groups(user).stream()
                .collect(Collectors.toMap(SocialAccount::getId, a -> a, (a, b) -> a));
        d.pageIds.removeIf(id -> !pages.containsKey(id));
        if (d.pageIds.isEmpty()) return "Các Trang đã chọn không còn — chọn lại";
        Function<Long, String> pageTarget = id -> TelegramSupport.targetValue(pages.get(id));
        Function<Long, String> groupId = id -> groups.containsKey(id) ? groups.get(id).getPlatformAccountId() : null;
        Map<String, Object> payload = d.buildPayload(pageTarget, groupId, mode);
        String pageNames = d.pageIds.stream().map(id -> TelegramSupport.label(pages.get(id))).collect(Collectors.joining(", "));
        int count = d.postCount();
        d.submitted = true;
        drafts.remove(chatId);
        config.setDefaultPages(new ArrayList<>(d.pageIds));
        config.setDefaultTarget(pageTarget.apply(d.pageIds.iterator().next()));
        safeEdit(token, chatId, d.panelMessageId, "Đang thêm " + count + " lượt đăng lên " + esc(pageNames) + " ("
                + ("NOW".equals(mode) ? "đăng ngay" : "nối đuôi hàng đợi") + ")…", null);
        log.info("[Telegram] Gửi bài nháp: {} bài × {} Trang, {} nhóm, mode {}", d.items.size(), d.pageIds.size(), d.groupIds.size(), mode);
        support.jobs.submit(() -> sendPayload(token, chatId, payload, pageNames));
        return "Đang gửi…";
    }

    private void sendPayload(String token, long chatId, Map<String, Object> payload, String pageNames) {
        Map<String, Object> res;
        try {
            res = support.postLocal("/api/queue/add-from-urls", payload);
        } catch (HttpStatusCodeException e) {
            log.warn("[Telegram] add-from-urls lỗi: {}", TelegramSupport.errorMessageOf(e));
            api.sendMessage(token, chatId, "Không thêm được: " + esc(shorten(TelegramSupport.errorMessageOf(e), 400)), null);
            return;
        } catch (ResourceAccessException e) {
            log.warn("[Telegram] add-from-urls quá lâu: {}", e.getMessage());
            api.sendMessage(token, chatId, "Backend xử lý lâu quá (vẫn có thể đang chạy). Kiểm tra lại bằng /lich.", null);
            return;
        } catch (Exception e) {
            api.sendMessage(token, chatId, "Không thêm được: " + esc(shorten(e.getMessage(), 300)), null);
            return;
        }
        if (res == null || Boolean.FALSE.equals(res.get("success"))) {
            api.sendMessage(token, chatId, "Không thêm được: " + esc(res != null ? String.valueOf(res.get("message")) : "phản hồi rỗng"), null);
            return;
        }
        List<Long> ids = new ArrayList<>();
        if (res.get("items") instanceof List<?> list) {
            for (Object o : list) {
                if (o instanceof Map<?, ?> m && m.get("id") != null) ids.add(TelegramSupport.num(m.get("id")));
            }
        }
        config.watch(ids, chatId);
        log.info("[Telegram] Đã tạo {} bài từ bot: {}", ids.size(), ids);
        Map<Long, String> names = support.accountNames(support.botUser());
        StringBuilder sb = new StringBuilder("<b>Đã thêm ").append(ids.size()).append(" bài</b> → ").append(esc(pageNames)).append('\n');
        if (res.get("message") instanceof String m && !m.isBlank()) sb.append(esc(m)).append('\n');
        List<PostQueue> created = new ArrayList<>(postQueueRepository.findAllById(ids));
        created.sort(Comparator.comparing(PostQueue::getScheduledAt, Comparator.nullsLast(Comparator.naturalOrder())));
        for (PostQueue p : created.stream().limit(12).toList()) {
            sb.append("<code>").append(p.getScheduledAt() != null ? p.getScheduledAt().format(TIME) : "--:--").append("</code> ")
                    .append(esc(shorten(TelegramBotService.pageOf(p, names), 22))).append(" · ")
                    .append(esc(shorten(TelegramBotService.titleOf(p), 40)))
                    .append(p.getTargetGroupNames() != null && !p.getTargetGroupNames().isBlank() ? " + nhóm" : "").append('\n');
        }
        if (!ids.isEmpty()) sb.append("\nBot sẽ nhắn khi từng bài đăng xong hoặc lỗi.");
        api.sendMessage(token, chatId, sb.toString(), null);
    }

    // ====================================================================== giao diện

    record PreviewView(String text, Object markup) {
    }

    PreviewView previewView(TelegramDraft d, TelegramDraft.Item it) {
        StringBuilder sb = new StringBuilder("<b>Bài ").append(d.indexOf(it)).append("</b>");
        if (it.manual()) sb.append(" · tự soạn");
        else sb.append(" · <a href=\"").append(esc(it.url).replace("\"", "&quot;")).append("\">link gốc</a>");
        List<String> media = it.allMedia();
        String mediaText = mediaSummary(it);
        if (!mediaText.isEmpty()) {
            sb.append(" · ").append(mediaText);
            if (!it.removedMedia.isEmpty()) {
                sb.append(" · <b>đã bỏ ").append(it.removedMedia.stream().map(i -> String.valueOf(i + 1))
                        .collect(Collectors.joining(", "))).append("</b>");
            }
        }
        sb.append('\n');
        if (it.mediaShown) sb.append("<i>Ảnh/video của bài ở ngay bên dưới (đánh số theo thứ tự đăng).</i>\n");
        if (it.mediaNote != null) sb.append("<i>Không xem trước được: ").append(esc(shorten(it.mediaNote, 200))).append("</i>\n");
        if (it.previewLoading) {
            sb.append("<i>Đang lấy nội dung…</i>");
        } else {
            if (it.previewError != null && it.customCaption == null) {
                sb.append("<i>Không xem trước được (").append(esc(shorten(it.previewError, 120)))
                        .append("). Vẫn đăng được — nội dung sẽ lấy lúc đăng.</i>\n");
            }
            if (it.customCaption != null && !it.manual()) sb.append("<i>Caption đã sửa</i>\n");
            String caption = it.caption();
            if (!caption.isBlank()) sb.append("<blockquote>").append(esc(shorten(caption, 900))).append("</blockquote>");
            else if (it.previewError == null) sb.append("<i>(không có caption)</i>");
        }
        List<List<Map<String, Object>>> rows = new ArrayList<>();
        rows.add(List.of(button("Viết lại bằng AI", "ai:" + it.id), button("Sửa caption", "ed:" + it.id)));
        List<Map<String, Object>> row2 = new ArrayList<>();
        if (it.customCaption != null && !it.manual()) row2.add(button("Dùng caption gốc", "og:" + it.id));
        if (d.items.size() > 1) row2.add(button("Bỏ bài này", "rm:" + it.id));
        if (!row2.isEmpty()) rows.add(row2);
        if (!it.previewLoading && media.size() > 1) {
            List<Map<String, Object>> row = new ArrayList<>();
            for (int i = 0; i < media.size() && i < 10; i++) {
                row.add(button((it.removedMedia.contains(i) ? "Lấy lại " : "Bỏ ") + (i + 1), "mx:" + it.id + ":" + i));
                if (row.size() == 5) {
                    rows.add(row);
                    row = new ArrayList<>();
                }
            }
            if (!row.isEmpty()) rows.add(row);
        }
        return new PreviewView(sb.toString(), keyboard(rows));
    }

    static String mediaSummary(TelegramDraft.Item it) {
        int n = it.allMedia().size();
        long videos = java.util.stream.IntStream.range(0, n).filter(it::isVideo).count();
        return mediaSummary(n - videos, videos);
    }

    static String mediaSummary(List<String> media) {
        if (media == null || media.isEmpty()) return "";
        long videos = media.stream().filter(TelegramComposer::isVideoUrl).count();
        return mediaSummary(media.size() - videos, videos);
    }

    private static String mediaSummary(long images, long videos) {
        List<String> parts = new ArrayList<>();
        if (images > 0) parts.add(images + " ảnh");
        if (videos > 0) parts.add(videos + " video");
        return String.join(", ", parts);
    }

    static boolean isVideoUrl(String u) {
        return TelegramDraft.looksLikeVideoUrl(u);
    }

    String panelText(TelegramDraft d, Map<Long, SocialAccount> pages, Map<Long, SocialAccount> groups) {
        StringBuilder sb = new StringBuilder("<b>Bài nháp</b> — ").append(d.items.size()).append(" bài");
        if (d.pageIds.size() > 1) sb.append(" × ").append(d.pageIds.size()).append(" Trang = ").append(d.postCount()).append(" lượt đăng");
        sb.append("\nTrang: ");
        if (d.pageIds.isEmpty()) sb.append("<i>chưa chọn</i>");
        else sb.append(esc(d.pageIds.stream().map(id -> pages.containsKey(id) ? TelegramSupport.label(pages.get(id)) : "#" + id)
                .collect(Collectors.joining(", "))));
        sb.append("\nNhóm: ");
        if (d.groupIds.isEmpty()) {
            sb.append("không");
        } else {
            sb.append(esc(d.groupIds.stream().map(id -> groups.containsKey(id) ? TelegramSupport.label(groups.get(id)) : "#" + id)
                    .collect(Collectors.joining(", "))));
            if (!d.pageIds.isEmpty() && pages.containsKey(d.pageIds.iterator().next())) {
                sb.append(" (đăng dưới tên ").append(esc(TelegramSupport.label(pages.get(d.pageIds.iterator().next())))).append(')');
            }
        }
        if (d.hasLinks()) sb.append("\nGhi nguồn: ").append(d.includeCredit ? "bật" : "tắt");
        if (d.colorBackgroundAllowed()) sb.append("\nNền màu: ").append(d.colorBackground ? "bật" : "tắt");
        String err = d.validate();
        if (err != null) sb.append("\n\n<i>").append(esc(err)).append("</i>");
        return sb.toString();
    }

    Object panelMarkup(TelegramDraft d) {
        List<List<Map<String, Object>>> rows = new ArrayList<>();
        rows.add(List.of(button("Trang (" + d.pageIds.size() + ")", "pp:0"), button("Nhóm (" + d.groupIds.size() + ")", "gp:0")));
        List<Map<String, Object>> opts = new ArrayList<>();
        if (d.hasLinks()) opts.add(button("Ghi nguồn: " + (d.includeCredit ? "bật" : "tắt"), "cr"));
        if (d.colorBackgroundAllowed()) opts.add(button("Nền màu: " + (d.colorBackground ? "bật" : "tắt"), "cb"));
        if (!opts.isEmpty()) rows.add(opts);
        if (d.validate() == null) rows.add(List.of(button("Đăng ngay", "go:N"), button("Nối đuôi hàng đợi", "go:Q")));
        rows.add(List.of(button("Huỷ nháp", "dx")));
        return keyboard(rows);
    }

    private void refreshPanel(String token, long chatId, TelegramDraft d, boolean moveToBottom) {
        User user = support.botUser();
        Map<Long, SocialAccount> pages = support.postingPages(user).stream().collect(Collectors.toMap(SocialAccount::getId, a -> a, (a, b) -> a));
        Map<Long, SocialAccount> groups = support.groups(user).stream().collect(Collectors.toMap(SocialAccount::getId, a -> a, (a, b) -> a));
        String text = panelText(d, pages, groups);
        Object markup = panelMarkup(d);
        if (d.panelMessageId != null && !moveToBottom) {
            safeEdit(token, chatId, d.panelMessageId, text, markup);
            return;
        }
        if (d.panelMessageId != null) safeEdit(token, chatId, d.panelMessageId, "Bảng điều khiển đã chuyển xuống dưới.", null);
        d.panelMessageId = api.sendMessageId(token, chatId, text, markup);
    }

    private void editPreview(String token, long chatId, TelegramDraft d, TelegramDraft.Item it) {
        if (it.previewMessageId == null) return;
        PreviewView v = previewView(d, it);
        safeEdit(token, chatId, it.previewMessageId, v.text, v.markup);
    }

    private void showPagePicker(String token, long chatId, TelegramDraft d, User user, int page) {
        List<SocialAccount> all = support.postingPages(user);
        StringBuilder sb = new StringBuilder("<b>Chọn Trang</b> (bấm để bật/tắt) — đã chọn ").append(d.pageIds.size());
        if (!d.pageIds.isEmpty()) sb.append("\nTrang đầu tiên cũng là Trang đăng vào nhóm.");
        picker(token, chatId, d, all, page, d.pageIds, "tp", "pp", sb.toString(), a ->
                "EXPIRED".equalsIgnoreCase(a.getTokenStatus()) ? " (hết hạn)" : "", null);
    }

    private void showGroupPicker(String token, long chatId, TelegramDraft d, User user, int page) {
        List<SocialAccount> all = support.groups(user);
        if (all.isEmpty()) {
            safeEdit(token, chatId, d.panelMessageId, "Chưa có nhóm Facebook nào trong Kết nối.", keyboard(List.of(List.of(button("Quay lại", "pk")))));
            return;
        }
        StringBuilder sb = new StringBuilder("<b>Chọn nhóm</b> (bấm để bật/tắt) — đã chọn ").append(d.groupIds.size())
                .append("\nMỗi nhóm nhận 1 bài, đăng dưới tên Trang đầu tiên đã chọn.");
        picker(token, chatId, d, all, page, d.groupIds, "tg", "gp", sb.toString(), a -> switch (String.valueOf(a.getGroupHealthStatus())) {
            case "PENDING_APPROVAL" -> " (chờ duyệt)";
            case "KICKED_OR_NOT_JOINED" -> " (chưa vào)";
            case "PRIVATE_NO_ACCESS" -> " (không vào được)";
            default -> "";
        }, d.groupIds.isEmpty() ? null : button("Bỏ chọn hết", "gc:" + page));
    }

    private void picker(String token, long chatId, TelegramDraft d, List<SocialAccount> all, int page, Set<Long> selected,
                        String toggleCmd, String pageCmd, String header, Function<SocialAccount, String> suffix,
                        Map<String, Object> extraButton) {
        int pages = Math.max(1, (all.size() + PICKER_PAGE_SIZE - 1) / PICKER_PAGE_SIZE);
        int pg = Math.max(0, Math.min(page, pages - 1));
        List<SocialAccount> slice = all.subList(pg * PICKER_PAGE_SIZE, Math.min(all.size(), (pg + 1) * PICKER_PAGE_SIZE));
        List<List<Map<String, Object>>> rows = new ArrayList<>();
        List<Map<String, Object>> row = new ArrayList<>();
        for (SocialAccount a : slice) {
            String text = (selected.contains(a.getId()) ? "✓ " : "") + shorten(TelegramSupport.label(a), 22) + suffix.apply(a);
            row.add(button(text, toggleCmd + ":" + a.getId() + ":" + pg));
            if (row.size() == 2) {
                rows.add(row);
                row = new ArrayList<>();
            }
        }
        if (!row.isEmpty()) rows.add(row);
        List<Map<String, Object>> nav = new ArrayList<>();
        if (pg > 0) nav.add(button("‹ Trước", pageCmd + ":" + (pg - 1)));
        if (pages > 1) nav.add(button((pg + 1) + "/" + pages, pageCmd + ":" + pg));
        if (pg < pages - 1) nav.add(button("Sau ›", pageCmd + ":" + (pg + 1)));
        if (!nav.isEmpty()) rows.add(nav);
        List<Map<String, Object>> last = new ArrayList<>();
        if (extraButton != null) last.add(extraButton);
        last.add(button("Xong", "pk"));
        rows.add(last);
        safeEdit(token, chatId, d.panelMessageId, header, keyboard(rows));
    }

    // ====================================================================== tiện ích

    @SuppressWarnings("unchecked")
    static FileRef fileRefOf(Map<String, Object> msg) {
        if (msg.get("photo") instanceof List<?> sizes && !sizes.isEmpty()) {
            Map<String, Object> best = null;
            for (Object o : sizes) {
                if (o instanceof Map<?, ?> m) {
                    Map<String, Object> mm = (Map<String, Object>) m;
                    if (best == null || TelegramSupport.num(mm.get("width")) * TelegramSupport.num(mm.get("height"))
                            > TelegramSupport.num(best.get("width")) * TelegramSupport.num(best.get("height"))) best = mm;
                }
            }
            if (best != null) return new FileRef(String.valueOf(best.get("file_id")), TelegramSupport.num(best.get("file_size")), "jpg");
        }
        if (msg.get("video") instanceof Map<?, ?> v) {
            Map<String, Object> vm = (Map<String, Object>) v;
            return new FileRef(String.valueOf(vm.get("file_id")), TelegramSupport.num(vm.get("file_size")), extOf(null, (String) vm.get("mime_type"), "mp4"));
        }
        if (msg.get("document") instanceof Map<?, ?> doc) {
            Map<String, Object> dm = (Map<String, Object>) doc;
            String mime = dm.get("mime_type") instanceof String s ? s : "";
            if (mime.startsWith("image/") || mime.startsWith("video/")) {
                return new FileRef(String.valueOf(dm.get("file_id")), TelegramSupport.num(dm.get("file_size")),
                        extOf((String) dm.get("file_name"), mime, mime.startsWith("video/") ? "mp4" : "jpg"));
            }
        }
        return null;
    }

    static boolean hasMedia(Map<String, Object> msg) {
        return msg.get("photo") != null || msg.get("video") != null || msg.get("document") != null;
    }

    static String extOf(String fileName, String mime, String fallback) {
        if (fileName != null) {
            int dot = fileName.lastIndexOf('.');
            if (dot >= 0) {
                String e = fileName.substring(dot + 1).toLowerCase(Locale.ROOT);
                if (e.matches("[a-z0-9]{2,5}")) return e;
            }
        }
        if (mime != null) {
            String m = mime.toLowerCase(Locale.ROOT);
            if (m.endsWith("/jpeg")) return "jpg";
            if (m.endsWith("/png")) return "png";
            if (m.endsWith("/webp")) return "webp";
            if (m.endsWith("/quicktime")) return "mov";
            if (m.endsWith("/mp4")) return "mp4";
        }
        return fallback;
    }

    private static String tooBigText(int n) {
        return (n > 1 ? n + " file" : "File") + " lớn hơn 20MB — Telegram không cho bot tải file lớn. "
                + "Gửi link bài gốc, hoặc nén video nhỏ lại rồi gửi.";
    }

    private static int intAt(String[] p, int i) {
        try {
            return p.length > i ? Integer.parseInt(p[i]) : 0;
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private void safeEdit(String token, long chatId, Long messageId, String text, Object markup) {
        if (messageId == null) return;
        try {
            api.editMessage(token, chatId, messageId, text, markup);
        } catch (TelegramException e) {
            log.debug("[Telegram] edit {}: {}", messageId, e.getMessage());
        }
    }
}
