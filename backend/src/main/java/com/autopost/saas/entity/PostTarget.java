package com.autopost.saas.entity;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDate;
import java.time.LocalDateTime;

/** Mục tiêu KPI số bài cần đăng cho 1 Fanpage/Group cụ thể vào 1 ngày cụ thể (đặt trước được). */
@Entity
@Table(name = "post_target",
       uniqueConstraints = @UniqueConstraint(name = "uk_post_target_account_date",
               columnNames = {"social_account_id", "target_date"}))
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class PostTarget {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "social_account_id", nullable = false)
    @JsonIgnoreProperties({"hibernateLazyInitializer", "handler", "user"})
    private SocialAccount socialAccount; // Fanpage HOẶC Group cụ thể — cùng bảng social_accounts

    @Column(name = "target_date", nullable = false)
    private LocalDate targetDate;

    @Column(name = "target_count", nullable = false)
    private Integer targetCount;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;
}
