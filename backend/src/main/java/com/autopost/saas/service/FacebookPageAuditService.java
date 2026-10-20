package com.autopost.saas.service;

import com.autopost.saas.dto.FacebookPageAccessDto;
import com.autopost.saas.dto.FacebookPageScanResponseDto;
import com.autopost.saas.entity.FacebookPageAccess;
import com.autopost.saas.entity.SocialAccount;
import com.autopost.saas.repository.FacebookPageAccessRepository;
import com.autopost.saas.repository.SocialAccountRepository;
import com.autopost.saas.util.PooledRestTemplateFactory;
import com.autopost.saas.util.WorkerRetryHelper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestTemplate;

import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
@RequiredArgsConstructor
@Slf4j
public class FacebookPageAuditService {

    private static final Pattern C_USER_PATTERN = Pattern.compile("(?:^|;\\s*)c_user=([^;]+)", Pattern.CASE_INSENSITIVE);

    private final FacebookPageAccessRepository pageAccessRepository;
    private final SocialAccountRepository socialAccountRepository;
    private final RestTemplate auditRestTemplate = PooledRestTemplateFactory.create(10_000, 600_000);

    @Value("${worker.base-url:http://localhost:3001}")
    private String workerBaseUrl;

    @Transactional(readOnly = true)
    public List<FacebookPageAccessDto> getManagedPages(Long userId, Long sourceAccountId) {
        SocialAccount source = requirePersonalCookieAccount(userId, sourceAccountId);
        String personalProfileId = extractPersonalProfileId(source.getAccessToken());
        return pageAccessRepository
                .findByUserIdAndPersonalProfileIdOrderByActiveDescPageNameAsc(userId, personalProfileId)
                .stream()
                .map(this::toDto)
                .toList();
    }

    @SuppressWarnings("unchecked")
    public FacebookPageScanResponseDto scanManagedPages(Long userId, Long sourceAccountId, boolean verifyEachPage) {
        SocialAccount source = requirePersonalCookieAccount(userId, sourceAccountId);
        String personalProfileId = extractPersonalProfileId(source.getAccessToken());

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        Map<String, Object> body = new HashMap<>();
        body.put("cookieString", source.getAccessToken());
        body.put("verifyEachPage", verifyEachPage);

        Map<String, Object> workerResponse;
        try {
            workerResponse = WorkerRetryHelper.postWithConnectionRetry(
                    auditRestTemplate,
                    workerBaseUrl + "/api/scan-managed-pages",
                    new HttpEntity<>(body, headers),
                    Map.class
            );
        } catch (HttpStatusCodeException exception) {
            HttpStatus status = exception.getStatusCode().value() == 401 ? HttpStatus.BAD_REQUEST : HttpStatus.BAD_GATEWAY;
            throw new ResponseStatusException(status, readWorkerError(exception.getResponseBodyAsString()), exception);
        } catch (Exception exception) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_GATEWAY,
                    "Không kết nối được Playwright Worker để quét Page: " + exception.getMessage(),
                    exception
            );
        }

        if (workerResponse == null || !Boolean.TRUE.equals(workerResponse.get("success"))) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Worker không trả về kết quả quét Page hợp lệ.");
        }

        String responseProfileId = stringValue(workerResponse.get("personalProfileId"));
        if (!personalProfileId.equals(responseProfileId)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Danh tính c_user trả về không khớp via đang quét.");
        }

        LocalDateTime scannedAt = parseDateTime(workerResponse.get("scannedAt"), LocalDateTime.now());
        String profileName = trimTo(stringValue(workerResponse.get("profileName")), 180, "Tài khoản Facebook");
        boolean scanComplete = Boolean.TRUE.equals(workerResponse.get("scanComplete"));
        List<Map<String, Object>> rawPages = workerResponse.get("pages") instanceof List<?> list
                ? list.stream().filter(Map.class::isInstance).map(item -> (Map<String, Object>) item).toList()
                : List.of();

        Set<String> seenPageIds = new HashSet<>();
        List<FacebookPageAccessDto> resultPages = new ArrayList<>();
        for (Map<String, Object> rawPage : rawPages) {
            String pageId = trimTo(stringValue(rawPage.get("pageId")), 100, null);
            if (pageId == null || pageId.isBlank() || pageId.equals(personalProfileId) || !seenPageIds.add(pageId)) continue;

            FacebookPageAccess access = pageAccessRepository
                    .findByUserIdAndPersonalProfileIdAndPageId(userId, personalProfileId, pageId)
                    .orElseGet(() -> FacebookPageAccess.builder()
                            .user(source.getUser())
                            .personalProfileId(personalProfileId)
                            .pageId(pageId)
                            .firstSeenAt(scannedAt)
                            .build());

            String verificationStatus = trimTo(stringValue(rawPage.get("verificationStatus")), 30, "DISCOVERED");
            access.setSourceAccount(source);
            access.setProfileName(profileName);
            access.setPageName(trimTo(stringValue(rawPage.get("name")), 180, "Facebook Page " + pageId));
            access.setPageUrl(trimTo(stringValue(rawPage.get("url")), 1000, "https://www.facebook.com/profile.php?id=" + pageId));
            access.setAvatarUrl(trimTo(stringValue(rawPage.get("avatarUrl")), 1500, null));
            access.setVerificationStatus(verificationStatus);
            access.setVerificationMessage(trimTo(stringValue(rawPage.get("verificationMessage")), 500, null));
            access.setActive("VERIFIED".equals(verificationStatus) || "DISCOVERED".equals(verificationStatus));
            access.setLastSeenAt(scannedAt);
            access.setLastScanAt(scannedAt);
            if ("VERIFIED".equals(verificationStatus)) {
                access.setLastVerifiedAt(parseDateTime(rawPage.get("verifiedAt"), scannedAt));
            }
            FacebookPageAccess saved = pageAccessRepository.save(access);
            FacebookPageAccessDto dto = toDto(saved);
            dto.setSources(stringList(rawPage.get("sources")));
            resultPages.add(dto);
        }

        // Tự động liên kết các Fanpage trong social_accounts trùng với các Page vừa kiểm kê vào Via này
        if (!seenPageIds.isEmpty()) {
            List<SocialAccount> userAccounts = socialAccountRepository.findByUserId(userId);
            for (SocialAccount acc : userAccounts) {
                if (acc.getPlatformAccountId() != null && seenPageIds.contains(acc.getPlatformAccountId())) {
                    // Page đang đăng bằng một nick khác còn sống thì giữ nguyên, tránh chuyển nhầm Page chính sang Via khác
                    String currentOwner = acc.getAccessToken() != null && acc.getAccessToken().contains("c_user")
                            ? extractPersonalProfileId(acc.getAccessToken()) : null;
                    String ownerStatus = acc.getTokenStatus();
                    boolean ownerAlive = ownerStatus == null || (!"EXPIRED".equals(ownerStatus) && !"CHECKPOINT".equals(ownerStatus));
                    if (currentOwner != null && !currentOwner.equals(personalProfileId) && ownerAlive) {
                        log.info("⏭️ [PageAudit] Bỏ qua liên kết Page '{}' (ID: {}): đang thuộc nick {} còn hoạt động.",
                                acc.getPageName(), acc.getId(), currentOwner);
                        continue;
                    }
                    boolean changed = false;
                    if (!source.getId().equals(acc.getPostingIdentityAccountId())) {
                        acc.setPostingIdentityAccountId(source.getId());
                        changed = true;
                    }
                    if (source.getAccessToken() != null && !source.getAccessToken().equals(acc.getAccessToken())) {
                        acc.setAccessToken(source.getAccessToken());
                        acc.setTokenStatus("OK");
                        acc.setTokenCheckedAt(LocalDateTime.now());
                        changed = true;
                    } else if ("OK".equals(source.getTokenStatus()) && "EXPIRED".equals(acc.getTokenStatus())) {
                        acc.setTokenStatus("OK");
                        acc.setTokenCheckedAt(LocalDateTime.now());
                        changed = true;
                    }
                    if (changed) {
                        socialAccountRepository.save(acc);
                        log.info("🔗 [PageAudit] Tự động liên kết Page '{}' (ID: {}) vào Via '{}' (ID: {}) và đồng bộ cookie mới nhất.",
                                acc.getPageName(), acc.getId(), source.getPageName(), source.getId());
                    }
                }
            }
        }

        // Chỉ đánh dấu "không còn thấy" khi worker đã thật sự cuộn một nguồn tới cuối. Không xoá bản
        // ghi cũ vì lịch sử này giúp phát hiện Page vừa bị gỡ quyền hoặc Facebook tạm tải thiếu.
        if (scanComplete) {
            for (FacebookPageAccess oldAccess : pageAccessRepository
                    .findByUserIdAndPersonalProfileIdOrderByActiveDescPageNameAsc(userId, personalProfileId)) {
                if (!seenPageIds.contains(oldAccess.getPageId())) {
                    oldAccess.setActive(false);
                    oldAccess.setVerificationStatus("NOT_SEEN");
                    oldAccess.setVerificationMessage("Không còn xuất hiện trong lần quét đầy đủ gần nhất; cần quét lại để xác nhận mất quyền.");
                    oldAccess.setLastScanAt(scannedAt);
                    pageAccessRepository.save(oldAccess);
                    resultPages.add(toDto(oldAccess));
                }
            }
        }

        Set<String> responsePageIds = resultPages.stream()
                .map(FacebookPageAccessDto::getPageId)
                .collect(java.util.stream.Collectors.toSet());
        for (FacebookPageAccess storedAccess : pageAccessRepository
                .findByUserIdAndPersonalProfileIdOrderByActiveDescPageNameAsc(userId, personalProfileId)) {
            if (responsePageIds.add(storedAccess.getPageId())) resultPages.add(toDto(storedAccess));
        }

        resultPages.sort(Comparator
                .comparing(FacebookPageAccessDto::isActive).reversed()
                .thenComparing(FacebookPageAccessDto::getPageName, Comparator.nullsLast(String.CASE_INSENSITIVE_ORDER)));
        int verifiedCount = (int) resultPages.stream()
                .filter(page -> "VERIFIED".equals(page.getVerificationStatus()))
                .count();

        log.info("Đã lưu kiểm kê Page cho via {}: {} mục, {} đã xác minh", personalProfileId, resultPages.size(), verifiedCount);
        return FacebookPageScanResponseDto.builder()
                .success(true)
                .personalProfileId(personalProfileId)
                .profileName(profileName)
                .totalFound(seenPageIds.size())
                .verifiedCount(verifiedCount)
                .scanComplete(scanComplete)
                .scannedAt(scannedAt)
                .attemptedSources(stringList(workerResponse.get("attemptedSources")))
                .completedSources(stringList(workerResponse.get("completedSources")))
                .pages(resultPages)
                .build();
    }

    private SocialAccount requirePersonalCookieAccount(Long userId, Long sourceAccountId) {
        SocialAccount source = socialAccountRepository.findByIdAndUserId(sourceAccountId, userId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Không tìm thấy via thuộc tài khoản hiện tại."));
        if ((source.getAccountType() != null
                && !"PERSONAL_COOKIE".equals(source.getAccountType())
                && !"PERSONAL_PROFILE_COOKIE".equals(source.getAccountType()))
                || source.getAccessToken() == null || source.getAccessToken().isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Chỉ có thể quét Page từ via dùng Facebook Cookie hợp lệ.");
        }
        extractPersonalProfileId(source.getAccessToken());
        return source;
    }

    private String extractPersonalProfileId(String cookieString) {
        Matcher matcher = C_USER_PATTERN.matcher(cookieString == null ? "" : cookieString);
        if (!matcher.find() || matcher.group(1).isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Cookie thiếu c_user nên không xác định được nick cá nhân.");
        }
        return matcher.group(1).trim();
    }

    private FacebookPageAccessDto toDto(FacebookPageAccess access) {
        return FacebookPageAccessDto.builder()
                .id(access.getId())
                .personalProfileId(access.getPersonalProfileId())
                .profileName(access.getProfileName())
                .pageId(access.getPageId())
                .pageName(access.getPageName())
                .pageUrl(access.getPageUrl())
                .avatarUrl(access.getAvatarUrl())
                .verificationStatus(access.getVerificationStatus())
                .verificationMessage(access.getVerificationMessage())
                .active(access.isActive())
                .firstSeenAt(access.getFirstSeenAt())
                .lastSeenAt(access.getLastSeenAt())
                .lastVerifiedAt(access.getLastVerifiedAt())
                .lastScanAt(access.getLastScanAt())
                .build();
    }

    private static String stringValue(Object value) {
        return value == null ? null : String.valueOf(value).trim();
    }

    private static String trimTo(String value, int maxLength, String fallback) {
        String normalized = value == null || value.isBlank() ? fallback : value.trim();
        if (normalized == null || normalized.length() <= maxLength) return normalized;
        return normalized.substring(0, maxLength);
    }

    private static LocalDateTime parseDateTime(Object value, LocalDateTime fallback) {
        if (value == null) return fallback;
        try {
            return OffsetDateTime.parse(String.valueOf(value)).toLocalDateTime();
        } catch (DateTimeParseException ignored) {
            try {
                return LocalDateTime.parse(String.valueOf(value));
            } catch (DateTimeParseException ignoredAgain) {
                return fallback;
            }
        }
    }

    private static List<String> stringList(Object rawValue) {
        if (!(rawValue instanceof List<?> list)) return List.of();
        return list.stream().filter(Objects::nonNull).map(String::valueOf).toList();
    }

    private static String readWorkerError(String responseBody) {
        if (responseBody == null || responseBody.isBlank()) return "Worker quét Page thất bại.";
        Matcher matcher = Pattern.compile("\\\"error\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"").matcher(responseBody);
        return matcher.find() ? matcher.group(1) : "Worker quét Page thất bại.";
    }

    @Transactional
    public void addManualPage(Long userId, Long sourceAccountId, String pageId, String pageName) {
        SocialAccount source = requirePersonalCookieAccount(userId, sourceAccountId);
        String personalProfileId = extractPersonalProfileId(source.getAccessToken());

        // Kiểm tra đã tồn tại chưa
        boolean exists = pageAccessRepository
                .findByUserIdAndPersonalProfileIdOrderByActiveDescPageNameAsc(userId, personalProfileId)
                .stream()
                .anyMatch(p -> pageId.equals(p.getPageId()));
        if (exists) return; // Đã có rồi, bỏ qua

        LocalDateTime now = LocalDateTime.now();
        FacebookPageAccess access = FacebookPageAccess.builder()
                .user(source.getUser())
                .sourceAccount(source)
                .personalProfileId(personalProfileId)
                .profileName(source.getPageName())
                .pageId(pageId)
                .pageName(pageName != null && !pageName.isBlank() ? pageName : "Page " + pageId)
                .pageUrl("https://www.facebook.com/profile.php?id=" + pageId)
                .verificationStatus("DISCOVERED")
                .active(true)
                .firstSeenAt(now)
                .lastSeenAt(now)
                .lastScanAt(now)
                .build();
        pageAccessRepository.save(access);
    }

    @Transactional
    public void deleteManagedPage(Long userId, Long sourceAccountId, String pageId) {
        SocialAccount source = requirePersonalCookieAccount(userId, sourceAccountId);
        String personalProfileId = extractPersonalProfileId(source.getAccessToken());

        pageAccessRepository
                .findByUserIdAndPersonalProfileIdOrderByActiveDescPageNameAsc(userId, personalProfileId)
                .stream()
                .filter(p -> pageId.equals(p.getPageId()))
                .findFirst()
                .ifPresent(pageAccessRepository::delete);
    }
}
