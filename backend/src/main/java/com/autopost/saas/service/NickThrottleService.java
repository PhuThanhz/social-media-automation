package com.autopost.saas.service;

import com.autopost.saas.entity.SocialAccount;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDateTime;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Giới hạn tốc độ theo NICK Facebook thật (c_user), tính chung mọi kết nối Page/Group/Profile dùng cùng cookie.
 *
 * Bài học 2026-10-27: nick Thành An quản trị ~20 Page, scheduler đăng nối đuôi liên tục (~75s/bài) nên lên tới
 * 49 bài/giờ và bị Facebook chặn "Để bảo vệ cộng đồng khỏi spam, chúng tôi giới hạn tần suất...". Cooldown cũ
 * chỉ dời bài của đúng 1 kết nối nên các Page khác cùng nick vẫn đăng tiếp.
 */
@Service
@Slf4j
public class NickThrottleService {

    /** Mặc định khi chưa có cài đặt; giá trị thật đọc từ bảng cài đặt lịch đăng chung. */
    public static final int MAX_POSTS_PER_HOUR_PER_NICK = PostingWindowService.DEFAULT_MAX_POSTS_PER_HOUR_PER_NICK;

    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private PostingWindowService postingWindowService;

    public int maxPostsPerHour() {
        try {
            return postingWindowService != null ? postingWindowService.maxPostsPerHourPerNick() : MAX_POSTS_PER_HOUR_PER_NICK;
        } catch (Exception e) {
            return MAX_POSTS_PER_HOUR_PER_NICK;
        }
    }
    private static final long HOUR_MS = 3_600_000L;
    private static final Pattern C_USER = Pattern.compile("(?:^|;\\s*)c_user=([^;\\s]+)", Pattern.CASE_INSENSITIVE);

    // Nick đang bị Facebook giới hạn → không giao bài cho tới mốc này.
    private final Map<String, LocalDateTime> rateLimitedUntil = new ConcurrentHashMap<>();
    // Thời điểm bắt đầu đăng các bài trong 60 phút gần nhất của mỗi nick.
    private final Map<String, Deque<Long>> recentStarts = new ConcurrentHashMap<>();
    private final Map<String, Long> lastCapLogAt = new ConcurrentHashMap<>();

    /** c_user trong cookie (bất kể loại kết nối), null nếu cookie không có. */
    public static String extractCUser(SocialAccount account) {
        if (account == null || account.getAccessToken() == null) return null;
        Matcher m = C_USER.matcher(account.getAccessToken());
        return m.find() ? m.group(1).trim() : null;
    }

    /** Khoá theo nick: băm c_user để không lộ Facebook user id trong log; không có c_user thì theo kết nối. */
    public static String nickKey(SocialAccount account) {
        String cUser = extractCUser(account);
        if (cUser != null && !cUser.isBlank()) {
            return "nick:" + sha256(cUser).substring(0, 16);
        }
        return "connection:" + (account != null ? account.getId() : null);
    }

    public void markRateLimited(String key, LocalDateTime until) {
        rateLimitedUntil.merge(key, until, (a, b) -> a.isAfter(b) ? a : b);
    }

    public LocalDateTime rateLimitedUntil(String key, LocalDateTime now) {
        LocalDateTime until = rateLimitedUntil.get(key);
        if (until == null) return null;
        if (!until.isAfter(now)) {
            rateLimitedUntil.remove(key, until);
            return null;
        }
        return until;
    }

    public void recordStart(String key, long nowMs) {
        Deque<Long> starts = recentStarts.computeIfAbsent(key, k -> new ArrayDeque<>());
        synchronized (starts) {
            starts.addLast(nowMs);
            prune(starts, nowMs);
        }
    }

    public int startsInLastHour(String key, long nowMs) {
        Deque<Long> starts = recentStarts.get(key);
        if (starts == null) return 0;
        synchronized (starts) {
            prune(starts, nowMs);
            return starts.size();
        }
    }

    public boolean isOverHourlyCap(String key, long nowMs) {
        return startsInLastHour(key, nowMs) >= maxPostsPerHour();
    }

    /** Lý do nick chưa được giao bài (null = được đăng). Log tối đa 5 phút/lần cho mỗi nick. */
    public String blockReason(String key, String label, LocalDateTime now, long nowMs) {
        LocalDateTime until = rateLimitedUntil(key, now);
        String reason = null;
        if (until != null) {
            reason = "đang nghỉ do Facebook giới hạn tần suất tới " + until.toLocalTime().withNano(0);
        } else if (isOverHourlyCap(key, nowMs)) {
            reason = "đã đăng " + maxPostsPerHour() + " bài trong 60 phút qua";
        }
        if (reason != null) {
            Long last = lastCapLogAt.get(key);
            if (last == null || nowMs - last > 300_000) {
                lastCapLogAt.put(key, nowMs);
                log.info("⏸️ [NickThrottle] Tạm hoãn bài của nick '{}' ({}): {}.", label, key, reason);
            }
        }
        return reason;
    }

    private static void prune(Deque<Long> starts, long nowMs) {
        while (!starts.isEmpty() && nowMs - starts.peekFirst() >= HOUR_MS) {
            starts.pollFirst();
        }
    }

    private static String sha256(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            return java.util.HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("JVM không hỗ trợ SHA-256", e);
        }
    }
}
