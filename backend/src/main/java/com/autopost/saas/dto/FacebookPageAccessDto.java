package com.autopost.saas.dto;

import lombok.*;

import java.time.LocalDateTime;
import java.util.List;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class FacebookPageAccessDto {
    private Long id;
    private String personalProfileId;
    private String profileName;
    private String pageId;
    private String pageName;
    private String pageUrl;
    private String avatarUrl;
    private String verificationStatus;
    private String verificationMessage;
    private boolean active;
    private LocalDateTime firstSeenAt;
    private LocalDateTime lastSeenAt;
    private LocalDateTime lastVerifiedAt;
    private LocalDateTime lastScanAt;
    private List<String> sources;
}
