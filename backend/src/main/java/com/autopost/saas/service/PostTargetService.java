package com.autopost.saas.service;

import com.autopost.saas.entity.PostQueue;
import com.autopost.saas.entity.PostQueueGroupResult;
import com.autopost.saas.entity.PostTarget;
import com.autopost.saas.entity.SocialAccount;
import com.autopost.saas.repository.PostQueueGroupResultRepository;
import com.autopost.saas.repository.PostQueueRepository;
import com.autopost.saas.repository.PostTargetRepository;
import com.autopost.saas.repository.SocialAccountRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.AbstractMap;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
@Slf4j
public class PostTargetService {

    private final PostTargetRepository postTargetRepository;
    private final PostQueueRepository postQueueRepository;
    private final PostQueueGroupResultRepository postQueueGroupResultRepository;
    private final SocialAccountRepository socialAccountRepository;

    public static final int DEFAULT_FANPAGE_KPI = 0;
    public static final int DEFAULT_GROUP_KPI = 0;

    /**
     * Lấy mục tiêu KPI hiệu dụng cho 1 tài khoản vào ngày cụ thể:
     * 1. Ưu tiên PostTarget đã đặt cho đúng ngày date.
     * 2. Nếu chưa đặt cho ngày date: kế thừa PostTarget gần nhất từng đặt trong quá khứ.
     * 3. Nếu chưa từng đặt: lấy mặc định cứng (Fanpage = 5 bài/ngày, Group = 3 bài/ngày).
     */
    public int getEffectiveTargetCount(SocialAccount account, LocalDate date) {
        if (account == null) return DEFAULT_FANPAGE_KPI;
        boolean isGroup = "FACEBOOK_GROUP".equals(account.getPlatform());
        int defaultCount = isGroup ? DEFAULT_GROUP_KPI : DEFAULT_FANPAGE_KPI;

        // 1. Kiểm tra ngày date
        java.util.Optional<PostTarget> exact = postTargetRepository.findBySocialAccount_IdAndTargetDate(account.getId(), date);
        if (exact.isPresent() && exact.get().getTargetCount() != null && exact.get().getTargetCount() > 0) {
            return exact.get().getTargetCount();
        }

        // 2. Kế thừa từ ngày gần nhất
        java.util.Optional<PostTarget> latest = postTargetRepository.findFirstBySocialAccount_IdOrderByTargetDateDesc(account.getId());
        if (latest.isPresent() && latest.get().getTargetCount() != null && latest.get().getTargetCount() > 0) {
            return latest.get().getTargetCount();
        }

        // 3. Mặc định cứng
        return defaultCount;
    }

    /** KPI + tiến độ thực tế của user trong khoảng ngày [from, to] — dùng để vẽ trên Lịch đăng bài. */
    public List<Map<String, Object>> getSummary(Long userId, LocalDate from, LocalDate to) {
        List<SocialAccount> accounts = socialAccountRepository.findByUserId(userId);
        if (accounts.isEmpty()) return List.of();

        List<PostTarget> explicitTargets = postTargetRepository.findBySocialAccount_User_IdAndTargetDateBetween(userId, from, to);
        Map<AbstractMap.SimpleEntry<Long, LocalDate>, PostTarget> targetMap = new HashMap<>();
        for (PostTarget pt : explicitTargets) {
            if (pt.getSocialAccount() != null && pt.getTargetDate() != null) {
                targetMap.put(new AbstractMap.SimpleEntry<>(pt.getSocialAccount().getId(), pt.getTargetDate()), pt);
            }
        }

        // Đếm số bài đã đăng thành công lên Fanpage theo (platformAccountId, ngày)
        Map<AbstractMap.SimpleEntry<String, LocalDate>, Integer> fanpageActuals = new HashMap<>();
        List<PostQueue> publishedPosts = postQueueRepository.findPublishedByUserIdAndPublishedAtBetween(
                userId, from.atStartOfDay(), to.plusDays(1).atStartOfDay());
        for (PostQueue post : publishedPosts) {
            if (post.getTargetGroupNames() != null && post.getTargetGroupNames().startsWith("GROUP_ONLY:")) {
                continue;
            }
            SocialAccount resolved = resolveAccountForTargetId(post.getTargetFanpageId(), accounts);
            if (resolved == null || resolved.getPlatformAccountId() == null || post.getPublishedAt() == null) continue;
            AbstractMap.SimpleEntry<String, LocalDate> key = new AbstractMap.SimpleEntry<>(resolved.getPlatformAccountId(), post.getPublishedAt().toLocalDate());
            fanpageActuals.merge(key, 1, Integer::sum);
        }

        // Đếm số lần đăng thành công vào từng Group theo (accountId, ngày) từ log chính xác.
        Map<AbstractMap.SimpleEntry<Long, LocalDate>, Integer> groupActuals = new HashMap<>();
        List<PostQueueGroupResult> groupResults = postQueueGroupResultRepository
                .findByPostQueue_Campaign_User_IdAndStatusAndAttemptedAtBetween(
                        userId, "PUBLISHED", from.atStartOfDay(), to.plusDays(1).atStartOfDay());
        for (PostQueueGroupResult result : groupResults) {
            if (result.getSocialAccount() == null) continue;
            AbstractMap.SimpleEntry<Long, LocalDate> key = new AbstractMap.SimpleEntry<>(result.getSocialAccount().getId(), result.getAttemptedAt().toLocalDate());
            groupActuals.merge(key, 1, Integer::sum);
        }

        // Đếm số bài ĐANG CHỜ ĐĂNG (PENDING/PROCESSING) lên lịch vào từng ngày
        Map<AbstractMap.SimpleEntry<String, LocalDate>, Integer> fanpagePendings = new HashMap<>();
        Map<AbstractMap.SimpleEntry<String, LocalDate>, Integer> groupPendings = new HashMap<>();
        Map<String, Integer> fanpageTotalPendings = new HashMap<>();
        Map<String, Integer> groupTotalPendings = new HashMap<>();

        List<PostQueue> activePendingPosts = postQueueRepository.findActivePendingByUserIdAndScheduledAtBetween(
                userId, from.atStartOfDay(), LocalDateTime.now().plusDays(60));
        for (PostQueue post : activePendingPosts) {
            if (post.getScheduledAt() == null) continue;
            LocalDate pDate = post.getScheduledAt().toLocalDate();
            if (post.getTargetGroupNames() != null && !post.getTargetGroupNames().trim().isEmpty()) {
                String raw = post.getTargetGroupNames().replace("GROUP_ONLY:", "");
                String[] gIds = raw.split(",");
                for (String gId : gIds) {
                    String trimmed = gId.trim();
                    if (!trimmed.isEmpty()) {
                        java.util.Set<String> matchedKeys = new java.util.HashSet<>();
                        matchedKeys.add(trimmed);
                        for (SocialAccount acc : accounts) {
                            if ("FACEBOOK_GROUP".equals(acc.getPlatform())) {
                                if (trimmed.equalsIgnoreCase(acc.getPlatformAccountId())
                                        || trimmed.equalsIgnoreCase(String.valueOf(acc.getId()))
                                        || (acc.getPageName() != null && trimmed.equalsIgnoreCase(acc.getPageName().trim()))
                                        || (acc.getPageName() != null && trimmed.equalsIgnoreCase(stripEmojiPrefix(acc.getPageName())))) {
                                    if (acc.getPlatformAccountId() != null) matchedKeys.add(acc.getPlatformAccountId());
                                    if (acc.getId() != null) matchedKeys.add(String.valueOf(acc.getId()));
                                    if (acc.getPageName() != null) matchedKeys.add(acc.getPageName().trim());
                                }
                            }
                        }
                        for (String key : matchedKeys) {
                            groupTotalPendings.merge(key, 1, Integer::sum);
                            if (!pDate.isBefore(from) && !pDate.isAfter(to)) {
                                groupPendings.merge(new AbstractMap.SimpleEntry<>(key, pDate), 1, Integer::sum);
                            }
                        }
                    }
                }
            } else {
                SocialAccount resolved = resolveAccountForTargetId(post.getTargetFanpageId(), accounts);
                if (resolved != null && resolved.getPlatformAccountId() != null) {
                    fanpageTotalPendings.merge(resolved.getPlatformAccountId(), 1, Integer::sum);
                    if (!pDate.isBefore(from) && !pDate.isAfter(to)) {
                        fanpagePendings.merge(new AbstractMap.SimpleEntry<>(resolved.getPlatformAccountId(), pDate), 1, Integer::sum);
                    }
                }
            }
        }

        List<Map<String, Object>> items = new java.util.ArrayList<>();
        // Duyệt từng ngày trong khoảng [from, to] cho tất cả các accounts
        for (LocalDate curDate = from; !curDate.isAfter(to); curDate = curDate.plusDays(1)) {
            for (SocialAccount account : accounts) {
                PostTarget explicit = targetMap.get(new AbstractMap.SimpleEntry<>(account.getId(), curDate));
                int targetCount = explicit != null ? explicit.getTargetCount() : getEffectiveTargetCount(account, curDate);
                Long targetId = explicit != null ? explicit.getId() : null;

                boolean isGroup = "FACEBOOK_GROUP".equals(account.getPlatform());
                int actualCount;
                int pendingCount;
                int totalPending;
                if (isGroup) {
                    actualCount = groupActuals.getOrDefault(new AbstractMap.SimpleEntry<>(account.getId(), curDate), 0);
                    java.util.Set<String> searchKeys = new java.util.HashSet<>();
                    if (account.getPlatformAccountId() != null) searchKeys.add(account.getPlatformAccountId());
                    if (account.getId() != null) searchKeys.add(String.valueOf(account.getId()));
                    if (account.getPageName() != null) {
                        searchKeys.add(account.getPageName().trim());
                        searchKeys.add(stripEmojiPrefix(account.getPageName()));
                    }

                    pendingCount = 0;
                    totalPending = 0;
                    for (String sKey : searchKeys) {
                        pendingCount = Math.max(pendingCount, groupPendings.getOrDefault(new AbstractMap.SimpleEntry<>(sKey, curDate), 0));
                        totalPending = Math.max(totalPending, groupTotalPendings.getOrDefault(sKey, 0));
                    }
                } else {
                    actualCount = fanpageActuals.getOrDefault(new AbstractMap.SimpleEntry<>(account.getPlatformAccountId(), curDate), 0);
                    pendingCount = fanpagePendings.getOrDefault(new AbstractMap.SimpleEntry<>(account.getPlatformAccountId(), curDate), 0);
                    totalPending = fanpageTotalPendings.getOrDefault(account.getPlatformAccountId(), 0);
                }

                Map<String, Object> item = new LinkedHashMap<>();
                item.put("targetId", targetId);
                item.put("socialAccountId", account.getId());
                item.put("platformAccountId", account.getPlatformAccountId());
                item.put("platform", account.getPlatform());
                item.put("accountName", account.getPageName());
                item.put("date", curDate.toString());
                item.put("targetCount", targetCount);
                item.put("actualCount", actualCount);
                item.put("pendingCount", pendingCount);
                item.put("totalPending", totalPending);
                item.put("achieved", actualCount >= targetCount);
                item.put("isDefaultKpi", explicit == null);
                items.add(item);
            }
        }
        return items;
    }

    /** Đặt/sửa KPI cho 1 Fanpage/Group vào 1 ngày cụ thể. targetCount null hoặc <=0 = xoá mục tiêu. */
    public PostTarget upsertTarget(Long userId, Long socialAccountId, LocalDate date, Integer targetCount) {
        SocialAccount account = socialAccountRepository.findById(socialAccountId)
                .orElseThrow(() -> new IllegalArgumentException("Không tìm thấy Fanpage/Group với ID: " + socialAccountId));
        if (account.getUser() == null || !account.getUser().getId().equals(userId)) {
            throw new SecurityException("Không có quyền đặt KPI cho Fanpage/Group này");
        }

        PostTarget existing = postTargetRepository.findBySocialAccount_IdAndTargetDate(socialAccountId, date).orElse(null);
        if (targetCount == null || targetCount <= 0) {
            if (existing != null) {
                postTargetRepository.delete(existing);
            }
            return null;
        }

        if (existing != null) {
            existing.setTargetCount(targetCount);
            return postTargetRepository.save(existing);
        }
        return postTargetRepository.save(PostTarget.builder()
                .socialAccount(account)
                .targetDate(date)
                .targetCount(targetCount)
                .build());
    }

    /** Xoá 1 mục tiêu KPI theo ID bản ghi PostTarget. */
    public void deleteTarget(Long userId, Long targetId) {
        PostTarget target = postTargetRepository.findById(targetId)
                .orElseThrow(() -> new IllegalArgumentException("Không tìm thấy mục tiêu KPI với ID: " + targetId));
        if (target.getSocialAccount() == null || target.getSocialAccount().getUser() == null
                || !target.getSocialAccount().getUser().getId().equals(userId)) {
            throw new SecurityException("Không có quyền xoá KPI này");
        }
        postTargetRepository.delete(target);
    }

    /** Số bài đã đăng thành công của riêng 1 Fanpage/Group vào 1 ngày cụ thể — dùng cho KPI Auto-Fill để biết còn thiếu bao nhiêu. */
    public int countActualForAccountOnDate(SocialAccount account, LocalDate date) {
        if (account == null || account.getUser() == null) return 0;
        Long userId = account.getUser().getId();
        LocalDateTime from = date.atStartOfDay();
        LocalDateTime to = date.plusDays(1).atStartOfDay();

        if ("FACEBOOK_GROUP".equals(account.getPlatform())) {
            return (int) postQueueGroupResultRepository
                    .findByPostQueue_Campaign_User_IdAndStatusAndAttemptedAtBetween(userId, "PUBLISHED", from, to)
                    .stream()
                    .filter(r -> r.getSocialAccount() != null && account.getId().equals(r.getSocialAccount().getId()))
                    .count();
        }
        List<SocialAccount> accounts = socialAccountRepository.findByUserId(userId);
        return (int) postQueueRepository.findPublishedByUserIdAndPublishedAtBetween(userId, from, to)
                .stream()
                .filter(p -> !(p.getTargetGroupNames() != null && p.getTargetGroupNames().startsWith("GROUP_ONLY:")))
                .filter(p -> matchesFanpageAccount(p.getTargetFanpageId(), accounts, account))
                .count();
    }

    /**
     * So khớp 1 bài đã đăng với 1 SocialAccount Fanpage theo TRANG FACEBOOK THẬT (platformAccountId),
     * không theo connection cụ thể.
     */
    private boolean matchesFanpageAccount(String targetFanpageId, List<SocialAccount> accounts, SocialAccount account) {
        if (account.getPlatformAccountId() == null) return false;
        SocialAccount resolved = resolveAccountForTargetId(targetFanpageId, accounts);
        return resolved != null && account.getPlatformAccountId().equals(resolved.getPlatformAccountId());
    }

    /** Tương tự PostQueueService: resolve SocialAccount từ targetFanpageId dạng platformAccountId[:accountType[:connectionId]]. */
    private SocialAccount resolveAccountForTargetId(String targetFanpageId, List<SocialAccount> accounts) {
        if (targetFanpageId == null || targetFanpageId.trim().isEmpty()) return null;
        String[] parts = targetFanpageId.split(":", -1);
        String realPlatformId = parts[0].trim();

        if (parts.length >= 3 && !parts[2].trim().isEmpty()) {
            try {
                Long connectionId = Long.valueOf(parts[2].trim());
                SocialAccount byConnection = accounts.stream()
                        .filter(a -> connectionId.equals(a.getId()))
                        .findFirst()
                        .orElse(null);
                if (byConnection != null) return byConnection;
            } catch (NumberFormatException ignored) {
            }
        }
        return accounts.stream()
                .filter(a -> realPlatformId.equals(a.getPlatformAccountId()))
                .findFirst()
                .orElse(null);
    }

    private String stripEmojiPrefix(String name) {
        if (name == null) return "";
        return name.replaceAll("^[\\p{So}\\p{Cn}\\p{Cs}\\p{Co}\\s\\|•·]+", "").trim();
    }
}
