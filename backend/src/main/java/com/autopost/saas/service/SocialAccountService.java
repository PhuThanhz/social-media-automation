package com.autopost.saas.service;

import com.autopost.saas.util.LocalServices;
import com.autopost.saas.entity.SocialAccount;
import com.autopost.saas.repository.SocialAccountRepository;
import com.autopost.saas.util.PooledRestTemplateFactory;
import com.autopost.saas.util.WorkerRetryHelper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
@Slf4j
public class SocialAccountService {

    private final SocialAccountRepository repository;
    private final FacebookGraphApiService facebookGraphApiService;
    private final com.autopost.saas.repository.FacebookPageAccessRepository facebookPageAccessRepository;
    private final com.autopost.saas.repository.PostTargetRepository postTargetRepository;
    private final com.autopost.saas.repository.PostQueueGroupResultRepository postQueueGroupResultRepository;
    private final com.autopost.saas.repository.GroupFlopConfigRepository groupFlopConfigRepository;
    private final RestTemplate restTemplate = PooledRestTemplateFactory.create(10000, 60000);

    @Cacheable(value = "socialAccountsByUser", key = "#userId")
    public List<SocialAccount> getAccountsByUserId(Long userId) {
        return repository.findByUserId(userId);
    }

    @SuppressWarnings("unchecked")
    @CacheEvict(value = "socialAccountsByUser", allEntries = true)
    public SocialAccount saveAccount(SocialAccount account) {
        if (account.getId() == null
                && account.getUser() != null
                && account.getPlatformAccountId() != null) {
            SocialAccount existingProfile = repository
                    .findByUserIdAndPlatformAndPlatformAccountId(
                            account.getUser().getId(),
                            account.getPlatform(),
                            account.getPlatformAccountId()
                    )
                    .orElse(null);
            if (existingProfile != null) {
                existingProfile.setAccessToken(account.getAccessToken());
                if (account.getPageName() != null && !account.getPageName().isBlank()) {
                    existingProfile.setPageName(account.getPageName());
                }
                if (account.getAccountType() != null) {
                    existingProfile.setAccountType(account.getAccountType());
                }
                if (account.getPostingIdentityAccountId() != null) {
                    existingProfile.setPostingIdentityAccountId(account.getPostingIdentityAccountId());
                }
                if (account.getBackupAccountId() != null) {
                    existingProfile.setBackupAccountId(account.getBackupAccountId());
                }
                existingProfile.setTokenStatus(account.getTokenStatus() != null ? account.getTokenStatus() : "OK");
                existingProfile.setTokenCheckedAt(java.time.LocalDateTime.now());
                account = existingProfile;
            }
        }

        boolean needsAutoName = account.getPageName() == null || account.getPageName().trim().isEmpty()
                || "Fanpage Facebook Main".equals(account.getPageName());

        boolean isThreads = "THREADS".equalsIgnoreCase(account.getPlatform()) || "THREADS_COOKIE".equalsIgnoreCase(account.getAccountType());
        if (needsAutoName && isThreads) {
            account.setPageName("Threads @" + (account.getPlatformAccountId() != null ? account.getPlatformAccountId().replaceFirst("^@", "") : ""));
        } else if (needsAutoName && account.getAccessToken() != null && !account.getAccessToken().isEmpty()) {
            if ("PAGE_TOKEN".equals(account.getAccountType())) {
                try {
                    Map<String, Object> response = facebookGraphApiService.getPageName(account.getPlatformAccountId(), account.getAccessToken());
                    if (response != null && response.get("name") != null) {
                        String realName = (String) response.get("name");
                        log.info("✅ Lấy được tên Fanpage thực tế từ Graph API: {}", realName);
                        account.setPageName(realName);
                    }
                } catch (Exception e) {
                    log.warn("Không thể lấy tên Fanpage từ Graph API: {}", e.getMessage());
                }
            } else {
                try {
                    String workerUrl = LocalServices.WORKER_BASE + "/api/get-account-name";
                    HttpHeaders headers = new HttpHeaders();
                    headers.setContentType(MediaType.APPLICATION_JSON);

                    Map<String, String> requestBody = new HashMap<>();
                    requestBody.put("cookieString", account.getAccessToken());

                    HttpEntity<Map<String, String>> request = new HttpEntity<>(requestBody, headers);
                    Map<String, Object> response = WorkerRetryHelper.postWithConnectionRetry(restTemplate, workerUrl, request, Map.class);

                    if (response != null && Boolean.TRUE.equals(response.get("success")) && response.get("name") != null) {
                        String realName = (String) response.get("name");
                        log.info("✅ Lấy được tên Facebook thực tế từ Worker: {}", realName);
                        account.setPageName(realName);
                    }
                } catch (Exception e) {
                    log.warn("Không thể lấy tên từ Worker: {}", e.getMessage());
                }
            }
        }

        if (account.getPageName() == null || account.getPageName().isEmpty()) {
            account.setPageName("FB Fanpage (" + account.getPlatformAccountId() + ")");
        }

        SocialAccount saved = repository.save(account);

        if ("FACEBOOK_PAGE".equals(saved.getPlatform())
                && "PERSONAL_COOKIE".equals(saved.getAccountType())
                && saved.getAccessToken() != null
                && saved.getPlatformAccountId() != null
                && saved.getUser() != null) {
            String cUser = extractCUser(saved.getAccessToken());
            if (cUser != null && !cUser.isBlank()) {
                syncFacebookPageAccess(saved.getUser(), cUser, saved.getPlatformAccountId(), saved.getPageName(), saved);
            }
        }

        return saved;
    }

    private void syncFacebookPageAccess(com.autopost.saas.entity.User user, String cUser, String pageId, String pageName, SocialAccount sourceAccount) {
        try {
            com.autopost.saas.entity.FacebookPageAccess access = facebookPageAccessRepository
                    .findByUserIdAndPersonalProfileIdAndPageId(user.getId(), cUser, pageId)
                    .orElseGet(() -> com.autopost.saas.entity.FacebookPageAccess.builder()
                            .user(user)
                            .personalProfileId(cUser)
                            .pageId(pageId)
                            .firstSeenAt(java.time.LocalDateTime.now())
                            .build());

            access.setSourceAccount(sourceAccount);
            if (pageName != null && !pageName.isBlank()) {
                access.setPageName(pageName);
            }
            if (access.getPageUrl() == null) {
                access.setPageUrl("https://www.facebook.com/profile.php?id=" + pageId);
            }
            access.setVerificationStatus("VERIFIED");
            access.setVerificationMessage("Đã khai báo/thêm trực tiếp bằng i_user.");
            access.setActive(true);
            access.setLastSeenAt(java.time.LocalDateTime.now());
            access.setLastScanAt(java.time.LocalDateTime.now());
            access.setLastVerifiedAt(java.time.LocalDateTime.now());
            facebookPageAccessRepository.save(access);
        } catch (Exception e) {
            log.warn("Không thể đồng bộ FacebookPageAccess cho Page ID {}: {}", pageId, e.getMessage());
        }
    }

    public static String extractCUser(String cookieStr) {
        if (cookieStr == null || cookieStr.isBlank()) return null;
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("(?:^|;\\s*)c_user=([^;\\s]+)", java.util.regex.Pattern.CASE_INSENSITIVE).matcher(cookieStr);
        if (!m.find()) return null;
        String val = m.group(1).trim();
        if (val.startsWith("\"") && val.endsWith("\"") && val.length() > 1) {
            val = val.substring(1, val.length() - 1);
        }
        return val;
    }

    /**
     * Ghi cookie mới cho MỌI kết nối của user có cùng c_user (Via + các Page/Group dùng cookie của Via đó).
     * Đọc thẳng repository (không qua cache) và tự evict cache vì gọi saveAccount nội bộ không đi qua proxy.
     */
    @CacheEvict(value = "socialAccountsByUser", allEntries = true)
    public List<String> applyCookieToSameCUser(Long userId, String cUser, String cookie) {
        List<String> updatedNames = new java.util.ArrayList<>();
        if (userId == null || cUser == null || cUser.isBlank() || cookie == null || cookie.isBlank()) return updatedNames;
        java.time.LocalDateTime now = java.time.LocalDateTime.now();
        for (SocialAccount acc : repository.findByUserId(userId)) {
            String accCUser = extractCUser(acc.getAccessToken());
            boolean matchCUser = accCUser != null && accCUser.equalsIgnoreCase(cUser);
            boolean matchPlatform = cUser.equalsIgnoreCase(acc.getPlatformAccountId());
            if (matchCUser || matchPlatform) {
                acc.setAccessToken(cookie);
                acc.setTokenStatus("OK");
                acc.setTokenCheckedAt(now);
                saveAccount(acc);
                updatedNames.add(acc.getPageName() != null ? acc.getPageName() : acc.getPlatformAccountId());
            }
        }
        return updatedNames;
    }

    @CacheEvict(value = "socialAccountsByUser", allEntries = true)
    @org.springframework.transaction.annotation.Transactional
    public void deleteAccount(Long id) {
        if (id == null) return;

        // 1. Gỡ tham chiếu tự trỏ (Self-reference) ở các SocialAccount khác
        repository.findAll().forEach(acc -> {
            boolean changed = false;
            if (id.equals(acc.getPostingIdentityAccountId())) {
                acc.setPostingIdentityAccountId(null);
                changed = true;
            }
            if (id.equals(acc.getBackupAccountId())) {
                acc.setBackupAccountId(null);
                changed = true;
            }
            if (id.equals(acc.getFallbackGroupId())) {
                acc.setFallbackGroupId(null);
                changed = true;
            }
            if (changed) repository.save(acc);
        });

        // 2. Gỡ liên kết cấu hình chống Flop
        try {
            groupFlopConfigRepository.findAll().stream()
                    .filter(c -> id.equals(c.getSocialAccountId()))
                    .forEach(c -> {
                        c.setSocialAccountId(null);
                        groupFlopConfigRepository.save(c);
                    });
        } catch (Exception e) {
            log.warn("Không thể gỡ tham chiếu GroupFlopConfig cho account {}: {}", id, e.getMessage());
        }

        // 3. Xóa các dữ liệu có ràng buộc khóa ngoại (Foreign Key) trỏ tới social_accounts
        try {
            facebookPageAccessRepository.deleteBySourceAccountId(id);
        } catch (Exception e) {
            log.warn("Lỗi khi xóa facebookPageAccesses cho account {}: {}", id, e.getMessage());
        }

        try {
            postTargetRepository.deleteBySocialAccount_Id(id);
        } catch (Exception e) {
            log.warn("Lỗi khi xóa postTarget cho account {}: {}", id, e.getMessage());
        }

        try {
            postQueueGroupResultRepository.deleteBySocialAccount_Id(id);
        } catch (Exception e) {
            log.warn("Lỗi khi xóa postQueueGroupResult cho account {}: {}", id, e.getMessage());
        }

        // 4. Xóa bản ghi trong social_accounts
        repository.deleteById(id);
        log.info("🗑️ Đã xóa thành công SocialAccount ID: {}", id);
    }
}
