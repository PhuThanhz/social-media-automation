package com.autopost.saas.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class PostQueueDto {
    private Long id;
    private Long campaignId;
    private String campaignName;
    private String title;
    private String content;
    private String mediaUrls;
    private String originalUrl;
    private String status;
    private String targetFanpageId;
    private String postType;
    private String targetGroupNames;
    private String publishedPostUrl;
    private String errorMessage;
    private LocalDateTime scheduledAt;
    private LocalDateTime publishedAt;
    private Integer executionDurationSeconds;
    private Integer retryCount;
    private String lockedBy;
    private String lockToken;
    private LocalDateTime leaseExpiresAt;
    private Integer attemptCount;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}

