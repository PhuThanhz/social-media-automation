package com.autopost.saas.service;

import com.autopost.saas.entity.SocialAccount;
import com.autopost.saas.repository.SocialAccountRepository;
import com.autopost.saas.util.PooledRestTemplateFactory;
import com.autopost.saas.util.WorkerRetryHelper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
@Slf4j
public class GroupHealthService {

    private static final String WORKER_URL = "http://localhost:3001/api/check-group-health";

    private final SocialAccountRepository socialAccountRepository;
    private final RestTemplate restTemplate = PooledRestTemplateFactory.create(10000, 60000);

    /**
     * Kiểm tra trạng thái Quyền & Sức khỏe của 1 Group cụ thể
     */
    public Map<String, Object> checkGroupHealth(Long socialAccountId) {
        SocialAccount account = socialAccountRepository.findById(socialAccountId)
                .orElseThrow(() -> new RuntimeException("Không tìm thấy tài khoản ID: " + socialAccountId));

        if (!"FACEBOOK_GROUP".equals(account.getPlatform())) {
            throw new IllegalArgumentException("Tài khoản này không phải là FACEBOOK_GROUP");
        }

        // Lấy Cookie từ tài khoản cá nhân có chứa cookie
        SocialAccount cookieOwnerAccount = resolvePersonalCookieAccount(account);
        String cookieString = cookieOwnerAccount != null ? cookieOwnerAccount.getAccessToken() : null;

        if (cookieString == null) {
            log.warn("⚠️ Không tìm thấy Cookie cá nhân chứa c_user (duy nhất/khớp danh tính) để check sức khỏe Group ID {}", account.getPlatformAccountId());
            account.setGroupHealthStatus("UNKNOWN");
            account.setGroupHealthCheckedAt(LocalDateTime.now());
            socialAccountRepository.save(account);
            return Map.of("success", false, "error", "Chưa có Cookie cá nhân chứa c_user");
        }

        try {
            Map<String, Object> body = new HashMap<>();
            body.put("cookieString", cookieString);
            body.put("targetGroupId", account.getPlatformAccountId());
            body.put("pageName", account.getPageName());
            // socialAccountId = id của account SỞ HỮU cookie (danh tính cá nhân đang đăng nhập), không
            // phải id của Group — dùng làm khóa profile trình duyệt cố định bên worker (xem
            // worker/browserPool.js acquirePersistentContext), để Facebook thấy "cùng 1 thiết bị" mỗi
            // lần health-check thay vì 1 thiết bị lạ, giảm tần suất bị đá phiên đăng nhập.
            body.put("socialAccountId", cookieOwnerAccount.getId());
            if (account.getPostingIdentityAccountId() != null) {
                socialAccountRepository.findById(account.getPostingIdentityAccountId()).ifPresent(identityAcc -> {
                    if (identityAcc.getPlatformAccountId() != null) {
                        body.put("targetFanpageId", identityAcc.getPlatformAccountId());
                    }
                });
            }

            log.info("🔍 [GroupHealth] Đang kiểm tra sức khỏe Group '{}' (ID: {})...", account.getPageName(), account.getPlatformAccountId());
            @SuppressWarnings("unchecked")
            Map<String, Object> response = WorkerRetryHelper.postWithConnectionRetry(restTemplate, WORKER_URL, body, Map.class);

            if (response != null && Boolean.TRUE.equals(response.get("success"))) {
                String status = (String) response.get("status");
                account.setGroupHealthStatus(status);
                account.setGroupHealthCheckedAt(LocalDateTime.now());
                socialAccountRepository.save(account);
                log.info("✅ [GroupHealth] Đã cập nhật trạng thái Group '{}': {}", account.getPageName(), status);
                return response;
            } else {
                account.setGroupHealthStatus("UNKNOWN");
                account.setGroupHealthCheckedAt(LocalDateTime.now());
                socialAccountRepository.save(account);
                return Map.of("success", false, "error", response != null ? response.get("error") : "Lỗi kết nối worker");
            }

        } catch (Exception e) {
            log.error("❌ [GroupHealth] Lỗi khi gọi worker check sức khỏe Group {}: {}", account.getPlatformAccountId(), e.getMessage());
            account.setGroupHealthStatus("UNKNOWN");
            account.setGroupHealthCheckedAt(LocalDateTime.now());
            socialAccountRepository.save(account);
            return Map.of("success", false, "error", e.getMessage());
        }
    }

    /**
     * Tự động gửi yêu cầu tham gia 1 Group cụ thể
     */
    public Map<String, Object> joinGroup(Long socialAccountId) {
        SocialAccount account = socialAccountRepository.findById(socialAccountId)
                .orElseThrow(() -> new RuntimeException("Không tìm thấy tài khoản ID: " + socialAccountId));

        if (!"FACEBOOK_GROUP".equals(account.getPlatform())) {
            throw new IllegalArgumentException("Tài khoản này không phải là FACEBOOK_GROUP");
        }

        String cookieString = resolvePersonalCookieString(account);

        if (cookieString == null) {
            return Map.of("success", false, "error", "Chưa có Cookie cá nhân chứa c_user (duy nhất/khớp danh tính)");
        }

        try {
            Map<String, Object> body = new HashMap<>();
            body.put("cookieString", cookieString);
            body.put("targetGroupId", account.getPlatformAccountId());
            body.put("pageName", account.getPageName());
            if (account.getPostingIdentityAccountId() != null) {
                socialAccountRepository.findById(account.getPostingIdentityAccountId()).ifPresent(identityAcc -> {
                    if (identityAcc.getPlatformAccountId() != null) {
                        body.put("targetFanpageId", identityAcc.getPlatformAccountId());
                        body.put("pageId", identityAcc.getPlatformAccountId());
                        if (identityAcc.getPageName() != null && !identityAcc.getPageName().isBlank()) {
                            body.put("pageName", identityAcc.getPageName());
                        }
                    }
                });
            }

            log.info("🤝 [GroupJoin] Đang gửi yêu cầu tham gia Group '{}' (ID: {})...", account.getPageName(), account.getPlatformAccountId());
            @SuppressWarnings("unchecked")
            Map<String, Object> response = WorkerRetryHelper.postWithConnectionRetry(restTemplate, "http://localhost:3001/api/join-group", body, Map.class);

            if (response != null && Boolean.TRUE.equals(response.get("success"))) {
                account.setGroupHealthStatus("PENDING_APPROVAL");
                account.setGroupHealthCheckedAt(LocalDateTime.now());
                socialAccountRepository.save(account);
                return response;
            } else {
                return Map.of("success", false, "error", response != null ? response.get("message") : "Lỗi kết nối worker");
            }
        } catch (Exception e) {
            log.error("❌ [GroupJoin] Lỗi gửi yêu cầu vào Group {}: {}", account.getPlatformAccountId(), e.getMessage());
            return Map.of("success", false, "error", e.getMessage());
        }
    }

    /**
     * Lấy cookie cá nhân dùng để thao tác (check sức khỏe / tham gia) với 1 Group.
     * Ưu tiên danh tính đăng bài đã cấu hình sẵn cho Group (posting_identity_account_id) nếu có cookie
     * hợp lệ. Nếu không, chỉ tự chọn khi user có DUY NHẤT 1 tài khoản cá nhân chứa cookie — không đoán
     * đại findFirst() giữa nhiều tài khoản trùng, tránh check nhầm/join nhầm bằng login không phải
     * thành viên Group này (cùng nguyên tắc chống "đăng nhầm account" áp dụng ở PostQueueService).
     */
    private String resolvePersonalCookieString(SocialAccount groupAccount) {
        SocialAccount acc = resolvePersonalCookieAccount(groupAccount);
        return acc != null ? acc.getAccessToken() : null;
    }

    private SocialAccount resolvePersonalCookieAccount(SocialAccount groupAccount) {
        if (groupAccount.getPostingIdentityAccountId() != null) {
            SocialAccount identityAcc = socialAccountRepository.findById(groupAccount.getPostingIdentityAccountId()).orElse(null);
            if (identityAcc != null && identityAcc.getAccessToken() != null && identityAcc.getAccessToken().contains("c_user=")) {
                return identityAcc;
            }
        }
        List<SocialAccount> cookieAccounts = socialAccountRepository.findByUserId(groupAccount.getUser().getId()).stream()
                .filter(a -> a.getAccessToken() != null && a.getAccessToken().contains("c_user="))
                .filter(a -> !"EXPIRED".equalsIgnoreCase(a.getTokenStatus()))
                .toList();
        return cookieAccounts.size() == 1 ? cookieAccounts.get(0) : null;
    }

    /**
     * Scan sức khỏe toàn bộ Group của 1 User
     */
    public List<Map<String, Object>> checkAllGroupsHealth(Long userId) {
        List<SocialAccount> groups = socialAccountRepository.findByUserId(userId).stream()
                .filter(a -> "FACEBOOK_GROUP".equals(a.getPlatform()))
                .toList();

        return groups.stream()
                .map(g -> {
                    Map<String, Object> res = new HashMap<>(checkGroupHealth(g.getId()));
                    res.put("socialAccountId", g.getId());
                    res.put("groupName", g.getPageName());
                    res.put("platformAccountId", g.getPlatformAccountId());
                    return res;
                })
                .toList();
    }
}
