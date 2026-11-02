package com.autopost.saas.publishing.service;

import com.autopost.saas.entity.PostQueue;
import com.autopost.saas.entity.SocialAccount;
import com.autopost.saas.publishing.model.PreflightResult;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class PublishingPreflightServiceTest {

    private PublishingPreflightService preflightService;

    @BeforeEach
    void setUp() {
        preflightService = new PublishingPreflightService();
    }

    @Test
    @DisplayName("Báo lỗi khi cả văn bản lẫn media đều trống")
    void testEmptyPostFails() {
        PostQueue post = new PostQueue();
        post.setContent("");
        post.setTitle("");
        post.setMediaUrls("");

        PreflightResult result = preflightService.validatePost(null, post);

        assertFalse(result.isValid());
        assertTrue(result.getErrors().stream().anyMatch(e -> e.contains("không có cả nội dung văn bản lẫn hình ảnh")));
    }

    @Test
    @DisplayName("Báo lỗi khi tài khoản có tokenStatus = EXPIRED")
    void testExpiredAccountFails() {
        SocialAccount account = new SocialAccount();
        account.setPageName("Fanpage Test");
        account.setTokenStatus("EXPIRED");
        account.setAccessToken("old_token");

        PostQueue post = new PostQueue();
        post.setContent("Nội dung hợp lệ");

        PreflightResult result = preflightService.validatePost(account, post);

        assertFalse(result.isValid());
        assertTrue(result.getErrors().stream().anyMatch(e -> e.contains("hết hạn Cookie/Token")));
    }

    @Test
    @DisplayName("Threads vượt quá 500 ký tự phải bị chặn bởi Preflight")
    void testThreadsCharLimit() {
        SocialAccount account = new SocialAccount();
        account.setPageName("Threads Account");
        account.setPlatform("THREADS");
        account.setTokenStatus("ACTIVE");
        account.setAccessToken("valid_token");

        PostQueue post = new PostQueue();
        post.setPostType("THREADS");
        post.setContent("A".repeat(501));

        PreflightResult result = preflightService.validatePost(account, post);

        assertFalse(result.isValid());
        assertTrue(result.getErrors().stream().anyMatch(e -> e.contains("vượt quá giới hạn 500 ký tự")));
    }

    @Test
    @DisplayName("TikTok bắt buộc phải có video hợp lệ")
    void testTikTokRequiresVideo() {
        SocialAccount account = new SocialAccount();
        account.setPageName("TikTok Channel");
        account.setPlatform("TIKTOK");
        account.setTokenStatus("ACTIVE");
        account.setAccessToken("valid_token");

        // Case 1: Không có media
        PostQueue postNoMedia = new PostQueue();
        postNoMedia.setPostType("TIKTOK");
        postNoMedia.setContent("Video description");

        PreflightResult res1 = preflightService.validatePost(account, postNoMedia);
        assertFalse(res1.isValid());
        assertTrue(res1.getErrors().stream().anyMatch(e -> e.contains("bắt buộc phải có tệp video")));

        // Case 2: Media là ảnh, không phải video
        PostQueue postPhoto = new PostQueue();
        postPhoto.setPostType("TIKTOK");
        postPhoto.setContent("Video description");
        postPhoto.setMediaUrls("https://example.com/banner.jpg");

        PreflightResult res2 = preflightService.validatePost(account, postPhoto);
        assertFalse(res2.isValid());
        assertTrue(res2.getErrors().stream().anyMatch(e -> e.contains("không phải định dạng video hợp lệ")));

        // Case 3: Video hợp lệ (.mp4)
        PostQueue postValidVideo = new PostQueue();
        postValidVideo.setPostType("TIKTOK");
        postValidVideo.setContent("Tiktoker trending video");
        postValidVideo.setMediaUrls("https://example.com/video.mp4");

        PreflightResult res3 = preflightService.validatePost(account, postValidVideo);
        assertTrue(res3.isValid());
        assertEquals(0, res3.getErrors().size());
    }

    @Test
    @DisplayName("Facebook Feed hợp lệ vượt qua preflight thành công")
    void testValidFacebookFeedPost() {
        SocialAccount account = new SocialAccount();
        account.setPageName("Fanpage Chốt Đơn");
        account.setPlatform("FACEBOOK");
        account.setTokenStatus("ACTIVE");
        account.setAccessToken("valid_token");

        PostQueue post = new PostQueue();
        post.setPostType("FEED");
        post.setContent("Siêu khuyến mãi hôm nay! Ghé ngay cửa hàng.");
        post.setMediaUrls("https://cdn.example.com/promo.png");

        PreflightResult result = preflightService.validatePost(account, post);

        assertTrue(result.isValid());
        assertEquals(0, result.getErrors().size());
    }
}

