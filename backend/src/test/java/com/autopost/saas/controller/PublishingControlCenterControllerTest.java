package com.autopost.saas.controller;

import com.autopost.saas.dto.PostQueueDto;
import com.autopost.saas.entity.Campaign;
import com.autopost.saas.entity.PostQueue;
import com.autopost.saas.entity.User;
import com.autopost.saas.publishing.model.PreflightResult;
import com.autopost.saas.publishing.service.PublishingPreflightService;
import com.autopost.saas.repository.PostQueueRepository;
import com.autopost.saas.repository.SocialAccountRepository;
import com.autopost.saas.repository.UserRepository;
import com.autopost.saas.service.PublishingControlCenterService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;

import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.when;

class PublishingControlCenterControllerTest {

    private PublishingControlCenterService controlCenterService;
    private PublishingPreflightService preflightService;
    private UserRepository userRepository;
    private PostQueueRepository postQueueRepository;
    private SocialAccountRepository socialAccountRepository;
    private PublishingControlCenterController controller;
    private com.autopost.saas.scheduler.CampaignScheduler campaignScheduler;
    private com.autopost.saas.service.PostingWindowService postingWindowService;

    private User testUser;
    private Authentication auth;

    @BeforeEach
    void setUp() {
        controlCenterService = Mockito.mock(PublishingControlCenterService.class);
        preflightService = Mockito.mock(PublishingPreflightService.class);
        userRepository = Mockito.mock(UserRepository.class);
        postQueueRepository = Mockito.mock(PostQueueRepository.class);
        socialAccountRepository = Mockito.mock(SocialAccountRepository.class);
        campaignScheduler = Mockito.mock(com.autopost.saas.scheduler.CampaignScheduler.class);
        postingWindowService = Mockito.mock(com.autopost.saas.service.PostingWindowService.class);
        Mockito.when(postingWindowService.defaultGapSeconds()).thenReturn(120);

        controller = new PublishingControlCenterController(
                controlCenterService,
                preflightService,
                userRepository,
                postQueueRepository,
                socialAccountRepository,
                campaignScheduler,
                postingWindowService
        );

        testUser = new User();
        testUser.setId(10L);
        testUser.setEmail("test@autopost.com");

        auth = Mockito.mock(Authentication.class);
        when(auth.getName()).thenReturn("test@autopost.com");
        when(userRepository.findByEmail("test@autopost.com")).thenReturn(Optional.of(testUser));
    }

    @Test
    @DisplayName("GET /api/publishing-control-center/overview trả về thông tin tổng quan hệ thống")
    void testGetOverview() {
        Map<String, Object> mockOverview = new HashMap<>();
        mockOverview.put("totalActiveInQueue", 42L);

        when(controlCenterService.getControlCenterOverview(10L)).thenReturn(mockOverview);

        ResponseEntity<Map<String, Object>> res = controller.getOverview(auth);
        assertNotNull(res.getBody());
        assertEquals(42L, res.getBody().get("totalActiveInQueue"));
    }

    @Test
    @DisplayName("GET /api/publishing-control-center/queue phân trang mượt mà")
    void testGetPaginatedQueue() {
        PostQueueDto dto = PostQueueDto.builder().id(101L).title("Test Post").status("QUEUED").build();
        Page<PostQueueDto> mockPage = new PageImpl<>(List.of(dto));

        when(controlCenterService.getPaginatedQueue(10L, "QUEUED", null, 0, 20)).thenReturn(mockPage);

        ResponseEntity<Page<PostQueueDto>> res = controller.getPaginatedQueue("QUEUED", null, 0, 20, auth);
        assertNotNull(res.getBody());
        assertEquals(1, res.getBody().getTotalElements());
        assertEquals(101L, res.getBody().getContent().get(0).getId());
    }

    @Test
    @DisplayName("POST /api/publishing-control-center/verify/{postId} xử lý xác minh hợp lệ")
    void testVerifyPost() {
        when(controlCenterService.verifyPost(101L, 10L, "CONFIRM_PUBLISHED", "Verified on FB")).thenReturn(true);

        ResponseEntity<Map<String, Object>> res = controller.verifyPost(
                101L,
                Map.of("action", "CONFIRM_PUBLISHED", "notes", "Verified on FB"),
                auth
        );

        assertNotNull(res.getBody());
        assertEquals(true, res.getBody().get("success"));
        assertEquals("CONFIRM_PUBLISHED", res.getBody().get("action"));
    }

    @Test
    @DisplayName("POST /api/publishing-control-center/bulk-cancel xử lý hủy an toàn")
    void testBulkCancel() {
        when(controlCenterService.bulkCancelPosts(10L, List.of(1L, 2L, 3L))).thenReturn(3);

        ResponseEntity<Map<String, Object>> res = controller.bulkCancel(
                Map.of("postIds", List.of(1, 2, 3)),
                auth
        );

        assertNotNull(res.getBody());
        assertEquals(true, res.getBody().get("success"));
        assertEquals(3, res.getBody().get("cancelledCount"));
    }

    @Test
    @DisplayName("POST /api/publishing-control-center/preflight-check/{postId} kiểm tra bài viết trước khi đăng")
    void testPreflightCheckPost() {
        Campaign campaign = new Campaign();
        campaign.setUser(testUser);

        PostQueue post = new PostQueue();
        post.setId(99L);
        post.setCampaign(campaign);
        post.setContent("Nội dung chuẩn");

        when(postQueueRepository.findById(99L)).thenReturn(Optional.of(post));
        when(preflightService.validatePost(isNull(), eq(post))).thenReturn(PreflightResult.success());
        when(controlCenterService.preflightCheckPost(eq(10L), eq(99L), any())).thenReturn(PreflightResult.success());

        ResponseEntity<?> res = controller.preflightCheckPost(99L, auth);
        assertEquals(200, res.getStatusCode().value());
        assertTrue(res.getBody() instanceof PreflightResult);
        assertTrue(((PreflightResult) res.getBody()).isValid());
    }

    @Test
    @DisplayName("bulk-reschedule xếp lại theo lịch đăng chung (khung giờ + làn nick)")
    void bulkRescheduleUsesSharedSchedule() {
        when(controlCenterService.bulkReschedulePosts(eq(10L), anyList(), any(), anyInt())).thenReturn(2);
        Map<String, Object> body = new HashMap<>();
        body.put("postIds", List.of(1, 2));
        controller.bulkReschedule(body, auth);
        Mockito.verify(campaignScheduler).packContinuousFrom(List.of(1L, 2L), 120, null);
    }
}

