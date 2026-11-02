package com.autopost.saas.publishing.service;

import com.autopost.saas.entity.PostQueue;
import com.autopost.saas.entity.SocialAccount;
import com.autopost.saas.publishing.adapter.FacebookPublishingAdapter;
import com.autopost.saas.publishing.adapter.PlatformPublishingAdapter;
import com.autopost.saas.publishing.adapter.ThreadsPublishingAdapter;
import com.autopost.saas.publishing.adapter.TikTokPublishingAdapter;
import com.autopost.saas.publishing.model.PreflightResult;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class PreflightValidationSuiteTest {

    private PublishingPreflightService preflightService;

    @BeforeEach
    void setUp() {
        List<PlatformPublishingAdapter> adapters = List.of(
                new FacebookPublishingAdapter(),
                new ThreadsPublishingAdapter(),
                new TikTokPublishingAdapter()
        );
        preflightService = new PublishingPreflightService(adapters);
    }

    @Test
    @DisplayName("Nội dung rỗng và không có media: Chặn ngay lập tức ở Preflight")
    void testEmptyContentAndMediaBlocked() {
        PostQueue post = new PostQueue();
        post.setContent("");
        post.setTitle("");
        post.setMediaUrls("");

        PreflightResult result = preflightService.validatePost(null, post);

        assertFalse(result.isValid());
        assertTrue(result.getErrors().stream().anyMatch(e -> e.contains("không có cả nội dung văn bản lẫn hình ảnh")));
    }

    @Test
    @DisplayName("Tài khoản EXPIRED / Hết hạn token: Chặn ngay lập tức")
    void testExpiredAccountBlocked() {
        SocialAccount account = new SocialAccount();
        account.setPlatform("FACEBOOK");
        account.setPageName("Page Bị Checkpoint");
        account.setTokenStatus("EXPIRED");
        account.setAccessToken("expired_cookie");

        PostQueue post = new PostQueue();
        post.setContent("Bài viết giới thiệu sản phẩm");

        PreflightResult result = preflightService.validatePost(account, post);

        assertFalse(result.isValid());
        assertTrue(result.getErrors().stream().anyMatch(e -> e.contains("hết hạn Cookie/Token")));
    }

    @Test
    @DisplayName("Threads: Giới hạn 500 ký tự — bài dài 501 ký tự bị chặn")
    void testThreadsCharLimitBlocked() {
        SocialAccount account = new SocialAccount();
        account.setPlatform("THREADS");
        account.setPageName("Threads User");
        account.setTokenStatus("ACTIVE");
        account.setAccessToken("valid_token");

        PostQueue post = new PostQueue();
        post.setPostType("THREADS");
        post.setContent("N".repeat(501));

        PreflightResult result = preflightService.validatePost(account, post);

        assertFalse(result.isValid());
        assertTrue(result.getErrors().stream().anyMatch(e -> e.contains("vượt quá giới hạn tối đa 500 ký tự")));
    }

    @Test
    @DisplayName("TikTok: Không có media hoặc gửi ảnh thay vì video bị chặn")
    void testTikTokPhotoRejected() {
        SocialAccount account = new SocialAccount();
        account.setPlatform("TIKTOK");
        account.setPageName("Kênh TikTok Shop");
        account.setTokenStatus("ACTIVE");
        account.setAccessToken("tiktok_sess");

        PostQueue postWithPhoto = new PostQueue();
        postWithPhoto.setPostType("TIKTOK");
        postWithPhoto.setContent("TikTok dance trend");
        postWithPhoto.setMediaUrls("https://cdn.example.com/banner.png");

        PreflightResult result = preflightService.validatePost(account, postWithPhoto);

        assertFalse(result.isValid());
        assertTrue(result.getErrors().stream().anyMatch(e -> e.contains("không phải định dạng video hợp lệ")));
    }

    @Test
    @DisplayName("TikTok: Video MP4 hợp lệ vượt qua Preflight")
    void testTikTokValidVideoPassed() {
        SocialAccount account = new SocialAccount();
        account.setPlatform("TIKTOK");
        account.setPageName("Kênh TikTok Shop");
        account.setTokenStatus("ACTIVE");
        account.setAccessToken("tiktok_sess");

        PostQueue postWithVideo = new PostQueue();
        postWithVideo.setPostType("TIKTOK");
        postWithVideo.setContent("Review sản phẩm cực hot");
        postWithVideo.setMediaUrls("https://cdn.example.com/video-review.mp4");

        PreflightResult result = preflightService.validatePost(account, postWithVideo);

        assertTrue(result.isValid());
        assertEquals(0, result.getErrors().size());
    }

    @Test
    @DisplayName("Facebook Story: Bắt buộc phải có tệp hình ảnh hoặc video")
    void testFacebookStoryRequiresMedia() {
        SocialAccount account = new SocialAccount();
        account.setPlatform("FACEBOOK");
        account.setPageName("Page Story");
        account.setTokenStatus("ACTIVE");
        account.setAccessToken("fb_token");

        PostQueue postStoryNoMedia = new PostQueue();
        postStoryNoMedia.setPostType("STORY");
        postStoryNoMedia.setContent("Chỉ có caption mà không có ảnh story");
        postStoryNoMedia.setMediaUrls("");

        PreflightResult result = preflightService.validatePost(account, postStoryNoMedia);

        assertFalse(result.isValid());
        assertTrue(result.getErrors().stream().anyMatch(e -> e.contains("Bắt buộc phải có ít nhất 1 hình ảnh hoặc video")));
    }

    @Test
    @DisplayName("Facebook Feed chuẩn: Chữ và ảnh hợp lệ vượt qua Preflight xuất sắc")
    void testFacebookValidFeedPassed() {
        SocialAccount account = new SocialAccount();
        account.setPlatform("FACEBOOK");
        account.setPageName("Page Doanh Nghiệp");
        account.setTokenStatus("ACTIVE");
        account.setAccessToken("fb_token");

        PostQueue validPost = new PostQueue();
        validPost.setPostType("FEED");
        validPost.setContent("Thông báo khai trương chi nhánh mới!");
        validPost.setMediaUrls("https://cdn.example.com/store.jpg");

        PreflightResult result = preflightService.validatePost(account, validPost);

        assertTrue(result.isValid());
        assertEquals(0, result.getErrors().size());
    }
}

