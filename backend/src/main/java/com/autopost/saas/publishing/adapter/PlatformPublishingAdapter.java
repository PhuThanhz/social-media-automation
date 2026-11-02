package com.autopost.saas.publishing.adapter;

import com.autopost.saas.entity.PostQueue;
import com.autopost.saas.entity.SocialAccount;
import com.autopost.saas.publishing.model.PreflightResult;
import com.autopost.saas.publishing.model.PublishResult;

/**
 * Interface chuẩn cho các adapter xuất bản nội dung đa nền tảng trong TOOLZUTTER.
 */
public interface PlatformPublishingAdapter {

    /**
     * Kiểm tra xem adapter này có hỗ trợ xử lý cặp (tài khoản, bài đăng) cụ thể không.
     */
    boolean supports(SocialAccount account, PostQueue post);

    /**
     * Kiểm tra tính hợp lệ của bài đăng và điều kiện tài khoản trước khi đưa vào hàng đợi thực thi.
     */
    PreflightResult validate(SocialAccount account, PostQueue post);

    /**
     * Tên nhận diện của nền tảng / adapter.
     */
    String getPlatformName();
}

