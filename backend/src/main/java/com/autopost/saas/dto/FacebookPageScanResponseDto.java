package com.autopost.saas.dto;

import lombok.*;

import java.time.LocalDateTime;
import java.util.List;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class FacebookPageScanResponseDto {
    private boolean success;
    private String personalProfileId;
    private String profileName;
    private int totalFound;
    private int verifiedCount;
    private boolean scanComplete;
    private LocalDateTime scannedAt;
    private List<String> attemptedSources;
    private List<String> completedSources;
    private List<FacebookPageAccessDto> pages;
}
