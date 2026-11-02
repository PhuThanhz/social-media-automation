package com.autopost.saas.util;

import org.springframework.http.client.ClientHttpRequestInterceptor;
import org.springframework.web.client.RestTemplate;

import java.net.URI;
import java.net.http.HttpRequest;
import java.util.Set;

/**
 * Địa chỉ Worker + token phiên của bản Desktop.
 * Bản Desktop (Tauri) truyền WORKER_BASE_URL và DESKTOP_SESSION_TOKEN qua biến môi trường;
 * chạy dev/server bình thường thì không có token và mọi thứ giữ nguyên như cũ.
 */
public final class LocalServices {

    public static final String SESSION_HEADER = "X-Session-Token";

    public static final String WORKER_BASE = env("WORKER_BASE_URL", "http://localhost:3001");

    /** null khi không chạy bản Desktop */
    public static final String SESSION_TOKEN = env("DESKTOP_SESSION_TOKEN", null);

    /** Token riêng của worker khi gọi ngược về backend (không cần đăng nhập người dùng) */
    public static final String WORKER_TOKEN = env("DESKTOP_WORKER_TOKEN", null);

    private static final Set<String> LOOPBACK_HOSTS = Set.of("localhost", "127.0.0.1", "[::1]", "::1");

    private LocalServices() {
    }

    private static String env(String key, String fallback) {
        String v = System.getenv(key);
        return v == null || v.isBlank() ? fallback : v.trim();
    }

    /** Chỉ gắn token cho request tới máy local, không bao giờ gửi ra dịch vụ bên ngoài (Facebook, Gemini...) */
    public static boolean isLoopback(URI uri) {
        return uri != null && uri.getHost() != null && LOOPBACK_HOSTS.contains(uri.getHost().toLowerCase());
    }

    public static ClientHttpRequestInterceptor sessionTokenInterceptor() {
        return (request, body, execution) -> {
            if (SESSION_TOKEN != null && isLoopback(request.getURI())) {
                request.getHeaders().set(SESSION_HEADER, SESSION_TOKEN);
            }
            return execution.execute(request, body);
        };
    }

    public static RestTemplate withSessionToken(RestTemplate restTemplate) {
        if (SESSION_TOKEN != null) {
            restTemplate.getInterceptors().add(sessionTokenInterceptor());
        }
        return restTemplate;
    }

    public static HttpRequest.Builder withSessionToken(HttpRequest.Builder builder, URI uri) {
        if (SESSION_TOKEN != null && isLoopback(uri)) {
            builder.header(SESSION_HEADER, SESSION_TOKEN);
        }
        return builder;
    }
}
