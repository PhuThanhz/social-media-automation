package com.autopost.saas.scheduler;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.util.Map;

/**
 * Scheduler tự động kiểm tra các Kênh Douyin hot định kỳ (mỗi 2 giờ),
 * trích xuất video mới chưa đăng, tự động dịch Vietsub và xếp vào Hàng Đợi Đăng Bài.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class DouyinChannelMonitorScheduler {

    private final RestTemplate restTemplate = new RestTemplate();
    private final String WORKER_BASE_URL = "http://localhost:3001";

    // @Scheduled(fixedRate = 7_200_000, initialDelay = 180_000)
    public void monitorDouyinChannels() {
        log.info("🔎 [Douyin Monitor] Bắt đầu tự động quét các Kênh Douyin đối thủ / hot creator...");
        try {
            // Có thể mở rộng lấy danh sách channelUrl từ CSDL
            String[] targetChannels = {
                "https://www.douyin.com/user/MS4wLjABAAAA_sample_channel_id"
            };

            for (String channelUrl : targetChannels) {
                try {
                    log.info("🌐 [Douyin Monitor] Đang quét kênh: {}", channelUrl);
                    Map<String, Object> body = Map.of("channelUrl", channelUrl, "limit", 3);
                    Map<?, ?> response = restTemplate.postForObject(WORKER_BASE_URL + "/api/hunt-tiktok-channel", body, Map.class);
                    if (response != null && Boolean.TRUE.equals(response.get("success"))) {
                        log.info("✅ [Douyin Monitor] Đã trích xuất danh sách video mới từ kênh thành công.");
                    }
                } catch (Exception channelErr) {
                    log.warn("⚠️ [Douyin Monitor] Lỗi khi quét kênh {}: {}", channelUrl, channelErr.getMessage());
                }
            }
        } catch (Exception e) {
            log.error("❌ [Douyin Monitor] Lỗi hệ thống khi quét Kênh Douyin ngầm: {}", e.getMessage());
        }
    }
}
