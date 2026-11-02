package com.autopost.saas.publishing.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * Kết quả thực thi đăng bài từ Platform Adapter / Worker.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class PublishResult {

    private PublishStatus status;
    private String publishedUrl;
    private String externalPostId;
    private String errorMessage;
    private boolean retryable;
    private Integer executionDurationSeconds;
    private LocalDateTime publishedAt;

    public static PublishResult success(String publishedUrl, String externalPostId, int durationSec) {
        return PublishResult.builder()
                .status(PublishStatus.PUBLISHED)
                .publishedUrl(publishedUrl)
                .externalPostId(externalPostId)
                .executionDurationSeconds(durationSec)
                .publishedAt(LocalDateTime.now())
                .retryable(false)
                .build();
    }

    public static PublishResult partial(String publishedUrl, String warningMessage, int durationSec) {
        return PublishResult.builder()
                .status(PublishStatus.PARTIAL)
                .publishedUrl(publishedUrl)
                .errorMessage(warningMessage)
                .executionDurationSeconds(durationSec)
                .publishedAt(LocalDateTime.now())
                .retryable(false)
                .build();
    }

    public static PublishResult fail(String errorMessage, boolean retryable, int durationSec) {
        return PublishResult.builder()
                .status(PublishStatus.FAILED)
                .errorMessage(errorMessage)
                .retryable(retryable)
                .executionDurationSeconds(durationSec)
                .build();
    }

    public static PublishResult needsReview(String warningMessage, int durationSec) {
        return PublishResult.builder()
                .status(PublishStatus.NEEDS_REVIEW)
                .errorMessage(warningMessage)
                .retryable(false)
                .executionDurationSeconds(durationSec)
                .build();
    }
}

