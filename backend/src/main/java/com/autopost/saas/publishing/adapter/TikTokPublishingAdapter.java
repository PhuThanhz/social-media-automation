package com.autopost.saas.publishing.adapter;

import com.autopost.saas.entity.PostQueue;
import com.autopost.saas.entity.SocialAccount;
import com.autopost.saas.publishing.model.PreflightResult;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

@Component
public class TikTokPublishingAdapter implements PlatformPublishingAdapter {

    private static final int MAX_TIKTOK_TITLE_CHARS = 2200;

    @Override
    public boolean supports(SocialAccount account, PostQueue post) {
        if (post != null && "TIKTOK".equalsIgnoreCase(post.getPostType())) {
            return true;
        }
        if (account != null && account.getPlatform() != null) {
            return account.getPlatform().toUpperCase().contains("TIKTOK");
        }
        return false;
    }

    @Override
    public PreflightResult validate(SocialAccount account, PostQueue post) {
        PreflightResult result = PreflightResult.success();
        if (post == null) {
            return PreflightResult.fail("Dữ liệu bài viết rỗng");
        }

        List<String> mediaUrls = parseMediaUrls(post.getMediaUrls());
        if (mediaUrls.isEmpty()) {
            result.addError("TikTok: Bắt buộc phải có tệp video đính kèm (.mp4, .mov, .webm).");
        } else {
            String firstMedia = mediaUrls.get(0).toLowerCase();
            boolean isVideo = firstMedia.matches(".*\\.(mp4|mov|webm|m4v)(\\?.*)?$");
            if (!isVideo) {
                result.addError("TikTok: Tệp đính kèm không phải định dạng video hợp lệ (.mp4, .mov, .webm).");
            }
        }

        String content = post.getContent() != null ? post.getContent().trim() : "";
        String title = post.getTitle() != null ? post.getTitle().trim() : "";
        String effectiveText = !content.isEmpty() ? content : title;

        if (effectiveText.length() > MAX_TIKTOK_TITLE_CHARS) {
            result.addError("TikTok: Tiêu đề vượt quá giới hạn " + MAX_TIKTOK_TITLE_CHARS + " ký tự.");
        }

        if (account != null && "EXPIRED".equalsIgnoreCase(account.getTokenStatus())) {
            result.addError("TikTok: Cookie tài khoản '" + account.getPageName() + "' đã hết hạn.");
        }

        return result;
    }

    @Override
    public String getPlatformName() {
        return "TIKTOK";
    }

    private List<String> parseMediaUrls(String raw) {
        if (raw == null || raw.trim().isEmpty()) return new ArrayList<>();
        return Arrays.stream(raw.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .toList();
    }
}

