package com.autopost.saas.scheduler;

import com.autopost.saas.entity.PostQueue;
import com.autopost.saas.entity.SocialAccount;
import com.autopost.saas.service.PostQueueService;
import com.autopost.saas.service.PostingWindowService;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.CALLS_REAL_METHODS;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.withSettings;

/** Khoá làn, giãn cách bài trễ, bài đầu làn và khoá theo c_user (tối ưu scheduler 2026-11-23). */
class CampaignSchedulerLaneLockTest {

    private CampaignScheduler schedulerWith(PostQueueService postQueueService, PostingWindowService windowService) {
        CampaignScheduler scheduler = mock(CampaignScheduler.class, withSettings().defaultAnswer(CALLS_REAL_METHODS));
        ReflectionTestUtils.setField(scheduler, "postQueueService", postQueueService);
        ReflectionTestUtils.setField(scheduler, "postingWindowService", windowService);
        return scheduler;
    }

    @Test
    void laneLockIsKeptWhilePostIsStillInFlight() {
        PostQueueService pqs = mock(PostQueueService.class);
        when(pqs.isInFlight(42L)).thenReturn(true);
        CampaignScheduler scheduler = schedulerWith(pqs, null);
        Map<String, Long> holders = new ConcurrentHashMap<>(Map.of("nick-a", 42L));
        long now = 10_000_000L;

        // Giữ 8 phút (quá mốc 5 phút cũ) nhưng bài vẫn đang chạy → KHÔNG nhả.
        assertThat(scheduler.releaseIfStale("account", "nick-a", now - 8 * 60_000, holders, now)).isFalse();
        // Giữ 20 phút, vẫn in-flight → vẫn giữ (dưới mốc tuyệt đối 45 phút).
        assertThat(scheduler.releaseIfStale("account", "nick-a", now - 20 * 60_000, holders, now)).isFalse();
        assertThat(holders).containsKey("nick-a");
    }

    @Test
    void laneLockIsReleasedWhenPostIsNoLongerRunningOrHardLimitPassed() {
        PostQueueService pqs = mock(PostQueueService.class);
        when(pqs.isInFlight(7L)).thenReturn(false);
        when(pqs.isInFlight(8L)).thenReturn(true);
        CampaignScheduler scheduler = schedulerWith(pqs, null);
        long now = 10_000_000L;

        Map<String, Long> holders = new ConcurrentHashMap<>(Map.of("nick-a", 7L, "nick-b", 8L));
        // Dưới 11 phút: chưa xét kẹt dù không in-flight (vừa submit, đang chờ thread).
        assertThat(scheduler.releaseIfStale("account", "nick-a", now - 60_000, holders, now)).isFalse();
        // Quá 11 phút và không còn in-flight → kẹt, nhả.
        assertThat(scheduler.releaseIfStale("account", "nick-a", now - 12 * 60_000, holders, now)).isTrue();
        assertThat(holders).doesNotContainKey("nick-a");
        // Vẫn in-flight nhưng quá 45 phút → nhả để không treo làn vĩnh viễn.
        assertThat(scheduler.releaseIfStale("account", "nick-b", now - 46 * 60_000, holders, now)).isTrue();
    }

    @Test
    void sameNickGapFollowsScheduleSettingsWithThreeSecondFloor() {
        PostingWindowService windowService = mock(PostingWindowService.class);
        when(windowService.get()).thenReturn(new PostingWindow(true, LocalTime.of(8, 0), LocalTime.of(22, 0), 60));
        assertThat(schedulerWith(null, windowService).sameNickGapMs()).isEqualTo(60_000L);

        when(windowService.get()).thenReturn(new PostingWindow(true, LocalTime.of(8, 0), LocalTime.of(22, 0), 0));
        assertThat(schedulerWith(null, windowService).sameNickGapMs()).isEqualTo(3_000L);
    }

    @Test
    void laneHeadsAreMergedIntoOldestPageWithoutDuplicates() {
        LocalDateTime t = LocalDateTime.of(2026, 11, 23, 9, 0);
        List<PostQueue> oldestPage = List.of(post(1L, t, "A:PERSONAL_COOKIE:1"), post(2L, t.plusMinutes(1), "A:PERSONAL_COOKIE:1"));
        List<PostQueue> heads = List.of(post(1L, t, "A:PERSONAL_COOKIE:1"), post(99L, t.plusMinutes(30), "B:PERSONAL_COOKIE:2"));

        List<PostQueue> merged = CampaignScheduler.mergeLaneHeads(oldestPage, heads);

        assertThat(merged).extracting(PostQueue::getId).containsExactly(1L, 2L, 99L);
    }

    @Test
    void anyConnectionCarryingSameCUserSharesOneLane() {
        SocialAccount pageConn = account(11L, "PERSONAL_COOKIE", "c_user=9988; xs=a; i_user=615100");
        SocialAccount groupConn = account(35L, "PERSONAL_PROFILE_COOKIE", "xs=b; c_user=9988");
        SocialAccount pageToken = account(50L, "PAGE_TOKEN", "EAAB-token");

        assertThat(CampaignScheduler.publishingIdentityKey(groupConn))
                .isEqualTo(CampaignScheduler.publishingIdentityKey(pageConn))
                .startsWith("facebook-cookie:")
                .doesNotContain("9988");
        assertThat(CampaignScheduler.publishingIdentityKey(pageToken)).startsWith("platform-account:PAGE_TOKEN:");
    }

    private static SocialAccount account(Long id, String type, String token) {
        return SocialAccount.builder().id(id).platform("FACEBOOK").platformAccountId("615" + id)
                .accountType(type).accessToken(token).build();
    }

    private static PostQueue post(Long id, LocalDateTime scheduledAt, String target) {
        return PostQueue.builder().id(id).status("PENDING").scheduledAt(scheduledAt).targetFanpageId(target).build();
    }
}
