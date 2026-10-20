package com.autopost.saas.entity;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(name = "social_accounts")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class SocialAccount {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    @JsonIgnoreProperties({"hibernateLazyInitializer", "handler", "password"})
    private User user;

    @Column(nullable = false, length = 50)
    private String platform; // Vd: FACEBOOK_PAGE, TWITTER, WORDPRESS

    @Column(name = "platform_account_id", length = 100)
    private String platformAccountId; // ID của fanpage hoặc user bên nền tảng thứ 3

    @Column(name = "access_token", columnDefinition = "TEXT")
    private String accessToken;

    @Column(name = "page_name", length = 150)
    private String pageName;

    @Column(name = "account_type", length = 50)
    private String accountType; // PERSONAL_COOKIE, PERSONAL_PROFILE_COOKIE (via chỉ để kiểm kê), PAGE_TOKEN

    @Column(name = "token_status", length = 20)
    private String tokenStatus; // OK, EXPIRING_SOON, EXPIRED, UNKNOWN — áp dụng cho cả PAGE_TOKEN (debug_token Graph API)
                                 // và PERSONAL_COOKIE (kiểm tra chủ động qua Playwright, chỉ có OK/EXPIRED/UNKNOWN)

    @Column(name = "token_expires_at")
    private LocalDateTime tokenExpiresAt; // null nếu token không có hạn (never expires)

    @Column(name = "token_checked_at")
    private LocalDateTime tokenCheckedAt;

    @Column(name = "max_posts_per_day")
    private Integer maxPostsPerDay; // null = không giới hạn

    @Column(name = "backup_account_id")
    private Long backupAccountId; // ID của SocialAccount khác dùng thay thế khi account này lỗi do token/cookie hết hạn (null = không có dự phòng)

    @Column(name = "group_health_status", length = 30)
    private String groupHealthStatus; // JOINED, PENDING_APPROVAL, KICKED_OR_NOT_JOINED, PRIVATE_NO_ACCESS, UNKNOWN

    @Column(name = "group_health_checked_at")
    private LocalDateTime groupHealthCheckedAt;

    @Column(name = "fallback_group_id")
    private Long fallbackGroupId; // ID của SocialAccount Group khác dùng dự phòng khi Group này bị Kick/rời nhóm

    @Column(name = "posting_identity_account_id")
    private Long postingIdentityAccountId; // Chỉ áp dụng cho platform=FACEBOOK_GROUP: ID SocialAccount Fanpage (PERSONAL_COOKIE) mặc định sẽ dùng để đăng vào Group này khi bài không chỉ định rõ Fanpage — người dùng tự chọn.

    @Column(name = "proxy_url", length = 255)
    private String proxyUrl; // Proxy HTTP/SOCKS5 riêng cho account này (Vd: http://user:pass@123.45.67.89:8080) để chống văng cookie do lệch IP.

    @Column(name = "user_agent", columnDefinition = "TEXT")
    private String userAgent; // User-Agent gốc khi lấy cookie để Playwright giả lập chuẩn 100% môi trường trình duyệt.

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;
}
