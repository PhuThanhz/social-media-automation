package com.autopost.saas.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

/** Bài mới do bộ quét tự động tìm được từ Kho Nguồn, chờ người dùng duyệt rồi tự đưa vào Hàng đợi. */
@Entity
@Table(name = "viral_inbox_items", indexes = @Index(name = "idx_viral_inbox_status", columnList = "status"))
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ViralInboxItem {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "source_id")
    private Long sourceId;

    @Column(name = "source_name", length = 255)
    private String sourceName;

    @Column(name = "post_url", nullable = false, unique = true, length = 700)
    private String postUrl;

    /** Nguyên item Worker trả về (caption, images, reactions...) dạng JSON. */
    @Column(columnDefinition = "MEDIUMTEXT")
    private String payload;

    @Column(name = "viral_score")
    private Integer viralScore;

    @Builder.Default
    @Column(nullable = false, length = 20)
    private String status = "NEW"; // NEW | QUEUED | DISMISSED

    @CreationTimestamp
    @Column(name = "found_at", updatable = false)
    private LocalDateTime foundAt;
}
