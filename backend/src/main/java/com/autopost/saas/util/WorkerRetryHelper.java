package com.autopost.saas.util;

import lombok.extern.slf4j.Slf4j;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestTemplate;

import java.net.SocketTimeoutException;

/**
 * Gọi POST tới Playwright Worker với tự động thử lại khi KHÔNG kết nối được (Connection refused —
 * thường do worker vừa restart/respawn, cần vài giây để mở lại cổng). KHÔNG retry khi đã timeout
 * đọc phản hồi (SocketTimeoutException), vì lúc đó request có thể đã tới worker và worker có thể
 * đang thực thi dở — retry ở đây dễ gây double-submit cho các thao tác có side-effect (đăng bài...).
 */
@Slf4j
public final class WorkerRetryHelper {

    private static final int[] RETRY_DELAYS_MS = { 3000, 5000, 8000 };

    private WorkerRetryHelper() {}

    public static <T> T postWithConnectionRetry(RestTemplate restTemplate, String url, Object request, Class<T> responseType) {
        for (int attempt = 0; ; attempt++) {
            try {
                return restTemplate.postForObject(url, request, responseType);
            } catch (ResourceAccessException e) {
                if (e.getCause() instanceof SocketTimeoutException) {
                    throw e;
                }
                if (attempt >= RETRY_DELAYS_MS.length) {
                    throw e;
                }
                int delayMs = RETRY_DELAYS_MS[attempt];
                log.warn("⚠️ Không kết nối được Playwright Worker ({}) khi gọi {}, thử lại lần {}/{} sau {}ms...",
                        e.getMessage(), url, attempt + 1, RETRY_DELAYS_MS.length, delayMs);
                try {
                    Thread.sleep(delayMs);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    throw e;
                }
            }
        }
    }
}
