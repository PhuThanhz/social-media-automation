package com.autopost.saas.util;

import org.apache.hc.client5.http.config.RequestConfig;
import org.apache.hc.client5.http.impl.classic.CloseableHttpClient;
import org.apache.hc.client5.http.impl.classic.HttpClients;
import org.apache.hc.client5.http.impl.io.PoolingHttpClientConnectionManager;
import org.apache.hc.core5.util.Timeout;
import org.springframework.http.client.HttpComponentsClientHttpRequestFactory;
import org.springframework.web.client.RestTemplate;

/**
 * Tạo RestTemplate dùng chung 1 connection pool (tái sử dụng TCP/TLS thay vì mở mới mỗi lần gọi),
 * thay cho pattern "new RestTemplate()" rải rác trước đây. Mỗi service tự gọi create() với
 * connect/read timeout riêng phù hợp — KHÔNG dùng Spring @Bean/@Qualifier để tránh rủi ro tiêm nhầm
 * instance timeout ngắn vào chỗ cần timeout dài (VD: PostQueueService gọi Worker đăng bài Playwright
 * thật, cần readTimeout dài hàng chục phút).
 */
public final class PooledRestTemplateFactory {

    private static final PoolingHttpClientConnectionManager CONNECTION_MANAGER = new PoolingHttpClientConnectionManager();

    static {
        CONNECTION_MANAGER.setMaxTotal(100);
        CONNECTION_MANAGER.setDefaultMaxPerRoute(50);
    }

    private PooledRestTemplateFactory() {
    }

    // RequestConfig#setConnectTimeout bị đánh dấu deprecated ở httpclient5 (khuyến nghị chuyển sang
    // ConnectionConfig ở connection manager), nhưng vẫn hoạt động đúng ở bản 5.4.1. Giữ nguyên ở đây vì
    // connectTimeout khác nhau theo từng caller (VD ScraperService dùng 3000/5000ms cho health-check),
    // trong khi ConnectionConfig chỉ set được 1 lần cho cả connection manager dùng chung.
    @SuppressWarnings("deprecation")
    public static RestTemplate create(int connectTimeoutMs, int readTimeoutMs) {
        RequestConfig requestConfig = RequestConfig.custom()
                .setConnectTimeout(Timeout.ofMilliseconds(connectTimeoutMs))
                .setResponseTimeout(Timeout.ofMilliseconds(readTimeoutMs))
                .setConnectionRequestTimeout(Timeout.ofMilliseconds(connectTimeoutMs))
                .build();

        CloseableHttpClient httpClient = HttpClients.custom()
                .setConnectionManager(CONNECTION_MANAGER)
                .setConnectionManagerShared(true)
                .setDefaultRequestConfig(requestConfig)
                .build();

        HttpComponentsClientHttpRequestFactory factory = new HttpComponentsClientHttpRequestFactory(httpClient);
        return new RestTemplate(factory);
    }
}
