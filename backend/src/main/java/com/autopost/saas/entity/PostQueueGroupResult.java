package com.autopost.saas.entity;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

/**
 * Log kết quả đăng vào từng Group cụ thể (1 dòng / 1 lần thử đăng vào 1 Group). Cần thiết vì
 * PostQueue.publishedGroupPostUrls (chuỗi URL cách nhau dấu phẩy) không đảm bảo cùng thứ tự/độ dài
 * với targetGroupNames khi có lỗi 1 phần — không thể suy ra chính xác "đã đăng vào Group nào" từ đó.
 * Bảng này là nguồn dữ liệu chính xác để tính KPI theo từng Group.
 */
@Entity
@Table(name = "post_queue_group_result")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class PostQueueGroupResult {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "post_queue_id", nullable = false)
    @JsonIgnoreProperties({"hibernateLazyInitializer", "handler", "campaign"})
    private PostQueue postQueue;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "social_account_id", nullable = false)
    @JsonIgnoreProperties({"hibernateLazyInitializer", "handler", "user"})
    private SocialAccount socialAccount; // Group cụ thể đã thử đăng

    @Column(nullable = false, length = 20)
    private String status; // PUBLISHED, FAILED

    @Column(name = "post_url", length = 500)
    private String postUrl;

    @Column(name = "error_message", columnDefinition = "TEXT")
    private String errorMessage;

    @Column(name = "attempted_at", nullable = false)
    private LocalDateTime attemptedAt;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;
}
