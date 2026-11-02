package com.autopost.saas.entity;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(name = "campaigns", indexes = {
        @Index(name = "idx_campaigns_status", columnList = "status"),
        @Index(name = "idx_campaigns_user_status", columnList = "user_id, status")
})
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Campaign {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    @JsonIgnore
    private User user;

    @Column(nullable = false, length = 100)
    private String name;

    @Column(name = "source_url", length = 500)
    private String sourceUrl; // Vd: Link RSS Feed hoặc Website

    @Column(name = "source_type", length = 50)
    private String sourceType; // RSS_FEED, WEBSITE_CRAWLER, FB_PAGE

    @Column(name = "target_fanpage_ids", length = 500)
    private String targetFanpageIds; // ID fanpage hoặc danh sách phân cách bởi dấu phẩy

    @Builder.Default
    @Column(name = "ai_rewrite_enabled")
    private Boolean aiRewriteEnabled = false;

    @Builder.Default
    @Column(name = "posting_interval_minutes")
    private Integer postingIntervalMinutes = 60;

    @Builder.Default
    @Column(name = "max_items_per_scrape")
    private Integer maxItemsPerScrape = 10; // Số bài tối đa lấy về mỗi lần cào nguồn

    @Column(name = "cron_expression", length = 50)
    private String cronExpression; // Cron 6 field chuẩn Spring, vd: 0 0 9 * * * (mỗi ngày 9h sáng). Null/rỗng = quét mỗi 5 phút (mặc định cũ).

    @Column(name = "last_scraped_at")
    private LocalDateTime lastScrapedAt;

    @Column(nullable = false, length = 20)
    private String status; // ACTIVE, PAUSED, DRAFT

    @Column(name = "n8n_webhook_url", length = 500)
    private String n8nWebhookUrl;

    @Column(name = "affiliate_link", length = 1000)
    private String affiliateLink; // Link affiliate tự động comment vào MỌI bài đăng thuộc chiến dịch này

    @Builder.Default
    @Column(name = "enable_group_comment")
    private Boolean enableGroupComment = false; // Opt-in: chỉ bình luận affiliateLink vào bài đăng trong Nhóm khi người dùng tick bật ở giao diện

    @Builder.Default
    @Column(name = "include_credit")
    private Boolean includeCredit = true; // Bật/tắt đính kèm Cre: @Tên_Tác_Giả

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;
}
