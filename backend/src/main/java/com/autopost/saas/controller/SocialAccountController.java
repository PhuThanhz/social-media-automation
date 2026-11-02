package com.autopost.saas.controller;

import com.autopost.saas.util.LocalServices;
import com.autopost.saas.entity.SocialAccount;
import com.autopost.saas.entity.User;
import com.autopost.saas.dto.FacebookPageAccessDto;
import com.autopost.saas.dto.FacebookPageScanRequestDto;
import com.autopost.saas.dto.FacebookPageScanResponseDto;
import com.autopost.saas.repository.UserRepository;
import com.autopost.saas.service.FacebookPageAuditService;
import com.autopost.saas.service.SocialAccountService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;
import com.autopost.saas.util.PooledRestTemplateFactory;

import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;


@RestController
@RequestMapping("/api/connections")
@RequiredArgsConstructor
@CrossOrigin(originPatterns = "*")
@Slf4j
public class SocialAccountController {

    private final SocialAccountService socialAccountService;
    private final FacebookPageAuditService facebookPageAuditService;
    private final com.autopost.saas.service.GroupHealthService groupHealthService;
    private final com.autopost.saas.service.PlaywrightHealthCheckService playwrightHealthCheckService;
    private final UserRepository userRepository;
    private final RestTemplate workerRestTemplate = PooledRestTemplateFactory.create(10000, 30000);
    /** Kết quả đã lưu của từng phiên đăng nhập Facebook — các lượt poll sau SUCCESS không lưu lại DB lần nữa. */
    private final Map<String, Map<String, Object>> fbLoginResults = new java.util.concurrent.ConcurrentHashMap<>();

    private User resolveUser(Authentication authentication) {
        if (authentication != null && authentication.getName() != null) {
            return userRepository.findByEmail(authentication.getName())
                    .orElseGet(() -> userRepository.findFirstByOrderByIdAsc().orElseThrow());
        }
        return userRepository.findByEmail("admin@gmail.com")
                .orElseGet(() -> userRepository.findFirstByOrderByIdAsc().orElseThrow());
    }

    @GetMapping
    public ResponseEntity<List<SocialAccount>> getConnections(Authentication authentication) {
        User user = resolveUser(authentication);
        return ResponseEntity.ok(socialAccountService.getAccountsByUserId(user.getId()));
    }

    @PostMapping
    public ResponseEntity<SocialAccount> addConnection(@RequestBody SocialAccount request, Authentication authentication) {
        User user = resolveUser(authentication);
        request.setUser(user);
        return ResponseEntity.ok(socialAccountService.saveAccount(request));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> deleteConnection(@PathVariable Long id) {
        try {
            socialAccountService.deleteAccount(id);
            return ResponseEntity.ok().build();
        } catch (Exception e) {
            log.error("Lỗi khi xóa kết nối/group ID {}: {}", id, e.getMessage(), e);
            return ResponseEntity.status(org.springframework.http.HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("message", "Không thể xóa: " + e.getMessage()));
        }
    }

    public static String extractCUser(String cookieStr) {
        if (cookieStr == null || cookieStr.isBlank()) return null;
        java.util.regex.Matcher matcher = java.util.regex.Pattern.compile("(?:^|;\\s*)c_user=([^;\\s]+)", java.util.regex.Pattern.CASE_INSENSITIVE).matcher(cookieStr);
        if (matcher.find()) {
            String val = matcher.group(1).trim();
            if (val.startsWith("\"") && val.endsWith("\"") && val.length() > 1) {
                val = val.substring(1, val.length() - 1);
            }
            return val;
        }
        return null;
    }

    @PostMapping("/sync-via-cookie")
    public ResponseEntity<Map<String, Object>> syncViaCookie(@RequestBody Map<String, String> request, Authentication authentication) {
        User user = resolveUser(authentication);
        String cookie = request.get("cookie");
        String viaUid = request.get("uid");
        if (cookie == null || cookie.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", "Cookie không được để trống!"));
        }
        String cUser = viaUid != null && !viaUid.isBlank() ? viaUid.trim() : extractCUser(cookie);
        if (cUser == null || cUser.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", "Không tìm thấy c_user (UID) trong Cookie!"));
        }

        List<String> updatedNames = socialAccountService.applyCookieToSameCUser(user.getId(), cUser, cookie);

        return ResponseEntity.ok(Map.of(
                "success", true,
                "count", updatedNames.size(),
                "cUser", cUser,
                "updatedNames", updatedNames
        ));
    }

    /**
     * Mở cửa sổ Chrome thật (headed) trên máy chạy worker để người dùng TỰ đăng nhập Facebook.
     * Body: {accountId?} — có accountId thì là đăng nhập lại đúng nick (c_user) của kết nối đó.
     */
    @PostMapping("/fb-login/start")
    public ResponseEntity<Map<String, Object>> startFacebookLogin(@RequestBody(required = false) Map<String, Object> body, Authentication authentication) {
        User user = resolveUser(authentication);
        Object rawId = body != null ? body.get("accountId") : null;
        String cUser = "";
        if (rawId != null && !String.valueOf(rawId).isBlank()) {
            Long accountId = Long.valueOf(String.valueOf(rawId));
            SocialAccount acc = socialAccountService.getAccountsByUserId(user.getId()).stream()
                    .filter(a -> accountId.equals(a.getId())).findFirst().orElse(null);
            if (acc == null) {
                return ResponseEntity.status(404).body(Map.of("success", false, "message", "Không tìm thấy kết nối này"));
            }
            String fromCookie = extractCUser(acc.getAccessToken());
            cUser = fromCookie != null ? fromCookie : String.valueOf(acc.getPlatformAccountId());
        }
        try {
            Map<?, ?> resp = workerRestTemplate.postForObject(LocalServices.WORKER_BASE + "/api/fb-login/start", Map.of("cUser", cUser), Map.class);
            return ResponseEntity.ok(Map.of("success", true, "sessionId", String.valueOf(resp != null ? resp.get("sessionId") : "")));
        } catch (org.springframework.web.client.HttpClientErrorException e) {
            return ResponseEntity.status(e.getStatusCode()).body(Map.of("success", false, "message", "Đang có 1 cửa sổ đăng nhập Facebook mở sẵn — hoàn tất hoặc đóng nó trước."));
        } catch (Exception e) {
            return ResponseEntity.status(502).body(Map.of("success", false, "message", "Không gọi được Playwright Worker: " + e.getMessage()));
        }
    }

    /** Theo dõi phiên đăng nhập; khi thành công thì cập nhật cookie cho mọi kết nối cùng c_user, chưa có Via thì tạo mới. */
    @GetMapping("/fb-login/{sessionId}")
    public ResponseEntity<Map<String, Object>> facebookLoginStatus(@PathVariable String sessionId, Authentication authentication) {
        Map<String, Object> done = fbLoginResults.get(sessionId);
        if (done != null) return ResponseEntity.ok(done);
        Map<?, ?> resp;
        try {
            resp = workerRestTemplate.getForObject(LocalServices.WORKER_BASE + "/api/fb-login/" + sessionId, Map.class);
        } catch (Exception e) {
            return ResponseEntity.status(502).body(Map.of("success", false, "message", "Không lấy được trạng thái đăng nhập: " + e.getMessage()));
        }
        if (resp == null) {
            return ResponseEntity.status(502).body(Map.of("success", false, "message", "Worker không trả dữ liệu"));
        }
        Map<String, Object> result = new java.util.LinkedHashMap<>();
        result.put("success", true);
        result.put("status", resp.get("status"));
        result.put("message", resp.get("message"));
        if (!"SUCCESS".equals(resp.get("status")) || !(resp.get("cookieString") instanceof String cookie)) {
            return ResponseEntity.ok(result);
        }
        synchronized (fbLoginResults) {
            done = fbLoginResults.get(sessionId);
            if (done != null) return ResponseEntity.ok(done);
            User user = resolveUser(authentication);
            String cUser = extractCUser(cookie);
            String name = resp.get("name") instanceof String n && !n.isBlank() ? n.trim() : null;
            List<String> updatedNames = socialAccountService.applyCookieToSameCUser(user.getId(), cUser, cookie);
            SocialAccount via = socialAccountService.getAccountsByUserId(user.getId()).stream()
                    .filter(a -> "FACEBOOK_PROFILE".equals(a.getPlatform()) && cUser.equals(a.getPlatformAccountId()))
                    .findFirst().orElse(null);
            boolean created = false;
            if (via == null) {
                SocialAccount fresh = new SocialAccount();
                fresh.setUser(user);
                fresh.setPlatform("FACEBOOK_PROFILE");
                fresh.setPlatformAccountId(cUser);
                fresh.setPageName(name); // null → saveAccount tự hỏi worker tên thật của nick
                fresh.setAccountType("PERSONAL_PROFILE_COOKIE");
                fresh.setAccessToken(cookie);
                fresh.setTokenStatus("OK");
                fresh.setTokenCheckedAt(java.time.LocalDateTime.now());
                via = socialAccountService.saveAccount(fresh);
                created = true;
            }
            result.put("cUser", cUser);
            result.put("created", created);
            result.put("updatedCount", updatedNames.size());
            result.put("updatedNames", updatedNames);
            result.put("account", via);
            fbLoginResults.put(sessionId, result);
            return ResponseEntity.ok(result);
        }
    }

    @PostMapping("/fb-login/{sessionId}/cancel")
    public ResponseEntity<Map<String, Object>> cancelFacebookLogin(@PathVariable String sessionId) {
        try {
            workerRestTemplate.postForObject(LocalServices.WORKER_BASE + "/api/fb-login/" + sessionId + "/cancel", Map.of(), Map.class);
        } catch (Exception ignored) { }
        return ResponseEntity.ok(Map.of("success", true));
    }

    /**
     * Extension Chrome gửi cookie Facebook của bất kỳ Profile Chrome nào người dùng đang mở.
     * Tự động tạo Via nếu chưa có, hoặc cập nhật cookie cho mọi kết nối cùng c_user.
     */
    @PostMapping("/sync-fb-cookie")
    public ResponseEntity<Map<String, Object>> syncFacebookCookie(@RequestBody Map<String, Object> body, Authentication authentication) {
        String cookie = body != null && body.get("cookieString") != null ? body.get("cookieString").toString().trim() : "";
        String cUser = extractCUser(cookie);
        if (cUser == null || !cookie.contains("xs=")) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", "Cookie không hợp lệ hoặc thiếu c_user/xs"));
        }
        User user = resolveUser(authentication);
        String name = body.get("name") instanceof String n && !n.isBlank() ? n.trim() : null;
        List<String> updatedNames = socialAccountService.applyCookieToSameCUser(user.getId(), cUser, cookie);
        SocialAccount via = socialAccountService.getAccountsByUserId(user.getId()).stream()
                .filter(a -> "FACEBOOK_PROFILE".equals(a.getPlatform()) && cUser.equals(a.getPlatformAccountId()))
                .findFirst().orElse(null);
        boolean created = false;
        // Extension tự đồng bộ (onlyExisting=true): chỉ cập nhật nick đã có, không tự tạo Via mới.
        boolean onlyExisting = Boolean.TRUE.equals(body.get("onlyExisting"));
        if (via == null && onlyExisting) {
            Map<String, Object> result = new java.util.LinkedHashMap<>();
            result.put("success", true);
            result.put("cUser", cUser);
            result.put("created", false);
            result.put("updatedCount", updatedNames.size());
            result.put("updatedNames", updatedNames);
            return ResponseEntity.ok(result);
        }
        if (via == null) {
            SocialAccount fresh = new SocialAccount();
            fresh.setUser(user);
            fresh.setPlatform("FACEBOOK_PROFILE");
            fresh.setPlatformAccountId(cUser);
            fresh.setPageName(name); // null -> saveAccount tự hỏi worker tên thật của nick
            fresh.setAccountType("PERSONAL_PROFILE_COOKIE");
            fresh.setAccessToken(cookie);
            fresh.setTokenStatus("OK");
            fresh.setTokenCheckedAt(java.time.LocalDateTime.now());
            via = socialAccountService.saveAccount(fresh);
            created = true;
        } else {
            via.setAccessToken(cookie);
            via.setTokenStatus("OK");
            via.setTokenCheckedAt(java.time.LocalDateTime.now());
            if (name != null && !name.isBlank()) {
                via.setPageName(name);
            }
            socialAccountService.saveAccount(via);
        }
        Map<String, Object> result = new java.util.LinkedHashMap<>();
        result.put("success", true);
        result.put("cUser", cUser);
        result.put("created", created);
        result.put("updatedCount", updatedNames.size());
        result.put("updatedNames", updatedNames);
        result.put("account", via);
        return ResponseEntity.ok(result);
    }

    @PutMapping("/{id}")
    public ResponseEntity<?> updateConnection(@PathVariable Long id, @RequestBody SocialAccount request, Authentication authentication) {
        User user = resolveUser(authentication);
        SocialAccount existing = socialAccountService.getAccountsByUserId(user.getId()).stream().filter(a -> a.getId().equals(id)).findFirst().orElse(null);
        if (existing == null) return ResponseEntity.notFound().build();
        if (request.getAccessToken() != null) {
            String newCookie = request.getAccessToken();
            // c_user luôn là UID nick cá nhân. Cookie có c_user = ID của chính Fanpage là cookie lai (xs của Via
            // ghép với ID Page) — Facebook từ chối, Page bị báo hết hạn và tách khỏi Via. Chặn từ đầu.
            String incomingCUser = extractCUser(newCookie);
            if ("FACEBOOK_PAGE".equals(existing.getPlatform()) && incomingCUser != null
                    && incomingCUser.equals(existing.getPlatformAccountId())) {
                return ResponseEntity.badRequest().body(Map.of("success", false, "message",
                        "c_user trong cookie đang là ID của chính Fanpage (" + incomingCUser + "), không phải UID nick Via. "
                                + "Hãy dán cookie đầy đủ của nick Via quản trị Page (hoặc cập nhật cookie ngay ở Via sở hữu)."));
            }
            existing.setAccessToken(newCookie);
            existing.setTokenStatus("OK");
            existing.setTokenCheckedAt(java.time.LocalDateTime.now());

            // Tự động đồng bộ Cookie mới cho TẤT CẢ các kết nối cùng c_user hoặc liên kết với Via này
            String targetCUser = extractCUser(newCookie);
            if (targetCUser == null && existing.getPlatformAccountId() != null && existing.getPlatformAccountId().matches("\\d+")) {
                targetCUser = existing.getPlatformAccountId();
            }

            List<SocialAccount> userAccounts = socialAccountService.getAccountsByUserId(user.getId());
            
            // Xác định Nick Via mẹ (root Via ID)
            Long rootViaId = null;
            if ("PERSONAL_PROFILE_COOKIE".equals(existing.getAccountType()) || "FACEBOOK_PROFILE".equals(existing.getPlatform())) {
                rootViaId = existing.getId();
            } else if (existing.getPostingIdentityAccountId() != null) {
                rootViaId = existing.getPostingIdentityAccountId();
            } else if (targetCUser != null) {
                for (SocialAccount a : userAccounts) {
                    if (("PERSONAL_PROFILE_COOKIE".equals(a.getAccountType()) || "FACEBOOK_PROFILE".equals(a.getPlatform()))
                            && targetCUser.equalsIgnoreCase(a.getPlatformAccountId())) {
                        rootViaId = a.getId();
                        break;
                    }
                }
            }

            for (SocialAccount acc : userAccounts) {
                if (!acc.getId().equals(existing.getId())) {
                    String accCUser = extractCUser(acc.getAccessToken());
                    boolean isSameCUser = targetCUser != null && accCUser != null && accCUser.equalsIgnoreCase(targetCUser);
                    boolean isPlatformMatch = targetCUser != null && targetCUser.equalsIgnoreCase(acc.getPlatformAccountId());
                    boolean isLinkedIdentity = existing.getId().equals(acc.getPostingIdentityAccountId());
                    boolean isReverseLinked = acc.getId().equals(existing.getPostingIdentityAccountId());
                    boolean isSameViaFamily = rootViaId != null && (
                        rootViaId.equals(acc.getId()) || rootViaId.equals(acc.getPostingIdentityAccountId())
                    );
                    
                    if (isSameCUser || isPlatformMatch || isLinkedIdentity || isReverseLinked || isSameViaFamily) {
                        acc.setAccessToken(newCookie);
                        acc.setTokenStatus("OK");
                        acc.setTokenCheckedAt(java.time.LocalDateTime.now());
                        if (rootViaId != null && acc.getPostingIdentityAccountId() == null && "PERSONAL_COOKIE".equals(acc.getAccountType())) {
                            acc.setPostingIdentityAccountId(rootViaId);
                        }
                        socialAccountService.saveAccount(acc);
                    }
                }
            }
        } else if (request.getTokenStatus() != null) {
            existing.setTokenStatus(request.getTokenStatus());
        }
        if (request.getPageName() != null) existing.setPageName(request.getPageName());
        if (request.getPlatformAccountId() != null) existing.setPlatformAccountId(request.getPlatformAccountId());
        if (request.getMaxPostsPerDay() != null) existing.setMaxPostsPerDay(request.getMaxPostsPerDay());
        if (request.getBackupAccountId() != null) {
            // 0 dùng như tín hiệu "bỏ chọn dự phòng" từ FE
            existing.setBackupAccountId(request.getBackupAccountId() == 0L ? null : request.getBackupAccountId());
        }
        if (request.getFallbackGroupId() != null) {
            existing.setFallbackGroupId(request.getFallbackGroupId() == 0L ? null : request.getFallbackGroupId());
        }
        if (request.getPostingIdentityAccountId() != null) {
            existing.setPostingIdentityAccountId(request.getPostingIdentityAccountId() == 0L ? null : request.getPostingIdentityAccountId());
        }
        if (request.getProxyUrl() != null) {
            existing.setProxyUrl(request.getProxyUrl().trim());
        }
        if (request.getUserAgent() != null) {
            existing.setUserAgent(request.getUserAgent().trim());
        }
        if (request.getGroupHealthStatus() != null) {
            existing.setGroupHealthStatus(request.getGroupHealthStatus());
        }
        return ResponseEntity.ok(socialAccountService.saveAccount(existing));
    }

    @PostMapping("/{id}/check-group-health")
    public ResponseEntity<java.util.Map<String, Object>> checkGroupHealth(@PathVariable Long id) {
        return ResponseEntity.ok(groupHealthService.checkGroupHealth(id));
    }

    @PostMapping("/{id}/join-group")
    public ResponseEntity<java.util.Map<String, Object>> joinGroup(@PathVariable Long id) {
        return ResponseEntity.ok(groupHealthService.joinGroup(id));
    }

    @PostMapping("/check-all-groups-health")
    public ResponseEntity<java.util.List<java.util.Map<String, Object>>> checkAllGroupsHealth(Authentication authentication) {
        User user = resolveUser(authentication);
        return ResponseEntity.ok(groupHealthService.checkAllGroupsHealth(user.getId()));
    }

    @GetMapping("/{id}/managed-pages")
    public ResponseEntity<List<FacebookPageAccessDto>> getManagedPages(
            @PathVariable Long id,
            Authentication authentication
    ) {
        User user = resolveUser(authentication);
        return ResponseEntity.ok(facebookPageAuditService.getManagedPages(user.getId(), id));
    }


    @PostMapping("/{id}/scan-managed-pages")
    public ResponseEntity<FacebookPageScanResponseDto> scanManagedPages(
            @PathVariable Long id,
            @RequestBody(required = false) FacebookPageScanRequestDto request,
            Authentication authentication
    ) {
        User user = resolveUser(authentication);
        boolean verifyEachPage = request == null || request.getVerifyEachPage() == null || request.getVerifyEachPage();
        return ResponseEntity.ok(facebookPageAuditService.scanManagedPages(user.getId(), id, verifyEachPage));
    }

    @PostMapping("/{id}/managed-pages")
    public ResponseEntity<Map<String, Object>> addManagedPageManually(
            @PathVariable Long id,
            @RequestBody Map<String, String> body,
            Authentication authentication
    ) {
        User user = resolveUser(authentication);
        String pageId = body.get("pageId");
        String pageName = body.get("pageName");
        if (pageId == null || pageId.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("message", "pageId là bắt buộc"));
        }
        facebookPageAuditService.addManualPage(user.getId(), id, pageId.trim(), pageName != null ? pageName.trim() : "Page " + pageId.trim().substring(Math.max(0, pageId.trim().length() - 4)));
        return ResponseEntity.ok(Map.of("message", "Đã thêm Page thành công", "pageId", pageId));
    }

    @DeleteMapping("/{id}/managed-pages/{pageId}")
    public ResponseEntity<Map<String, Object>> deleteManagedPage(
            @PathVariable Long id,
            @PathVariable String pageId,
            Authentication authentication
    ) {
        User user = resolveUser(authentication);
        facebookPageAuditService.deleteManagedPage(user.getId(), id, pageId);
        return ResponseEntity.ok(Map.of("message", "Đã xóa Page thành công", "pageId", pageId));
    }

    /**
     * Kiểm tra trực tiếp tình trạng sống/chết (Live Health Check) của Cookie tài khoản/Via qua Playwright Worker.
     */
    @PostMapping("/{id}/check-cookie-health")
    public ResponseEntity<Map<String, Object>> checkCookieHealth(@PathVariable Long id, Authentication authentication) {
        User user = resolveUser(authentication);
        SocialAccount account = socialAccountService.getAccountsByUserId(user.getId()).stream()
                .filter(a -> a.getId().equals(id))
                .findFirst().orElse(null);
        if (account == null) {
            return ResponseEntity.status(404).body(Map.of("success", false, "message", "Không tìm thấy tài khoản"));
        }
        if (account.getAccessToken() == null || account.getAccessToken().isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", "Tài khoản chưa có cookie/token"));
        }

        String status = playwrightHealthCheckService.checkCookieStatus(account.getAccessToken());
        java.time.LocalDateTime now = java.time.LocalDateTime.now();
        account.setTokenStatus(status);
        account.setTokenCheckedAt(now);
        socialAccountService.saveAccount(account);

        // Nếu đây là Via, tự động đồng bộ trạng thái kiểm tra cho toàn bộ Fanpage trực thuộc
        boolean isVia = "FACEBOOK_PROFILE".equals(account.getPlatform()) || "PERSONAL_PROFILE_COOKIE".equals(account.getAccountType());
        String cUser = extractCUser(account.getAccessToken());
        int updatedChildren = 0;
        if (isVia) {
            for (SocialAccount acc : socialAccountService.getAccountsByUserId(user.getId())) {
                if (!acc.getId().equals(account.getId())) {
                    boolean isChild = account.getId().equals(acc.getPostingIdentityAccountId());
                    String accCUser = extractCUser(acc.getAccessToken());
                    boolean sameCUser = cUser != null && cUser.equalsIgnoreCase(accCUser);
                    if (isChild || sameCUser) {
                        acc.setTokenStatus(status);
                        acc.setTokenCheckedAt(now);
                        socialAccountService.saveAccount(acc);
                        updatedChildren++;
                    }
                }
            }
        }

        return ResponseEntity.ok(Map.of(
                "success", true,
                "status", status,
                "checkedAt", now.toString(),
                "updatedChildren", updatedChildren,
                "message", "OK".equals(status) ? "Cookie hoạt động tốt!" : "EXPIRED".equals(status) ? "Cookie đã hết hạn hoặc phiên bị đăng xuất!" : "Worker trả về trạng thái không xác định"
        ));
    }

    /**
     * Đồng bộ / Thêm nhanh các Fanpage đã kiểm kê từ Via vào bảng kết nối (social_accounts) để xuất bản.
     */
    @PostMapping("/{id}/import-managed-pages")
    public ResponseEntity<Map<String, Object>> importManagedPages(
            @PathVariable Long id,
            @RequestBody(required = false) Map<String, Object> body,
            Authentication authentication
    ) {
        User user = resolveUser(authentication);
        SocialAccount via = socialAccountService.getAccountsByUserId(user.getId()).stream()
                .filter(a -> a.getId().equals(id))
                .findFirst().orElse(null);
        if (via == null) {
            return ResponseEntity.status(404).body(Map.of("success", false, "message", "Không tìm thấy nick Via"));
        }

        List<String> selectedPageIds = null;
        if (body != null && body.get("pageIds") instanceof List<?> list) {
            selectedPageIds = list.stream().map(String::valueOf).toList();
        }

        List<FacebookPageAccessDto> managedPages = facebookPageAuditService.getManagedPages(user.getId(), id);
        List<SocialAccount> userAccounts = socialAccountService.getAccountsByUserId(user.getId());
        Map<String, SocialAccount> existingByPageId = userAccounts.stream()
                .filter(a -> a.getPlatformAccountId() != null)
                .collect(Collectors.toMap(SocialAccount::getPlatformAccountId, Function.identity(), (a, b) -> a));

        int added = 0;
        int updated = 0;
        java.time.LocalDateTime now = java.time.LocalDateTime.now();

        for (FacebookPageAccessDto p : managedPages) {
            String pageId = p.getPageId();
            if (pageId == null || pageId.isBlank()) continue;
            if (selectedPageIds != null && !selectedPageIds.isEmpty() && !selectedPageIds.contains(pageId)) continue;
            // Bỏ qua nếu là chính UID của Via
            if (pageId.equals(via.getPlatformAccountId())) continue;

            SocialAccount existing = existingByPageId.get(pageId);
            if (existing != null) {
                // Đã có trong danh sách -> Cập nhật Via sở hữu và cookie mới
                existing.setPostingIdentityAccountId(via.getId());
                if (via.getAccessToken() != null && !via.getAccessToken().isBlank()) {
                    existing.setAccessToken(via.getAccessToken());
                }
                existing.setTokenStatus(via.getTokenStatus() != null ? via.getTokenStatus() : "OK");
                existing.setTokenCheckedAt(now);
                if (p.getPageName() != null && !p.getPageName().isBlank()) {
                    existing.setPageName(p.getPageName());
                }
                socialAccountService.saveAccount(existing);
                updated++;
            } else {
                // Tạo mới SocialAccount kết nối Fanpage
                SocialAccount fresh = new SocialAccount();
                fresh.setUser(user);
                fresh.setPlatform("FACEBOOK_PAGE");
                fresh.setPlatformAccountId(pageId);
                fresh.setPageName(p.getPageName() != null && !p.getPageName().isBlank() ? p.getPageName() : "Page " + pageId);
                fresh.setAccountType("PERSONAL_COOKIE");
                fresh.setAccessToken(via.getAccessToken());
                fresh.setPostingIdentityAccountId(via.getId());
                fresh.setTokenStatus(via.getTokenStatus() != null ? via.getTokenStatus() : "OK");
                fresh.setTokenCheckedAt(now);
                socialAccountService.saveAccount(fresh);
                added++;
            }
        }

        return ResponseEntity.ok(Map.of(
                "success", true,
                "addedCount", added,
                "updatedCount", updated,
                "totalCount", added + updated,
                "message", String.format("Đã đồng bộ %d Fanpage vào hệ thống (thêm mới %d, cập nhật %d).", added + updated, added, updated)
        ));
    }
}

