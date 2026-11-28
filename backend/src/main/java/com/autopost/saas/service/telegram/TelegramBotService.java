package com.autopost.saas.service.telegram;

import com.autopost.saas.entity.PostQueue;
import com.autopost.saas.entity.SocialAccount;
import com.autopost.saas.entity.User;
import com.autopost.saas.repository.PostQueueRepository;
import com.autopost.saas.repository.SocialAccountRepository;
import com.autopost.saas.repository.UserRepository;
import com.autopost.saas.service.NickThrottleService;
import com.autopost.saas.service.PostQueueService;
import com.autopost.saas.service.SocialAccountService;
import com.autopost.saas.service.telegram.TelegramApi.TelegramException;
import com.autopost.saas.util.LocalServices;
import com.autopost.saas.util.PooledRestTemplateFactory;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestTemplate;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Collectors;

import static com.autopost.saas.service.telegram.TelegramApi.button;
import static com.autopost.saas.service.telegram.TelegramApi.esc;
import static com.autopost.saas.service.telegram.TelegramApi.keyboard;
import static com.autopost.saas.service.telegram.TelegramText.shorten;

/**
 * Bot Telegram điều khiển tool: long polling getUpdates trên 1 thread riêng (không chiếm pool @Scheduled),
 * chỉ nhận lệnh từ chat đã ghép nối. Tạo bài bằng cách gọi lại đúng endpoint của web qua loopback
 * (/api/queue/add-from-urls, /api/threads/bulk) nên hành vi y như bấm trên giao diện.
 */
@Service
@Slf4j
public class TelegramBotService {

    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("HH:mm dd/MM");
    private static final DateTimeFormatter HOUR = DateTimeFormatter.ofPattern("HH:mm");
    private static final int MAX_LINKS = 20;
    private static final long STATE_TTL_MS = 15 * 60_000;
    /** Tin cũ hơn mốc này (VD backend tắt lâu) thì bỏ qua để không tự đăng link đã nguội. */
    private static final long MAX_MESSAGE_AGE_SECONDS = 15 * 60;
    private static final int MAX_PAIR_ATTEMPTS = 5;
    static final String THREADS_ACCOUNT_TYPE = "THREADS_COOKIE";

    private final TelegramConfigService config;
    private final TelegramApi api;
    private final PostQueueService postQueueService;
    private final PostQueueRepository postQueueRepository;
    private final SocialAccountRepository socialAccountRepository;
    private final SocialAccountService socialAccountService;
    private final NickThrottleService nickThrottleService;
    private final TelegramSupport support;
    private final TelegramComposer composer;
    private final Map<Long, ChatState> states = new ConcurrentHashMap<>();
    private final AtomicInteger failedPairAttempts = new AtomicInteger();

    private volatile boolean running;
    private volatile Thread poller;
    private volatile String lastError;
    private volatile long lastPollOkMs;
    private volatile String commandsSetForToken;

    static final class ChatState {
        final List<String> urls;
        final boolean threads;
        final long createdAtMs = System.currentTimeMillis();
        String target;          // FB: "pageId:TYPE:connId"
        Long threadsAccountId;  // Threads: id nick
        String label;

        ChatState(List<String> urls, boolean threads) {
            this.urls = urls;
            this.threads = threads;
        }

        boolean expired() {
            return System.currentTimeMillis() - createdAtMs > STATE_TTL_MS;
        }
    }

    public TelegramBotService(TelegramConfigService config, TelegramApi api, PostQueueService postQueueService,
                              PostQueueRepository postQueueRepository, SocialAccountRepository socialAccountRepository,
                              SocialAccountService socialAccountService, NickThrottleService nickThrottleService,
                              TelegramSupport support, TelegramComposer composer) {
        this.config = config;
        this.api = api;
        this.postQueueService = postQueueService;
        this.postQueueRepository = postQueueRepository;
        this.socialAccountRepository = socialAccountRepository;
        this.socialAccountService = socialAccountService;
        this.nickThrottleService = nickThrottleService;
        this.support = support;
        this.composer = composer;
    }

    // ====================================================================== vòng polling

    @EventListener(ApplicationReadyEvent.class)
    public synchronized void start() {
        if (poller != null && poller.isAlive()) return;
        running = true;
        poller = new Thread(this::pollLoop, "telegram-poller");
        poller.setDaemon(true);
        poller.start();
        log.info("[Telegram] Bot poller đã khởi động (bật/tắt trong Kết nối → Telegram bot).");
    }

    @PreDestroy
    public void stop() {
        running = false;
        Thread t = poller;
        if (t != null) t.interrupt();
        support.shutdown();
    }

    public Map<String, Object> status() {
        Map<String, Object> m = new LinkedHashMap<>();
        boolean enabled = config.isEnabled() && config.token() != null;
        m.put("running", enabled && poller != null && poller.isAlive());
        m.put("lastError", lastError);
        m.put("lastPollOkAt", lastPollOkMs > 0 ? new Date(lastPollOkMs).toInstant().toString() : null);
        return m;
    }

    private void pollLoop() {
        while (running) {
            String token = config.token();
            if (!config.isEnabled() || token == null) {
                lastError = null;
                sleep(5_000);
                continue;
            }
            try {
                ensureCommands(token);
                Long last = config.lastUpdateId();
                List<Map<String, Object>> updates = api.getUpdates(token, last != null ? last + 1 : null, 25);
                lastError = null;
                lastPollOkMs = System.currentTimeMillis();
                for (Map<String, Object> u : updates) {
                    long updateId = num(u.get("update_id"));
                    // Ghi offset TRƯỚC khi xử lý: crash giữa chừng thì bỏ tin đó chứ không tạo bài 2 lần.
                    config.setLastUpdateId(updateId);
                    try {
                        handleUpdate(token, u);
                    } catch (Exception e) {
                        log.warn("[Telegram] Lỗi xử lý update {}: {}", updateId, TelegramApi.sanitize(e.getMessage(), token));
                    }
                }
            } catch (TelegramException e) {
                lastError = e.getMessage();
                int status = e.status();
                log.warn("[Telegram] getUpdates: {}", e.getMessage());
                // 401/404 = token sai; 409 = có tiến trình khác cũng đang poll cùng bot
                sleep(status == 401 || status == 404 ? 60_000 : status == 409 ? 15_000 : 10_000);
            } catch (Exception e) {
                lastError = TelegramApi.sanitize(e.getMessage(), token);
                sleep(10_000);
            }
        }
    }

    private void ensureCommands(String token) {
        if (token.equals(commandsSetForToken)) return;
        try {
            api.setMyCommands(token, List.of(
                    new String[]{"lich", "Bài sắp đăng"},
                    new String[]{"hangdoi", "Thống kê hàng đợi"},
                    new String[]{"loi", "Bài lỗi: thử lại / xoá"},
                    new String[]{"nick", "Tạm dừng / chạy lại nick"},
                    new String[]{"huy", "Huỷ thao tác đang dở"},
                    new String[]{"help", "Hướng dẫn"}));
            commandsSetForToken = token;
        } catch (TelegramException e) {
            log.debug("[Telegram] setMyCommands: {}", e.getMessage());
        }
    }

    private static void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    // ====================================================================== router

    @SuppressWarnings("unchecked")
    void handleUpdate(String token, Map<String, Object> update) {
        if (update.get("callback_query") instanceof Map<?, ?> cb) {
            handleCallback(token, (Map<String, Object>) cb);
            return;
        }
        if (!(update.get("message") instanceof Map<?, ?> rawMsg)) return;
        Map<String, Object> msg = (Map<String, Object>) rawMsg;
        Map<String, Object> chat = (Map<String, Object>) msg.get("chat");
        if (chat == null) return;
        long chatId = num(chat.get("id"));
        String text = msg.get("text") instanceof String s ? s : null;
        boolean media = TelegramComposer.hasMedia(msg);
        if (text == null && !media) return;
        long date = num(msg.get("date"));
        if (date > 0 && System.currentTimeMillis() / 1000 - date > MAX_MESSAGE_AGE_SECONDS) {
            log.info("[Telegram] Bỏ qua tin cũ ({}s) từ chat {}", System.currentTimeMillis() / 1000 - date, chatId);
            return;
        }
        TelegramText.Command cmd = TelegramText.parseCommand(text);

        if (!config.isAllowed(chatId)) {
            log.info("[Telegram] Tin từ chat chưa ghép {} ({}) — {}", chatId, media ? "ảnh/video" : "chữ",
                    cmd != null ? "/" + cmd.name() : "bỏ qua");
            handleUnpaired(token, chatId, chat, cmd);
            return;
        }
        log.info("[Telegram] chat {} gửi: {}", chatId, media ? "ảnh/video" + (msg.get("media_group_id") != null ? " (album)" : "")
                : cmd != null ? "/" + cmd.name()
                : composer.awaitingCaption(chatId) && !TelegramText.isOnlyUrls(text) ? "caption mới (" + text.length() + " ký tự)"
                : TelegramText.extractUrls(text).isEmpty() ? "chữ (" + text.length() + " ký tự)"
                : TelegramText.extractUrls(text).size() + " link");
        if (media) {
            composer.addMediaMessage(token, chatId, msg);
            return;
        }

        if (cmd != null) {
            switch (cmd.name()) {
                case "start", "help" -> send(token, chatId, helpText(), null);
                case "lich" -> send(token, chatId, scheduleText(), keyboard(List.of(List.of(button("Làm mới", "lich")))));
                case "hangdoi" -> send(token, chatId, queueStatsText(), null);
                case "loi" -> sendFailures(token, chatId);
                case "nick" -> {
                    NickView v = nickView();
                    send(token, chatId, v.text, v.markup);
                }
                case "huy" -> {
                    boolean hadThreads = states.remove(chatId) != null;
                    String draftMsg = composer.cancel(token, chatId);
                    send(token, chatId, draftMsg != null ? draftMsg : (hadThreads ? "Đã huỷ thao tác đang dở." : "Không có gì đang dở."), null);
                }
                default -> send(token, chatId, "Không hiểu lệnh /" + esc(cmd.name()) + ". Gõ /help để xem lệnh.", null);
            }
            return;
        }

        if (composer.awaitingCaption(chatId)) {
            if (!TelegramText.isOnlyUrls(text)) {
                composer.setCaption(token, chatId, text);
                return;
            }
            composer.stopAwaitingCaption(chatId); // tin chỉ có link = bài mới, không phải caption
        }
        List<String> urls = TelegramText.extractUrls(text);
        if (urls.isEmpty()) {
            composer.addText(token, chatId, text);
            return;
        }
        if (urls.size() > MAX_LINKS) {
            send(token, chatId, "Tối đa " + MAX_LINKS + " link mỗi lần (bạn gửi " + urls.size() + ").", null);
            return;
        }
        long threadsCount = urls.stream().filter(TelegramText::isThreadsUrl).count();
        if (threadsCount > 0 && threadsCount < urls.size()) {
            send(token, chatId, "Link Threads và link khác cần gửi riêng 2 tin (Threads đăng lên nick Threads, còn lại đăng lên Fanpage).", null);
            return;
        }
        if (threadsCount > 0) startThreadsFlow(token, chatId, urls);
        else composer.addLinks(token, chatId, urls);
    }

    private void handleUnpaired(String token, long chatId, Map<String, Object> chat, TelegramText.Command cmd) {
        if (cmd == null || !"start".equals(cmd.name())) return; // chat lạ: im lặng
        if (cmd.arg().isBlank()) {
            send(token, chatId, "Chat này chưa được ghép nối với tool.\nMở tool → <b>Kết nối</b> → <b>Telegram bot</b> → "
                    + "bấm <b>Tạo mã ghép nối</b>, rồi gửi <code>/start &lt;mã&gt;</code> tại đây.", null);
            return;
        }
        if (config.consumePairCode(cmd.arg())) {
            failedPairAttempts.set(0);
            config.addChat(chatId, chatName(chat));
            log.info("[Telegram] Đã ghép nối chat {} ({})", chatId, chatName(chat));
            send(token, chatId, "<b>Đã ghép nối.</b> Từ giờ chat này điều khiển được tool.\n\n" + helpText(), null);
        } else {
            if (failedPairAttempts.incrementAndGet() >= MAX_PAIR_ATTEMPTS) {
                config.clearPairCode();
                failedPairAttempts.set(0);
                log.warn("[Telegram] Sai mã ghép nối {} lần — đã huỷ mã hiện tại.", MAX_PAIR_ATTEMPTS);
            }
            send(token, chatId, "Mã ghép nối không đúng hoặc đã hết hạn (10 phút). Tạo mã mới trong tool rồi thử lại.", null);
        }
    }

    @SuppressWarnings("unchecked")
    private void handleCallback(String token, Map<String, Object> cb) {
        String cbId = String.valueOf(cb.get("id"));
        String data = cb.get("data") instanceof String s ? s : "";
        Map<String, Object> message = (Map<String, Object>) cb.get("message");
        if (message == null) {
            api.answerCallback(token, cbId, null);
            return;
        }
        long chatId = num(((Map<String, Object>) message.get("chat")).get("id"));
        long messageId = num(message.get("message_id"));
        if (!config.isAllowed(chatId)) {
            api.answerCallback(token, cbId, "Chat chưa ghép nối");
            return;
        }
        String[] p = data.split(":");
        log.info("[Telegram] chat {} bấm nút {}", chatId, data);
        String toast = null;
        try {
            if (TelegramComposer.CALLBACKS.contains(p[0])) {
                api.answerCallback(token, cbId, composer.onCallback(token, chatId, messageId, p));
                return;
            }
            switch (p[0]) {
                case "t", "th" -> chooseTarget(token, chatId, messageId, p[0].equals("th"), Long.parseLong(p[1]));
                case "m" -> runCreate(token, chatId, messageId, "NOW".equals(p[1]) ? "NOW" : "QUEUE");
                case "x" -> {
                    states.remove(chatId);
                    api.editMessage(token, chatId, messageId, "Đã huỷ.", null);
                }
                case "lich" -> api.editMessage(token, chatId, messageId, scheduleText(),
                        keyboard(List.of(List.of(button("Làm mới", "lich")))));
                case "r" -> toast = retryPost(token, chatId, Long.parseLong(p[1]));
                case "d" -> askDelete(token, chatId, Long.parseLong(p[1]));
                case "dd" -> toast = deletePost(token, chatId, messageId, Long.parseLong(p[1]));
                case "keep" -> api.editMessage(token, chatId, messageId, "Đã giữ lại bài.", null);
                case "p" -> {
                    boolean pause = "1".equals(p[2]);
                    List<String> names = socialAccountService.setPaused(botUser().getId(), Long.parseLong(p[1]), pause, true);
                    toast = (pause ? "Đã tạm dừng " : "Đã chạy lại ") + names.size() + " kết nối";
                    NickView v = nickView();
                    api.editMessage(token, chatId, messageId, v.text, v.markup);
                }
                default -> toast = "Nút không còn hiệu lực";
            }
        } catch (Exception e) {
            log.warn("[Telegram] callback '{}': {}", data, TelegramApi.sanitize(e.getMessage(), token));
            toast = "Lỗi: " + shorten(TelegramApi.sanitize(e.getMessage(), token), 150);
        }
        api.answerCallback(token, cbId, toast);
    }

    // ====================================================================== gửi link → tạo bài

    /** Link Threads: chọn nick Threads rồi Đăng ngay / Nối đuôi (bài nháp nâng cao chỉ dành cho Fanpage). */
    private void startThreadsFlow(String token, long chatId, List<String> urls) {
        List<SocialAccount> accounts = threadsAccounts(botUser());
        if (accounts.isEmpty()) {
            send(token, chatId, "Chưa có nick Threads nào. Thêm nick ở trang <b>Đăng Threads</b> trước.", null);
            return;
        }
        List<List<Map<String, Object>>> rows = new ArrayList<>();
        for (SocialAccount a : accounts) {
            rows.add(List.of(button(shorten(label(a), 40) + expiredMark(a), "th:" + a.getId())));
        }
        rows.add(List.of(button("Huỷ", "x")));
        states.put(chatId, new ChatState(urls, true));
        send(token, chatId, "Nhận <b>" + urls.size() + "</b> link Threads. Đăng lên nick Threads nào?", keyboard(rows));
    }

    private void chooseTarget(String token, long chatId, long messageId, boolean threads, long accountId) {
        ChatState st = states.get(chatId);
        if (st == null || st.expired() || st.threads != threads) {
            states.remove(chatId);
            api.editMessage(token, chatId, messageId, "Phiên đã hết hạn — gửi lại link nhé.", null);
            return;
        }
        User user = botUser();
        SocialAccount acc = (threads ? threadsAccounts(user) : postingPages(user)).stream()
                .filter(a -> a.getId() == accountId).findFirst().orElse(null);
        if (acc == null) {
            api.editMessage(token, chatId, messageId, "Không tìm thấy kết nối này nữa — gửi lại link nhé.", null);
            states.remove(chatId);
            return;
        }
        if (threads) {
            st.threadsAccountId = acc.getId();
        } else {
            st.target = targetValue(acc);
        }
        st.label = label(acc);
        api.editMessage(token, chatId, messageId,
                "<b>" + st.urls.size() + "</b> link → <b>" + esc(st.label) + "</b>\nĐăng thế nào?",
                keyboard(List.of(
                        List.of(button("Đăng ngay", "m:NOW"), button("Nối đuôi hàng đợi", "m:QUEUE")),
                        List.of(button("Huỷ", "x")))));
    }

    private void runCreate(String token, long chatId, long messageId, String mode) {
        ChatState st = states.remove(chatId);
        if (st == null || st.expired() || (st.target == null && st.threadsAccountId == null)) {
            api.editMessage(token, chatId, messageId, "Phiên đã hết hạn — gửi lại link nhé.", null);
            return;
        }
        api.editMessage(token, chatId, messageId, "Đang thêm " + st.urls.size() + " link vào <b>" + esc(st.label) + "</b> ("
                + ("NOW".equals(mode) ? "đăng ngay" : "nối đuôi hàng đợi") + ")…", null);
        support.jobs.submit(() -> {
            try {
                createPosts(token, chatId, st, mode);
            } catch (Exception e) {
                log.warn("[Telegram] Tạo bài lỗi: {}", e.getMessage());
                send(token, chatId, "Không thêm được bài: " + esc(shorten(e.getMessage(), 300)), null);
            }
        });
    }

    @SuppressWarnings("unchecked")
    private void createPosts(String token, long chatId, ChatState st, String mode) {
        Map<String, Object> body = new HashMap<>();
        body.put("urls", st.urls);
        body.put("scheduleMode", mode);
        String path;
        if (st.threads) {
            body.put("accountIds", List.of(st.threadsAccountId));
            path = "/api/threads/bulk";
        } else {
            body.put("targetFanpageId", st.target);
            path = "/api/queue/add-from-urls";
        }
        Map<String, Object> res;
        try {
            res = support.postLocal(path, body);
        } catch (HttpStatusCodeException e) {
            send(token, chatId, "Không thêm được: " + esc(shorten(TelegramSupport.errorMessageOf(e), 400)), null);
            return;
        } catch (ResourceAccessException e) {
            send(token, chatId, "Backend xử lý lâu quá (vẫn có thể đang chạy). Kiểm tra lại bằng /lich.", null);
            return;
        }
        if (res == null || Boolean.FALSE.equals(res.get("success"))) {
            send(token, chatId, "Không thêm được: " + esc(res != null ? String.valueOf(res.get("message")) : "phản hồi rỗng"), null);
            return;
        }
        List<Long> ids = new ArrayList<>();
        Object items = st.threads ? res.get("posts") : res.get("items");
        if (items instanceof List<?> list) {
            for (Object o : list) {
                if (o instanceof Map<?, ?> m && m.get("id") != null) ids.add(num(m.get("id")));
            }
        }
        if (!st.threads) config.setDefaultTarget(st.target);
        config.watch(ids, chatId);

        StringBuilder sb = new StringBuilder();
        sb.append("<b>Đã thêm ").append(ids.size()).append(" bài</b> → ").append(esc(st.label)).append('\n');
        if (res.get("message") instanceof String m && !m.isBlank()) sb.append(esc(m)).append('\n');
        if (st.threads && res.get("failed") instanceof List<?> failed && !failed.isEmpty()) {
            sb.append("Lỗi ").append(failed.size()).append(" link: ").append(esc(shorten(failed.toString(), 300))).append('\n');
        }
        List<PostQueue> created = new ArrayList<>(postQueueRepository.findAllById(ids));
        created.sort(Comparator.comparing(PostQueue::getScheduledAt, Comparator.nullsLast(Comparator.naturalOrder())));
        for (PostQueue p : created.stream().limit(10).toList()) {
            sb.append("<code>").append(p.getScheduledAt() != null ? p.getScheduledAt().format(TIME) : "--:--").append("</code> #")
                    .append(p.getId()).append(' ').append(esc(shorten(titleOf(p), 50))).append('\n');
        }
        if (!ids.isEmpty()) sb.append("\nBot sẽ nhắn khi từng bài đăng xong hoặc lỗi.");
        send(token, chatId, sb.toString(), null);
    }

    // ====================================================================== bài lỗi

    private void sendFailures(String token, long chatId) {
        User user = botUser();
        Map<Long, String> names = accountNames(user);
        List<PostQueue> failed = postQueueService.getRecentQueueForUser(user.getId(), 2, null).stream()
                .filter(p -> "FAILED".equals(p.getStatus()))
                .sorted(Comparator.comparing(PostQueue::getUpdatedAt, Comparator.nullsLast(Comparator.reverseOrder())))
                .limit(8).toList();
        if (failed.isEmpty()) {
            send(token, chatId, "Không có bài lỗi nào.", null);
            return;
        }
        StringBuilder sb = new StringBuilder("<b>Bài lỗi gần nhất</b>\n");
        List<List<Map<String, Object>>> rows = new ArrayList<>();
        for (PostQueue p : failed) {
            sb.append("\n#").append(p.getId()).append(" · ").append(esc(pageOf(p, names))).append(" · ")
                    .append(esc(shorten(titleOf(p), 40))).append("\n<i>").append(esc(shorten(p.getErrorMessage(), 140))).append("</i>\n");
            rows.add(List.of(button("Thử lại #" + p.getId(), "r:" + p.getId()), button("Xoá #" + p.getId(), "d:" + p.getId())));
        }
        send(token, chatId, sb.toString(), keyboard(rows));
    }

    private String retryPost(String token, long chatId, long postId) {
        PostQueue p = postQueueRepository.findById(postId).orElse(null);
        if (p == null) return "Bài #" + postId + " không còn";
        if (!"FAILED".equals(p.getStatus())) return "Bài #" + postId + " đang " + p.getStatus() + ", không cần thử lại";
        postQueueService.resetFailedPost(postId);
        config.watch(List.of(postId), chatId);
        send(token, chatId, "Đã đưa #" + postId + " vào hàng đợi đăng lại. Bot sẽ báo kết quả.", null);
        return "Đã đưa lại vào hàng đợi";
    }

    private void askDelete(String token, long chatId, long postId) {
        PostQueue p = postQueueRepository.findById(postId).orElse(null);
        if (p == null) {
            send(token, chatId, "Bài #" + postId + " không còn.", null);
            return;
        }
        send(token, chatId, "Xoá hẳn bài #" + postId + " (" + esc(shorten(titleOf(p), 60)) + ")? Không hoàn tác được.",
                keyboard(List.of(List.of(button("Xoá", "dd:" + postId), button("Thôi", "keep")))));
    }

    private String deletePost(String token, long chatId, long messageId, long postId) {
        PostQueue p = postQueueRepository.findById(postId).orElse(null);
        if (p == null) {
            api.editMessage(token, chatId, messageId, "Bài #" + postId + " đã không còn.", null);
            return null;
        }
        if ("PROCESSING".equals(p.getStatus())) return "Bài đang được đăng, không xoá được lúc này";
        postQueueService.deletePost(postId);
        config.unwatch(List.of(postId));
        api.editMessage(token, chatId, messageId, "Đã xoá bài #" + postId + ".", null);
        return "Đã xoá";
    }

    // ====================================================================== theo dõi kết quả bài tạo từ bot

    @Scheduled(fixedDelay = 30_000, initialDelay = 30_000)
    public void notifyWatchedPosts() {
        String token = config.token();
        if (!config.isEnabled() || token == null) return;
        Map<Long, TelegramConfigService.WatchEntry> watched = config.watched();
        if (watched.isEmpty()) return;
        Map<Long, PostQueue> posts = postQueueRepository.findAllById(watched.keySet()).stream()
                .collect(Collectors.toMap(PostQueue::getId, p -> p));
        Map<Long, String> names = accountNames(botUser());
        List<Long> done = new ArrayList<>();
        long now = System.currentTimeMillis();
        for (Map.Entry<Long, TelegramConfigService.WatchEntry> e : watched.entrySet()) {
            long id = e.getKey();
            long chatId = e.getValue().chatId();
            PostQueue p = posts.get(id);
            if (p == null || "CANCELLED".equals(p.getStatus()) || now - e.getValue().createdAtMs() > 3L * 24 * 3600_000) {
                done.add(id);
                continue;
            }
            try {
                if ("PUBLISHED".equals(p.getStatus())) {
                    String link = p.getPublishedPostUrl();
                    send(token, chatId, "<b>Đã đăng</b> #" + id + " · " + esc(pageOf(p, names)) + "\n" + esc(shorten(titleOf(p), 80))
                            + (link != null && !link.isBlank() ? "\n" + esc(link) : ""), null);
                    done.add(id);
                } else if ("FAILED".equals(p.getStatus())) {
                    send(token, chatId, "<b>Đăng lỗi</b> #" + id + " · " + esc(pageOf(p, names)) + "\n" + esc(shorten(titleOf(p), 80))
                                    + "\n<i>" + esc(shorten(p.getErrorMessage(), 200)) + "</i>",
                            keyboard(List.of(List.of(button("Thử lại", "r:" + id), button("Xoá", "d:" + id)))));
                    done.add(id);
                }
            } catch (TelegramException ex) {
                log.warn("[Telegram] Không báo được bài #{}: {}", id, ex.getMessage());
            }
        }
        config.unwatch(done);
    }

    // ====================================================================== nội dung các lệnh

    static String helpText() {
        return "<b>Bot điều khiển tool đăng bài</b>\n"
                + "Gửi cho bot để tạo bài nháp:\n"
                + "• link bài (Facebook, TikTok, Reddit, báo…), nhiều link mỗi dòng một link\n"
                + "• ảnh / video / album (caption của ảnh là nội dung bài; file ≤ 20MB)\n"
                + "• đoạn chữ — đăng status, status ngắn bật được nền màu\n"
                + "Mỗi bài có xem trước, Viết lại bằng AI, Sửa caption. Bảng điều khiển chọn nhiều Trang, nhóm, "
                + "ghi nguồn rồi Đăng ngay / Nối đuôi hàng đợi. Link Threads gửi riêng để đăng lên nick Threads.\n\n"
                + "/lich — 10 bài sắp đăng\n"
                + "/hangdoi — thống kê hàng đợi\n"
                + "/loi — bài lỗi, thử lại hoặc xoá\n"
                + "/nick — tạm dừng / chạy lại nick\n"
                + "/huy — huỷ thao tác đang dở";
    }

    String scheduleText() {
        User user = botUser();
        Map<Long, String> names = accountNames(user);
        List<PostQueue> upcoming = postQueueService.getRecentQueueForUser(user.getId(), 1, null).stream()
                .filter(p -> "PENDING".equals(p.getStatus()) || "PROCESSING".equals(p.getStatus()))
                .sorted(Comparator.comparing(PostQueue::getScheduledAt, Comparator.nullsLast(Comparator.naturalOrder())))
                .toList();
        if (upcoming.isEmpty()) return "Hàng đợi trống — không có bài nào sắp đăng.";
        StringBuilder sb = new StringBuilder("<b>Lịch đăng</b> — ").append(upcoming.size()).append(" bài đang chờ");
        if (upcoming.size() > 10) sb.append(" (10 bài gần nhất)");
        sb.append('\n');
        for (PostQueue p : upcoming.stream().limit(10).toList()) {
            sb.append("\n<code>").append(p.getScheduledAt() != null ? p.getScheduledAt().format(TIME) : "--:--").append("</code> ")
                    .append("PROCESSING".equals(p.getStatus()) ? "<b>đang đăng</b> · " : "")
                    .append(esc(shorten(pageOf(p, names), 25))).append(" · ").append(esc(shorten(titleOf(p), 45)));
        }
        return sb.toString();
    }

    String queueStatsText() {
        User user = botUser();
        Map<String, Object> c = postQueueService.getQueueCountsForUser(user.getId());
        List<PostQueue> recent = postQueueService.getRecentQueueForUser(user.getId(), 1, null);
        LocalDate today = LocalDate.now();
        long publishedToday = recent.stream().filter(p -> "PUBLISHED".equals(p.getStatus())
                && p.getPublishedAt() != null && p.getPublishedAt().toLocalDate().equals(today)).count();
        long failedToday = recent.stream().filter(p -> "FAILED".equals(p.getStatus())
                && p.getUpdatedAt() != null && p.getUpdatedAt().toLocalDate().equals(today)).count();
        Optional<LocalDateTime> next = recent.stream().filter(p -> "PENDING".equals(p.getStatus()) && p.getScheduledAt() != null)
                .map(PostQueue::getScheduledAt).min(Comparator.naturalOrder());
        long pausedNicks = nickGroups(user).stream().filter(g -> g.paused).count();
        StringBuilder sb = new StringBuilder("<b>Hàng đợi</b>\n");
        sb.append("Chờ đăng: <b>").append(c.get("pending")).append("</b>");
        next.ifPresent(t -> sb.append(" (bài kế tiếp ").append(t.format(TIME)).append(')'));
        sb.append("\nĐang đăng: ").append(c.get("processing"));
        sb.append("\nHôm nay: đã đăng ").append(publishedToday).append(", lỗi ").append(failedToday);
        sb.append("\nTổng lỗi chưa xử lý: ").append(c.get("failed"));
        if (pausedNicks > 0) sb.append("\nNick đang tạm dừng: ").append(pausedNicks);
        return sb.toString();
    }

    record NickView(String text, Object markup) {
    }

    static final class NickGroup {
        String label;
        final List<SocialAccount> accounts = new ArrayList<>();
        boolean paused;
        boolean expired;
        LocalDateTime restingUntil;
        boolean overCap;
    }

    NickView nickView() {
        List<NickGroup> groups = nickGroups(botUser());
        if (groups.isEmpty()) return new NickView("Chưa có nick nào dùng cookie.", null);
        StringBuilder sb = new StringBuilder("<b>Nick</b> (tạm dừng = scheduler không tự đăng bài của nick đó; bài vẫn giữ trong hàng đợi)\n");
        List<List<Map<String, Object>>> rows = new ArrayList<>();
        int i = 1;
        for (NickGroup g : groups.stream().limit(25).toList()) {
            long pages = g.accounts.size();
            sb.append('\n').append(i++).append(". <b>").append(esc(shorten(g.label, 30))).append("</b> — ")
                    .append(pages).append(" kết nối · ");
            if (g.paused) sb.append("<b>TẠM DỪNG</b>");
            else if (g.expired) sb.append("cookie hết hạn");
            else if (g.restingUntil != null) sb.append("FB giới hạn, nghỉ tới ").append(g.restingUntil.format(HOUR));
            else if (g.overCap) sb.append("chạm trần bài/giờ");
            else sb.append("đang chạy");
            long firstId = g.accounts.get(0).getId();
            rows.add(List.of(g.paused
                    ? button("Chạy lại: " + shorten(g.label, 25), "p:" + firstId + ":0")
                    : button("Tạm dừng: " + shorten(g.label, 25), "p:" + firstId + ":1")));
        }
        return new NickView(sb.toString(), keyboard(rows));
    }

    /** Gộp kết nối theo c_user (1 nick = Via + mọi Page nó quản trị); Threads mỗi nick 1 dòng. */
    List<NickGroup> nickGroups(User user) {
        LinkedHashMap<String, NickGroup> byKey = new LinkedHashMap<>();
        LocalDateTime now = LocalDateTime.now();
        long nowMs = System.currentTimeMillis();
        List<SocialAccount> accounts = socialAccountRepository.findByUserId(user.getId()).stream()
                .sorted(Comparator.comparing(SocialAccount::getId)).toList();
        for (SocialAccount a : accounts) {
            String cUser = NickThrottleService.extractCUser(a);
            String key;
            if (cUser != null && !cUser.isBlank()) key = "fb:" + cUser;
            else if (isThreadsAccount(a)) key = "th:" + a.getId();
            else continue;
            NickGroup g = byKey.computeIfAbsent(key, k -> new NickGroup());
            g.accounts.add(a);
            boolean isProfile = "FACEBOOK_PROFILE".equalsIgnoreCase(a.getPlatform())
                    || "PERSONAL_PROFILE_COOKIE".equalsIgnoreCase(a.getAccountType());
            if (g.label == null || isProfile) g.label = (isThreadsAccount(a) ? "Threads " : "") + label(a);
            if (Boolean.TRUE.equals(a.getPaused())) g.paused = true;
            if ("EXPIRED".equalsIgnoreCase(a.getTokenStatus())) g.expired = true;
            String nk = NickThrottleService.nickKey(a);
            LocalDateTime until = nickThrottleService.rateLimitedUntil(nk, now);
            if (until != null) g.restingUntil = until;
            if (nickThrottleService.isOverHourlyCap(nk, nowMs)) g.overCap = true;
        }
        return new ArrayList<>(byKey.values());
    }

    // ====================================================================== helpers

    User botUser() {
        return support.botUser();
    }

    List<SocialAccount> postingPages(User user) {
        return support.postingPages(user);
    }

    List<SocialAccount> threadsAccounts(User user) {
        return support.threadsAccounts(user);
    }

    static boolean isThreadsAccount(SocialAccount a) {
        return TelegramSupport.isThreadsAccount(a);
    }

    static String targetValue(SocialAccount a) {
        return TelegramSupport.targetValue(a);
    }

    static String label(SocialAccount a) {
        return TelegramSupport.label(a);
    }

    private static String expiredMark(SocialAccount a) {
        return "EXPIRED".equalsIgnoreCase(a.getTokenStatus()) ? " (cookie hết hạn)" : "";
    }

    private Map<Long, String> accountNames(User user) {
        return support.accountNames(user);
    }

    static String pageOf(PostQueue p, Map<Long, String> names) {
        Long conn = TelegramText.connectionIdOf(p.getTargetFanpageId());
        if (conn != null && names.containsKey(conn)) return names.get(conn);
        if (p.getTargetGroupNames() != null && !p.getTargetGroupNames().isBlank()) return "Nhóm";
        return p.getTargetFanpageId() != null ? p.getTargetFanpageId().split(":")[0] : "?";
    }

    static String titleOf(PostQueue p) {
        if (p.getTitle() != null && !p.getTitle().isBlank()) return p.getTitle();
        if (p.getContent() != null && !p.getContent().isBlank()) return p.getContent();
        return p.getOriginalUrl() != null ? p.getOriginalUrl() : "(chưa có nội dung)";
    }

    @SuppressWarnings("unchecked")
    private static String chatName(Map<String, Object> chat) {
        Object title = chat.get("title");
        if (title != null) return String.valueOf(title);
        String first = chat.get("first_name") != null ? String.valueOf(chat.get("first_name")) : "";
        String last = chat.get("last_name") != null ? " " + chat.get("last_name") : "";
        String user = chat.get("username") != null ? " (@" + chat.get("username") + ")" : "";
        String name = (first + last + user).trim();
        return name.isEmpty() ? String.valueOf(chat.get("id")) : name;
    }

    private void send(String token, long chatId, String html, Object markup) {
        try {
            api.sendMessage(token, chatId, html, markup);
        } catch (TelegramException e) {
            log.warn("[Telegram] Gửi tin tới {} lỗi: {}", chatId, e.getMessage());
            throw e;
        }
    }

    /** Gửi tin thử tới mọi chat đã ghép nối; trả số chat gửi được. */
    public int sendTest() {
        String token = config.token();
        int ok = 0;
        for (TelegramConfigService.ChatEntry c : config.chats()) {
            try {
                api.sendMessage(token, c.id(), "Tin thử từ tool đăng bài — bot đang hoạt động.\n\n" + queueStatsText(), null);
                ok++;
            } catch (TelegramException e) {
                log.warn("[Telegram] Gửi thử tới {} lỗi: {}", c.id(), e.getMessage());
            }
        }
        return ok;
    }

    static long num(Object o) {
        return TelegramSupport.num(o);
    }
}
