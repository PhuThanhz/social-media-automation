package com.autopost.saas.service.telegram;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class TelegramTextTest {

    @Test
    void parsesCommandWithBotSuffixAndArgument() {
        TelegramText.Command c = TelegramText.parseCommand("/start@ToolZutterBot  123456 ");
        assertThat(c.name()).isEqualTo("start");
        assertThat(c.arg()).isEqualTo("123456");
        assertThat(TelegramText.parseCommand("/LICH").name()).isEqualTo("lich");
        assertThat(TelegramText.parseCommand("xem lịch")).isNull();
        assertThat(TelegramText.parseCommand("/")).isNull();
    }

    @Test
    void extractsUrlsDedupedAndWithoutTrailingPunctuation() {
        String text = "đăng giúp:\nhttps://www.facebook.com/reel/123, https://vt.tiktok.com/ZSabc/).\nhttps://www.facebook.com/reel/123";
        assertThat(TelegramText.extractUrls(text))
                .containsExactly("https://www.facebook.com/reel/123", "https://vt.tiktok.com/ZSabc/");
        assertThat(TelegramText.extractUrls("không có link")).isEmpty();
    }

    @Test
    void recognisesThreadsHostsOnly() {
        assertThat(TelegramText.isThreadsUrl("https://www.threads.com/@abc/post/X1")).isTrue();
        assertThat(TelegramText.isThreadsUrl("https://threads.net/@abc/post/X1")).isTrue();
        assertThat(TelegramText.isThreadsUrl("https://www.facebook.com/threads.com")).isFalse();
        assertThat(TelegramText.isThreadsUrl("https://evilthreads.com/x")).isFalse();
    }

    @Test
    void connectionIdComesFromThirdSegment() {
        assertThat(TelegramText.connectionIdOf("61584834510803:PERSONAL_COOKIE:7")).isEqualTo(7L);
        assertThat(TelegramText.connectionIdOf("61584834510803:PERSONAL_COOKIE")).isNull();
        assertThat(TelegramText.connectionIdOf(null)).isNull();
    }

    @Test
    void tokenIsNeverShownOrLogged() {
        String token = "123456789:AAH-abcdefghijklmnopqrstuvwxyz012345";
        assertThat(TelegramConfigService.maskToken(token)).isEqualTo("123456789:***");
        String err = "I/O error on POST request for \"https://api.telegram.org/bot" + token + "/getUpdates\"";
        assertThat(TelegramApi.sanitize(err, token)).doesNotContain("AAH-abc").contains("bot***");
        assertThat(TelegramApi.sanitize("https://api.telegram.org/bot987654:ZZZZZZZZZZZZZZZZZZZZZZZZZZ/x", null)).doesNotContain("ZZZZ");
    }

    @Test
    void htmlIsEscaped() {
        assertThat(TelegramApi.esc("<b>A & B</b>")).isEqualTo("&lt;b&gt;A &amp; B&lt;/b&gt;");
    }

    @Test
    void onlyUrlsMessagesAreNotTreatedAsCaptions() {
        assertThat(TelegramText.isOnlyUrls("https://fb.com/reel/1")).isTrue();
        assertThat(TelegramText.isOnlyUrls(" https://a.com/x ,\nhttps://b.com/y ")).isTrue();
        assertThat(TelegramText.isOnlyUrls("Mua tại đây https://shopee.vn/x")).isFalse();
        assertThat(TelegramText.isOnlyUrls("caption không link")).isFalse();
        assertThat(TelegramText.isOnlyUrls("")).isFalse();
    }
}
