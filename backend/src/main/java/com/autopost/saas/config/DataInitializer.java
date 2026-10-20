package com.autopost.saas.config;

import com.autopost.saas.entity.Campaign;
import com.autopost.saas.entity.SocialAccount;
import com.autopost.saas.entity.User;
import com.autopost.saas.repository.CampaignRepository;
import com.autopost.saas.repository.SocialAccountRepository;
import com.autopost.saas.repository.PostTargetRepository;
import com.autopost.saas.repository.UserRepository;
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
    private final CampaignRepository campaignRepository;
    private final SocialAccountRepository socialAccountRepository;
    private final PostTargetRepository postTargetRepository;
    private final PasswordEncoder passwordEncoder;

    @Override
    public void run(String... args) throws Exception {
        User admin = userRepository.findByEmail("admin@gmail.com").orElse(null);
        if (admin == null) {
            admin = new User();
            admin.setUsername("Admin");
            admin.setEmail("admin@gmail.com");
        }
        admin.setPassword(passwordEncoder.encode("123456"));
        admin = userRepository.save(admin);
        log.info("✅ Đã khởi tạo/cập nhật tài khoản mặc định: admin@gmail.com / 123456");

        // Tự động tạo Chiến dịch cào bài trên THREADS.NET với Từ khóa "mèo"
        if (campaignRepository.findByUserId(admin.getId()).isEmpty()) {
            Campaign threadsCatCampaign = Campaign.builder()
                    .user(admin)
                    .name("🧵 Chiến dịch Cào Threads.net (Từ khóa: mèo)")
                    .sourceUrl("https://www.threads.net/search?q=mèo")
                    .sourceType("THREADS")
                    .targetFanpageIds("61584834510803")
                    .aiRewriteEnabled(true)
                    .postingIntervalMinutes(30)
                    .cronExpression("Mỗi 5 phút")
                    .status("ACTIVE")
                    .build();
            campaignRepository.save(threadsCatCampaign);

            Campaign catCampaignReddit = Campaign.builder()
                    .user(admin)
                    .name("🐱 Chiến dịch Cào Mèo Đáng Yêu Reddit (/r/cats)")
                    .sourceUrl("https://www.reddit.com/r/cats/hot.rss")
                    .sourceType("RSS_FEED")
                    .targetFanpageIds("61584834510803")
                    .aiRewriteEnabled(true)
                    .postingIntervalMinutes(45)
                    .cronExpression("Mỗi 10 phút")
                    .status("ACTIVE")
                    .build();
            campaignRepository.save(catCampaignReddit);

            log.info("✅ Đã tự động tạo Chiến dịch cào bài Threads.net với từ khóa 'mèo'!");
        }

        // Chỉ dùng secret từ biến môi trường khi cài mới. Tuyệt đối không hard-code hoặc ghi đè
        // cookie người dùng vừa cập nhật trên màn hình Kết nối mỗi khi backend khởi động lại.
        seedFanpage(admin, "🐱 Fanpage Làm Sen (Nick Thành An)", "61584834510803",
                System.getenv("FACEBOOK_LAM_SEN_COOKIE"));

        // Tự động khởi tạo Fanpage Vĩnh Viễn với Page Access Token (Meta Graph API Engine)
        seedPageTokenFanpage(admin, "🐱 Fanpage Graph API (Token Vĩnh Viễn)", "952969537889415",
                System.getenv("FACEBOOK_PAGE_ACCESS_TOKEN"));

        // Tự động khởi tạo các Group Facebook
        seedFacebookGroup(admin, "🐱 Đảo Mèo 1", "263510030791508");
        seedFacebookGroup(admin, "Sài Gòn ơi, ăn gì?", "964362037266166");
        seedFacebookGroup(admin, "Hội Những Người Tin Mình Sắp Giàu", "2035252243920945");
        seedFacebookGroup(admin, "Sống cùng tiểu đường tim mạch cao huyết áp", "510277186406856");
        seedFacebookGroup(admin, "GenZ làm mẹ (400k member)", "773774567089399");
        seedFacebookGroup(admin, "🐶 Tinder Pets Việt Nam by InterPetFest", "1195776878326307");
        seedFacebookGroup(admin, "Ê, biết tin gì chưa?", "1590316894437844");
        seedFacebookGroup(admin, "Cinema Hà Nội", "352102219461769");

        seedTikTokCampaign(admin, "🎬 Cào TikTok: FILM FACTORY (@film.factoryyy)", "https://www.tiktok.com/@film.factoryyy");
        seedTikTokCampaign(admin, "🎬 Cào TikTok: PhimTalk (@phimtalk000)", "https://www.tiktok.com/@phimtalk000");

        // Dọn dẹp các Group trùng lặp hoặc đã bị xoá khỏi hệ thống nếu còn tồn tại trong DB
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
                postTargetRepository.deleteBySocialAccount_Id(acc.getId());
                socialAccountRepository.delete(acc);
                log.info("🗑️ Đã xoá vĩnh viễn group không dùng: {} (ID: {})", acc.getPageName(), acc.getPlatformAccountId());
            } catch (Exception e) {
                log.warn("⚠️ Không thể xoá group {}: {}", acc.getPageName(), e.getMessage());
            }
        }
    }

    private void seedPageTokenFanpage(User user, String pageName, String pageId, String pageToken) {
        SocialAccount acc = socialAccountRepository.findByUserId(user.getId()).stream()
                .filter(a -> pageId.equals(a.getPlatformAccountId()) && "PAGE_TOKEN".equals(a.getAccountType()))
                .findFirst()
                .orElse(null);
        if (acc == null) {
            if (pageToken == null || pageToken.isBlank()) {
                log.info("ℹ️ Bỏ qua seed PAGE_TOKEN {} vì chưa cấu hình FACEBOOK_PAGE_ACCESS_TOKEN.", pageName);
                return;
            }
            acc = SocialAccount.builder()
                    .user(user)
                    .platform("FACEBOOK_PAGE")
                    .platformAccountId(pageId)
                    .pageName(pageName)
                    .accountType("PAGE_TOKEN")
                    .accessToken(pageToken)
                    .tokenStatus("OK")
                    .build();
            socialAccountRepository.save(acc);
            log.info("✅ Đã tự động khởi tạo kết nối Fanpage PAGE_TOKEN Vĩnh Viễn: {} (ID: {})", pageName, pageId);
        } else {
            log.info("ℹ️ Giữ nguyên PAGE_TOKEN hiện có cho {} (connection #{}), không ghi đè lúc khởi động.", pageName, acc.getId());
        }
    }

    private void seedFanpage(User user, String pageName, String pageId, String cookieString) {
        SocialAccount acc = socialAccountRepository.findByUserId(user.getId()).stream()
                .filter(a -> pageId.equals(a.getPlatformAccountId())
                        && "FACEBOOK_PAGE".equals(a.getPlatform())
                        && "PERSONAL_COOKIE".equals(a.getAccountType()))
                .findFirst()
                .orElse(null);
        if (acc == null) {
            if (cookieString == null || cookieString.isBlank()) {
                log.info("ℹ️ Bỏ qua seed Cookie {} vì chưa cấu hình FACEBOOK_LAM_SEN_COOKIE.", pageName);
                return;
            }
            acc = SocialAccount.builder()
                    .user(user)
                    .platform("FACEBOOK_PAGE")
                    .platformAccountId(pageId)
                    .pageName(pageName)
                    .accountType("PERSONAL_COOKIE")
                    .accessToken(cookieString)
                    .build();
            socialAccountRepository.save(acc);
            log.info("✅ Đã khởi tạo kết nối Fanpage: {} (ID: {}) với Playwright Cookie!", pageName, pageId);
        } else {
            log.info("ℹ️ Giữ nguyên cookie hiện có cho {} (connection #{}), không ghi đè lúc khởi động.", pageName, acc.getId());
        }
    }

    private void seedFacebookGroup(User user, String pageName, String groupId) {
        SocialAccount groupAcc = socialAccountRepository.findByUserId(user.getId()).stream()
                .filter(a -> groupId.equals(a.getPlatformAccountId()))
                .findFirst()
                .orElse(null);
        if (groupAcc == null) {
            groupAcc = SocialAccount.builder()
                    .user(user)
                    .platform("FACEBOOK_GROUP")
                    .platformAccountId(groupId)
                    .pageName(pageName)
                    .accountType("PERSONAL_COOKIE")
                    .build();
            socialAccountRepository.save(groupAcc);
            log.info("✅ Đã khởi tạo kết nối Group Facebook: {} (ID: {})", pageName, groupId);
        } else if (!pageName.equals(groupAcc.getPageName())) {
            groupAcc.setPageName(pageName);
            socialAccountRepository.save(groupAcc);
            log.info("✅ Đã cập nhật tên Group Facebook: {} (ID: {})", pageName, groupId);
        }
    }

    private void seedTikTokCampaign(User user, String campaignName, String sourceUrl) {
        boolean exists = campaignRepository.findByUserId(user.getId()).stream()
                .anyMatch(c -> sourceUrl.equalsIgnoreCase(c.getSourceUrl()));
        if (!exists) {
            Campaign c = Campaign.builder()
                    .user(user)
                    .name(campaignName)
                    .sourceUrl(sourceUrl)
                    .sourceType("TIKTOK")
                    .status("ACTIVE")
                    .postingIntervalMinutes(60)
                    .maxItemsPerScrape(15)
                    .aiRewriteEnabled(false)
                    .build();
            campaignRepository.save(c);
            log.info("✅ Đã khởi tạo chiến dịch cào TikTok: {}", campaignName);
        }
    }
}
