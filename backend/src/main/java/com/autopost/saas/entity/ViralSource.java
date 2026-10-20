package com.autopost.saas.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

/** Nguồn Fanpage / Group trong "Kho Nguồn Mục Tiêu" của trang Săn bài Viral — được quét định kỳ ở backend. */
@Entity
@Table(name = "viral_sources")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ViralSource {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 255)
    private String name;

    @Column(nullable = false, unique = true, length = 500)
    private String url;

    @Column(length = 20)
    private String type; // PAGE | GROUP | REDDIT

    @Column(length = 500)
    private String description;

    @Column(length = 50)
    private String category;

    @Builder.Default
    @Column(name = "auto_scan", nullable = false)
    private Boolean autoScan = true;

    @Column(name = "last_scanned_at")
    private LocalDateTime lastScannedAt;

    @Column(name = "last_scan_status", length = 20)
    private String lastScanStatus; // OK | ERROR

    @Column(name = "last_scan_error", length = 1000)
    private String lastScanError;

    @Column(name = "last_new_count")
    private Integer lastNewCount;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;
}
