package com.autopost.saas.service.telegram;

import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class TelegramDraftTest {

    private static Map<String, Object> payload(TelegramDraft d, String mode) {
        return d.buildPayload(id -> "pg" + id + ":PERSONAL_COOKIE:" + id, gid -> "g" + gid, mode);
    }

    @Test
    void eachItemIsExpandedPerPageAndGroupsRideOnlyOnFirstPage() {
        TelegramDraft d = new TelegramDraft();
        d.addItem("https://fb.com/reel/1");
        TelegramDraft.Item edited = d.addItem("https://fb.com/reel/2");
        edited.customCaption = "Caption AI";
        d.pageIds.addAll(List.of(7L, 9L));
        d.groupIds.addAll(List.of(100L, 200L));

        Map<String, Object> p = payload(d, "QUEUE");

        assertThat(p.get("urls")).isEqualTo(List.of("https://fb.com/reel/1", "https://fb.com/reel/1", "https://fb.com/reel/2", "https://fb.com/reel/2"));
        assertThat(p.get("targetFanpageIds")).isEqualTo(List.of("pg7:PERSONAL_COOKIE:7", "pg9:PERSONAL_COOKIE:9", "pg7:PERSONAL_COOKIE:7", "pg9:PERSONAL_COOKIE:9"));
        assertThat(p.get("targetGroupNamesList")).isEqualTo(Arrays.asList("g100,g200", null, "g100,g200", null));
        // link chưa sửa caption → null để server tự cào; đã sửa → gửi caption mới
        assertThat(p.get("customCaptions")).isEqualTo(Arrays.asList(null, null, "Caption AI", "Caption AI"));
        assertThat(p.get("customMediaUrls")).isEqualTo(Arrays.asList(null, null, null, null));
        assertThat(p.get("scheduleMode")).isEqualTo("QUEUE");
        assertThat(p.get("targetFanpageId")).isEqualTo("pg7:PERSONAL_COOKIE:7");
        assertThat(d.postCount()).isEqualTo(4);
    }

    @Test
    void manualMediaPostSendsEmptyUrlCaptionAndUploadedMedia() {
        TelegramDraft d = new TelegramDraft();
        TelegramDraft.Item it = d.addItem(null);
        it.media.addAll(List.of("http://localhost:8081/uploads/a.jpg", "http://localhost:8081/uploads/b.mp4"));
        it.customCaption = "";
        d.pageIds.add(7L);
        d.includeCredit = false;

        Map<String, Object> p = payload(d, "NOW");

        assertThat(p.get("urls")).isEqualTo(List.of(""));
        assertThat(p.get("customCaptions")).isEqualTo(List.of(""));
        assertThat(p.get("customMediaUrls")).isEqualTo(List.of("http://localhost:8081/uploads/a.jpg,http://localhost:8081/uploads/b.mp4"));
        assertThat(p.get("includeCredits")).isEqualTo(List.of(false));
        assertThat(d.validate()).isNull();
    }

    @Test
    void colorBackgroundOnlyForShortTextOnlyDrafts() {
        TelegramDraft d = new TelegramDraft();
        d.addItem(null).customCaption = "Chúc cả nhà cuối tuần vui vẻ";
        d.pageIds.add(1L);
        d.colorBackground = true;
        assertThat(d.colorBackgroundAllowed()).isTrue();
        assertThat(payload(d, "NOW").get("colorBackgrounds")).isEqualTo(List.of(true));

        d.addItem("https://fb.com/x");
        assertThat(d.colorBackgroundAllowed()).isFalse();
        assertThat(payload(d, "NOW").get("colorBackgrounds")).isEqualTo(List.of(false, false));

        TelegramDraft longText = new TelegramDraft();
        longText.addItem(null).customCaption = "x".repeat(TelegramDraft.COLOR_BG_MAX_CHARS + 1);
        assertThat(longText.colorBackgroundAllowed()).isFalse();
    }

    @Test
    void validationCatchesMissingPagesEmptyPostsAndTooManyPosts() {
        TelegramDraft d = new TelegramDraft();
        assertThat(d.validate()).isEqualTo("Bài nháp trống");
        d.addItem(null).customCaption = "  ";
        assertThat(d.validate()).isEqualTo("Chưa chọn Trang nào");
        d.pageIds.add(1L);
        assertThat(d.validate()).isEqualTo("Bài 1 chưa có nội dung");

        TelegramDraft big = new TelegramDraft();
        for (int i = 0; i < 10; i++) big.addItem("https://fb.com/" + i);
        for (long p = 1; p <= 7; p++) big.pageIds.add(p);
        assertThat(big.validate()).startsWith("Tối đa 60 lượt đăng");
    }

    @Test
    void itemIdsStayStableAfterRemoval() {
        TelegramDraft d = new TelegramDraft();
        TelegramDraft.Item a = d.addItem("https://a");
        TelegramDraft.Item b = d.addItem("https://b");
        d.items.remove(a);
        assertThat(d.item(b.id)).isSameAs(b);
        assertThat(d.item(a.id)).isNull();
        assertThat(d.indexOf(b)).isEqualTo(1);
        assertThat(d.addItem("https://c").id).isEqualTo(3);
    }

    @Test
    void picksLargestPhotoAndReadsVideoAndDocumentFiles() {
        Map<String, Object> photo = Map.of("photo", List.of(
                Map.of("file_id", "small", "width", 90, "height", 90, "file_size", 1000),
                Map.of("file_id", "big", "width", 1280, "height", 960, "file_size", 200000)));
        assertThat(TelegramComposer.fileRefOf(photo)).isEqualTo(new TelegramComposer.FileRef("big", 200000, "jpg"));

        Map<String, Object> video = Map.of("video", Map.of("file_id", "v1", "file_size", 5_000_000, "mime_type", "video/quicktime"));
        assertThat(TelegramComposer.fileRefOf(video).ext()).isEqualTo("mov");

        Map<String, Object> doc = Map.of("document", Map.of("file_id", "d1", "file_size", 10, "mime_type", "image/png", "file_name", "anh.PNG"));
        assertThat(TelegramComposer.fileRefOf(doc).ext()).isEqualTo("png");

        Map<String, Object> pdf = Map.of("document", Map.of("file_id", "d2", "mime_type", "application/pdf"));
        assertThat(TelegramComposer.fileRefOf(pdf)).isNull();
        assertThat(TelegramComposer.extOf("../../etc/passwd", null, "jpg")).isEqualTo("jpg");
    }

    @Test
    void mediaSummaryCountsImagesAndVideos() {
        assertThat(TelegramComposer.mediaSummary(List.of("https://x/a.jpg", "https://x/b.mp4?x=1", "https://video.fbcdn/c"))).isEqualTo("1 ảnh, 2 video");
        assertThat(TelegramComposer.mediaSummary(List.of())).isEmpty();
    }

    @Test
    void removingMediaSendsKeptListAndLastMediaCannotBeRemoved() {
        TelegramDraft d = new TelegramDraft();
        TelegramDraft.Item it = d.addItem("https://fb.com/p/1");
        it.scrapedMedia = List.of("https://cdn/a.jpg", "https://cdn/b.mp4", "https://cdn/c.jpg");
        d.pageIds.add(7L);
        assertThat(payload(d, "QUEUE").get("customMediaUrls")).isEqualTo(Arrays.asList((Object) null));

        assertThat(it.toggleMedia(1)).isTrue();
        assertThat(payload(d, "QUEUE").get("customMediaUrls")).isEqualTo(List.of("https://cdn/a.jpg,https://cdn/c.jpg"));
        assertThat(it.toggleMedia(0)).isTrue();
        assertThat(it.toggleMedia(2)).isFalse(); // còn đúng 1 cái → không cho bỏ
        assertThat(it.keptMedia()).containsExactly("https://cdn/c.jpg");

        assertThat(it.toggleMedia(1)).isTrue(); // lấy lại
        assertThat(it.keptMedia()).containsExactly("https://cdn/b.mp4", "https://cdn/c.jpg");
    }

    @Test
    void facebookVideoWithoutExtensionIsDetectedFromServerKinds() {
        TelegramDraft d = new TelegramDraft();
        TelegramDraft.Item it = d.addItem("https://www.facebook.com/reel/1");
        it.scrapedMedia = List.of("https://scontent.fsgn2-4.fna.fbcdn.net/o1/v/t2/f2/m366/AQM_x", "https://scontent.x/p.jpg");
        assertThat(it.isVideo(0)).isFalse(); // chưa có kinds → đoán theo URL (sai với FB)
        it.scrapedKinds = List.of("video", "image");
        assertThat(it.isVideo(0)).isTrue();
        assertThat(it.isVideo(1)).isFalse();
        assertThat(TelegramComposer.mediaSummary(it)).isEqualTo("1 ảnh, 1 video");

        TelegramDraft.Item own = d.addItem(null);
        own.media.add("http://localhost:8081/uploads/tg_x.mov");
        own.mediaKinds.add("video");
        assertThat(TelegramComposer.mediaSummary(own)).isEqualTo("1 video");
    }
}
