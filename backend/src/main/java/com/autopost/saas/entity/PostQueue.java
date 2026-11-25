package com.autopost.saas.entity;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(
        name = "post_queue",
        indexes = {
                @Index(name = "idx_post_queue_status_scheduled_id", columnList = "status, scheduled_at, id"),
                @Index(name = "idx_post_queue_status_updated", columnList = "status, updated_at"),
                @Index(name = "idx_post_queue_published_at", columnList = "published_at"),
                @Index(name = "idx_post_queue_target_fanpage_id", columnList = "target_fanpage_id"),
                @Index(name = "idx_post_queue_content_hash", columnList = "content_hash")
        })
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class PostQueue {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "campaign_id", nullable = false)
    @JsonIgnoreProperties({"hibernateLazyInitializer", "handler", "user"})
    private Campaign campaign;

    @Column(name = "original_url", columnDefinition = "TEXT")
    private String originalUrl;

    @Column(name = "content_hash", length = 64)
    private String contentHash; // SHA-256 của nội dung bài viết đã chuẩn hoá, dùng để dedup thay cho original_url (originalUrl có thể trùng nhau giữa nhiều bài khác nội dung khi Playwright không tìm thấy permalink riêng và fallback về URL của Group/Page nguồn).

    @Column(length = 300)
    private String title;

    @Column(columnDefinition = "TEXT")
    private String content;

    @Column(name = "media_urls", columnDefinition = "TEXT")
    private String mediaUrls;

    @Column(nullable = false, length = 20)
    private String status; // PENDING, PUBLISHED, FAILED, CANCELLED

    @Column(name = "target_fanpage_id", length = 100)
    private String targetFanpageId;

    @Column(name = "post_type", length = 20)
    private String postType; // FEED (mặc định, kể cả khi null) hoặc STORY

    // Phông nền cho status nền màu (COLOR_BACKGROUND): RED, RAINBOW, PURPLE... — null = RED như cũ.
    // Danh sách preset ở worker/fb-background.js.
    @Column(name = "background_preset", length = 30)
    private String backgroundPreset;

    @Column(name = "scheduled_at")
    private LocalDateTime scheduledAt;

    // true = bài bị dời sang ngày sau vì nick không kịp đăng hết trong khung giờ đăng (chờ người dùng
    // duyệt chuyển sang nick khác hoặc để nguyên)
    @Column(name = "window_deferred")
    private Boolean windowDeferred;

    @Column(name = "published_at")
    private LocalDateTime publishedAt;

    @Column(name = "execution_duration_seconds")
    private Integer executionDurationSeconds; // Thời gian Playwright thực tế chạy đăng bài (tính bằng giây)

    @Column(name = "error_message", columnDefinition = "TEXT")
    private String errorMessage;

    @Column(name = "fb_post_id", length = 100)
    private String fbPostId; // ID bài viết thật trên Facebook sau khi đăng qua Graph API (dạng pageId_postId) — dùng để lấy insights sau này. Null nếu đăng qua Playwright hoặc chưa đăng.

    @Column(name = "affiliate_link", columnDefinition = "TEXT")
    private String affiliateLink; // Link affiliate hoặc nội dung bình luận — có thể chứa full bài báo khi dùng Status nền đỏ

    @Builder.Default
    @Column(name = "enable_group_comment")
    private Boolean enableGroupComment = false; // Opt-in: chỉ bình luận affiliateLink vào bài đăng trong Nhóm khi người dùng tick bật ở giao diện. Không ảnh hưởng bài đăng lên Fanpage (leg đó tự bình luận mặc định).

    @Column(name = "target_group_names", columnDefinition = "TEXT")
    private String targetGroupNames; // Tên các Group Facebook cần share thêm (cách nhau bởi dấu phẩy), chỉ áp dụng khi đăng qua Playwright dạng Reel

    @Column(name = "published_post_url", columnDefinition = "TEXT")
    private String publishedPostUrl; // Link bài viết thật trên Facebook sau khi đăng (tường Fanpage hoặc GROUP_ONLY), dùng cho Lịch sử/Báo cáo. Null nếu chưa đăng hoặc không dò được link.

    @Column(name = "published_group_post_urls", columnDefinition = "TEXT")
    private String publishedGroupPostUrls; // Link các bài đã đăng vào từng Group trong targetGroupNames (thứ tự khớp nhau), cách nhau bởi dấu phẩy.

    @Builder.Default
    @Column(name = "retry_count")
    private Integer retryCount = 0; // Số lần đã tự động thử lại khi đăng lỗi (giới hạn MAX_RETRY)

    @Column(name = "locked_by", length = 100)
    private String lockedBy; // Worker URL hoặc Thread đang chiếm quyền lease (vd: http://localhost:3001)

    @Column(name = "lock_token", length = 64)
    private String lockToken; // Fencing token ngẫu nhiên chống race condition

    @Column(name = "locked_at")
    private LocalDateTime lockedAt; // Thời điểm cấp lease

    @Column(name = "lease_expires_at")
    private LocalDateTime leaseExpiresAt; // Thời điểm hết hạn lease

    @Builder.Default
    @Column(name = "attempt_count")
    private Integer attemptCount = 0; // Tổng số lượt thực thi

    @Column(name = "last_attempt_id", length = 64)
    private String lastAttemptId; // UUID của lượt thực thi gần nhất

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;
}
