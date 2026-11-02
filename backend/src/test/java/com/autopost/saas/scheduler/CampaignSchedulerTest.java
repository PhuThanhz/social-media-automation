package com.autopost.saas.scheduler;

import com.autopost.saas.entity.PostQueue;
import com.autopost.saas.entity.SocialAccount;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class CampaignSchedulerTest {

    @Test
    void sameFacebookCookieAcrossConnectionsUsesOneOrderedQueue() {
        SocialAccount connection11 = cookieAccount(11L, "615100", "c_user=9988; xs=old-session; i_user=615100");
        SocialAccount connection12 = cookieAccount(12L, "615200", "xs=new-session; c_user=9988; i_user=615200");

        String firstKey = CampaignScheduler.publishingIdentityKey(connection11);
        String secondKey = CampaignScheduler.publishingIdentityKey(connection12);
        assertThat(firstKey).isEqualTo(secondKey);

        LocalDateTime sameTime = LocalDateTime.of(2026, 8, 25, 9, 0);
        List<PostQueue> shuffled = List.of(
                post(5L, sameTime, "615100:PERSONAL_COOKIE:11"),
                post(2L, sameTime, "615200:PERSONAL_COOKIE:12"),
                post(4L, sameTime.minusMinutes(1), "615100:PERSONAL_COOKIE:11"),
                post(3L, sameTime, "615100:PERSONAL_COOKIE:11"),
                post(1L, sameTime, "615200:PERSONAL_COOKIE:12"));

        Map<String, List<PostQueue>> queues = CampaignScheduler.groupPendingPosts(shuffled, post ->
                post.getTargetFanpageId().endsWith(":11") ? firstKey : secondKey);

        assertThat(queues).hasSize(1);
        assertThat(new ArrayList<>(queues.values()).get(0))
                .extracting(PostQueue::getId)
                .containsExactly(4L, 1L, 2L, 3L, 5L);
        assertThat(queues.keySet().iterator().next()).startsWith("facebook-cookie:");
        assertThat(queues.keySet().iterator().next()).doesNotContain("9988");
    }

    @Test
    void differentFacebookUsersRemainParallelQueues() {
        SocialAccount first = cookieAccount(21L, "615100", "c_user=111; xs=session-a");
        SocialAccount second = cookieAccount(22L, "615200", "c_user=222; xs=session-b");
        String firstKey = CampaignScheduler.publishingIdentityKey(first);
        String secondKey = CampaignScheduler.publishingIdentityKey(second);

        LocalDateTime time = LocalDateTime.of(2026, 8, 25, 9, 0);
        Map<String, List<PostQueue>> queues = CampaignScheduler.groupPendingPosts(
                List.of(
                        post(1L, time, "615100:PERSONAL_COOKIE:21"),
                        post(2L, time, "615200:PERSONAL_COOKIE:22")),
                post -> post.getTargetFanpageId().endsWith(":21") ? firstKey : secondKey);

        assertThat(queues).hasSize(2);
    }

    @Test
    void directFacebookProofAllowsSafeRecovery() {
        assertThat(CampaignScheduler.hasDirectPublishedEvidence(
                PostQueue.builder().fbPostId("page_post").build())).isTrue();
        assertThat(CampaignScheduler.hasDirectPublishedEvidence(
                PostQueue.builder().publishedPostUrl("https://facebook.com/post/1").build())).isTrue();
        assertThat(CampaignScheduler.hasDirectPublishedEvidence(
                PostQueue.builder().publishedGroupPostUrls("https://facebook.com/groups/1/posts/2").build())).isTrue();
        assertThat(CampaignScheduler.hasDirectPublishedEvidence(PostQueue.builder().build())).isFalse();
    }

    @Test
    void continuousLanesChainPostsPerNickAndRunNicksInParallel() {
        LocalDateTime now = LocalDateTime.of(2026, 10, 15, 19, 0);
        List<PostQueue> pending = List.of(
                post(1L, now.plusHours(3), "A:PERSONAL_COOKIE:1"),
                post(2L, now.plusHours(5), "A:PERSONAL_COOKIE:1"),
                post(3L, now.plusHours(1), "B:PERSONAL_COOKIE:2"));
        List<PostQueue> updated = new ArrayList<>();

        CampaignScheduler.planContinuousLanes(pending, List.of(), null,
                p -> p.getTargetFanpageId().substring(0, 1), now, 120, updated);

        // Nick A: 2 bài nối nhau cách 60s đăng + 120s nghỉ; nick B chạy song song từ đầu (lệch 30s để tránh khởi động Chromium cùng tích tắc).
        assertThat(pending.get(0).getScheduledAt()).isEqualTo(now.plusSeconds(20));
        assertThat(pending.get(1).getScheduledAt()).isEqualTo(now.plusSeconds(20 + 180));
        assertThat(pending.get(2).getScheduledAt()).isEqualTo(now.plusSeconds(20 + 30));
        assertThat(updated).hasSize(3);
    }

    @Test
    void appendedPostsFillGapsWithoutOverlappingExistingSchedule() {
        LocalDateTime now = LocalDateTime.of(2026, 10, 15, 19, 0);
        PostQueue existing = post(1L, now.plusMinutes(2), "A:PERSONAL_COOKIE:1");
        PostQueue newOne = post(2L, now, "A:PERSONAL_COOKIE:1");
        PostQueue newTwo = post(3L, now, "A:PERSONAL_COOKIE:1");
        List<PostQueue> updated = new ArrayList<>();

        CampaignScheduler.planContinuousLanes(List.of(existing, newOne, newTwo), List.of(), java.util.Set.of(2L, 3L),
                p -> "A", now, 120, updated);

        // Bài cũ lúc +2' giữ nguyên; bài mới không chen vào trước nó (không đủ chỗ) mà nối ngay sau.
        assertThat(existing.getScheduledAt()).isEqualTo(now.plusMinutes(2));
        assertThat(newOne.getScheduledAt()).isEqualTo(now.plusMinutes(2).plusSeconds(180));
        assertThat(newTwo.getScheduledAt()).isEqualTo(now.plusMinutes(2).plusSeconds(360));
        assertThat(updated).containsExactly(newOne, newTwo);
    }

    private static final PostingWindow WINDOW_9_23 = new PostingWindow(true, java.time.LocalTime.of(9, 0), java.time.LocalTime.of(23, 0), 120);

    @Test
    void windowCompressesGapSoAllPostsFinishBeforeClose() {
        // 22:00, nick A có 10 bài, nghỉ 10' → bình thường hết 22:00 + 10×11' > 23:00; ép giãn cách để xong trước 23:00
        LocalDateTime now = LocalDateTime.of(2026, 10, 16, 22, 0);
        List<PostQueue> pending = new ArrayList<>();
        for (long i = 1; i <= 10; i++) pending.add(post(i, now, "A:PERSONAL_COOKIE:1"));
        List<PostQueue> updated = new ArrayList<>();
        java.util.Map<String, List<PostQueue>> deferred = new java.util.LinkedHashMap<>();

        CampaignScheduler.planContinuousLanes(pending, List.of(), null, p -> "A", now, 600,
                WINDOW_9_23, false, updated, deferred);

        assertThat(deferred).isEmpty();
        for (PostQueue p : pending) {
            assertThat(p.getScheduledAt().plusSeconds(60)).isBeforeOrEqualTo(now.withHour(23));
            assertThat(p.getWindowDeferred()).isNull();
        }
        // Giãn cách giữa 2 bài liên tiếp không dưới mức tối thiểu 2 phút (60s đăng + 120s nghỉ)
        for (int i = 1; i < pending.size(); i++) {
            long between = java.time.Duration.between(pending.get(i - 1).getScheduledAt(), pending.get(i).getScheduledAt()).getSeconds();
            assertThat(between).isGreaterThanOrEqualTo(180);
        }
    }

    @Test
    void spreadEvenlyFillsRemainingWindowInsteadOfPackingFromMorning() {
        // Ngoài giờ (01:00): 14 bài của 1 nick → rải đều từ 09:00 tới trước 23:00, không dồn cục buổi sáng
        LocalDateTime now = LocalDateTime.of(2026, 10, 16, 1, 0);
        List<PostQueue> pending = new ArrayList<>();
        for (long i = 1; i <= 14; i++) pending.add(post(i, now, "A:PERSONAL_COOKIE:1"));
        List<PostQueue> updated = new ArrayList<>();
        java.util.Map<String, List<PostQueue>> deferred = new java.util.LinkedHashMap<>();

        CampaignScheduler.planContinuousLanes(pending, List.of(), null, p -> "A", now, 180,
                WINDOW_9_23, false, true, updated, deferred);

        assertThat(deferred).isEmpty();
        assertThat(pending.get(0).getScheduledAt()).isEqualTo(LocalDateTime.of(2026, 10, 16, 9, 0));
        // 14h = 50400s, 14 bài × 60s đăng → giãn cách (50400 − 840) / 14 = 3540s → mỗi bài cách nhau đúng 1 tiếng
        for (int i = 1; i < pending.size(); i++) {
            long between = java.time.Duration.between(pending.get(i - 1).getScheduledAt(), pending.get(i).getScheduledAt()).getSeconds();
            assertThat(between).isEqualTo(3600);
        }
        assertThat(pending.get(13).getScheduledAt().plusSeconds(60)).isBeforeOrEqualTo(LocalDateTime.of(2026, 10, 16, 23, 0));
    }

    @Test
    void spreadEvenlyNeverGoesBelowMinimumGap() {
        // 22:30 còn 30', 5 bài: rải đều cần 360s/bài > tối thiểu 180s → dùng 360s; 20 bài thì giữ tối thiểu
        LocalDateTime now = LocalDateTime.of(2026, 10, 16, 22, 30);
        List<PostQueue> pending = new ArrayList<>();
        for (long i = 1; i <= 20; i++) pending.add(post(i, now, "A:PERSONAL_COOKIE:1"));
        List<PostQueue> updated = new ArrayList<>();
        java.util.Map<String, List<PostQueue>> deferred = new java.util.LinkedHashMap<>();

        CampaignScheduler.planContinuousLanes(pending, List.of(), null, p -> "A", now, 120,
                WINDOW_9_23, false, true, updated, deferred);

        long between = java.time.Duration.between(pending.get(0).getScheduledAt(), pending.get(1).getScheduledAt()).getSeconds();
        assertThat(between).isEqualTo(180);
        assertThat(deferred.get("A")).isNotEmpty();
    }

    @Test
    void windowOverflowGoesToNextMorningAndIsReported() {
        // 22:30 còn 30' — mỗi bài tối thiểu 3' (60s đăng + 120s nghỉ) → chỉ kịp ~10 bài, 5 bài dư sang 9:00 hôm sau
        LocalDateTime now = LocalDateTime.of(2026, 10, 16, 22, 30);
        List<PostQueue> pending = new ArrayList<>();
        for (long i = 1; i <= 15; i++) pending.add(post(i, now, "A:PERSONAL_COOKIE:1"));
        List<PostQueue> updated = new ArrayList<>();
        java.util.Map<String, List<PostQueue>> deferred = new java.util.LinkedHashMap<>();

        CampaignScheduler.planContinuousLanes(pending, List.of(), null, p -> "A", now, 300,
                WINDOW_9_23, false, updated, deferred);

        long today = pending.stream().filter(p -> p.getScheduledAt().toLocalDate().equals(now.toLocalDate())).count();
        assertThat(today).isEqualTo(10);
        assertThat(deferred.get("A")).hasSize(5);
        PostQueue firstDeferred = deferred.get("A").get(0);
        assertThat(firstDeferred.getScheduledAt()).isEqualTo(LocalDateTime.of(2026, 10, 17, 9, 0));
        assertThat(firstDeferred.getWindowDeferred()).isTrue();
    }

    @Test
    void packingOutsideWindowStartsAtNextOpenWithoutCountingAsOverflow() {
        LocalDateTime now = LocalDateTime.of(2026, 10, 16, 23, 30);
        List<PostQueue> pending = List.of(post(1L, now, "A:PERSONAL_COOKIE:1"), post(2L, now, "A:PERSONAL_COOKIE:1"));
        List<PostQueue> updated = new ArrayList<>();
        java.util.Map<String, List<PostQueue>> deferred = new java.util.LinkedHashMap<>();

        CampaignScheduler.planContinuousLanes(pending, List.of(), null, p -> "A", now, 120,
                WINDOW_9_23, false, updated, deferred);

        assertThat(pending.get(0).getScheduledAt()).isEqualTo(LocalDateTime.of(2026, 10, 17, 9, 0));
        assertThat(pending.get(1).getScheduledAt()).isEqualTo(LocalDateTime.of(2026, 10, 17, 9, 3));
        assertThat(deferred).isEmpty();
    }

    @Test
    void keepOriginalTimeMovesLateNightPostToMorningWithoutPullingItEarlier() {
        LocalDateTime now = LocalDateTime.of(2026, 10, 16, 15, 0);
        PostQueue late = post(1L, LocalDateTime.of(2026, 10, 16, 23, 40), "A:PERSONAL_COOKIE:1");
        List<PostQueue> updated = new ArrayList<>();
        java.util.Map<String, List<PostQueue>> deferred = new java.util.LinkedHashMap<>();

        CampaignScheduler.planContinuousLanes(List.of(late), List.of(), java.util.Set.of(1L), p -> "A", now, 180,
                WINDOW_9_23, true, updated, deferred);

        assertThat(late.getScheduledAt()).isEqualTo(LocalDateTime.of(2026, 10, 17, 9, 0));
        assertThat(deferred).isEmpty();
    }

    @Test
    void queueSummaryEstimatesFinishPerNickInsideWindow() {
        LocalDateTime now = LocalDateTime.of(2026, 10, 16, 22, 55);
        // Nick A: 1 bài trễ hạn + 1 bài 22:59:30 → bài 2 không kịp xong trước 23:00 → 9:00 hôm sau
        PostQueue a1 = post(1L, now.minusMinutes(10), "A:PERSONAL_COOKIE:1");
        PostQueue a2 = post(2L, now.plusMinutes(4).plusSeconds(30), "A:PERSONAL_COOKIE:1");
        // Nick B: 1 bài 22:56
        PostQueue b1 = post(3L, now.plusMinutes(1), "B:PERSONAL_COOKIE:2");

        java.util.Map<String, Object> summary = CampaignScheduler.queueFinishSummary(List.of(a1, a2, b1), List.of(),
                p -> p.getTargetFanpageId().substring(0, 1), lane -> "Nick " + lane, now, WINDOW_9_23);

        assertThat(summary.get("totalPending")).isEqualTo(3);
        assertThat(summary.get("finishAllAt")).isEqualTo(LocalDateTime.of(2026, 10, 17, 9, 1).toString());
        assertThat(summary.get("finishTodayCount")).isEqualTo(2);
        assertThat(summary.get("laterCount")).isEqualTo(1);
        @SuppressWarnings("unchecked")
        List<java.util.Map<String, Object>> lanes = (List<java.util.Map<String, Object>>) summary.get("lanes");
        assertThat(lanes.get(0).get("name")).isEqualTo("Nick A");
        assertThat(lanes.get(1).get("finishAt")).isEqualTo(LocalDateTime.of(2026, 10, 16, 22, 57).toString());
    }

    private SocialAccount cookieAccount(Long id, String pageId, String cookie) {
        return SocialAccount.builder()
                .id(id)
                .platform("FACEBOOK")
                .platformAccountId(pageId)
                .accountType("PERSONAL_COOKIE")
                .accessToken(cookie)
                .build();
    }

    private PostQueue post(Long id, LocalDateTime scheduledAt, String target) {
        return PostQueue.builder()
                .id(id)
                .status("PENDING")
                .scheduledAt(scheduledAt)
                .targetFanpageId(target)
                .build();
    }
}
