package com.autopost.saas.security;

import com.autopost.saas.util.LocalServices;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/**
 * Bản Desktop: chỉ app Tauri (và Worker do app khởi động) biết token phiên ngẫu nhiên.
 * Request thiếu token bị từ chối, kể cả curl từ chính máy đó hay trang web lạ gọi vào 127.0.0.1.
 * Không đăng ký khi không có DESKTOP_SESSION_TOKEN (dev/server giữ nguyên hành vi cũ).
 */
public class DesktopSessionTokenFilter extends OncePerRequestFilter {

    /** Request do worker gửi (token worker) → được bỏ qua bước đăng nhập người dùng */
    public static final String WORKER_ATTR = "desktop.worker";

    private final byte[] expected;
    private final byte[] workerToken;

    public DesktopSessionTokenFilter(String token, String workerToken) {
        this.expected = token.getBytes(StandardCharsets.UTF_8);
        this.workerToken = workerToken == null ? null : workerToken.getBytes(StandardCharsets.UTF_8);
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getRequestURI();
        if ("OPTIONS".equalsIgnoreCase(request.getMethod())) return true;
        // <img>/<video> không gửi được header → file tĩnh trong uploads/ và health check được miễn
        boolean isGet = "GET".equalsIgnoreCase(request.getMethod()) || "HEAD".equalsIgnoreCase(request.getMethod());
        return isGet && (path.startsWith("/uploads/") || path.equals("/actuator/health"));
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String token = request.getHeader(LocalServices.SESSION_HEADER);
        if (token == null) token = request.getParameter("st");
        byte[] given = token == null ? null : token.getBytes(StandardCharsets.UTF_8);
        if (given != null && workerToken != null && MessageDigest.isEqual(workerToken, given)) {
            request.setAttribute(WORKER_ATTR, Boolean.TRUE);
            chain.doFilter(request, response);
            return;
        }
        if (given == null || !MessageDigest.isEqual(expected, given)) {
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setContentType("application/json;charset=UTF-8");
            response.getWriter().write("{\"error\":\"SESSION_TOKEN_REQUIRED\"}");
            return;
        }
        chain.doFilter(request, response);
    }
}
