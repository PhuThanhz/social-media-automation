package com.autopost.saas.publishing.service;

import com.autopost.saas.entity.PostQueue;
import com.autopost.saas.entity.SocialAccount;
import com.autopost.saas.repository.CampaignRepository;
import com.autopost.saas.repository.PostQueueGroupResultRepository;
import com.autopost.saas.repository.PostQueueRepository;
import com.autopost.saas.repository.SocialAccountRepository;
import com.autopost.saas.scheduler.CampaignScheduler;
import com.autopost.saas.service.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.client.RestTemplate;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class WorkerClusterReliabilityTest {

    private WorkerRouterService workerRouterService;
    private RestTemplate mockRestTemplate;
    private CampaignScheduler campaignScheduler;
    private PostQueueRepository postQueueRepository;

    @BeforeEach
    void setUp() {
        // Cấu hình cụm 3 Worker: 3001, 3002, 3003
        workerRouterService = new WorkerRouterService(
                "http://localhost:3001,http://localhost:3002,http://localhost:3003",
                "http://localhost:3001"
        );
        mockRestTemplate = mock(RestTemplate.class);
        ReflectionTestUtils.setField(workerRouterService, "healthCheckClient", mockRestTemplate);

        postQueueRepository = mock(PostQueueRepository.class);
        campaignScheduler = new CampaignScheduler(
                mock(CampaignRepository.class),
                postQueueRepository,
                mock(PostQueueGroupResultRepository.class),
                mock(SocialAccountRepository.class),
                mock(ScraperService.class),
                mock(PostQueueService.class),
                mock(FacebookGraphApiService.class),
                mock(PlaywrightHealthCheckService.class),
                mock(ViaCookieFollowService.class),
                mock(PostingWindowService.class),
                mock(NickThrottleService.class),
                workerRouterService
        );
        ReflectionTestUtils.setField(campaignScheduler, "workerStatusClient", mockRestTemplate);
    }

    @Test
    @DisplayName("Kịch bản 1: Phân bổ 3 Worker cố định theo mã băm Account (Affinity)")
    void testThreeWorkerAccountAffinity() {
        List<String> allWorkers = workerRouterService.getAllWorkerUrls();
        assertEquals(3, allWorkers.size());
        assertTrue(allWorkers.contains("http://localhost:3001"));
        assertTrue(allWorkers.contains("http://localhost:3002"));
        assertTrue(allWorkers.contains("http://localhost:3003"));

        // Giả lập cả 3 worker đều sống
        when(mockRestTemplate.getForObject(contains("/api/health"), eq(Map.class)))
                .thenReturn(Map.of("status", "ok"));

        String routeA = workerRouterService.getPostingWorkerUrl("/api/post", "account-alpha");
        String routeB = workerRouterService.getPostingWorkerUrl("/api/post", "account-alpha");
        assertEquals(routeA, routeB, "Cùng một account phải luôn được định tuyến về cùng 1 worker để giữ cookie profile");
    }

    @Test
    @DisplayName("Kịch bản 2: Tự động chuyển hướng (Failover) khi 1 Worker bị offline")
    void testWorkerFailoverWhenPrimaryOffline() {
        // Giả lập worker 3001 offline, worker 3002 và 3003 online
        when(mockRestTemplate.getForObject(eq("http://localhost:3001/api/health"), eq(Map.class)))
                .thenThrow(new RuntimeException("Connection refused"));
        when(mockRestTemplate.getForObject(eq("http://localhost:3002/api/health"), eq(Map.class)))
                .thenReturn(Map.of("status", "ok"));
        when(mockRestTemplate.getForObject(eq("http://localhost:3003/api/health"), eq(Map.class)))
                .thenReturn(Map.of("status", "ok"));

        String chosenWorker = workerRouterService.getPostingWorkerUrl("/api/post", "account-that-maps-to-3001");
        assertNotNull(chosenWorker);
        assertFalse(chosenWorker.startsWith("http://localhost:3001"), "Không được gửi job vào worker đang offline");
        assertTrue(chosenWorker.startsWith("http://localhost:3002") || chosenWorker.startsWith("http://localhost:3003"),
                "Tự động failover sang worker 3002 hoặc 3003");
    }

    @Test
    @DisplayName("Kịch bản 3: Đối soát đa worker — Worker 3003 đăng thành công, hệ thống tìm thấy và cập nhật proof URL")
    void testCrossWorkerReconciliationFindsResultOnWorker3() {
        PostQueue post = new PostQueue();
        post.setId(3145L);
        post.setStatus("PROCESSING");

        // Worker 3001 trả về rỗng (không chạy bài này)
        when(mockRestTemplate.getForObject(eq("http://localhost:3001/api/post-results/3145"), eq(Map.class)))
                .thenReturn(Map.of("legs", List.of()));

        // Worker 3002 lỗi kết nối
        when(mockRestTemplate.getForObject(eq("http://localhost:3002/api/post-results/3145"), eq(Map.class)))
                .thenThrow(new RuntimeException("Timeout"));

        // Worker 3003 có kết quả SUCCESS với postUrl thật
        Map<String, Object> legSuccess = Map.of(
                "status", "SUCCESS",
                "postUrl", "https://facebook.com/watch/?v=11223344"
        );
        when(mockRestTemplate.getForObject(eq("http://localhost:3003/api/post-results/3145"), eq(Map.class)))
                .thenReturn(Map.of("legs", List.of(legSuccess)));

        String verdict = campaignScheduler.askWorkerPostResult(post);

        assertEquals("SUCCESS", verdict);
        assertEquals("https://facebook.com/watch/?v=11223344", post.getPublishedPostUrl());
    }

    @Test
    @DisplayName("Kịch bản 4: Khi bất kỳ worker nào trả về IN_PROGRESS, scheduler bảo lưu không can thiệp")
    void testWorkerInProgressPreventsIntervention() {
        PostQueue post = new PostQueue();
        post.setId(4001L);
        post.setStatus("PROCESSING");

        Map<String, Object> legRunning = Map.of("status", "IN_PROGRESS");
        when(mockRestTemplate.getForObject(eq("http://localhost:3002/api/post-results/4001"), eq(Map.class)))
                .thenReturn(Map.of("legs", List.of(legRunning)));

        String verdict = campaignScheduler.askWorkerPostResult(post);

        assertEquals("IN_PROGRESS", verdict);
    }
}

