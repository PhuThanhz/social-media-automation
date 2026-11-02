package com.autopost.saas.config;

import com.github.benmanes.caffeine.cache.Caffeine;
import org.springframework.cache.CacheManager;
import org.springframework.cache.annotation.EnableCaching;
import org.springframework.cache.caffeine.CaffeineCacheManager;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Duration;

/**
 * Cache TTL ngắn (30s), chỉ áp dụng cho danh sách hiển thị dropdown UI (social accounts, campaigns).
 * KHÔNG dùng cho dữ liệu ảnh hưởng luồng đăng bài live (VD: đếm số bài đã đăng/ngày, trạng thái PostQueue)
 * vì độ trễ cache có thể làm sai lệch giới hạn max-posts/day.
 */
@Configuration
@EnableCaching
public class CacheConfig {

    @Bean
    public CacheManager cacheManager() {
        CaffeineCacheManager manager = new CaffeineCacheManager("socialAccountsByUser", "campaignsByUser");
        manager.setCaffeine(Caffeine.newBuilder()
                .expireAfterWrite(Duration.ofSeconds(30))
                .maximumSize(500)
                .recordStats());
        return manager;
    }
}
