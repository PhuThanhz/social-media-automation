package com.autopost.saas.service;

import com.autopost.saas.dto.PostQueueDto;
import com.autopost.saas.entity.Campaign;
import com.autopost.saas.entity.PostQueue;
import com.autopost.saas.entity.User;
import com.autopost.saas.repository.CampaignRepository;
import com.autopost.saas.repository.PostQueueRepository;
import com.autopost.saas.repository.SocialAccountRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.when;

class PublishingControlCenterBenchmarkTest {

    @Test
    @DisplayName("Thử nghiệm tải và phân trang 1,000 bài viết trong hàng đợi đảm bảo thời gian xử lý < 50ms")
    void testPaginatedQueuePerformanceWith1000Posts() {
        PostQueueRepository postQueueRepository = Mockito.mock(PostQueueRepository.class);
        SocialAccountRepository socialAccountRepository = Mockito.mock(SocialAccountRepository.class);
        CampaignRepository campaignRepository = Mockito.mock(CampaignRepository.class);
        WorkerRouterService workerRouterService = Mockito.mock(WorkerRouterService.class);

        PublishingControlCenterService service = new PublishingControlCenterService(
                postQueueRepository,
                socialAccountRepository,
                campaignRepository,
                workerRouterService
        );

        User user = new User();
        user.setId(1L);

        Campaign campaign = new Campaign();
        campaign.setId(10L);
        campaign.setName("Chiến dịch Black Friday");
        campaign.setUser(user);

        // Tạo 1,000 bài viết giả lập
        List<PostQueue> simulated1000Posts = new ArrayList<>(1000);
        LocalDateTime now = LocalDateTime.now();
        for (long i = 1; i <= 1000; i++) {
            PostQueue p = new PostQueue();
            p.setId(i);
            p.setCampaign(campaign);
            p.setTitle("Bài đăng tự động #" + i);
            p.setContent("Nội dung bài viết quảng bá sản phẩm #" + i + " với ưu đãi sốc!");
            p.setMediaUrls("https://example.com/banner-" + (i % 10) + ".jpg");
            p.setStatus(i % 5 == 0 ? "PUBLISHED" : (i % 7 == 0 ? "FAILED" : "PENDING"));
            p.setScheduledAt(now.plusMinutes(i * 10));
            simulated1000Posts.add(p);
        }

        // Mô phỏng JPA trả về trang 20 bài từ tập dữ liệu 1,000 bài
        List<PostQueue> page20 = simulated1000Posts.subList(0, 20);
        Page<PostQueue> mockPage = new PageImpl<>(page20, PageRequest.of(0, 20), 1000);

        when(postQueueRepository.findQueuePaginatedForUser(eq(1L), any(), any(), any(Pageable.class)))
                .thenReturn(mockPage);

        // Đo đạc thời gian thực thi (Benchmark)
        long startNano = System.nanoTime();
        Page<PostQueueDto> result = service.getPaginatedQueue(1L, "ALL", null, 0, 20);
        long elapsedMs = (System.nanoTime() - startNano) / 1_000_000;

        assertNotNull(result);
        assertEquals(20, result.getContent().size());
        assertEquals(1000, result.getTotalElements());
        assertEquals(50, result.getTotalPages());

        // Đảm bảo thời gian DTO mapping và xử lý < 50ms
        assertTrue(elapsedMs < 50, "Thời gian xử lý phải < 50ms, thực tế: " + elapsedMs + "ms");
        System.out.println("⚡ [Benchmark] Xử lý phân trang 1,000 bài viết hoàn tất trong: " + elapsedMs + " ms");
    }

    @Test
    @DisplayName("Thử nghiệm dời lịch hàng loạt (Bulk Reschedule) an toàn và chính xác từng phút")
    void testBulkRescheduleAccuracy() {
        PostQueueRepository postQueueRepository = Mockito.mock(PostQueueRepository.class);
        SocialAccountRepository socialAccountRepository = Mockito.mock(SocialAccountRepository.class);
        CampaignRepository campaignRepository = Mockito.mock(CampaignRepository.class);
        WorkerRouterService workerRouterService = Mockito.mock(WorkerRouterService.class);

        PublishingControlCenterService service = new PublishingControlCenterService(
                postQueueRepository,
                socialAccountRepository,
                campaignRepository,
                workerRouterService
        );

        User user = new User();
        user.setId(2L);
        Campaign campaign = new Campaign();
        campaign.setUser(user);

        PostQueue p1 = new PostQueue();
        p1.setId(101L);
        p1.setCampaign(campaign);
        p1.setStatus("FAILED");

        PostQueue p2 = new PostQueue();
        p2.setId(102L);
        p2.setCampaign(campaign);
        p2.setStatus("PENDING");

        when(postQueueRepository.findById(101L)).thenReturn(java.util.Optional.of(p1));
        when(postQueueRepository.findById(102L)).thenReturn(java.util.Optional.of(p2));

        LocalDateTime startTime = LocalDateTime.of(2026, 11, 2, 10, 0, 0);
        int rescheduled = service.bulkReschedulePosts(2L, List.of(101L, 102L), startTime, 15);

        assertEquals(2, rescheduled);
        assertEquals(LocalDateTime.of(2026, 11, 2, 10, 0, 0), p1.getScheduledAt());
        assertEquals("PENDING", p1.getStatus());
        assertEquals(LocalDateTime.of(2026, 11, 2, 10, 15, 0), p2.getScheduledAt());
        assertEquals("PENDING", p2.getStatus());
    }
}

