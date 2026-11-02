package com.autopost.saas.config;

import com.autopost.saas.entity.GroupFlopConfig;
import com.autopost.saas.entity.SocialAccount;
import com.autopost.saas.entity.User;
import com.autopost.saas.repository.GroupFlopConfigRepository;
import com.autopost.saas.repository.SocialAccountRepository;
import com.autopost.saas.repository.UserRepository;
import com.autopost.saas.service.SocialAccountService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.CommandLineRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
@RequiredArgsConstructor
@Slf4j
public class DataInitializer implements CommandLineRunner {

    private final UserRepository userRepository;
    private final SocialAccountRepository socialAccountRepository;
    private final GroupFlopConfigRepository groupFlopConfigRepository;
    private final SocialAccountService socialAccountService;
    private final PasswordEncoder passwordEncoder;

    @org.springframework.beans.factory.annotation.Value("${desktop.mode:false}")
    private boolean desktopMode;

    @Override
    public void run(String... args) throws Exception {
        // Bản Desktop: không tạo tài khoản mặc định (mật khẩu ai cũng biết); chủ tự tạo ở lần mở đầu tiên
        if (desktopMode) {
            return;
        }

        // 1. TÀI KHOẢN ADMIN MẶC ĐỊNH (để người dùng/bạn bè đăng nhập vào hệ thống)
        User admin = userRepository.findByEmail("admin@gmail.com").orElse(null);
        if (admin == null) {
            admin = new User();
            admin.setUsername("Phú Admin");
            admin.setEmail("admin@gmail.com");
        }
        admin.setPassword(passwordEncoder.encode("123456"));
        admin = userRepository.save(admin);
        log.info("✅ Đã khởi tạo/cập nhật tài khoản mặc định: admin@gmail.com / 123456");

        // 2. CẤU HÌNH CHỐNG FLOP BÀI ĐĂNG MẶC ĐỊNH
        if (groupFlopConfigRepository.findByUserIdOrderByCreatedAtDesc(admin.getId()).isEmpty()) {
            GroupFlopConfig defaultFlop = GroupFlopConfig.builder()
                    .user(admin)
                    .groupName("Tất cả các nhóm (Mặc định)")
                    .checkAfterHours(2)
                    .checkAfterMinutes(120)
                    .minLikesThreshold(10)
                    .minCommentsThreshold(0)
                    .enabled(true)
                    .build();
            groupFlopConfigRepository.save(defaultFlop);
            log.info("✅ Đã khởi tạo cấu hình chống Flop mặc định (Check sau 2h, min 10 like)");
        }

        // 3. DỌN DẸP AN TOÀN CÁC TÀI KHOẢN / GROUP KHÔNG CÒN DÙNG (NẾU CÓ)
        List<SocialAccount> accountsToDelete = socialAccountRepository.findByUserId(admin.getId()).stream()
                .filter(a -> "242848220423686".equals(a.getPlatformAccountId())
                        || "441249175921600".equals(a.getPlatformAccountId())
                        || "406574384046789".equals(a.getPlatformAccountId())
                        || "270104621081662".equals(a.getPlatformAccountId())
                        || "chicotheotruonghocvietnam".equals(a.getPlatformAccountId())
                        || "CRAWL_SOURCE".equalsIgnoreCase(a.getAccountType())
                        || (a.getPageName() != null && a.getPageName().contains("[🎬 Phim]"))
                        || "chikhenphimhay".equals(a.getPlatformAccountId())
                        || "xemphimgixemvoi".equals(a.getPlatformAccountId())
                        || "898364887623372".equals(a.getPlatformAccountId())
                        || "w2wcartoon".equals(a.getPlatformAccountId())
                        || "khenphim".equals(a.getPlatformAccountId())
                        || "170281847022614".equals(a.getPlatformAccountId())
                        || "VietnamCinemas".equals(a.getPlatformAccountId())
                        || "@film.factoryyy".equalsIgnoreCase(a.getPlatformAccountId())
                        || "@phimtalk000".equalsIgnoreCase(a.getPlatformAccountId()))
                .toList();

        for (SocialAccount acc : accountsToDelete) {
            try {
                socialAccountService.deleteAccount(acc.getId());
                log.info("🗑️ Đã xoá an toàn group/account không dùng: {} (ID: {})", acc.getPageName(), acc.getPlatformAccountId());
            } catch (Exception e) {
                log.warn("⚠️ Không thể xoá account {}: {}", acc.getPageName(), e.getMessage());
            }
        }

        // Ghi chú: Nick Via, Fanpage, Group Facebook và Chiến dịch để người dùng tự do cấu hình
        // trực tiếp trên giao diện ("Quản lý kết nối" / "Quản lý nhóm"), không nạp cứng tài khoản cá nhân.
    }
}
