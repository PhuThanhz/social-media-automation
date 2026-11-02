package com.autopost.saas.publishing.service;

import com.autopost.saas.entity.PostQueue;
import com.autopost.saas.entity.SocialAccount;
import com.autopost.saas.publishing.adapter.PlatformPublishingAdapter;
import com.autopost.saas.publishing.model.PreflightResult;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Dịch vụ kiểm tra và thẩm định bài viết trước khi đưa vào hàng đợi đăng thực tế (Preflight Validation) — TOOLZUTTER 3.3.
 * Tích hợp hệ thống PlatformPublishingAdapter đa nền tảng, phát hiện lỗi chặn sớm trước khi gửi lệnh sang Worker.
 */
@Service
@Slf4j
public class PublishingPreflightService {

    private final List<PlatformPublishingAdapter> adapters;

    public PublishingPreflightService() {
        this.adapters = new ArrayList<>();
    }

    @Autowired
    public PublishingPreflightService(List<PlatformPublishingAdapter> adapters) {
        this.adapters = adapters != null ? adapters : new ArrayList<>();
    }

    public PreflightResult validatePost(SocialAccount account, PostQueue post) {
        PreflightResult result = PreflightResult.success();

        if (post == null) {
            return PreflightResult.fail("Dữ liệu bài viết rỗng (null)");
        }

        // 1. Nếu có adapter tương ứng đăng ký, ưu tiên dùng adapter chuyên biệt của nền tảng
        for (PlatformPublishingAdapter adapter : adapters) {
            if (adapter.supports(account, post)) {
                log.debug("🔍 Áp dụng adapter '{}' cho bài Post #{}", adapter.getPlatformName(), post.getId());
                return adapter.validate(account, post);
            }
        }

        // 2. Fallback sang bộ luật chung nếu không tìm thấy adapter phù hợp
        String content = post.getContent() != null ? post.getContent().trim() : "";
        String title = post.getTitle() != null ? post.getTitle().trim() : "";
        String effectiveText = !content.isEmpty() ? content : title;
        List<String> mediaUrls = parseMediaUrls(post.getMediaUrls());

        if (effectiveText.isEmpty() && mediaUrls.isEmpty()) {
            result.addError("Bài viết không có cả nội dung văn bản lẫn hình ảnh/video — không thể xuất bản.");
            return result;
        }

        if (account != null) {
            if ("EXPIRED".equalsIgnoreCase(account.getTokenStatus())) {
                result.addError("Tài khoản '" + account.getPageName() + "' đã hết hạn Cookie/Token. Vui lòng cập nhật kết nối.");
            }
            if (account.getAccessToken() == null || account.getAccessToken().isBlank()) {
                result.addError("Tài khoản '" + account.getPageName() + "' thiếu chuỗi xác thực AccessToken/Cookie.");
            }
        }

        String postType = post.getPostType() != null ? post.getPostType().toUpperCase() : "FEED";
        String platform = account != null && account.getPlatform() != null ? account.getPlatform().toUpperCase() : "";

        if ("THREADS".equals(postType) || platform.contains("THREADS")) {
            if (effectiveText.length() > 500) {
                result.addError("Nội dung vượt quá giới hạn 500 ký tự của Threads (hiện tại: " + effectiveText.length() + " ký tự).");
            }
        }

        if ("TIKTOK".equals(postType) || platform.contains("TIKTOK")) {
            if (mediaUrls.isEmpty()) {
                result.addError("TikTok bắt buộc phải có tệp video đính kèm.");
            } else {
                String firstMedia = mediaUrls.get(0).toLowerCase();
                boolean isVideo = firstMedia.matches(".*\\.(mp4|mov|webm|m4v)(\\?.*)?$");
                if (!isVideo) {
                    result.addError("Tệp đính kèm TikTok không phải định dạng video hợp lệ (.mp4, .mov, .webm).");
                }
            }
            if (effectiveText.length() > 2200) {
                result.addError("Tiêu đề TikTok vượt quá giới hạn 2200 ký tự.");
            }
        }

        if ("STORY".equals(postType) && mediaUrls.isEmpty()) {
            result.addError("Facebook Story bắt buộc phải có ảnh hoặc video.");
        }

        if (effectiveText.length() > 63206) {
            result.addError("Nội dung vượt quá giới hạn văn bản của Facebook (tối đa 63206 ký tự).");
        }

        return result;
    }

    private List<String> parseMediaUrls(String raw) {
        if (raw == null || raw.trim().isEmpty()) {
            return new ArrayList<>();
        }
        return Arrays.stream(raw.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .toList();
    }
}
