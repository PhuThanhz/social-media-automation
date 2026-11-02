package com.autopost.saas.service;

import com.autopost.saas.util.LocalServices;
import com.autopost.saas.util.PooledRestTemplateFactory;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestTemplate;

import java.util.Map;

/**
 * Kiểm tra chủ động xem cookie Facebook (tài khoản PERSONAL_COOKIE) còn dùng được không, thay vì chỉ
 * biết khi một bài đăng thực tế thất bại. Dùng lại endpoint worker /api/get-account-name có sẵn — nó
 * đã mở trình duyệt Playwright thật, load mbasic.facebook.com và gọi assertFacebookSession() để phát
 * hiện cookie hết hạn/không hợp lệ, nên không cần viết thêm automation mới ở worker.
 */
@Service
@Slf4j
public class PlaywrightHealthCheckService {

    private static final String EXPIRED_MARKER = "hết hạn hoặc không hợp lệ";
    private final RestTemplate restTemplate = PooledRestTemplateFactory.create(10000, 60000);

    /** Trả về "OK", "EXPIRED", hoặc "UNKNOWN" (lỗi không xác định được, VD worker đang tắt/timeout). */
    public String checkCookieStatus(String cookieString) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        HttpEntity<Map<String, String>> request = new HttpEntity<>(Map.of("cookieString", cookieString), headers);
        try {
            restTemplate.postForEntity(LocalServices.WORKER_BASE + "/api/get-account-name", request, Map.class);
            return "OK";
        } catch (HttpStatusCodeException e) {
            // /api/get-account-name trả HTTP 500 kèm {success:false, error:"..."} khi cookie hỏng (không
            // phải HTTP 200 kèm success:false) — RestTemplate ném exception thay vì trả body bình thường,
            // nên phải bắt HttpStatusCodeException và soi nội dung lỗi thay vì đọc response body như thường lệ.
            String responseBody = e.getResponseBodyAsString();
            if (responseBody != null && responseBody.contains(EXPIRED_MARKER)) {
                return "EXPIRED";
            }
            log.warn("⚠️ Worker trả lỗi không xác định khi kiểm tra cookie: {}", responseBody);
            return "UNKNOWN";
        } catch (Exception e) {
            log.warn("⚠️ Không gọi được Worker để kiểm tra cookie (worker có đang chạy port 3001?): {}", e.getMessage());
            return "UNKNOWN";
        }
    }
}
