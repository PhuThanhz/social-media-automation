package com.autopost.saas.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(
        name = "facebook_page_accesses",
        uniqueConstraints = @UniqueConstraint(
                name = "uk_page_access_user_profile_page",
                columnNames = {"user_id", "personal_profile_id", "page_id"}
        ),
        indexes = {
                @Index(name = "idx_page_access_profile", columnList = "user_id,personal_profile_id"),
                @Index(name = "idx_page_access_status", columnList = "verification_status,last_seen_at")
        }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class FacebookPageAccess {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    @com.fasterxml.jackson.annotation.JsonIgnore
    private User user;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "source_account_id", nullable = false)
    @com.fasterxml.jackson.annotation.JsonIgnore
    private SocialAccount sourceAccount;

    @Column(name = "personal_profile_id", nullable = false, length = 100)
    private String personalProfileId;

    @Column(name = "profile_name", length = 180)
    private String profileName;

    @Column(name = "page_id", nullable = false, length = 100)
    private String pageId;

    @Column(name = "page_name", nullable = false, length = 180)
    private String pageName;

    @Column(name = "page_url", length = 1000)
    private String pageUrl;

    @Column(name = "avatar_url", length = 1500)
    private String avatarUrl;

    @Column(name = "verification_status", nullable = false, length = 30)
    private String verificationStatus; // VERIFIED, DISCOVERED, NO_ACCESS, SESSION_INVALID, NOT_SEEN

    @Column(name = "verification_message", length = 500)
    private String verificationMessage;

    @Column(name = "active", nullable = false)
    private boolean active;

    @Column(name = "first_seen_at", nullable = false)
    private LocalDateTime firstSeenAt;

    @Column(name = "last_seen_at", nullable = false)
    private LocalDateTime lastSeenAt;

    @Column(name = "last_verified_at")
    private LocalDateTime lastVerifiedAt;

    @Column(name = "last_scan_at", nullable = false)
    private LocalDateTime lastScanAt;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;
}
