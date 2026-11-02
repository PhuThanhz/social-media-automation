package com.autopost.saas.publishing.service;

import com.autopost.saas.entity.Campaign;
import com.autopost.saas.entity.PostExecutionAttempt;
import com.autopost.saas.entity.PostQueue;
import com.autopost.saas.entity.User;
import com.autopost.saas.repository.CampaignRepository;
import com.autopost.saas.repository.PostExecutionAttemptRepository;
import com.autopost.saas.repository.PostQueueRepository;
import com.autopost.saas.repository.SocialAccountRepository;
import com.autopost.saas.scheduler.CampaignScheduler;
import com.autopost.saas.service.PublishingControlCenterService;
import com.autopost.saas.service.WorkerRouterService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;

import java.time.LocalDateTime;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class AntiDuplicateLeasingTest {

    private PostQueueRepository postQueueRepository;
    private SocialAccountRepository socialAccountRepository;
    private CampaignRepository campaignRepository;
    private WorkerRouterService workerRouterService;
    private PostExecutionAttemptRepository attemptRepository;
    private CampaignScheduler campaignScheduler;
    private PublishingControlCenterService controlCenterService;

    private User testUser;
    private Campaign testCampaign;

    @BeforeEach
    void setUp() {
        postQueueRepository = mock(PostQueueRepository.class);
        socialAccountRepository = mock(SocialAccountRepository.class);
        campaignRepository = mock(CampaignRepository.class);
        workerRouterService = mock(WorkerRouterService.class);
        attemptRepository = mock(PostExecutionAttemptRepository.class);
        campaignScheduler = mock(CampaignScheduler.class);

        controlCenterService = new PublishingControlCenterService(
                postQueueRepository,
                socialAccountRepository,
                campaignRepository,
                workerRouterService,
                attemptRepository,
                campaignScheduler
        );

        testUser = new User();
        testUser.setId(10L);

        testCampaign = new Campaign();
        testCampaign.setId(100L);
        testCampaign.setUser(testUser);
    }

    @Test
    @DisplayName("Kịch bản 1: Hai worker cùng tranh 1 job — chỉ 1 worker được cấp lease, worker thứ hai bị từ chối")
    void testConcurrentLeaseAcquisitionConflict() {
        Long postId = 501L;
        String worker1 = "http://localhost:3001";
        String worker2 = "http://localhost:3002";
        String token1 = UUID.randomUUID().toString();
        String token2 = UUID.randomUUID().toString();
        LocalDateTime now = LocalDateTime.now();
        LocalDateTime expiresAt = now.plusMinutes(5);

        // Worker 1 nhanh hơn: acquireLease thành công (trả về 1)
        when(postQueueRepository.acquireLease(eq(postId), eq(worker1), eq(token1), any(), any()))
                .thenReturn(1);
        // Worker 2 đến sau: acquireLease thất bại (trả về 0 do job đã ở PROCESSING với lease còn hạn)
        when(postQueueRepository.acquireLease(eq(postId), eq(worker2), eq(token2), any(), any()))
                .thenReturn(0);

        int resultWorker1 = postQueueRepository.acquireLease(postId, worker1, token1, now, expiresAt);
        int resultWorker2 = postQueueRepository.acquireLease(postId, worker2, token2, now, expiresAt);

        assertEquals(1, resultWorker1, "Worker 1 phải chiếm được lease thành công");
        assertEquals(0, resultWorker2, "Worker 2 phải bị chặn để chống đăng trùng");
    }

    @Test
    @DisplayName("Kịch bản 2: RESET_PENDING bị từ chối nếu có Worker đang trong trạng thái IN_PROGRESS")
    void testResetPendingRejectedWhenWorkerInProgress() {
        Long postId = 601L;
        PostQueue post = new PostQueue();
        post.setId(postId);
        post.setCampaign(testCampaign);
        post.setStatus("NEEDS_REVIEW");

        when(postQueueRepository.findById(postId)).thenReturn(Optional.of(post));
        when(campaignScheduler.askWorkerPostResult(post)).thenReturn("IN_PROGRESS");

        IllegalStateException ex = assertThrows(IllegalStateException.class, () ->
                controlCenterService.verifyPost(postId, 10L, "RESET_PENDING", "Thử reset"));

        assertTrue(ex.getMessage().contains("Một Worker trong cụm đang tích cực xử lý bài viết này"));
        // Đảm bảo không đổi trạng thái bài viết
        verify(postQueueRepository, never()).save(any());
    }

    @Test
    @DisplayName("Kịch bản 3: RESET_PENDING bị từ chối nếu Worker xác nhận bài ĐÃ ĐĂNG THÀNH CÔNG")
    void testResetPendingRejectedWhenWorkerAlreadySucceeded() {
        Long postId = 701L;
        PostQueue post = new PostQueue();
        post.setId(postId);
        post.setCampaign(testCampaign);
        post.setStatus("NEEDS_REVIEW");
        post.setPublishedPostUrl("https://www.facebook.com/1000/posts/999888");

        when(postQueueRepository.findById(postId)).thenReturn(Optional.of(post));
        when(campaignScheduler.askWorkerPostResult(post)).thenReturn("SUCCESS");

        IllegalStateException ex = assertThrows(IllegalStateException.class, () ->
                controlCenterService.verifyPost(postId, 10L, "RESET_PENDING", "Muốn đăng lại"));

        assertTrue(ex.getMessage().contains("Worker trong cụm xác nhận bài này ĐÃ ĐĂNG THÀNH CÔNG"));
        verify(postQueueRepository, never()).save(any());
    }

    @Test
    @DisplayName("Kịch bản 4: RESET_PENDING thành công khi kiểm tra an toàn và giải phóng khóa cũ")
    void testResetPendingSafeReconciliation() {
        Long postId = 801L;
        PostQueue post = new PostQueue();
        post.setId(postId);
        post.setCampaign(testCampaign);
        post.setStatus("NEEDS_REVIEW");
        post.setLockedBy("old-worker-3001");
        post.setLockToken("old-token-abc");

        when(postQueueRepository.findById(postId)).thenReturn(Optional.of(post));
        when(campaignScheduler.askWorkerPostResult(post)).thenReturn(null); // Không có worker nào đang chạy

        boolean ok = controlCenterService.verifyPost(postId, 10L, "RESET_PENDING", "Đã check page và chưa có bài");

        assertTrue(ok);
        assertEquals("PENDING", post.getStatus());
        assertNull(post.getLockedBy(), "Khóa cũ phải được giải phóng");
        assertNull(post.getLockToken(), "Fencing token cũ phải bị hủy");
        assertEquals(0, post.getRetryCount());

        // Kiểm tra audit attempt được lưu lại
        ArgumentCaptor<PostExecutionAttempt> attemptCaptor = ArgumentCaptor.forClass(PostExecutionAttempt.class);
        verify(attemptRepository).save(attemptCaptor.capture());
        PostExecutionAttempt savedAttempt = attemptCaptor.getValue();
        assertEquals("RESET_PENDING", savedAttempt.getStatus());
        assertTrue(savedAttempt.getErrorMessage().contains("Đã check page"));
    }

    @Test
    @DisplayName("Kịch bản 5: CONFIRM_PUBLISHED chốt bài an toàn và ghi nhận audit log")
    void testConfirmPublishedAuditLogging() {
        Long postId = 901L;
        PostQueue post = new PostQueue();
        post.setId(postId);
        post.setCampaign(testCampaign);
        post.setStatus("NEEDS_REVIEW");
        post.setPublishedPostUrl("https://facebook.com/permalink/12345");

        when(postQueueRepository.findById(postId)).thenReturn(Optional.of(post));

        boolean ok = controlCenterService.verifyPost(postId, 10L, "CONFIRM_PUBLISHED", "Đã thấy bài hiển thị trên tường");

        assertTrue(ok);
        assertEquals("PUBLISHED", post.getStatus());
        assertNotNull(post.getPublishedAt());

        ArgumentCaptor<PostExecutionAttempt> attemptCaptor = ArgumentCaptor.forClass(PostExecutionAttempt.class);
        verify(attemptRepository).save(attemptCaptor.capture());
        assertEquals("CONFIRM_PUBLISHED", attemptCaptor.getValue().getStatus());
        assertEquals("https://facebook.com/permalink/12345", attemptCaptor.getValue().getProofUrl());
    }
}

