package com.autopost.saas.service;

import com.autopost.saas.entity.SocialAccount;
import com.autopost.saas.entity.User;
import com.autopost.saas.repository.SocialAccountRepository;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class SocialAccountPauseTest {

    private final User owner = User.builder().id(1L).build();
    private final SocialAccount via = acc(10L, "Nick An", "c_user=111; xs=a");
    private final SocialAccount pageA = acc(11L, "Làm Sen", "xs=b; c_user=111");
    private final SocialAccount other = acc(12L, "Kinh Tế", "c_user=222");
    private final SocialAccountRepository repo = mock(SocialAccountRepository.class);
    private final SocialAccountService service = new SocialAccountService(repo, null, null, null, null, null);

    SocialAccountPauseTest() {
        when(repo.findByUserId(1L)).thenReturn(List.of(via, pageA, other));
        when(repo.findById(11L)).thenReturn(Optional.of(pageA));
        when(repo.save(any())).thenAnswer(i -> i.getArgument(0));
    }

    @Test
    void pausingOneConnectionPausesEveryConnectionOfThatNick() {
        List<String> names = service.setPaused(1L, 11L, true, true);

        assertThat(names).containsExactlyInAnyOrder("Nick An", "Làm Sen");
        assertThat(via.getPaused()).isTrue();
        assertThat(pageA.getPaused()).isTrue();
        assertThat(other.getPaused()).isNull();

        service.setPaused(1L, 11L, false, true);
        assertThat(via.getPaused()).isNull();
        assertThat(pageA.getPaused()).isNull();
    }

    @Test
    void singleConnectionModeTouchesOnlyThatConnection() {
        service.setPaused(1L, 11L, true, false);
        assertThat(pageA.getPaused()).isTrue();
        assertThat(via.getPaused()).isNull();
    }

    @Test
    void cannotPauseAnotherUsersConnection() {
        assertThatThrownBy(() -> service.setPaused(2L, 11L, true, true)).isInstanceOf(IllegalArgumentException.class);
    }

    private SocialAccount acc(Long id, String name, String cookie) {
        return SocialAccount.builder().id(id).user(owner).platform("FACEBOOK_PAGE").pageName(name)
                .accountType("PERSONAL_COOKIE").accessToken(cookie).build();
    }
}
