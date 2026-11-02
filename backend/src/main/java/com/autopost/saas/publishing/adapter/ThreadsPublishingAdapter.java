package com.autopost.saas.publishing.adapter;

import com.autopost.saas.entity.PostQueue;
import com.autopost.saas.entity.SocialAccount;
import com.autopost.saas.publishing.model.PreflightResult;
import org.springframework.stereotype.Component;

@Component
public class ThreadsPublishingAdapter implements PlatformPublishingAdapter {

    private static final int MAX_THREADS_CHARS = 500;

    @Override
    public boolean supports(SocialAccount account, PostQueue post) {
        if (post != null && "THREADS".equalsIgnoreCase(post.getPostType())) {
            return true;
        }
        if (account != null && account.getPlatform() != null) {
            return account.getPlatform().toUpperCase().contains("THREADS");
        }
        return false;
    }

    @Override
    public PreflightResult validate(SocialAccount account, PostQueue post) {
        PreflightResult result = PreflightResult.success();
        if (post == null) {
            return PreflightResult.fail("Dữ liệu bài viết rỗng");
        }

        String content = post.getContent() != null ? post.getContent().trim() : "";
        String title = post.getTitle() != null ? post.getTitle().trim() : "";
        String effectiveText = !content.isEmpty() ? content : title;

        if (effectiveText.isEmpty() && (post.getMediaUrls() == null || post.getMediaUrls().isBlank())) {
            result.addError("Threads: Bài viết không có nội dung lẫn ảnh/video.");
            return result;
        }

        if (effectiveText.length() > MAX_THREADS_CHARS) {
            result.addError("Threads: Nội dung dài " + effectiveText.length() + " ký tự, vượt quá giới hạn tối đa " + MAX_THREADS_CHARS + " ký tự của Meta Threads.");
        }

        if (account != null && "EXPIRED".equalsIgnoreCase(account.getTokenStatus())) {
            result.addError("Threads: Cookie của tài khoản '" + account.getPageName() + "' đã hết hạn.");
        }

        return result;
    }

    @Override
    public String getPlatformName() {
        return "THREADS";
    }
}

