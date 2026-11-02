package com.autopost.saas.publishing.adapter;

import com.autopost.saas.entity.PostQueue;
import com.autopost.saas.entity.SocialAccount;
import com.autopost.saas.publishing.model.PreflightResult;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

@Component
public class FacebookPublishingAdapter implements PlatformPublishingAdapter {

    private static final int MAX_FACEBOOK_CHARS = 63206;

    @Override
    public boolean supports(SocialAccount account, PostQueue post) {
        if (account != null && account.getPlatform() != null) {
            String p = account.getPlatform().toUpperCase();
            if (p.contains("FACEBOOK") || "FB".equals(p)) return true;
        }
        if (post != null && post.getPostType() != null) {
            String type = post.getPostType().toUpperCase();
            return "FEED".equals(type) || "STORY".equals(type) || "REEL".equals(type)
                    || "COLOR_BACKGROUND".equals(type) || "RED_PHOTO_TRICK".equals(type);
        }
        return account == null; // Mặc định nền tảng phổ biến nhất
    }

    @Override
    public PreflightResult validate(SocialAccount account, PostQueue post) {
        PreflightResult result = PreflightResult.success();
        if (post == null) {
            return PreflightResult.fail("Dữ liệu bài viết rỗng (null)");
        }

        String content = post.getContent() != null ? post.getContent().trim() : "";
        String title = post.getTitle() != null ? post.getTitle().trim() : "";
        String effectiveText = !content.isEmpty() ? content : title;
        List<String> mediaUrls = parseMediaUrls(post.getMediaUrls());

        if (effectiveText.isEmpty() && mediaUrls.isEmpty()) {
            result.addError("Facebook: Bài viết không có cả nội dung văn bản lẫn hình ảnh/video.");
            return result;
        }

        if (effectiveText.length() > MAX_FACEBOOK_CHARS) {
            result.addError("Facebook: Nội dung vượt quá giới hạn " + MAX_FACEBOOK_CHARS + " ký tự.");
        }

        if ("STORY".equalsIgnoreCase(post.getPostType()) && mediaUrls.isEmpty()) {
            result.addError("Facebook Story: Bắt buộc phải có ít nhất 1 hình ảnh hoặc video.");
        }

        if (account != null) {
            if ("EXPIRED".equalsIgnoreCase(account.getTokenStatus())) {
                result.addError("Facebook: Tài khoản '" + account.getPageName() + "' đã hết hạn Cookie/Token.");
            }
            if (account.getAccessToken() == null || account.getAccessToken().isBlank()) {
                result.addError("Facebook: Tài khoản '" + account.getPageName() + "' thiếu chuỗi xác thực.");
            }
        }

        return result;
    }

    @Override
    public String getPlatformName() {
        return "FACEBOOK";
    }

    private List<String> parseMediaUrls(String raw) {
        if (raw == null || raw.trim().isEmpty()) return new ArrayList<>();
        return Arrays.stream(raw.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .toList();
    }
}

