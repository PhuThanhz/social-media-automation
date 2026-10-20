package com.autopost.saas.entity;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(name = "group_flop_configs")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class GroupFlopConfig {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    @JsonIgnoreProperties({"hibernateLazyInitializer", "handler", "password"})
    private User user;

    @Column(name = "group_name", nullable = false, length = 255)
    private String groupName;

    @Column(name = "group_url", length = 500)
    private String groupUrl;

    @Column(name = "social_account_id")
    private Long socialAccountId; // Null = tất cả tài khoản, hoặc ID SocialAccount chỉ định

    @Column(name = "social_account_name", length = 150)
    private String socialAccountName;

    @Builder.Default
    @Column(name = "check_after_hours")
    private Integer checkAfterHours = 2; // Mặc định 2 tiếng

    @Builder.Default
    @Column(name = "check_after_minutes")
    private Integer checkAfterMinutes = 120; // Mặc định 120 phút

    @Builder.Default
    @Column(name = "min_likes_threshold")
    private Integer minLikesThreshold = 10; // Mặc định 10 likes

    @Builder.Default
    @Column(name = "min_comments_threshold")
    private Integer minCommentsThreshold = 0; // Mặc định 0 comment

    @Builder.Default
    @Column(name = "enabled")
    private Boolean enabled = true;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;
}
