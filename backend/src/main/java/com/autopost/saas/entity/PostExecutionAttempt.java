package com.autopost.saas.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

/**
 * Bản ghi nhật ký lịch sử từng lần thực thi đăng bài (Execution Attempt History) — TOOLZUTTER 3.3.
 * Cung cấp bằng chứng audit trail bất biến phục vụ đối soát, chống đăng lặp và phân tích độ tin cậy cụm Worker.
 */
@Entity
@Table(
        name = "post_execution_attempt",
        indexes = {
                @Index(name = "idx_post_attempt_queue_id", columnList = "post_queue_id"),
                @Index(name = "idx_post_attempt_token", columnList = "attempt_token"),
                @Index(name = "idx_post_attempt_status", columnList = "status"),
                @Index(name = "idx_post_attempt_started", columnList = "started_at")
        })
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class PostExecutionAttempt {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "post_queue_id", nullable = false)
    private Long postQueueId;

    @Column(name = "attempt_token", length = 64, nullable = false)
    private String attemptToken; // Fencing token ngẫu nhiên phân biệt từng lần chạy

    @Column(name = "worker_instance", length = 100)
    private String workerInstance; // URL của Worker thực hiện (vd: http://localhost:3001)

    @Column(name = "started_at", nullable = false)
    private LocalDateTime startedAt;

    @Column(name = "finished_at")
    private LocalDateTime finishedAt;

    @Column(nullable = false, length = 30)
    private String status; // STARTED, SUCCESS, FAILED, TIMEOUT, NEEDS_REVIEW, CANCELLED

    @Column(name = "error_code", length = 50)
    private String errorCode;

    @Column(name = "error_message", columnDefinition = "TEXT")
    private String errorMessage;

    @Column(name = "proof_url", columnDefinition = "TEXT")
    private String proofUrl;

    @Column(name = "raw_worker_response", columnDefinition = "TEXT")
    private String rawWorkerResponse;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;
}

