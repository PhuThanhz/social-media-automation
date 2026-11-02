package com.autopost.saas.service;

import com.autopost.saas.entity.SocialAccount;
import com.autopost.saas.entity.User;
import com.autopost.saas.repository.FacebookPageAccessRepository;
import com.autopost.saas.repository.GroupFlopConfigRepository;
import com.autopost.saas.repository.PostQueueGroupResultRepository;
import com.autopost.saas.repository.PostQueueRepository;
import com.autopost.saas.repository.PostTargetRepository;
import com.autopost.saas.repository.SocialAccountRepository;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class RefreshedFacebookCookieTest {

    private static final String NICK = "100023403136194";
    private static final String OTHER = "100009194846268";
    private static final String OLD = "c_user=" + NICK + "; xs=old; fr=1";
    private static final String FRESH = "c_user=" + NICK + "; xs=new; fr=2";

    private final SocialAccountRepository repo = mock(SocialAccountRepository.class);
    private final SocialAccountService socialAccountService = mock(SocialAccountService.class);
    private final PostQueueService service = new PostQueueService(
            mock(PostQueueRepository.class), repo, mock(PostQueueGroupResultRepository.class),
            mock(FacebookGraphApiService.class), mock(GeminiService.class), mock(FacebookPageAccessRepository.class),
            mock(WorkerRouterService.class), new ViaCookieFollowService(repo), new NickThrottleService(), socialAccountService);

    @Test
    void freshCookieOfSameNickIsSavedForAllConnectionsAndInMemoryAccount() {
        SocialAccount page = account(7L, OLD);
        service.saveRefreshedFacebookCookie(OLD, Map.of("success", true, "cookieString", FRESH), page);

        verify(socialAccountService).applyCookieToSameCUser(1L, NICK, FRESH);
        assertThat(page.getAccessToken()).isEqualTo(FRESH);
        assertThat(page.getTokenStatus()).isEqualTo("OK");
    }

    @Test
    void ignoresMissingUnchangedOrOtherNickCookie() {
        SocialAccount page = account(7L, OLD);
        service.saveRefreshedFacebookCookie(OLD, Map.of("success", true), page);
        service.saveRefreshedFacebookCookie(OLD, Map.of("cookieString", OLD), page);
        service.saveRefreshedFacebookCookie(OLD, Map.of("cookieString", "c_user=" + OTHER + "; xs=z"), page);
        service.saveRefreshedFacebookCookie(OLD, null, page);

        verify(socialAccountService, never()).applyCookieToSameCUser(any(), any(), any());
        assertThat(page.getAccessToken()).isEqualTo(OLD);
    }

    @Test
    void serviceUpdatesEveryConnectionWithSameCUserOnly() {
        SocialAccountService real = spy(new SocialAccountService(repo, mock(FacebookGraphApiService.class),
                mock(FacebookPageAccessRepository.class), mock(PostTargetRepository.class),
                mock(PostQueueGroupResultRepository.class), mock(GroupFlopConfigRepository.class)));
        SocialAccount via = account(1L, OLD);
        SocialAccount page = account(2L, "c_user=\"" + NICK + "\"; xs=old; i_user=615");
        SocialAccount other = account(3L, "c_user=" + OTHER + "; xs=o");
        when(repo.findByUserId(1L)).thenReturn(List.of(via, page, other));
        doAnswer(inv -> inv.getArgument(0)).when(real).saveAccount(any());

        List<String> updated = real.applyCookieToSameCUser(1L, NICK, FRESH);

        assertThat(updated).containsExactly("acc1", "acc2");
        assertThat(via.getAccessToken()).isEqualTo(FRESH);
        assertThat(page.getAccessToken()).isEqualTo(FRESH);
        assertThat(other.getAccessToken()).isEqualTo("c_user=" + OTHER + "; xs=o");
    }

    private static SocialAccount account(Long id, String cookie) {
        return SocialAccount.builder()
                .id(id)
                .pageName("acc" + id)
                .platformAccountId("page" + id)
                .accountType("PERSONAL_COOKIE")
                .accessToken(cookie)
                .user(User.builder().id(1L).build())
                .build();
    }
}
