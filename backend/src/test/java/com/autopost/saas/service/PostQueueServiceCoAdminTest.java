package com.autopost.saas.service;

import com.autopost.saas.entity.FacebookPageAccess;
import com.autopost.saas.entity.SocialAccount;
import com.autopost.saas.repository.FacebookPageAccessRepository;
import com.autopost.saas.repository.PostQueueGroupResultRepository;
import com.autopost.saas.repository.PostQueueRepository;
import com.autopost.saas.repository.SocialAccountRepository;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class PostQueueServiceCoAdminTest {

    private static final String LAM_SEN = "61584834510803";
    private static final String NICK_1 = "100023403136194";
    private static final String NICK_2 = "100009194846268";

    private final SocialAccountRepository socialAccountRepository = mock(SocialAccountRepository.class);
    private final FacebookPageAccessRepository pageAccessRepository = mock(FacebookPageAccessRepository.class);
    private final PostQueueService service = new PostQueueService(
            mock(PostQueueRepository.class), socialAccountRepository, mock(PostQueueGroupResultRepository.class),
            mock(FacebookGraphApiService.class), mock(GeminiService.class), pageAccessRepository,
            mock(WorkerRouterService.class), new ViaCookieFollowService(socialAccountRepository));

    @Test
    void coAdminViaWithoutConnectionForThisPageIsNotUsed() {
        // Nick 2 là admin Làm Sen nhưng chỉ có kết nối cho Page "BaT" → không được đem kết nối BaT ra đăng Làm Sen.
        List<SocialAccount> accounts = new ArrayList<>(List.of(
                cookieAccount(7L, LAM_SEN, NICK_1),
                cookieAccount(83L, "61584073808794", NICK_2)));
        when(socialAccountRepository.findByUserId(1L)).thenReturn(accounts);
        when(pageAccessRepository.findByUserIdAndPageIdAndActiveTrue(1L, LAM_SEN))
                .thenReturn(List.of(access(NICK_1), access(NICK_2)));

        assertThat(service.findCandidatePostingAccountsForPage(1L, LAM_SEN, 7L))
                .extracting(SocialAccount::getId)
                .containsExactly(7L);

        // Khi nick 2 có kết nối riêng cho Làm Sen thì được dùng làm Via thứ 2.
        accounts.add(cookieAccount(120L, LAM_SEN, NICK_2));
        when(socialAccountRepository.findById(7L)).thenReturn(java.util.Optional.of(accounts.get(0)));
        assertThat(service.findCandidatePostingAccountsForPage(1L, LAM_SEN, 7L))
                .extracting(SocialAccount::getId)
                .containsExactly(7L, 120L);
    }

    private static SocialAccount cookieAccount(Long id, String pageId, String cUser) {
        return SocialAccount.builder()
                .id(id)
                .platformAccountId(pageId)
                .accountType("PERSONAL_COOKIE")
                .accessToken("c_user=" + cUser + "; xs=abc")
                .build();
    }

    private static FacebookPageAccess access(String cUser) {
        return FacebookPageAccess.builder().pageId(LAM_SEN).personalProfileId(cUser).active(true).build();
    }
}
