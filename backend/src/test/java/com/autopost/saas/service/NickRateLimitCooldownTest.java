package com.autopost.saas.service;

import com.autopost.saas.entity.PostQueue;
import com.autopost.saas.entity.SocialAccount;
import com.autopost.saas.repository.FacebookPageAccessRepository;
import com.autopost.saas.repository.PostQueueGroupResultRepository;
import com.autopost.saas.repository.PostQueueRepository;
import com.autopost.saas.repository.SocialAccountRepository;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class NickRateLimitCooldownTest {

    private static final String THANH_AN = "100023403136194";
    private static final String NICK_2 = "100009194846268";

    private final PostQueueRepository postQueueRepository = mock(PostQueueRepository.class);
    private final SocialAccountRepository socialAccountRepository = mock(SocialAccountRepository.class);
    private final NickThrottleService throttle = new NickThrottleService();
    private final PostQueueService service = new PostQueueService(
            postQueueRepository, socialAccountRepository, mock(PostQueueGroupResultRepository.class),
            mock(FacebookGraphApiService.class), mock(GeminiService.class), mock(FacebookPageAccessRepository.class),
            mock(WorkerRouterService.class), new ViaCookieFollowService(socialAccountRepository), throttle, mock(SocialAccountService.class));

    @Test
    void rateLimitOnOnePageRestsEveryConnectionOfTheSameNick() {
        SocialAccount lamSen = account(125L, "c_user=" + THANH_AN + "; xs=a; i_user=61584834510803");
        SocialAccount doanCongDang = account(103L, "xs=b; c_user=" + THANH_AN);
        SocialAccount nick2Page = account(110L, "c_user=" + NICK_2 + "; xs=c");
        when(socialAccountRepository.findAll()).thenReturn(List.of(lamSen, doanCongDang, nick2Page));

        LocalDateTime soon = LocalDateTime.now().plusMinutes(5);
        PostQueue current = post(1L, "61584834510803:PERSONAL_COOKIE:125", LocalDateTime.now());
        PostQueue samePageSoon = post(2L, "61584834510803:PERSONAL_COOKIE:125", soon);
        PostQueue otherPageSoon = post(3L, "61594906257820:PERSONAL_COOKIE:103", soon);
        PostQueue nick2Soon = post(4L, "61584834510803:PERSONAL_COOKIE:110", soon);
        when(postQueueRepository.findByStatusAndTargetFanpageIdEndingWith(eq("PENDING"), anyString())).thenReturn(List.of());
        when(postQueueRepository.findByStatusAndTargetFanpageIdEndingWith("PENDING", ":125")).thenReturn(List.of(samePageSoon));
        when(postQueueRepository.findByStatusAndTargetFanpageIdEndingWith("PENDING", ":103")).thenReturn(List.of(otherPageSoon));
        when(postQueueRepository.findByStatusAndTargetFanpageIdEndingWith("PENDING", ":110")).thenReturn(List.of(nick2Soon));

        service.applyRateLimitCooldown(lamSen, current);

        LocalDateTime resume = LocalDateTime.now().plusHours(PostQueueService.RATE_LIMIT_COOLDOWN_HOURS).minusMinutes(1);
        assertThat(current.getStatus()).isEqualTo("PENDING");
        assertThat(current.getScheduledAt()).isAfter(resume);
        assertThat(current.getErrorMessage()).startsWith(PostQueueService.RATE_LIMIT_MESSAGE_PREFIX);
        assertThat(samePageSoon.getScheduledAt()).isAfter(resume);
        assertThat(otherPageSoon.getScheduledAt()).isAfter(resume);
        assertThat(nick2Soon.getScheduledAt()).isEqualTo(soon);

        assertThat(throttle.rateLimitedUntil(NickThrottleService.nickKey(doanCongDang), LocalDateTime.now())).isNotNull();
        assertThat(throttle.rateLimitedUntil(NickThrottleService.nickKey(nick2Page), LocalDateTime.now())).isNull();
    }

    @Test
    void onlySpecificFacebookPhrasesCountAsRateLimit() {
        assertThat(PostQueueService.isRateLimited("FB_SPAM_BLOCK: Facebook chặn đăng tạm thời")).isTrue();
        assertThat(PostQueueService.isRateLimited("Để bảo vệ cộng đồng khỏi spam, chúng tôi giới hạn tần suất bạn đăng bài")).isTrue();
        assertThat(PostQueueService.isRateLimited("FB_RATE_LIMITED: Rate limit exceeded 1675004")).isTrue();
        assertThat(PostQueueService.isRateLimited("FB_MODAL_STUCK: Nhóm Chống Spam Lừa Đảo - không tìm thấy nút Đăng")).isFalse();
        assertThat(PostQueueService.isRateLimited(null)).isFalse();
    }

    @Test
    void hourlyCapCountsAllConnectionsOfTheNickTogether() {
        String key = NickThrottleService.nickKey(account(125L, "c_user=" + THANH_AN));
        assertThat(key).isEqualTo(NickThrottleService.nickKey(account(103L, "xs=z; c_user=" + THANH_AN + "; i_user=1")));
        assertThat(key).doesNotContain(THANH_AN);

        long t0 = 1_000_000_000L;
        for (int i = 0; i < NickThrottleService.MAX_POSTS_PER_HOUR_PER_NICK - 1; i++) {
            throttle.recordStart(key, t0 + i * 60_000L);
        }
        long now = t0 + 30 * 60_000L;
        assertThat(throttle.isOverHourlyCap(key, now)).isFalse();
        throttle.recordStart(key, now);
        assertThat(throttle.isOverHourlyCap(key, now)).isTrue();
        assertThat(throttle.blockReason(key, "Làm Sen", LocalDateTime.now(), now)).contains("60 phút");
        // Bài đầu tiên ra khỏi cửa sổ 60 phút → được đăng tiếp.
        assertThat(throttle.isOverHourlyCap(key, t0 + 3_600_000L)).isFalse();
    }

    private static SocialAccount account(Long id, String cookie) {
        return SocialAccount.builder().id(id).pageName("Page " + id).accountType("PERSONAL_COOKIE").accessToken(cookie).build();
    }

    private static PostQueue post(Long id, String target, LocalDateTime at) {
        PostQueue p = new PostQueue();
        p.setId(id);
        p.setStatus("PENDING");
        p.setTargetFanpageId(target);
        p.setScheduledAt(at);
        return p;
    }
}
