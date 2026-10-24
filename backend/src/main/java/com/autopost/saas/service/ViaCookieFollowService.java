package com.autopost.saas.service;

import com.autopost.saas.entity.SocialAccount;
import com.autopost.saas.repository.SocialAccountRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * Fanpage đăng bằng cookie (PERSONAL_COOKIE) thực chất chạy bằng phiên của Via quản trị nó
 * (postingIdentityAccountId). Cookie lưu riêng trên kết nối Page chỉ là bản sao — khi bản sao này cũ
 * hoặc hỏng (VD: c_user bị ghi thành chính ID Page, ghép với xs của Via) thì health-check đánh Page
 * EXPIRED dù Via vẫn sống. Service này cho Page "đi theo Via": chép cookie hiện tại của Via xuống Page.
 *
 * Chỉ chép khi bản sao của Page không đáng tin — Page đang EXPIRED, hoặc c_user của Page không phải
 * nick cá nhân nào của user — để không đổi nick đăng của Page đang chạy tốt bằng cookie Via khác.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ViaCookieFollowService {

    private static final Pattern C_USER_PATTERN = Pattern.compile("(?:^|;\\s*)c_user=([^;\\s]+)", Pattern.CASE_INSENSITIVE);

    private final SocialAccountRepository socialAccountRepository;

    /** Đồng bộ một kết nối Page theo Via của nó. Trả về true nếu đã chép cookie Via xuống Page. */
    @CacheEvict(value = "socialAccountsByUser", allEntries = true)
    public boolean followIdentityVia(SocialAccount page) {
        if (!isCookiePage(page) || page.getPostingIdentityAccountId() == null) return false;
        SocialAccount via = socialAccountRepository.findById(page.getPostingIdentityAccountId()).orElse(null);
        if (via == null) return false;
        Set<String> profileCUsers = page.getUser() == null ? Set.of() : profileCUsers(socialAccountRepository.findByUserId(page.getUser().getId()));
        return adopt(page, via, profileCUsers);
    }

    /** Quét toàn bộ Page cookie, cho các Page có bản sao cookie hỏng đi theo Via. Chỉ đụng DB, không mở browser. */
    @CacheEvict(value = "socialAccountsByUser", allEntries = true)
    public int repairPagesFollowingVias() {
        List<SocialAccount> cookieAccounts = socialAccountRepository
                .findByAccountTypeIn(List.of("PERSONAL_COOKIE", "PERSONAL_PROFILE_COOKIE"));
        Map<Long, SocialAccount> byId = cookieAccounts.stream()
                .collect(Collectors.toMap(SocialAccount::getId, Function.identity()));
        Map<Long, Set<String>> profileCUsersByUser = cookieAccounts.stream()
                .filter(a -> a.getUser() != null)
                .collect(Collectors.groupingBy(a -> a.getUser().getId(),
                        Collectors.collectingAndThen(Collectors.toList(), ViaCookieFollowService::profileCUsers)));
        int repaired = 0;
        for (SocialAccount page : cookieAccounts) {
            if (!isCookiePage(page) || page.getPostingIdentityAccountId() == null) continue;
            SocialAccount via = byId.get(page.getPostingIdentityAccountId());
            if (via == null) continue;
            Set<String> profileCUsers = page.getUser() == null ? Set.of() : profileCUsersByUser.getOrDefault(page.getUser().getId(), Set.of());
            if (adopt(page, via, profileCUsers)) repaired++;
        }
        return repaired;
    }

    private boolean adopt(SocialAccount page, SocialAccount via, Set<String> profileCUsers) {
        if (!isProfile(via) || isDead(via.getTokenStatus())) return false;
        String viaCookie = via.getAccessToken();
        String viaCUser = extractCUser(viaCookie);
        if (viaCUser == null || Objects.equals(viaCookie, page.getAccessToken())) return false;
        if (page.getUser() != null && via.getUser() != null && !page.getUser().getId().equals(via.getUser().getId())) return false;

        String pageCUser = extractCUser(page.getAccessToken());
        boolean pageCopyBroken = isDead(page.getTokenStatus()) || pageCUser == null || !profileCUsers.contains(pageCUser);
        if (!pageCopyBroken) return false;

        String oldStatus = page.getTokenStatus();
        page.setAccessToken(viaCookie);
        page.setTokenStatus(via.getTokenStatus() != null ? via.getTokenStatus() : "OK");
        page.setTokenCheckedAt(LocalDateTime.now());
        socialAccountRepository.save(page);
        log.info("🔗 [ViaCookie] Page '{}' (ID: {}) có cookie riêng hỏng (c_user={}, status={}) — đã đồng bộ theo Via '{}' (ID: {}, c_user={}).",
                page.getPageName(), page.getId(), pageCUser, oldStatus, via.getPageName(), via.getId(), viaCUser);
        return true;
    }

    private static boolean isCookiePage(SocialAccount account) {
        return "PERSONAL_COOKIE".equals(account.getAccountType())
                && !"FACEBOOK_GROUP".equals(account.getPlatform())
                && !"FACEBOOK_PROFILE".equals(account.getPlatform());
    }

    private static boolean isProfile(SocialAccount account) {
        return "FACEBOOK_PROFILE".equals(account.getPlatform()) || "PERSONAL_PROFILE_COOKIE".equals(account.getAccountType());
    }

    private static boolean isDead(String status) {
        return "EXPIRED".equals(status) || "CHECKPOINT".equals(status);
    }

    private static Set<String> profileCUsers(List<SocialAccount> accounts) {
        return accounts.stream()
                .filter(ViaCookieFollowService::isProfile)
                .map(a -> extractCUser(a.getAccessToken()))
                .filter(Objects::nonNull)
                .collect(Collectors.toSet());
    }

    static String extractCUser(String cookie) {
        if (cookie == null) return null;
        Matcher m = C_USER_PATTERN.matcher(cookie);
        return m.find() ? m.group(1).trim() : null;
    }
}
