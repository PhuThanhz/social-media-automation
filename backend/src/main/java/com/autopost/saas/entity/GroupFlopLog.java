package com.autopost.saas.entity;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(name = "group_flop_logs")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class GroupFlopLog {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    @JsonIgnoreProperties({"hibernateLazyInitializer", "handler", "password"})
    private User user;

    @Column(name = "post_queue_id")
    private Long postQueueId;

    @Column(name = "group_name", nullable = false, length = 255)
    private String groupName;

    @Column(name = "post_url", nullable = false, length = 1000)
    private String postUrl;

    @Builder.Default
    @Column(name = "likes_count")
    private Integer likesCount = 0;

    @Builder.Default
    @Column(name = "comments_count")
    private Integer commentsCount = 0;

    @Builder.Default
    @Column(name = "status", nullable = false, length = 50)
    private String status = "DELETED_SUCCESS"; // DELETED_SUCCESS, DELETE_FAILED, KEPT

    @Column(name = "reason", length = 500)
    private String reason;

    @Column(name = "deleted_at")
    private LocalDateTime deletedAt;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;
}
