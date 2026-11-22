package com.autopost.saas.desktop;

import com.autopost.saas.entity.SocialAccount;
import com.autopost.saas.entity.User;
import com.autopost.saas.repository.SocialAccountRepository;
import com.autopost.saas.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

/**
 * Bản Desktop: group Facebook có sẵn cho mọi người dùng mới (vd group Đảo Mèo).
 * - Người dùng mới (tạo tài khoản Chủ lần đầu / Chủ thêm người dùng) → thêm ngay.
 * - Bản cài cũ cập nhật lên → bổ sung một lần cho người dùng đang có (đánh dấu bằng file trong thư mục dữ liệu),
 *   sau đó khách tự xóa group thì không bị thêm lại.
 * Group không tính vào giới hạn tài khoản của gói (PlanLimitAspect bỏ qua FACEBOOK_GROUP).
 */
@Slf4j
@Component
@ConditionalOnProperty(name = "desktop.mode", havingValue = "true")
@RequiredArgsConstructor
public class DesktopDefaultGroups {

    record DefaultGroup(String name, String groupId) {}

    /** Thêm group mặc định ở đây. Đổi danh sách → tăng MARKER để bản cài cũ được bổ sung lại một lần. */
    static final List<DefaultGroup> GROUPS = List.of(
            new DefaultGroup("🐱 Đảo Mèo 1", "263510030791508")
    );
    private static final String MARKER = "default-groups-v1.done";
    private static final String PLATFORM = "FACEBOOK_GROUP";

    private final SocialAccountRepository socialAccountRepository;
    private final UserRepository userRepository;

    public void seedFor(User user) {
        for (DefaultGroup g : GROUPS) {
            if (socialAccountRepository.findByUserIdAndPlatformAndPlatformAccountId(user.getId(), PLATFORM, g.groupId()).isPresent()) {
                continue;
            }
            SocialAccount group = new SocialAccount();
            group.setUser(user);
            group.setPlatform(PLATFORM);
            group.setPageName(g.name());
            group.setPlatformAccountId(g.groupId());
            group.setTokenStatus("OK");
            socialAccountRepository.save(group);
        }
    }

    @EventListener(ApplicationReadyEvent.class)
    public void backfillExistingUsers() {
        String dataDir = System.getenv("APP_DATA_DIR");
        if (dataDir == null || dataDir.isBlank()) return;
        Path marker = Path.of(dataDir, MARKER);
        if (Files.exists(marker)) return;
        try {
            userRepository.findAll().forEach(this::seedFor);
            Files.writeString(marker, "ok");
        } catch (Exception e) {
            log.warn("Không thêm được group mặc định: {}", e.getMessage());
        }
    }
}
