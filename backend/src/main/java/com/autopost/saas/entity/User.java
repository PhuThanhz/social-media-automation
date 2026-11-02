package com.autopost.saas.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(name = "users")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 100)
    private String email;

    @Column(nullable = false, length = 50)
    private String username;

    @Column(nullable = false)
    private String password;

    /** Bản Desktop: OWNER (người tạo đầu tiên, quản lý người dùng) hoặc MEMBER; null = MEMBER */
    @Column(length = 20)
    private String role;

    /** Bản Desktop: tài khoản bị chủ khóa thì không đăng nhập được */
    private Boolean disabled;

    @Column(name = "daily_post_target")
    private Integer dailyPostTarget; // Mục tiêu số bài cần đăng trong 1 ngày (KPI) — null = chưa đặt mục tiêu

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;
}
